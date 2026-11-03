"""Opt-in bounded NDK debugger observer. Does not mutate application files."""
import json
import time
import traceback
import subprocess
import hashlib
import lldb

_config = {}
_lifecycle_hits = 0


def entry(debugger, config_path):
    with open(__file__, "rb") as source:
        print("DEBUGGER_PYTHON_SHA256|" + hashlib.sha256(source.read()).hexdigest(), flush=True)
    try:
        run(debugger, config_path)
    except Exception:
        print("CACHE_DEBUGGER_ERROR|" + traceback.format_exc(), flush=True)
        debugger.HandleCommand("quit 1")


def stack_record(frame):
    process = frame.GetThread().GetProcess()
    error = lldb.SBError()
    frames = []
    for item in list(frame.GetThread())[:30]:
        module = item.GetModule()
        load = item.GetPCAddress().GetLoadAddress(process.GetTarget())
        base = module.GetObjectFileHeaderAddress().GetLoadAddress(process.GetTarget())
        frames.append({
            "index": item.GetFrameID(), "function": item.GetFunctionName(),
            "module": str(module.GetFileSpec()), "pc": hex(load),
            "offset": hex(load - base) if base != lldb.LLDB_INVALID_ADDRESS else None,
        })
    # Record raw return addresses as well: Android's remote stub may not expose
    # all ELF modules to a Windows host. Resolve against the actual PID maps,
    # without downloading arbitrary modules or claiming symbol names.
    maps_result = subprocess.run([
        _config["adb"], "-P", str(_config["adbPort"]), "-s", _config["serial"],
        "shell", "su", "0", "cat", "/proc/" + str(process.GetProcessID()) + "/maps",
    ], capture_output=True, text=True, timeout=3)
    maps = []
    for row in maps_result.stdout.splitlines():
        fields = row.split(None, 5)
        if len(fields) == 6:
            begin, end = (int(value, 16) for value in fields[0].split("-"))
            maps.append((begin, end, int(fields[2], 16), fields[5]))
    def address_record(value):
        for begin, end, file_offset, module in maps:
            if begin <= value < end:
                return {"pc": hex(value), "module": module,
                        "offset": hex(value - begin + file_offset)}
        return {"pc": hex(value), "module": None}
    raw_returns = []
    stack = frame.FindRegister("rsp").GetValueAsUnsigned()
    pointer = process.ReadPointerFromMemory(stack, error)
    if error.Success():
        raw_returns.append({"source": "function-entry-stack-return", **address_record(pointer)})
    rbp = frame.FindRegister("rbp").GetValueAsUnsigned()
    for _ in range(20):
        next_rbp = process.ReadPointerFromMemory(rbp, error)
        if error.Fail():
            break
        pointer = process.ReadPointerFromMemory(rbp + 8, error)
        if error.Fail():
            break
        raw_returns.append({"source": "frame-pointer-chain", **address_record(pointer)})
        if next_rbp <= rbp or next_rbp - rbp > 1048576:
            break
        rbp = next_rbp
    return {
        "pid": process.GetProcessID(),
        "tid": frame.GetThread().GetThreadID(), "frames": frames,
        "time": time.time(),
        "rawReturns": raw_returns, "mapsExitCode": maps_result.returncode,
    }


def cache_delete(frame, bp_loc, internal_dict):
    process = frame.GetThread().GetProcess()
    function = frame.GetFunctionName() or frame.GetSymbol().GetName() or ""
    register = "rsi" if "unlinkat" in function else "rdi"
    error = lldb.SBError()
    address = frame.FindRegister(register).GetValueAsUnsigned()
    filename = process.ReadCStringFromMemory(address, 4096, error)
    if error.Fail() or not filename:
        return False
    if filename != "Code Cache" and filename != _config["cacheDirectory"]:
        return False
    record = stack_record(frame)
    record.update(function=function, path=filename, observation="function-entry-not-syscall-return")
    print("CACHE_DELETE|" + json.dumps(record), flush=True)
    return False


def lifecycle_exit(frame, bp_loc, internal_dict):
    global _lifecycle_hits
    _lifecycle_hits += 1
    if _lifecycle_hits > 12:
        return False
    record = stack_record(frame)
    record.update(function=frame.GetFunctionName() or frame.GetSymbol().GetName() or "",
                  observation="function-entry-not-exit-completion")
    record["threads"] = [
        {"tid": thread.GetThreadID(), "name": thread.GetName(),
         "frames": [{"function": item.GetFunctionName(), "pc": hex(item.GetPC()),
                     "module": str(item.GetModule().GetFileSpec())}
                    for item in list(thread)[:8]]}
        for thread in list(frame.GetThread().GetProcess())[:64]
    ]
    print("LIFECYCLE_EXIT|" + json.dumps(record), flush=True)
    return False


def run(debugger, config_path):
    global _config
    with open(config_path, encoding="utf-8") as source:
        _config = json.load(source)
    debugger.HandleCommand("settings set target.memory-module-load-level minimal")
    # Complete target creation before attaching, and require the actual stopped
    # remote state instead of treating a successful connection as ready.
    debugger.SetAsync(False)
    target = debugger.CreateTarget(_config["localLibc"])
    module = target.GetModuleAtIndex(0)
    if not module.IsValid():
        raise RuntimeError("DEBUGGER_LIBC_MODULE_INVALID")
    listener = lldb.SBListener("agentvn-cache-probe")
    error = lldb.SBError()
    process = target.ConnectRemote(
        listener, "connect://127.0.0.1:" + str(_config["localPort"]), "gdb-remote", error)
    if error.Fail():
        raise RuntimeError("DEBUGGER_CONNECT:" + str(error))
    lifecycle = _config.get("mode") == "lifecycle-exit"
    prefix = "LIFECYCLE" if lifecycle else "CACHE"
    try:
        print("CACHE_DEBUGGER_ATTACHED|" + str(process.GetProcessID()), flush=True)
        print("DEBUGGER_INITIAL_STATE|" + str(process.GetState()), flush=True)
        # This listener owns the public state queue. LLDB applies a public
        # state on removal of its event; connection success alone is not stop.
        initial_deadline = time.monotonic() + 3
        while process.GetState() != lldb.eStateStopped and time.monotonic() < initial_deadline:
            event = lldb.SBEvent()
            if listener.WaitForEvent(1, event):
                print("DEBUGGER_INITIAL_EVENT|" + str(lldb.SBProcess.GetStateFromEvent(event))
                      + "|" + str(process.GetState()), flush=True)
        if process.GetState() != lldb.eStateStopped:
            raise RuntimeError("DEBUGGER_INITIAL_NOT_STOPPED:" + str(process.GetState()))
        if "x86_64" not in target.GetTriple():
            raise RuntimeError("DEBUGGER_ARCH_UNSUPPORTED:" + str(target.GetTriple()))
        result = target.SetModuleLoadAddress(module, int(_config["libcBase"], 16))
        if result.Fail():
            raise RuntimeError("DEBUGGER_LIBC_LOAD_ADDRESS:" + str(result))
        debugger.SetAsync(True)
        names = ("exit", "_exit", "abort", "__fortify_fatal") if lifecycle else ("unlinkat", "rmdir", "unlink", "remove")
        locations = 0
        lifecycle_breakpoints = set()
        for name in names:
            breakpoint = target.BreakpointCreateByName(name)
            if lifecycle:
                lifecycle_breakpoints.add(breakpoint.GetID())
            else:
                breakpoint.SetScriptCallbackFunction(__name__ + ".cache_delete")
            locations += breakpoint.GetNumLocations()
            print(prefix + "_BREAKPOINT|" + name + "|" + str(breakpoint.GetNumLocations()), flush=True)
        if lifecycle:
            if not locations:
                raise RuntimeError("DEBUGGER_LIFECYCLE_NO_BREAKPOINTS")
            # Observe fatal paths; never consume or mask their actual signals.
            signals = process.GetUnixSignals()
            for name in ("SIGABRT", "SIGSEGV", "SIGBUS"):
                number = signals.GetSignalNumberFromName(name)
                if number < 0 or not all((
                    signals.SetShouldSuppress(number, False),
                    signals.SetShouldStop(number, False),
                    signals.SetShouldNotify(number, True),
                )):
                    raise RuntimeError("DEBUGGER_SIGNAL_POLICY:" + name)
            debugger.SetAsync(True)
            print("LIFECYCLE_DEBUGGER_RESUME|" + json.dumps({
                "state": process.GetState(), "async": debugger.GetAsync(),
                "pid": process.GetProcessID(), "time": time.time(),
            }), flush=True)
        result = process.Continue()
        if result.Fail():
            raise RuntimeError("DEBUGGER_CONTINUE:" + str(result))
        if lifecycle:
            print("LIFECYCLE_DEBUGGER_READY|" + str(process.GetProcessID()), flush=True)
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            event = lldb.SBEvent()
            if listener.WaitForEvent(1, event):
                state = lldb.SBProcess.GetStateFromEvent(event)
                if state in (lldb.eStateExited, lldb.eStateDetached):
                    break
                if state == lldb.eStateStopped:
                    if lifecycle:
                        # Collect on this script's event loop. A nested Python
                        # breakpoint callback can contend with its interpreter.
                        for thread in process:
                            if (thread.GetStopReason() == lldb.eStopReasonBreakpoint
                                    and thread.GetStopReasonDataCount() >= 2
                                    and thread.GetStopReasonDataAtIndex(0) in lifecycle_breakpoints):
                                print("LIFECYCLE_STOP|" + str(thread.GetThreadID()) + "|"
                                      + str(thread.GetFrameAtIndex(0).GetFunctionName()), flush=True)
                                lifecycle_exit(thread.GetFrameAtIndex(0), None, None)
                    process.Continue()
    finally:
        if lifecycle and process.GetState() == lldb.eStateExited:
            print("LIFECYCLE_DEBUGGER_EXITED|" + str(process.GetExitStatus()), flush=True)
        else:
            if process.GetState() == lldb.eStateRunning:
                process.Stop()
            result = process.Detach()
            print(prefix + "_DEBUGGER_DETACHED|" + str(result.Success()).lower(), flush=True)

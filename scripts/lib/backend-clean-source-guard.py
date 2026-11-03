"""QA-only audit guard; never imported by the shipped application."""

import json
import os
from pathlib import Path
import sys
import traceback
from functools import lru_cache
import platform

ROOT = Path(os.environ["AGENTVN_QA_GUARD_ROOT"]).resolve()
ENV_ROOT = Path(os.environ["AGENTVN_QA_ENV_ROOT"]).resolve()
RECEIPT = ROOT / "test-boundary.json"
blocked = []
self_testing = True
current_test = None
platform_probe = None

# Python 3.11 win32_ver invokes the fixed stdlib `ver` command even when
# consumers only request OS metadata. Cache its actual default result before
# tests start; do not exempt NUL writes or child processes from the audit guard.
if sys.platform == "win32":
    platform._syscmd_ver = lru_cache(maxsize=4)(platform._syscmd_ver)
    platform_probe = {
        "scope": "QA startup only, before guard installation and test collection",
        "method": "cached actual platform._syscmd_ver() default result",
        "result": list(platform._syscmd_ver()),
    }


def within_root(value):
    for boundary in (ROOT, ENV_ROOT):
        try:
            Path(os.fsdecode(value)).resolve().relative_to(boundary)
            return True
        except (ValueError, TypeError):
            continue
    return False


def deny(category):
    if not self_testing:
        blocked.append({
            "category": category,
            "test": current_test,
            "stack": [{"file": Path(frame.filename).name, "function": frame.name, "line": frame.lineno}
                      for frame in traceback.extract_stack(limit=9)[:-1]],
        })
    raise PermissionError("Isolated source acceptance guard: " + category)


def audit(event, args):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
        destination = args[1] if event != "socket.getaddrinfo" else args[0]
        host = destination[0] if isinstance(destination, tuple) else destination
        if host not in ("127.0.0.1", "::1", "localhost"):
            deny("external-network")
    elif event == "sqlite3.connect":
        target = args[0]
        if target not in (":memory:", "") and not within_root(target):
            deny("database-outside-isolated-root")
    elif event == "subprocess.Popen":
        deny("child-process-during-tests")
    elif event == "open":
        target, mode, flags = args
        if isinstance(target, int):
            return
        write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
        writing = bool(flags & write_flags) if isinstance(flags, int) else False
        writing = writing or bool(mode and any(char in mode for char in "wax+"))
        if writing and not within_root(target):
            deny("write-outside-isolated-root")


sys.addaudithook(audit)
self_checks = []
for event, args in [
    ("socket.connect", (None, ("203.0.113.1", 443))),
    ("socket.getaddrinfo", ("example.invalid", 443, 0, 0, 0)),
    ("sqlite3.connect", (str(ROOT.parent / "outside-guard.sqlite"),)),
    ("open", (str(ROOT.parent / "outside-guard-file"), "w", os.O_WRONLY | os.O_CREAT)),
    ("subprocess.Popen", ("unused-qa-command", [], None, None)),
]:
    try:
        # Synthetic audit events prove rejection without making a real request/write.
        sys.audit(event, *args)
    except PermissionError:
        self_checks.append({"event": event, "status": "PASS"})
    else:
        raise AssertionError("QA isolation self-test did not reject: " + event)
self_testing = False


def pytest_runtest_setup(item):
    global current_test
    current_test = item.nodeid


def pytest_sessionfinish(session, exitstatus):
    if platform_probe is not None:
        platform_probe["cache"] = platform._syscmd_ver.cache_info()._asdict()
    RECEIPT.write_text(json.dumps({
        "status": "PASS" if not blocked and int(exitstatus) == 0 else "FAILED",
        "scope": "Python audit hooks during this pytest process; not an OS sandbox",
        "selfChecks": self_checks,
        "blockedUnexpectedOperations": blocked,
        "pytestExitCode": int(exitstatus),
        "platformMetadataProbe": platform_probe,
        "externalConnectionsAllowed": False,
        "loopbackConnectionsAllowed": True,
    }, indent=2), encoding="utf-8")

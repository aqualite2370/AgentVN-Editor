void (async () => {
  const packageName = process.argv[2];
  const expression = process.argv.slice(3).join(" ");
  if (!packageName || !expression) {
    throw new Error("Usage: node scripts/android-cdp-evaluate.cjs <package> <expression>");
  }
  const sdkRoot = process.env.ANDROID_SDK_ROOT || "D:\\Android_dev\\Sdk";
  const adb = `${sdkRoot}\\platform-tools\\adb.exe`;
  const { spawnSync } = await import("node:child_process");
  const pidResult = spawnSync(adb, ["-s", "emulator-5554", "shell", "pidof", packageName], { encoding: "utf8" });
  const pid = pidResult.stdout.trim().split(/\s+/)[0];
  if (!pid) throw new Error(`No running process for ${packageName}`);
  spawnSync(adb, ["-s", "emulator-5554", "forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`], { stdio: "ignore" });
  const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  if (!tabs[0]) throw new Error("No WebView CDP page");
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (message) => message.error ? reject(message.error) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  process.stdout.write(`${JSON.stringify(result.result.value ?? result.result, null, 2)}\n`);
  socket.close();
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

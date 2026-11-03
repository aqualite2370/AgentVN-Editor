void (async () => {
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
  expression: `(() => ({
    title: document.title,
    body: document.body.innerText.slice(0, 3000),
    screens: [...document.querySelectorAll("[data-ui-screen]")].map((element) => element.getAttribute("data-ui-screen")),
    buttons: [...document.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: button.innerText,
        testid: button.dataset.testid,
        aria: button.getAttribute("aria-label"),
        disabled: button.disabled,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }),
    diagnostics: window.__AGENTVN_RUNTIME_DIAGNOSTICS__ ?? null,
  }))()`,
  returnByValue: true,
  awaitPromise: true,
  });
  process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`);
  socket.close();
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

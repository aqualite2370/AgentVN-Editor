"use strict";
// QA only: actual current Dev host/WebView, isolated project/database/profile.
// One controlled loopback proposal prepares a real draft; no real model calls.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Assistant-Interaction-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-assistant-interaction-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const writeNew = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const sources = ["editor/src/styles/layout.css", "editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
  "editor/src/components/assistant/assistant-creation-workbench.css", "editor/src/components/editor/EditorToolbar.tsx"];
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"];
function prepare() {
  for (const d of [qa, checkpoint, summary]) { assert(!fs.existsSync(d)); fs.mkdirSync(d, { recursive: true }); }
  const copied = [];
  for (const f of [__filename, ...sources, "scripts/lib/current-native-editor-session.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/lib/controlled-assistant-provider.cjs",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const original = path.resolve(root, f), dest = path.join(checkpoint, path.relative(root, original));
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(original, dest, fs.constants.COPYFILE_EXCL); copied.push(desc(dest));
  }
  const sourceFixture = "F:/AgentVN/QA/Native-Assistant-Recovery-20261020-01/native-recovery-a-20261020-01.vnproj";
  const p = load(sourceFixture); p.project_id = "native-interaction-20261020-01";
  p.title = "Dev交互隔离_20261020"; p.created_at = p.updated_at = new Date().toISOString();
  const input = path.join(qa, `${p.project_id}.vnproj`); writeNew(input, p);
  writeNew(path.join(summary, "preparation.json"), { at: new Date().toISOString(), project: p,
    products: products.map(desc), sources: sources.map(desc), copied, input: desc(input), sourceFixture: desc(sourceFixture) });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration, diagnose = false) {
  assert(/^\d{2}$/.test(iteration)); const out = path.join(qa, `session-${iteration}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), project = prep.project;
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_INTERACTION_CONTROLLED_DRAFT_NOT_RELEASE_OR_PHYSICAL_INPUT",
    cases: [], inlineMatrix: [], focusMatrix: [], reopenMatrix: [], screenshots: [], launches: [], cleanups: [], errors: [],
    submissions: [], sources: sources.map(desc), products: products.map(desc), input: prep.input,
    realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    buildAccounting: "Dev startup builds GameCLI preview; no Dev publication build.",
    assertions: "12 display combinations each for inline draft geometry and floating keyboard focus; no old queue/recovery matrix replay." };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const session = nativeSession({ out, input: prep.input.path, report, save });
  let page, provider, started = false;
  const assertBytes = () => { for (const f of [...report.sources, ...report.products, report.input]) assert.equal(sha(f.path), f.sha256); };
  async function stage(name, fn) {
    const c = { name, status: "RUNNING", startedAt: Date.now() }; report.cases.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); console.log(`FAILED ${name}: ${e.message}`); }
    finally { c.finishedAt = Date.now(); save(); }
  }
  async function inline() {
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
    await panel.getByRole("button", { name: "创造模式", exact: true }).click();
    await panel.getByLabel("向大模型助手提问", { exact: true }).waitFor(); return panel;
  }
  async function finite(win) {
    await win.evaluate(async n => {
      await Promise.all(n.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }
  async function beginProbe() {
    await page.evaluate(() => {
      const previous = window.__nativeInteractionProbe;
      if (previous) { previous.running = false; previous.observer?.disconnect(); }
      const identity = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
      const probe = window.__nativeInteractionProbe = { running: true, frames: [], events: [], commits: [], identity };
      // Capture the actual React attribute commit inside the WebView. A later
      // CDP readback can arrive after a short reversal has already completed.
      if (identity) {
        probe.observer = new MutationObserver(() => {
          const s = getComputedStyle(identity);
          probe.commits.push({ t: performance.now(), closing: identity.dataset.closing,
            opacity: Number(s.opacity), transform: s.transform,
            transitions: identity.getAnimations().filter(a => "transitionProperty" in a).map(a => ({
              property: a.transitionProperty, currentTime: a.currentTime,
              timing: a.effect.getComputedTiming(), keyframes: a.effect.getKeyframes(),
            })) });
        });
        probe.observer.observe(identity, { attributes: true, attributeFilter: ["class", "data-closing"] });
      }
      const capture = e => {
        const button = e.target?.closest?.("button"), n = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
        probe.events.push({ t: performance.now(), type: e.type,
          key: e.key, label: (button ?? e.target)?.getAttribute?.("aria-label"), text: e.target?.textContent?.slice(0, 65),
          opacity: n && Number(getComputedStyle(n).opacity), closing: n?.dataset.closing });
      };
      probe.capture = capture;
      for (const type of ["click", "keydown", "focusin", "transitionend", "animationend"]) document.addEventListener(type, capture, true);
      const sample = () => {
        if (!probe.running) return;
        const n = document.querySelector('[data-testid="assistant-creation-workbench-window"]'), a = document.activeElement;
        const r = n?.getBoundingClientRect(), s = n && getComputedStyle(n);
        probe.frames.push({ t: performance.now(), exists: Boolean(n), closing: n?.dataset.closing,
          count: document.querySelectorAll('[data-testid="assistant-creation-workbench-window"]').length,
          sameWindow: !identity || n === identity,
          inert: n?.inert, activeInside: Boolean(n?.contains(a)), tag: a?.tagName, label: a?.getAttribute("aria-label"),
          opacity: s ? Number(s.opacity) : null, transform: s?.transform, rect: r?.toJSON() });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }
  async function endProbe() {
    return page.evaluate(() => {
      const probe = window.__nativeInteractionProbe; probe.running = false; probe.observer?.disconnect();
      for (const type of ["click", "keydown", "focusin", "transitionend", "animationend"]) document.removeEventListener(type, probe.capture, true);
      return { frames: probe.frames, events: probe.events, commits: probe.commits };
    });
  }
  const winLocator = () => page.getByTestId("assistant-creation-workbench-window");
  async function openKeyboard() {
    const panel = await inline(), opener = panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true });
    await opener.focus(); await beginProbe(); await page.keyboard.press("Enter");
    const win = winLocator(); await win.waitFor(); await win.getByTestId("assistant-creation-workbench-studio").waitFor();
    await finite(win); return win;
  }
  async function focus() {
    return page.evaluate(() => {
      const a = document.activeElement, n = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
      const r = a?.getBoundingClientRect();
      return { inside: Boolean(n?.contains(a)), tag: a?.tagName, label: a?.getAttribute("aria-label"),
        text: a?.textContent?.slice(0, 70), meaningful: a instanceof HTMLElement && a !== document.body &&
          a.matches("button,input,textarea,select,summary,a[href],[tabindex]") && !a.closest('[inert],[aria-hidden="true"]') &&
          r.width > 0 && r.height > 0 };
    });
  }
  async function unchanged() {
    const actual = (await session.api(`/api/project/projects/${project.project_id}`)).data;
    const authored = nodes => nodes.map(({ measured, ...n }) => n);
    assert.deepEqual(actual.editor_settings, report.baseline.editor_settings);
    assert.deepEqual(authored(actual.nodes), authored(report.baseline.nodes)); assert.deepEqual(actual.edges, report.baseline.edges);
    assert.deepEqual(actual.asset_manifest, report.baseline.asset_manifest);
  }
  try {
    assertBytes(); provider = await controlledAssistantProvider(); report.modelEndpoint = provider.url;
    started = true; await session.start(); page = session.page;
    page.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith("/api/assistant/creation/processes")) {
        const v = req.postDataJSON(); report.submissions.push({ id: v.id, projectId: v.project_id, conversationId: v.conversation_id }); save();
      }
    });
    const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(prep.input.path)) }, body: fs.readFileSync(prep.input.path) });
    const imported = await r.json(); assert(r.ok && imported.ok);
    report.baseline = (await session.api(`/api/project/projects/${project.project_id}`)).data;
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-interaction", provider_type: "openai_compatible", display_name: "本机交互受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-interaction", model_id: "controlled-model",
        model_name: "controlled-model", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-interaction": "test-only-secret" },
    });
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await stage("real-ui-controlled-draft-preparation-without-merge", async () => {
      const panel = await inline(); await panel.getByTestId("assistant-new-conversation").click();
      report.emptyMonitor = await panel.getByTestId("assistant-process-monitor").evaluate(n => ({
        rect: n.getBoundingClientRect().toJSON(), clientHeight: n.clientHeight, scrollHeight: n.scrollHeight,
        gridRows: getComputedStyle(n.parentElement).gridTemplateRows }));
      await panel.getByLabel("向大模型助手提问", { exact: true }).fill("HISTORY_A 构建标题关于按钮");
      await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await until(() => report.submissions.length === 1, "one actual task submission");
      const t = report.submissions[0];
      const final = await until(async () => { const p = await session.api(`/api/assistant/creation/processes/${t.id}`);
        return ["completed", "failed"].includes(p.status) && p; }, "draft terminal");
      assert.equal(final.status, "completed", JSON.stringify(final));
      await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "HISTORY_A组件", exact: true }).waitFor();
      assert.equal(provider.requests.length, 1); await unchanged(); return { task: t.id, status: final.status };
    });
    if (report.cases[0].status !== "PASS") throw Error("Draft setup failed; dependent tests must not claim coverage.");
    if (diagnose) {
      await stage("single-variable-grid-row-probe-restored-before-exit", async () => {
        const observations = [];
        for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
          await session.metrics({ width, height, dpr: 1, reduced: false });
          const panel = await inline();
          const observation = await panel.evaluate(n => {
            const measure = () => {
              const m = n.querySelector(".assistant-process-monitor"), h = m.querySelector("header");
              const body = n.querySelector(".assistant-chat-body"), r = m.getBoundingClientRect(), hr = h.getBoundingClientRect();
              return { rows: getComputedStyle(n).gridTemplateRows, monitor: r.toJSON(), header: hr.toJSON(),
                bodyGap: body.getBoundingClientRect().top - r.bottom,
                headerHit: h.contains(document.elementFromPoint(hr.x + hr.width / 2, hr.y + hr.height / 2)) };
            };
            const original = n.style.gridTemplateRows, before = measure();
            try {
              n.style.gridTemplateRows = "auto auto auto minmax(0, 1fr) auto";
              return { before, probe: measure() };
            } finally { n.style.gridTemplateRows = original; }
          });
          observations.push({ width, height, ...observation });
          const g = observation.probe;
          assert(g.headerHit && g.header.bottom <= g.monitor.bottom + 1);
          assert(g.bodyGap >= 0 && g.bodyGap < 32, "Monitor track must not leave a growing empty spacer");
          if (width === 1920) assert(!observation.before.headerHit, "Expected original failure before probe");
        }
        return observations;
      });
      await unchanged(); assert.equal(provider.requests.length, 1);
      report.status = report.cases.every(c => c.status === "PASS") ? "CURRENT_NATIVE_DIAGNOSIS_PASS" : "FAILED";
      if (report.status === "FAILED") process.exitCode = 1;
      return;
    }
    await stage("inline-expanded-draft-process-monitor-twelve-combinations", async () => {
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }, item = { ...v, status: "RUNNING" }; report.inlineMatrix.push(item);
        try {
          await session.metrics(v); const panel = await inline();
          await panel.getByTestId("assistant-creation-draft").waitFor();
          const monitor = panel.getByTestId("assistant-process-monitor");
          item.geometry = await monitor.evaluate(n => {
            const header = n.querySelector("header"), r = n.getBoundingClientRect(), h = header.getBoundingClientRect();
            const a = n.querySelector("li summary"), ar = a?.getBoundingClientRect();
            const hit = document.elementFromPoint(h.x + h.width / 2, h.y + h.height / 2);
            const parent = n.parentElement, input = parent.querySelector("textarea")?.getBoundingClientRect();
            const parentStyle = getComputedStyle(parent), rows = parentStyle.gridTemplateRows.split(" ").map(Number.parseFloat);
            const bodyGap = parent.querySelector(".assistant-chat-body").getBoundingClientRect().top - r.bottom;
            return { rect: r.toJSON(), header: h.toJSON(), headerHit: hit === header || header.contains(hit),
              childControl: ar?.toJSON(), clientHeight: n.clientHeight, scrollHeight: n.scrollHeight,
              parentChildren: parent.children.length, gridRows: parentStyle.gridTemplateRows,
              bodyGap, trackHeight: rows[2], rowGap: Number.parseFloat(parentStyle.rowGap),
              input: input?.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
          });
          const g = item.geometry;
          assert(g.header.top >= g.rect.top - 1 && g.header.bottom <= g.rect.bottom + 1 && g.headerHit,
            `Process monitor header clipped or not hit: ${JSON.stringify(g)}`);
          assert(g.bodyGap >= -1 && g.bodyGap < 32 && g.trackHeight <= g.rect.height + 1,
            `Process track must fit its monitor, not a growing empty spacer: ${JSON.stringify(g)}`);
          assert(g.overflow <= 1 && g.input.top >= 0 && g.input.bottom <= height + 1);
          const details = monitor.locator("li details").first(), toggle = details.locator("summary");
          await toggle.scrollIntoViewIfNeeded(); await toggle.click();
          item.detailsOpened = await details.evaluate(n => n.open); assert(item.detailsOpened);
          await toggle.click(); item.detailsClosed = await details.evaluate(n => !n.open); assert(item.detailsClosed);
          item.status = "PASS";
        } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
        save();
        if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
          await session.shot(`inline-${width}-dpr${dpr}-${reduced}`);
      }
      assert.equal(report.inlineMatrix.length, 12);
      assert(report.inlineMatrix.every(i => i.status === "PASS"), "Inline monitor geometry/actionability matrix failed");
      return { combinations: 12 };
    });
    await stage("floating-keyboard-open-close-focus-twelve-combinations", async () => {
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }, item = { ...v, status: "RUNNING" }; report.focusMatrix.push(item);
        try {
          await session.metrics(v); const win = await openKeyboard();
          item.open = await focus(); item.entry = await endProbe();
          item.geometry = await win.evaluate(n => ({ rect: n.getBoundingClientRect().toJSON(),
            overflow: document.documentElement.scrollWidth - innerWidth }));
          assert(item.open.inside && item.open.meaningful, "Keyboard open must own actionable window focus");
          const visibleFrames = item.entry.frames.filter(f => f.exists && !f.inert);
          assert(visibleFrames.length > 0 && visibleFrames.every(f => f.activeInside), "Entry stole or lost keyboard focus");
          assert(visibleFrames.some(f => f.opacity > 0 && f.opacity < .995), "No visible intermediate entry frame");
          const g = item.geometry;
          assert(g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= width + 1 && g.rect.bottom <= height + 1 && g.overflow <= 1);
          const close = win.getByRole("button", { name: "关闭工作台", exact: true });
          await close.focus(); await beginProbe(); await page.keyboard.press("Enter");
          item.closing = await focus();
          assert(item.closing.meaningful && !item.closing.inside, "Close must transfer focus before decorative exit");
          const options = page.locator('[data-workspace-surface="options"]:visible'); await options.focus();
          await win.waitFor({ state: "detached" }); item.after = await focus(); item.exit = await endProbe();
          assert(await options.evaluate(n => document.activeElement === n), "Exit cleanup stole newer keyboard focus");
          assert(item.exit.frames.filter(f => f.exists && f.closing === "true").every(f => f.inert && !f.activeInside));
          item.status = "PASS";
        } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
        finally {
          await endProbe().catch(() => {});
          const win = winLocator();
          if (await win.count()) {
            if (await win.getAttribute("data-closing") !== "true") await win.getByRole("button", { name: "关闭工作台", exact: true }).click();
            await win.waitFor({ state: "detached" });
          }
          save();
        }
      }
      assert.equal(report.focusMatrix.length, 12);
      assert(report.focusMatrix.every(i => i.status === "PASS"), "Floating keyboard/focus matrix failed"); return { combinations: 12 };
    });
    await stage("nonmodal-background-and-keyboard-minimize-restore", async () => {
      await session.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      const win = await openKeyboard(); await endProbe();
      const edit = page.locator('[data-workspace-surface="edit"]:visible'); await edit.click();
      assert(await edit.evaluate(n => document.activeElement === n)); assert(await win.isVisible());
      const minimize = win.getByRole("button", { name: "最小化工作台", exact: true });
      await minimize.focus(); await page.keyboard.press("Enter");
      const restore = win.getByRole("button", { name: "恢复工作台", exact: true });
      assert(await restore.evaluate(n => document.activeElement === n));
      assert(!await win.locator(".assistant-creation-workbench-content").isVisible());
      await page.keyboard.press("Enter"); assert((await focus()).inside);
      await win.getByRole("button", { name: "关闭工作台", exact: true }).click(); await win.waitFor({ state: "detached" });
      return { backgroundRemainsInteractive: true, minimizeFocusRetained: true };
    });
    await stage("latest-real-opener-wins-during-close-transition", async () => {
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }, item = { ...v, status: "RUNNING" }; report.reopenMatrix.push(item);
        try {
          await session.metrics(v); const win = await openKeyboard(); await endProbe();
          await win.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
          // A real accessible background opener, not an injected internal event.
          const panel = await inline(), opener = panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true });
          await win.getByRole("button", { name: "关闭工作台", exact: true }).focus();
          await beginProbe(); await page.keyboard.press("Enter");
          item.afterClose = await win.evaluate(n => ({ closing: n.dataset.closing, opacity: Number(getComputedStyle(n).opacity), t: performance.now() }));
          // Observe one actual presented exit frame before reversing, not a fixed sleep.
          await page.waitForFunction(() => !document.querySelector('[data-testid="assistant-creation-workbench-window"]') ||
            window.__nativeInteractionProbe.frames.some(f => f.closing === "true" && f.opacity > 0 && f.opacity < .995));
          assert(await win.count() > 0 &&
            await page.evaluate(() => window.__nativeInteractionProbe.frames.some(f =>
              f.closing === "true" && f.opacity > 0 && f.opacity < .995)),
          "Exit unmounted without a visible intermediate frame; cannot exercise a continuous reversal");
          await opener.focus(); await page.keyboard.press("Enter");
          item.afterOpen = await page.evaluate(() => {
            const n = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
            return { t: performance.now(), closing: n?.dataset.closing,
              opacity: n && Number(getComputedStyle(n).opacity), sameWindow: n === window.__nativeInteractionProbe.identity };
          });
          await until(async () => {
            const state = await page.evaluate(() => {
              const n = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
              return { exists: Boolean(n), closing: n?.dataset.closing };
            });
            return !state.exists || state.closing === "false";
          }, "latest real opener terminal");
          item.exists = await win.count() > 0;
          if (item.exists) await finite(win);
          item.focus = await focus(); item.probe = await endProbe(); item.sameWindow = item.afterOpen.sameWindow;
          assert.equal(item.afterClose.closing, "true", "Close did not enter its transition");
          assert(item.afterOpen.closing !== undefined, "Activation missed the actual exit; coverage not established");
          assert(item.exists && item.focus.inside && item.sameWindow, "Latest opener lost to stale close callback");
          const activation = item.probe.events.find(e => e.type === "click" && e.label === "在独立窗口打开创造工作台");
          const commit = item.probe.commits.find(c => c.closing === "false" && c.t >= activation?.t);
          const transition = commit?.transitions.find(t => t.property === "opacity");
          const startOpacity = Number(transition?.keyframes[0]?.opacity);
          const forward = item.probe.frames.filter(f => f.t >= commit?.t && f.closing === "false");
          item.reversal = {
            openCommit: commit, startOpacity,
            continuous: Boolean(activation && commit && startOpacity > 0 && startOpacity <= activation.opacity + .025 &&
              Math.abs(commit.opacity - startOpacity) < .025 && forward.every(f => f.opacity >= startOpacity - .025)),
            intermediate: forward.some(f => f.opacity > 0 && f.opacity < .995),
            uniqueOwner: item.probe.frames.every(f => f.count === 1 && f.sameWindow &&
              (f.closing === "true" ? f.inert && !f.activeInside : !f.inert && f.activeInside)),
          };
          assert(item.reversal.continuous && item.reversal.intermediate && item.reversal.uniqueOwner,
            `Reopen must retarget current presentation without a blank/reset/focus gap: ${JSON.stringify(item.reversal)}`);
          if (width === 1920 && dpr === 1 && !reduced) await session.shot("reopened-1920-dpr1-normal");
          item.status = "PASS";
        } catch (e) {
          item.status = "FAILED"; item.error = String(e.stack || e);
          item.probe ??= await endProbe().catch(() => undefined);
        }
        finally {
          await endProbe().catch(() => {});
          const win = winLocator();
          if (await win.count()) {
            if (await win.getAttribute("data-closing") !== "true")
              await win.getByRole("button", { name: "关闭工作台", exact: true }).click();
            await win.waitFor({ state: "detached" });
          }
          save();
        }
      }
      assert.equal(report.reopenMatrix.length, 12);
      assert(report.reopenMatrix.every(i => i.status === "PASS"), "Latest opener/reversal matrix failed");
      return { combinations: 12 };
    });
    await unchanged(); assert.equal(provider.requests.length, 1); assert.equal(report.submissions.length, 1);
    assert.deepEqual(report.errors, []);
    report.status = report.cases.every(c => c.status === "PASS") ? "CURRENT_NATIVE_INTERACTION_PASS" : "PRODUCT_BEHAVIOR_FAILED";
    if (report.status !== "CURRENT_NATIVE_INTERACTION_PASS") process.exitCode = 1;
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    if (started) {
      try { await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await session.stop("final exact-owned cleanup, not normal-close evidence"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) { report.modelBoundary = provider.requests; report.providerCleanup = await provider.stop(); }
    try { assertBytes(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status })),
      inline: report.inlineMatrix.length, focus: report.focusMatrix.length, out, error: report.error }));
  }
}
if (require.main === module) (process.argv[2] === "prepare" ? Promise.resolve().then(prepare) : run(process.argv[2], process.argv.includes("--diagnose")))
  .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, sources, summary };

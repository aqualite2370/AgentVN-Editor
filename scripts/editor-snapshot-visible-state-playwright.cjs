"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

// Real navigation and DOM state preservation. Native property instrumentation
// measures discarded snapshot work; this is not a CPU/LoAF acceptance run.
const paths = resolveAcceptancePaths();
const names = (process.env.SNAPSHOT_STATE_VIEWPORTS || "1080p,1440p,4k").split(",");
const matrix = viewports.filter(viewport => names.includes(viewport.name));
assert(matrix.length === names.length && matrix.length > 0, "Invalid or empty snapshot matrix");
const dpr = Number(process.env.SNAPSHOT_STATE_DPR || 1);
const reduced = process.env.SNAPSHOT_STATE_REDUCED === "1";
const checkDiscardedReads = !process.argv.includes("--visible-state-only");
const assistantOnly = process.argv.includes("--assistant-scroll-only");
const dropAssistantScroll = process.argv.includes("--drop-assistant-scroll");
const assistantScrollRace = process.argv.includes("--assistant-scroll-race");
assert(!dropAssistantScroll || assistantOnly, "Scroll fault injection requires the isolated AI path");
const report = { status: "RUNNING", scope: "Editor snapshot state; native reads diagnostic; not performance/Release",
  checkDiscardedReads, dropAssistantScroll, assistantScrollRace,
  isolation: paths, dpr, reduced, cases: [] };

(async () => {
  fs.mkdirSync(paths.output, { recursive: true });
  const env = await startEditorAcceptance(paths.output);
  let browser;
  try {
    for (const viewport of matrix) {
      browser = await chromium.launch({ headless: false });
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
      page.setDefaultTimeout(15000);
      try {
        await env.server.run(async () => {
          await env.open(page);
          if (!assistantOnly) {
          await page.locator('[data-workspace-surface="options"]:visible').click();
          const live = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
          await page.waitForFunction(() => {
            const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
            return root?.classList.contains("is-entered")
              && root.querySelector('.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-designer')
                ?.getAttribute("data-advanced-tab-ready") === "true";
          });
          const title = live.getByRole("textbox", { name: "项目名称", exact: true });
          await title.fill(`快照状态 ${viewport.name}`);
          await page.evaluate(() => {
            const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
            const controls = node => [...(node?.querySelectorAll("input,textarea,select") ?? [])]
              .map(control => ({ tag: control.tagName, type: control.type, value: control.value,
                checked: control instanceof HTMLInputElement ? control.checked : null }));
            const active = root.querySelector(".advanced-tab-content.is-active");
            const warm = root.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
            const scroll = active.querySelector(".advanced-tab-scroll");
            scroll.scrollTop = Math.min(120, scroll.scrollHeight - scroll.clientHeight);
            const audit = { running: true, discardedReads: 0, totalScrollReads: 0, discardedSamples: [],
              before: { controls: controls(active), inspector: controls(warm?.querySelector(".runtime-layout-inspector")),
                scroll: scroll.scrollTop }, snapshot: null, originals: [] };
            window.__snapshotStateAudit = audit;
            for (const name of ["scrollTop", "scrollLeft"]) {
              const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
              if (!descriptor?.get) throw new Error(`Native ${name} getter unavailable`);
              audit.originals.push({ name, descriptor });
              Object.defineProperty(Element.prototype, name, { ...descriptor, get() {
                if (audit.running && this.isConnected
                  && this.closest('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)')) {
                  audit.totalScrollReads++;
                }
                if (audit.running && this.isConnected
                  && this.closest('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)')
                  && this.closest('.advanced-tab-content.is-warm[data-tab="layout"][aria-hidden="true"]')
                  && this.closest(".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center")) {
                  audit.discardedReads++;
                  if (audit.discardedSamples.length < 5)
                    audit.discardedSamples.push({ name, tag: this.tagName, className: String(this.className) });
                }
                return descriptor.get.call(this);
              } });
            }
            const observer = new MutationObserver(records => {
              const ghost = records.flatMap(record => [...record.addedNodes])
                .find(node => node instanceof HTMLElement && node.classList.contains("toolbar-popover-morph-ghost"));
              if (!ghost) return;
              audit.running = false;
              audit.snapshot = {
                controls: controls(ghost.querySelector(".advanced-tab-content.is-active")),
                inspector: controls(ghost.querySelector('.advanced-tab-content[data-tab="layout"] .runtime-layout-inspector')),
                scroll: ghost.querySelector(".advanced-tab-content.is-active .advanced-tab-scroll")?.scrollTop,
                inert: ghost.inert, ariaHidden: ghost.getAttribute("aria-hidden"),
                focused: ghost.contains(document.activeElement),
                pruned: Number(ghost.dataset.editorSnapshotLayoutPruned || 0),
              };
              observer.disconnect();
              audit.originals.forEach(({ name, descriptor }) => Object.defineProperty(Element.prototype, name, descriptor));
            });
            observer.observe(document.body, { childList: true });
          });
          await live.locator('[data-help-key="advanced.tab.layout"]').click();
          await page.waitForFunction(() => window.__snapshotStateAudit?.snapshot);
          const evidence = await page.evaluate(() => {
            const { before, snapshot, discardedReads, totalScrollReads, discardedSamples } = window.__snapshotStateAudit;
            return { before, snapshot, discardedReads, totalScrollReads, discardedSamples };
          });
          const entry = { viewport: viewport.name, evidence, status: "RUNNING" };
          report.cases.push(entry);
          assert(evidence.snapshot.pruned > 0, "Actual desktop snapshot must contain the pruning case");
          assert.deepEqual(evidence.snapshot.controls, evidence.before.controls, "Visible form state changed in outgoing snapshot");
          assert.deepEqual(evidence.snapshot.inspector, evidence.before.inspector, "Retained inspector state lost source mapping");
          assert.equal(evidence.snapshot.scroll, evidence.before.scroll, "Visible scroll position changed in outgoing snapshot");
          assert(evidence.snapshot.inert && evidence.snapshot.ariaHidden === "true" && !evidence.snapshot.focused,
            "Presentation snapshot captured input/focus");
          if (checkDiscardedReads)
            assert.equal(evidence.discardedReads, 0, "Snapshot reads state for descendants it discards before presentation");
          assert(evidence.totalScrollReads <= 32,
            `Snapshot reads scroll state from too many descendants (${evidence.totalScrollReads})`);
          await page.waitForFunction(() => {
            const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
            return root?.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
              && root.querySelector(".advanced-tab-content.is-active")?.dataset.tab === "layout"
              && !document.querySelector(".toolbar-popover-morph-ghost");
          });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: path.join(paths.output, `${viewport.name}.png`) });
          entry.status = "PASS";
          console.log(`PASS ${viewport.name}: visible state, retained mapping, ownership; discarded reads ${
            checkDiscardedReads ? "verified" : "diagnostic only"}`);
          }
          // Seed a local conversation through the application's persistence
          // API. Navigation/scroll use real controls; no model call is made.
          await page.evaluate(async projectId => {
            const history = await import("/src/assistant/conversationHistory.ts");
            const conversation = history.newAssistantConversation(projectId, "inquiry");
            conversation.messages = Array.from({ length: 60 }, (_, index) => ({
              role: index % 2 ? "assistant" : "user",
              content: `本地快照回归 ${index}：保留用户已滚动查看的位置，不发起模型请求。`,
            }));
            await history.saveAssistantConversation(conversation);
          }, paths.fixtureProjectId);
          await page.locator('[data-workspace-surface="assistant"]:visible').click();
          const body = page.locator(".toolbar-popover.assistant:not(.toolbar-popover-morph-ghost) .assistant-chat-body");
          await body.locator(".assistant-message").last().waitFor({ state: "visible" });
          await page.waitForFunction(() => {
            const root = document.querySelector(".toolbar-popover.assistant:not(.toolbar-popover-morph-ghost)");
            return root?.classList.contains("is-entered") && !document.querySelector(".toolbar-popover-morph-ghost");
          });
          const bounds = await body.boundingBox();
          assert(bounds, "Chat body unavailable");
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          const scrollRange = await body.evaluate(element => element.scrollHeight - element.clientHeight);
          // Establish a deterministic mid-scroll state; the user-facing transition
          // and snapshot ownership are still triggered through real controls below.
          await body.evaluate((element, range) => {
            element.scrollTop = Math.floor(range / 2);
          }, scrollRange);
          await page.waitForFunction(() => {
            const body = document.querySelector(".toolbar-popover.assistant:not(.toolbar-popover-morph-ghost) .assistant-chat-body");
            return body && body.scrollTop > 0 && body.scrollTop < body.scrollHeight - body.clientHeight - 100;
          });
          await page.evaluate(dropScroll => {
            const body = document.querySelector(".toolbar-popover.assistant:not(.toolbar-popover-morph-ghost) .assistant-chat-body");
            const maxScroll = Math.max(1, body.scrollHeight - body.clientHeight);
            const audit = window.__assistantSnapshotAudit = {
              before: body.scrollTop,
              beforeProgress: body.scrollTop / maxScroll,
              copied: null,
              assigned: null,
              snapshot: null,
              firstFrames: [],
            };
            const nativeClone = Node.prototype.cloneNode;
            const scroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
            if (!scroll?.get || !scroll?.set) throw new Error("Native scrollTop accessor unavailable");
            let outgoingClone = null;
            // Sample the native source read made by the real snapshot copier,
            // rather than an earlier CDP observation or a later live layout.
            Node.prototype.cloneNode = function(deep) {
              const clone = nativeClone.call(this, deep);
              if (this instanceof HTMLElement && this.contains(body)
                && this.classList.contains("toolbar-popover") && deep) outgoingClone = clone;
              return clone;
            };
            Object.defineProperty(Element.prototype, "scrollTop", { ...scroll,
              get() {
                const value = scroll.get.call(this);
                if (this === body && outgoingClone) {
                  audit.copied = { scroll: value, range: body.scrollHeight - body.clientHeight };
                }
                return value;
              },
              set(value) {
                const isSnapshotBody = outgoingClone?.contains(this)
                  && this instanceof HTMLElement && this.classList.contains("assistant-chat-body");
                if (isSnapshotBody) audit.assigned = value;
                scroll.set.call(this, isSnapshotBody && dropScroll ? 0 : value);
              },
            });
            const observer = new MutationObserver(records => {
              const ghost = records.flatMap(record => [...record.addedNodes])
                .find(node => node instanceof HTMLElement && node.classList.contains("toolbar-popover-morph-ghost")
                  && node.classList.contains("assistant"));
              if (!ghost) return;
              const snapshotBody = ghost.querySelector(".assistant-chat-body");
              const snapshotMaxScroll = Math.max(1, snapshotBody.scrollHeight - snapshotBody.clientHeight);
              audit.snapshot = {
                scroll: snapshotBody.scrollTop,
                progress: snapshotBody.scrollTop / snapshotMaxScroll,
                messages: ghost.querySelectorAll(".assistant-message").length,
                inert: ghost.inert, ariaHidden: ghost.getAttribute("aria-hidden"),
                focused: ghost.contains(document.activeElement),
              };
              observer.disconnect();
              Node.prototype.cloneNode = nativeClone;
              Object.defineProperty(Element.prototype, "scrollTop", scroll);
              requestAnimationFrame(() => {
                audit.firstFrames.push({ connected: ghost.isConnected, scroll: snapshotBody.scrollTop });
                requestAnimationFrame(() => {
                  audit.firstFrames.push({ connected: ghost.isConnected, scroll: snapshotBody.scrollTop });
                });
              });
            });
            observer.observe(document.body, { childList: true });
          }, dropAssistantScroll);
          if (assistantScrollRace) {
            // Real input between the early reading and copier consumption:
            // this must not be misreported as a product snapshot failure.
            await page.mouse.wheel(0, 120);
            await page.waitForFunction(() => {
              const body = document.querySelector(".toolbar-popover.assistant:not(.toolbar-popover-morph-ghost) .assistant-chat-body");
              return body && Math.abs(body.scrollTop - window.__assistantSnapshotAudit.before) > 40;
            });
          }
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.waitForFunction(() => window.__assistantSnapshotAudit?.firstFrames.length === 2);
          const assistantEvidence = await page.evaluate(() => window.__assistantSnapshotAudit);
          const assistantCase = { viewport: viewport.name, name: "assistant-outgoing-scroll", evidence: assistantEvidence, status: "RUNNING" };
          report.cases.push(assistantCase);
          assert(assistantEvidence.before > 0, "Real wheel must move chat away from origin");
          assert(assistantEvidence.copied?.scroll > 0, "Actual snapshot copier did not read a scrolled AI conversation");
          assert.equal(assistantEvidence.assigned, assistantEvidence.copied.scroll,
            "AI snapshot restore does not use the actual source read");
          assert(Math.abs(assistantEvidence.snapshot.scroll - assistantEvidence.copied.scroll) <= 1,
            "Outgoing AI conversation lost the source scroll position at snapshot ownership");
          assert(assistantEvidence.firstFrames.every(frame => frame.connected
            && Math.abs(frame.scroll - assistantEvidence.copied.scroll) <= 1),
          "AI snapshot changed scroll position before its first two frames");
          if (assistantScrollRace) assert(Math.abs(assistantEvidence.copied.scroll - assistantEvidence.before) > 40,
            "Race regression did not exercise a changed source after the early sample");
          assert.equal(assistantEvidence.snapshot.messages, 60);
          assert(assistantEvidence.snapshot.inert && assistantEvidence.snapshot.ariaHidden === "true"
            && !assistantEvidence.snapshot.focused);
          await page.waitForFunction(() => !document.querySelector(".toolbar-popover-morph-ghost"));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          assistantCase.status = "PASS";
          console.log(`PASS ${viewport.name}: outgoing AI conversation scroll and ownership`);
        });
      } catch (error) {
        await page.screenshot({ path: path.join(paths.output, `${viewport.name}-failure.png`) }).catch(() => {});
        throw error;
      } finally {
        await browser.close();
        browser = null;
      }
    }
    assert(report.cases.length === matrix.length * (assistantOnly ? 1 : 2));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack;
    const unfinished = report.cases.find(entry => entry.status === "RUNNING");
    if (unfinished) unfinished.status = "FAILED";
    throw error;
  } finally {
    await browser?.close();
    await env.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

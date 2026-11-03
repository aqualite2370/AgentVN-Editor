const { chromium } = require("../editor/node_modules/playwright");

const baseUrl = process.env.AGENTVN_QUICK_MENU_URL ?? "http://127.0.0.1:6868/?prototype=quick-menu&variant=A";
const viewports = [
  { name: "reported-desktop", width: 1365, height: 768 },
  { name: "wide-desktop", width: 1536, height: 864 },
  { name: "full-hd", width: 1920, height: 1080 },
  { name: "standard-laptop", width: 1280, height: 720 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "narrow-mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 360, height: 800 },
];
const variants = ["A", "C"];

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (metrics.scrollWidth > metrics.innerWidth + 1) {
    throw new Error(`${label}: horizontal overflow (${metrics.scrollWidth} > ${metrics.innerWidth})`);
  }
}

async function assertMorphSurface(page, label, initialClipPath, expectUnclipped = false) {
  const surface = page.getByTestId("quick-menu-surface");
  const toggle = page.getByTestId("prototype-quick-menu-toggle");
  const [surfaceBox, toggleBox, clipPath, surfaceClipPath, toggleCoreCount, toggleIcon] = await Promise.all([
    surface.boundingBox(),
    toggle.boundingBox(),
    surface.evaluate((element) => {
      const pseudo = getComputedStyle(element, "::before");
      return pseudo.content !== "none" ? pseudo.clipPath : getComputedStyle(element).clipPath;
    }),
    surface.evaluate((element) => getComputedStyle(element).clipPath),
    toggle.locator(".prototype-toggle-core").count(),
    toggle.getAttribute("data-icon"),
  ]);
  if (!surfaceBox || !toggleBox) throw new Error(`${label}: missing morph surface or toggle`);
  const rightInset = surfaceBox.right - toggleBox.right;
  const bottomInset = surfaceBox.bottom - toggleBox.bottom;
  if (rightInset < -1 || rightInset > 14 || bottomInset < -1 || bottomInset > 14) {
    throw new Error(`${label}: morph surface and integrated close control drifted apart`, {
      cause: { surfaceBox, toggleBox, rightInset, bottomInset },
    });
  }
  if (initialClipPath === clipPath) {
    throw new Error(`${label}: morph surface clip path did not change`);
  }
  if (toggleBox.width > 48 || toggleBox.height > 48) {
    throw new Error(`${label}: original toggle footprint is still visible after morph`);
  }
  if (toggleCoreCount !== 0) {
    throw new Error(`${label}: morph still keeps an extra nested toggle core`);
  }
  if (toggleIcon !== "close") {
    throw new Error(`${label}: morph did not switch to the integrated close control`);
  }
  if (expectUnclipped && surfaceClipPath !== "none") {
    throw new Error(`${label}: expanded morph surface still clips child control edges`, { cause: { clipPath, surfaceClipPath } });
  }
}

async function assertNoActionOverlap(page, label) {
  const result = await page.evaluate(() => {
    const toggle = document.querySelector("[data-testid='prototype-quick-menu-toggle']")?.getBoundingClientRect();
    if (!toggle) return { overlap: true };
    const intersects = (rect) => !(rect.right <= toggle.left || rect.left >= toggle.right || rect.bottom <= toggle.top || rect.top >= toggle.bottom);
    const actions = [...document.querySelectorAll("[data-testid^='quick-action-']")]
      .map((element) => ({ rect: element.getBoundingClientRect(), display: getComputedStyle(element).display }))
      .filter(({ display, rect }) => display !== "none" && rect.width > 0 && rect.height > 0);
    return { overlap: actions.some(({ rect }) => intersects(rect)), actionCount: actions.length };
  });
  if (result.overlap) throw new Error(`${label}: an action overlaps the integrated close control`);
}

async function assertACompact(page, label) {
  const result = await page.evaluate(() => {
    const toggle = document.querySelector("[data-testid='prototype-quick-menu-toggle']")?.getBoundingClientRect();
    const capsule = document.querySelector(".prototype-capsule");
    const actions = [...document.querySelectorAll(".prototype-capsule > .prototype-action-a")]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      gap: toggle && actions.length ? toggle.left - Math.max(...actions.map((rect) => rect.right)) : Number.POSITIVE_INFINITY,
      actionCount: actions.length,
      capsulePaddingRight: capsule ? Number.parseFloat(getComputedStyle(capsule).paddingRight) : Number.POSITIVE_INFINITY,
      nestedRowCount: document.querySelectorAll(".prototype-actions-row").length,
    };
  });
  if (result.actionCount !== 7) throw new Error(`${label}: expected all 7 compact capsule buttons`, result);
  if (result.nestedRowCount !== 0) throw new Error(`${label}: capsule still wraps actions in an extra row layer`, result);
  if (result.capsulePaddingRight > 8) throw new Error(`${label}: capsule reserves a large blank right slot for the close control`, result);
  if (result.gap > 8) throw new Error(`${label}: capsule buttons sit too far from the X (${result.gap}px)`, result);
}

async function assertCNarrow(page, label) {
  const result = await page.evaluate(() => {
    const surface = document.querySelector(".prototype-drawer")?.getBoundingClientRect();
    const actions = [...document.querySelectorAll(".prototype-drawer > .prototype-action-c")];
    const toggle = document.querySelector("[data-testid='prototype-quick-menu-toggle']")?.getBoundingClientRect();
    const firstElement = actions[0];
    const lastElement = actions[actions.length - 1];
    const first = firstElement?.getBoundingClientRect();
    const last = lastElement?.getBoundingClientRect();
    return {
      surfaceWidth: surface?.width ?? Number.POSITIVE_INFINITY,
      surfaceHeight: surface?.height ?? 0,
      actionCount: actions.length,
      actionHeight: first?.height ?? 0,
      actionWidth: first?.width ?? 0,
      columns: firstElement ? getComputedStyle(firstElement).gridTemplateColumns : "",
      iconBorder: firstElement ? getComputedStyle(firstElement.querySelector(".prototype-action-icon")).border : "",
      nestedColumnCount: document.querySelectorAll(".prototype-actions-column").length,
      headingCount: document.querySelectorAll(".prototype-drawer-heading").length,
      hintCount: document.querySelectorAll(".prototype-action-hint").length,
      xInside: Boolean(surface && toggle && toggle.right <= surface.right + 1 && toggle.bottom <= surface.bottom + 1),
      actionToXGap: first && last && toggle ? toggle.top - last.bottom : Number.POSITIVE_INFINITY,
      actionSpan: first && last ? last.bottom - first.top : 0,
    };
  });
  if (result.surfaceWidth > 180) throw new Error(`${label}: morph rail remains too wide (${result.surfaceWidth}px)`, result);
  if (result.surfaceHeight < 270 || result.surfaceHeight > 300) throw new Error(`${label}: morph rail has excess vertical shell space`, result);
  if (result.actionCount !== 7) throw new Error(`${label}: morph rail must show seven actions`, result);
  if (result.actionHeight < 29 || result.actionHeight > 32) throw new Error(`${label}: action rows are not compact`, result);
  if (!result.columns.startsWith("30px")) throw new Error(`${label}: action rows keep an unnecessary nested text column`, result);
  if (result.iconBorder !== "0px none rgb(0, 0, 0)" && !result.iconBorder.startsWith("0px")) throw new Error(`${label}: action icons still have a nested frame`, result);
  if (result.nestedColumnCount !== 0 || result.headingCount !== 0 || result.hintCount !== 0) throw new Error(`${label}: morph rail still exposes extra hierarchy layers`, result);
  if (!result.xInside) throw new Error(`${label}: close control is not part of the morphing container`, result);
  if (result.actionToXGap > 12) throw new Error(`${label}: morph rail leaves an empty footer below the action rows`, result);
}

async function assertCollapsedDots(page, label, viewport) {
  const result = await page.evaluate(() => {
    const toggle = document.querySelector("[data-testid='prototype-quick-menu-toggle']")?.getBoundingClientRect();
    const icon = document.querySelector("[data-testid='prototype-quick-menu-toggle'] svg");
    const dots = [...document.querySelectorAll("[data-testid='prototype-quick-menu-toggle'] circle")].map((element) => ({
      cx: element.getAttribute("cx"),
      cy: element.getAttribute("cy"),
      r: element.getAttribute("r"),
      fill: element.getAttribute("fill"),
    }));
    return {
      toggleWidth: toggle?.width ?? 0,
      toggleHeight: toggle?.height ?? 0,
      iconName: icon?.getAttribute("data-precision-icon"),
      iconWidth: icon?.getBoundingClientRect().width ?? 0,
      iconHeight: icon?.getBoundingClientRect().height ?? 0,
      dots,
    };
  });
  const expectedSize = viewport.width <= 560 ? 44 : 50;
  if (Math.abs(result.toggleWidth - expectedSize) > 0.5 || Math.abs(result.toggleHeight - expectedSize) > 0.5) {
    throw new Error(`${label}: collapsed toggle should use the compact client footprint`, result);
  }
  if (result.iconName !== "expand") throw new Error(`${label}: collapsed toggle must reuse the client three-dot icon`, result);
  if (result.dots.length !== 3 || !result.dots.every((dot) => dot.cy === "12" && dot.r === "1.3" && dot.fill === "currentColor")) {
    throw new Error(`${label}: collapsed toggle dot geometry does not match the client`, result);
  }
}

async function assertBRemoved(page, viewport) {
  const url = new URL(baseUrl);
  url.searchParams.set("variant", "B");
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.getByTestId("quick-menu-prototype").waitFor();
  const result = await page.evaluate(() => ({
    layout: document.querySelector("[data-variant-layout]")?.getAttribute("data-variant-layout"),
    fanCount: document.querySelectorAll(".prototype-fan-orbit, .prototype-fan-actions, .prototype-action-b").length,
    switcher: document.querySelector(".prototype-switcher-label")?.textContent?.replace(/\s+/g, " ").trim(),
  }));
  if (result.layout === "fan" || result.fanCount !== 0 || result.switcher !== "方案 A胶囊展开") {
    throw new Error(`${viewport.name} B: removed variant still exposed`, { cause: result });
  }
}

async function assertDirectionPicker(page, label) {
  const picker = page.getByTestId("prototype-direction-picker");
  if (await picker.count() !== 1) throw new Error(`${label}: direction picker missing`);
  const values = await picker.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-direction")));
  const expectedValues = label.includes(" C") ? "auto,up,down" : "auto,up,down,left,right";
  if (values.join(",") !== expectedValues) {
    throw new Error(`${label}: direction picker exposes the wrong supported directions`, { cause: { values, expectedValues } });
  }
  const directions = label.includes(" C") ? ["auto", "up", "down"] : ["auto", "up", "down", "left", "right"];
  for (const direction of directions) {
    const url = new URL(page.url());
    url.searchParams.set("direction", direction);
    await page.goto(url.toString(), { waitUntil: "networkidle" });
    await page.getByTestId("quick-menu-prototype").waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(80);
    const before = await page.getByTestId("prototype-quick-menu-toggle").boundingBox();
    await page.getByTestId("prototype-quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-phase") === "expanded", undefined, { timeout: 2_000 });
    await page.waitForTimeout(260);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(80);
    const after = await page.getByTestId("prototype-quick-menu-toggle").boundingBox();
    if (!before || !after || Math.max(
      Math.abs((before.x + before.width / 2) - (after.x + after.width / 2)),
      Math.abs((before.y + before.height / 2) - (after.y + after.height / 2)),
    ) > 1) {
      const debugState = await page.evaluate(() => ({
        url: window.location.href,
        menu: document.querySelector("[data-variant-layout]")?.className,
        toggleCount: document.querySelectorAll("[data-testid='prototype-quick-menu-toggle']").length,
        toggleRect: document.querySelector("[data-testid='prototype-quick-menu-toggle']")?.getBoundingClientRect().toJSON(),
        menuRect: document.querySelector("[data-variant-layout]")?.getBoundingClientRect().toJSON(),
        menuStyle: (() => {
          const element = document.querySelector("[data-variant-layout]");
          const style = element ? getComputedStyle(element) : null;
          return style ? { right: style.right, bottom: style.bottom, transform: style.transform } : null;
        })(),
        capsuleRect: document.querySelector("[data-testid='quick-menu-surface']")?.getBoundingClientRect().toJSON(),
        stageRect: document.querySelector(".prototype-stage")?.getBoundingClientRect().toJSON(),
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      }));
      throw new Error(`${label} ${direction}: collapsed toggle moved while expanding before=${JSON.stringify(before)} after=${JSON.stringify(after)} state=${JSON.stringify(debugState)}`);
    }
    await page.getByTestId("prototype-quick-menu-toggle").click();
    const collapseSamples = [];
    for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
      await page.waitForTimeout(20);
      collapseSamples.push(await page.getByTestId("prototype-quick-menu-toggle").boundingBox());
    }
    const collapseDrift = Math.max(...collapseSamples.filter(Boolean).map((box) => Math.max(
      Math.abs((box.x + box.width / 2) - (before.x + before.width / 2)),
      Math.abs((box.y + box.height / 2) - (before.y + before.height / 2)),
    )));
    if (collapseDrift > 1) {
      throw new Error(`${label} ${direction}: toggle center drifted during collapse`, { cause: { collapseDrift, collapseSamples } });
    }
    await page.waitForFunction(() => document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-phase") === "collapsed", undefined, { timeout: 2_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(40);
    const collapseIcon = await page.getByTestId("prototype-quick-menu-toggle").locator("svg").first().boundingBox();
    const collapseToggle = await page.getByTestId("prototype-quick-menu-toggle").boundingBox();
    if (!collapseIcon || !collapseToggle || Math.max(
      Math.abs((collapseIcon.x + collapseIcon.width / 2) - (collapseToggle.x + collapseToggle.width / 2)),
      Math.abs((collapseIcon.y + collapseIcon.height / 2) - (collapseToggle.y + collapseToggle.height / 2)),
    ) > 3) {
      throw new Error(`${label} ${direction}: collapsed icon is not centered in the fixed toggle`, { cause: { collapseIcon, collapseToggle } });
    }
  }
}

async function runVariant(page, viewport, variant) {
  const url = new URL(baseUrl);
  url.searchParams.set("variant", variant);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.getByTestId("quick-menu-prototype").waitFor();
  await assertNoHorizontalOverflow(page, `${viewport.name} ${variant} initial`);

  const status = page.getByTestId("quick-menu-status");
  if (await status.getAttribute("data-phase") !== "collapsed") {
    throw new Error(`${viewport.name} ${variant}: prototype should start collapsed`);
  }
  if (await page.locator("[data-testid^='quick-action-']").count() !== 0) {
    throw new Error(`${viewport.name} ${variant}: action buttons must not be inserted before expansion`);
  }
  if (variant === "A" || variant === "C") await assertCollapsedDots(page, `${viewport.name} ${variant}`, viewport);

  const initialClipPath = await page.getByTestId("quick-menu-surface")
    .evaluate((element) => {
      const pseudo = getComputedStyle(element, "::before");
      return pseudo.content !== "none" ? pseudo.clipPath : getComputedStyle(element).clipPath;
    });
  if (variant === "A" || variant === "C") {
    const initialSurfaceClipPath = await page.getByTestId("quick-menu-surface")
      .evaluate((element) => getComputedStyle(element).clipPath);
    const initialSurfaceBeforeOpacity = await page.getByTestId("quick-menu-surface")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element, "::before").opacity));
    if (initialSurfaceClipPath !== "none" || initialSurfaceBeforeOpacity > 0) {
      throw new Error(`${viewport.name} ${variant}: collapsed entry control is still clipped by the morph surface`, {
        cause: { initialSurfaceClipPath, initialSurfaceBeforeOpacity },
      });
    }
  }

  await page.getByTestId("prototype-quick-menu-toggle").click();
  await page.waitForTimeout(120);
  const phaseDuringExpansion = await status.getAttribute("data-phase");
  if (phaseDuringExpansion !== "expanding") {
    throw new Error(`${viewport.name} ${variant}: expected expanding phase, got ${phaseDuringExpansion}`);
  }
  if (await page.locator("[data-testid^='quick-action-']").count() !== 7) {
    throw new Error(`${viewport.name} ${variant}: all action nodes should mount together before fading`);
  }

  const firstOpacity = await page.locator("[data-testid^='quick-action-']").first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  if (firstOpacity > 0.3) {
    throw new Error(`${viewport.name} ${variant}: actions should start with a fade, got opacity ${firstOpacity}`);
  }

  if (variant === "C") {
    const firstQueuedCount = Number(await status.getAttribute("data-visible-count"));
    await page.waitForTimeout(60);
    const earlyQueuedCount = Number(await status.getAttribute("data-visible-count"));
    if (earlyQueuedCount < 1) {
      throw new Error(`${viewport.name} C: morph rail stays blank after the shell opens`, { cause: { earlyQueuedCount } });
    }
    const earlyPaintedOpacity = await page.locator(".prototype-action-c.is-visible")
      .evaluateAll((elements) => Math.max(...elements.map((element) => Number.parseFloat(getComputedStyle(element).opacity))));
    if (earlyPaintedOpacity > 0.05) {
      throw new Error(`${viewport.name} C: action text paints before its morph shell`, {
        cause: { earlyPaintedOpacity, earlyQueuedCount },
      });
    }
    const earlyRevealClipPath = await page.getByTestId("quick-menu-surface")
      .evaluate((element) => getComputedStyle(element, "::before").clipPath);
    if (earlyRevealClipPath === "none") {
      throw new Error(`${viewport.name} C: morph rail reveals the full empty shell before the queue catches up`, {
        cause: { earlyRevealClipPath, earlyQueuedCount },
      });
    }
    const earlyGeometry = await page.evaluate(() => {
      const surface = document.querySelector(".prototype-drawer")?.getBoundingClientRect();
      const visibleActions = [...document.querySelectorAll(".prototype-action-c.is-visible")]
        .map((element) => element.getBoundingClientRect());
      const revealCount = Number(document.querySelector(".prototype-drawer")?.getAttribute("data-reveal-count") ?? 0);
      const revealHeight = revealCount === 0 ? 50 : 81 + (revealCount - 1) * 33;
      return {
        surfaceBottom: surface?.bottom ?? 0,
        revealTop: (surface?.bottom ?? 0) - revealHeight,
        revealCount,
        visibleActionCount: visibleActions.length,
        escapedActions: visibleActions.filter((rect) => rect.top < (surface?.bottom ?? 0) - revealHeight - 1).length,
      };
    });
    if (earlyGeometry.visibleActionCount < 1 || earlyGeometry.escapedActions > 0) {
      throw new Error(`${viewport.name} C: first action text appears before the morph shell reaches it`, { cause: earlyGeometry });
    }
    await page.waitForFunction(() => {
      const value = Number(document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-visible-count"));
      return value > 1 && value < 7;
    }, undefined, { timeout: 2_000 });
    const queuedCount = Number(await status.getAttribute("data-visible-count"));
    if (queuedCount <= firstQueuedCount || queuedCount >= 7) {
      throw new Error(`${viewport.name} C: queue did not advance gradually`, { cause: { firstQueuedCount, queuedCount } });
    }
    await page.waitForFunction(() => document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-phase") === "expanded", undefined, { timeout: 2_000 });
  } else {
    await page.waitForFunction(() => document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-phase") === "expanded", undefined, { timeout: 2_000 });
  }
  await page.waitForTimeout(240);

  if (await page.locator("[data-testid^='quick-action-']").count() !== 7) {
    throw new Error(`${viewport.name} ${variant}: expected all 7 actions after insertion`);
  }
  await assertMorphSurface(page, `${viewport.name} ${variant}`, initialClipPath, variant === "A" || variant === "C");
  await assertNoActionOverlap(page, `${viewport.name} ${variant}`);
  if (variant === "A") await assertACompact(page, `${viewport.name} A`);
  if (variant === "C") await assertCNarrow(page, `${viewport.name} C`);
  await assertNoHorizontalOverflow(page, `${viewport.name} ${variant} expanded`);

  await page.getByTestId("prototype-quick-menu-toggle").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='quick-menu-status']")?.getAttribute("data-phase") === "collapsed", undefined, { timeout: 2_000 });
  if (await page.locator("[data-testid^='quick-action-']").count() !== 0) {
    throw new Error(`${viewport.name} ${variant}: action buttons should be removed after collapse`);
  }
  await assertNoHorizontalOverflow(page, `${viewport.name} ${variant} collapsed`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AGENTVN_BROWSER_EXECUTABLE
      ? { executablePath: process.env.AGENTVN_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      for (const variant of variants) {
        await runVariant(page, viewport, variant);
        await assertDirectionPicker(page, `${viewport.name} ${variant}`);
      }
      await page.close();
    }
    console.log(`quick-menu-prototype: passed ${viewports.length} viewports × ${variants.length} variants; D/E removed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

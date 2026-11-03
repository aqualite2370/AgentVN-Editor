"use strict";
const assert = require('node:assert/strict');
const { chromium } = require('../editor/node_modules/playwright');
const { observeMenuAction, finishMenuAction, assessSkipAction } = require('./android-menu-action-observer.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const mode of ['stop-at-unread', 'still-active', 'dropped-touch', 'active-without-advance']) {
      await page.setContent('<div class="story-player" data-current-scene-id="scene" data-current-command-index="3"><button data-ui-component-id="quick_skip_button">快进</button></div>');
      await page.evaluate(mode => {
        document.querySelector('button').onclick = () => {
          if (mode === 'dropped-touch') return;
          const button = document.querySelector('button');
          button.classList.add('active');
          if (mode !== 'active-without-advance') setTimeout(() => document.querySelector('.story-player').setAttribute('data-current-command-index', '4'), 30);
          if (mode === 'stop-at-unread') setTimeout(() => button.classList.remove('active'), 60);
        };
      }, mode);
      await page.evaluate(observeMenuAction, 'quick_skip_button');
      await page.locator('button').click();
      await page.waitForTimeout(650);
      const evidence = await page.evaluate(finishMenuAction);
      if (mode === 'stop-at-unread') {
        assert.equal(await page.locator('button').evaluate(button => button.classList.contains('active')), false, 'old delayed assertion reproduces missed active state');
      }
      assert.equal(assessSkipAction(evidence).status, ['stop-at-unread', 'still-active'].includes(mode) ? 'PASS' : 'FAILED', mode);
      assert.equal(await page.evaluate(() => window.__agentvnMenuActionObserver), undefined, 'observer disposed');
    }
    await page.setContent('<div class="story-player"><button data-ui-component-id="quick_auto_button">自动</button></div>');
    await page.locator('button').evaluate(button => { button.onclick = () => button.classList.toggle('active'); });
    await page.evaluate(observeMenuAction, 'quick_auto_button');
    await page.locator('button').click();
    await page.locator('button').click();
    const evidence = await page.evaluate(() => {
      window.retainedObserver = window.__agentvnMenuActionObserver;
    }).then(() => page.evaluate(finishMenuAction, true));
    assert.equal(evidence.inputEvents.filter(event => event.type === 'click' && event.trusted && event.hitsButton).length, 2);
    assert(evidence.samples.some(sample => sample.state.active));
    assert.equal(evidence.samples.at(-1).state.active, false);
    assert(evidence.inputEvents.every(event => event.rect.width > 0));
    const count = evidence.inputEvents.length;
    await page.locator('button').click();
    assert.equal(await page.evaluate(() => window.retainedObserver.events.length), count, 'input listeners must be disposed');
    console.log('android-menu-action-observer: PASS (transient active, progression, dropped touch, trusted input timeline, geometry, observer/listener cleanup)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

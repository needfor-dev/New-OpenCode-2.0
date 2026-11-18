// flows.js — Custom redirect method step orchestration (exact 6 steps)
//
// Step 1: Go to website, wait 5-60s, click Open (scan whole page)
// Step 2: Wait 10-25s, click Next, optional Scroll Down, wait 5-10s
// Step 3: Click Open, reload site, 67/100 probability scroll, wait 3-13s
// Step 4: Click Continue, wait 3-7s
// Step 5: Click Go to Link, wait 2-12s
// Step 6: Click Open Link, browse like human

const {
  humanClick, humanScroll, humanMicroActions, humanHover,
  humanTextSelection, humanPause, humanReadPage, humanTabSwitch,
  humanBlurWindow, humanMisclick, humanBackNavigate,
} = require('./humanActions');

const config = require('./config');
const { rand, randFloat, chance, sleep } = require('./utils');

/**
 * Main tab flow — follows the 6-step redirect method exactly.
 *
 * @param {Object} opts
 * @param {Object} opts.puppeteer - puppeteer-extra instance
 * @param {Object} opts.page - Puppeteer page
 * @param {Object} opts.cfg - parsed config
 * @param {Object} opts.browser - browser instance (for tab switching)
 * @param {number} opts.run - current run number
 * @param {number} opts.tabIndex - tab index
 */
async function runTabFlow({ puppeteer, page, cfg, run, browser, tabIndex }) {
  const meta = { tab: tabIndex, run, clicked: 0, postOpened: false, finalUrl: '', success: false, step: 0, error: null };

  const preset = config.SPEED_PRESETS[cfg.speed || 'normal'] || config.SPEED_PRESETS.normal;
  const mult = preset.multiplier;
  const readMult = preset.readMultiplier;

  const skew = (min, max) => Math.max(config.randSkewed(min, max, 0.5) * mult, 800);

  try {
    // ==================================================================
    // STEP 1: Go to website and wait 5-60sec, click Open button
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    await stepNavigateToTarget(page, cfg, tabIndex);

    // Wait 5-60sec before clicking Open (human-like reading/hesitation)
    const wait1 = skew(config.step1WaitBeforeOpen.min, config.step1WaitBeforeOpen.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-1: waiting ~${Math.round(wait1 / 1000)}s before Open`);
    await humanReadPage(page, { debug: cfg.debug, maxMs: 10000 * readMult });
    await humanMicroActions(page, wait1, { debug: cfg.debug });

    // Scan whole page and click Open button
    const openButton = await findOpenButton(page, cfg.debug);
    if (!openButton) {
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-1: Open button not found`);
      meta.step = 1; return meta;
    }
    await maybeMisclick(page, openButton, cfg.debug);
    await hoverAndHesitate(page, openButton, cfg.debug);
    const clicked = await humanClick(page, openButton, { debug: cfg.debug });
    if (!clicked) { meta.step = 1; return meta; }
    meta.clicked++; meta.step = 1;
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-1: Open button clicked`);

    // Human curiosity after click
    await maybeTabSwitch(page, browser, cfg, tabIndex);
    await maybeBlurWindow(page, cfg, tabIndex);

    // ==================================================================
    // STEP 2: Wait 10-25sec, click Next, handle Scroll Down, wait 5-10sec
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    const wait2 = skew(config.step2WaitAfterOpen.min, config.step2WaitAfterOpen.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-2: waiting ~${Math.round(wait2 / 1000)}s after Open`);
    await humanPause(page, wait2, { debug: cfg.debug });

    await sleep(clampedRand(100, 500, 0.5));
    const nextButton = await findNextButton(page, cfg.debug);
    if (nextButton) {
      await hoverAndHesitate(page, nextButton, cfg.debug);
      await humanClick(page, nextButton, { debug: cfg.debug });
      meta.clicked++;
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-2: Next button clicked`);
    } else if (cfg.debug) {
      console.log(`  tab[${tabIndex}] STEP-2: Next button not found`);
    }

    // If "Scroll Down" appears, click it (optional)
    const scrollDownAppears = await checkScrollDown(page, cfg.debug);
    if (scrollDownAppears) {
      await humanScroll(page, { maxBursts: 2, maxViewports: 1, debug: cfg.debug });
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-2: Scroll Down appeared, scrolled`);
    }

    const wait3 = skew(config.step2ScrollWait.min, config.step2ScrollWait.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-2: waiting ~${Math.round(wait3 / 1000)}s`);
    await humanPause(page, wait3, { debug: cfg.debug });
    meta.step = 2;

    // ==================================================================
    // STEP 3: Click Open again, reload site, 67/100 probability, wait 3-13sec
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    const openButton2 = await findOpenButton(page, cfg.debug);
    if (openButton2) {
      await hoverAndHesitate(page, openButton2, cfg.debug);
      await humanClick(page, openButton2, { debug: cfg.debug });
      meta.clicked++;
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-3: Open button clicked again`);
    }

    // Reload the site
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-3: site reloaded`);
    await humanPause(page, 1000, 2200 * mult, { debug: cfg.debug });

    // 67/100 probability — scroll down for more humanizing
    const probCheck = config.checkProbability(config.step3Probability);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-3: probability 67/100 → ${probCheck ? 'passed' : 'failed'}`);
    if (probCheck) {
      await humanScroll(page, { maxBursts: rand(2, 4), maxViewports: 2, debug: cfg.debug });
    } else {
      await humanMicroActions(page, rand(1200, 3500) * mult, { debug: cfg.debug });
    }

    const wait4 = skew(config.step3WaitAfterClick.min, config.step3WaitAfterClick.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-3: waiting ~${Math.round(wait4 / 1000)}s`);
    await humanPause(page, wait4, { debug: cfg.debug });
    meta.step = 3;

    // ==================================================================
    // STEP 4: Click Continue button, wait 3-7sec
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    const continueButton = await findContinueButton(page, cfg.debug);
    if (continueButton) {
      await hoverAndHesitate(page, continueButton, cfg.debug);
      await humanClick(page, continueButton, { debug: cfg.debug });
      meta.clicked++;
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-4: Continue button clicked`);
    }

    const wait5 = skew(config.step4WaitAfterContinue.min, config.step4WaitAfterContinue.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-4: waiting ~${Math.round(wait5 / 1000)}s`);
    await humanPause(page, wait5, { debug: cfg.debug });
    meta.step = 4;

    // ==================================================================
    // STEP 5: Click Go to Link button, wait 2-12sec
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    const goToLinkButton = await findGoToLinkButton(page, cfg.debug);
    if (goToLinkButton) {
      await hoverAndHesitate(page, goToLinkButton, cfg.debug);
      await humanClick(page, goToLinkButton, { debug: cfg.debug });
      meta.clicked++;
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-5: Go to Link button clicked`);
    }

    const wait6 = skew(config.step5WaitAfterGoToLink.min, config.step5WaitAfterGoToLink.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-5: waiting ~${Math.round(wait6 / 1000)}s`);
    await humanPause(page, wait6, { debug: cfg.debug });
    meta.step = 5;

    // ==================================================================
    // STEP 6: Click Open Link, then continue browsing like a human
    // ==================================================================
    if (shouldBail(config.abandonment)) { meta.error = 'abandoned'; return meta; }

    const openLinkButton = await findOpenLinkButton(page, cfg.debug);
    if (openLinkButton) {
      await hoverAndHesitate(page, openLinkButton, cfg.debug);
      await humanClick(page, openLinkButton, { debug: cfg.debug });
      meta.clicked++;
      if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-6: Open Link button clicked`);
    }

    // Human curiosity: back-then-forward navigation
    await humanBackNavigate(page, { debug: cfg.debug });

    // Continue browsing like a human: read, scroll, hover, select text
    const browseDuration = skew(config.finalBrowseDuration.min, config.finalBrowseDuration.max);
    if (cfg.debug) console.log(`  tab[${tabIndex}] STEP-6: browsing for ~${Math.round(browseDuration / 1000)}s`);
    await humanReadPage(page, { debug: cfg.debug, maxMs: browseDuration });

    try { meta.finalUrl = await page.url(); } catch (_) {}
    meta.postOpened = true;
    meta.success = true;
    meta.step = 6;

    return meta;
  } catch (e) {
    if (cfg.debug) console.log(`  tab[${tabIndex}] error at step ${meta.step}:`, e && (e.message || e));
    meta.error = e && (e.message || String(e));
    return meta;
  }
}

/* ========================================================================= */
/*  Step helpers                                                             */
/* ========================================================================= */

async function stepNavigateToTarget(page, cfg, tabIndex) {
  await page.goto(cfg.target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
    if (cfg.debug) console.log(`  tab[${tabIndex}] goto failed: ${err && err.message}`);
  });
  await sleep(clampedRand(700, 1600, 0.6));
}

async function hoverAndHesitate(page, el, debug) {
  try {
    const box = await el.boundingBox().catch(() => null);
    if (box) {
      const x = clamp(rand(box.x + 4, box.x + box.width - 4), box.x, box.x + box.width);
      const y = clamp(rand(box.y + 4, box.y + box.height - 4), box.y, box.y + box.height);
      await humanMove(page, x, y, { steps: rand(6, 14), speed: randFloat(0.7, 1.2) });
    }
    await sleep(rand(70, 320));
  } catch (_) {}
}

function shouldBail(abandonment) {
  return chance(abandonment.perStepBailChance);
}

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }
function clampedRand(min, max, bias = 0.5) {
  const u = Math.pow(Math.random(), 1 / (bias * 2 + 0.1));
  return Math.floor(min + u * (max - min + 1));
}

/* ========================================================================= */
/*  Element finders — robust multi-strategy detection                        */
/* ========================================================================= */

/**
 * Check if an element is visible and clickable.
 */
async function isElementVisible(el) {
  try {
    const box = await el.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width <= 0 || box.height <= 0) return false;
    const visible = await el.isIntersectingViewport().catch(() => true);
    const disabled = await el.evaluate((node) => node.disabled || node.getAttribute('aria-disabled') === 'true').catch(() => false);
    if (disabled) return false;
    return true;
  } catch (_) { return false; }
}

/**
 * Get all clickable elements on the page with their text signals.
 */
async function getClickableElements(page) {
  const els = await page.$$('button, a, [role="button"], input[type="button"], input[type="submit"]').catch(() => []);
  const results = [];
  for (const el of els) {
    try {
      const signal = await el.evaluate((node) => {
        const t = (node.innerText || node.textContent || '').toLowerCase().trim();
        const aria = (node.getAttribute('aria-label') || '').toLowerCase().trim();
        const title = (node.getAttribute('title') || '').toLowerCase().trim();
        const cls = (node.className || '').toLowerCase();
        const id = (node.id || '').toLowerCase();
        const href = (node.getAttribute('href') || '').toLowerCase();
        const data = (node.getAttribute('data-text') || '').toLowerCase().trim();
        return { t, aria, title, cls, id, href, data };
      });
      const fullText = `${signal.t} ${signal.aria} ${signal.title} ${signal.cls} ${signal.id} ${signal.href} ${signal.data}`.trim();
      results.push({ el, fullText });
    } catch (_) {}
  }
  return results;
}

/**
 * Find the best matching element by keyword from all clickable elements.
 */
async function findByKeyword(page, keywords, debug) {
  const elements = await getClickableElements(page);
  let best = null;
  let bestScore = 0;

  for (const { el, fullText } of elements) {
    if (!(await isElementVisible(el))) continue;

    let score = 0;
    const lower = fullText;

    // Exact keyword match scores higher
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (lower === kw || lower.startsWith(kw) || lower.endsWith(kw)) score += 3;
        else score += 1;
      }
    }

    // Prefer elements with reasonable size
    try {
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 60 && box.height > 20) score += 1;
    } catch (_) {}

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best && bestScore > 0) return best;
  if (debug) console.log(`  findByKeyword: no match for ${keywords.join(', ')}`);
  return null;
}

/**
 * Fallback: return first visible clickable element.
 */
async function findFirstClickable(page, debug) {
  const elements = await getClickableElements(page);
  for (const { el } of elements) {
    if (await isElementVisible(el)) return el;
  }
  return null;
}

/**
 * Wait for an element matching keywords to appear (retry up to ~5 seconds).
 */
async function waitForElementByKeyword(page, keywords, debug, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const el = await findByKeyword(page, keywords, debug);
    if (el) return el;
    await sleep(500);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Specific button finders                                                   */
/* -------------------------------------------------------------------------- */

async function findOpenButton(page, debug) {
  // First try keyword match
  const el = await findByKeyword(page, ['open', 'go', 'start', 'enter'], debug);
  if (el) return el;
  // Wait a bit more for dynamic content
  const waited = await waitForElementByKeyword(page, ['open', 'go', 'start', 'enter'], debug, 3000);
  if (waited) return waited;
  // Fallback
  return findFirstClickable(page, debug);
}

async function findNextButton(page, debug) {
  const el = await findByKeyword(page, ['next'], debug);
  if (el) return el;
  const waited = await waitForElementByKeyword(page, ['next'], debug, 2000);
  if (waited) return waited;
  return null;
}

async function checkScrollDown(page, debug) {
  const el = await findByKeyword(page, ['scroll down', 'scroll', 'down'], debug);
  if (el) {
    if (debug) console.log('  checkScrollDown: found scroll down element');
    return true;
  }
  const waited = await waitForElementByKeyword(page, ['scroll down', 'scroll', 'down'], debug, 2000);
  if (waited) return true;
  return false;
}

async function findContinueButton(page, debug) {
  const el = await findByKeyword(page, ['continue'], debug);
  if (el) return el;
  const waited = await waitForElementByKeyword(page, ['continue'], debug, 2000);
  if (waited) return waited;
  return null;
}

async function findGoToLinkButton(page, debug) {
  const el = await findByKeyword(page, ['go to link', 'goto', 'visit', 'proceed'], debug);
  if (el) return el;
  const waited = await waitForElementByKeyword(page, ['go to link', 'goto', 'visit', 'proceed'], debug, 2000);
  if (waited) return waited;
  return null;
}

async function findOpenLinkButton(page, debug) {
  const el = await findByKeyword(page, ['open link', 'open'], debug);
  if (el) return el;
  const waited = await waitForElementByKeyword(page, ['open link', 'open'], debug, 2000);
  if (waited) return waited;
  // Last resort fallback
  return findFirstClickable(page, debug);
}

/* -------------------------------------------------------------------------- */
/*  Human "error" wrappers                                                    */
/* -------------------------------------------------------------------------- */

async function maybeMisclick(page, el, debug) {
  if (!chance(0.06)) return false;
  try {
    const box = await el.boundingBox().catch(() => null);
    if (!box) return false;
    const mx = box.x + rand(-box.width * 0.55, -box.width * 0.15);
    const my = box.y + rand(-box.height * 0.55, -box.height * 0.15);
    await humanMove(page, mx, my, { steps: rand(6, 13), speed: randFloat(0.7, 1.2) });
    await sleep(rand(70, 200));
    await page.mouse.down().catch(() => {});
    await sleep(rand(25, 90));
    await page.mouse.up().catch(() => {});
    await sleep(rand(180, 450));
    if (debug) console.log('  human misclick (off-target), correcting');
    return true;
  } catch (_) { return false; }
}

async function maybeTabSwitch(page, browser, cfg, tabIndex) {
  if (!chance(config.reading.tabSwitchChance)) return;
  try {
    const pages = await browser.pages();
    const others = pages.filter(p => p !== page);
    if (others.length === 0) return;
    const target = others[rand(0, others.length - 1)];
    await target.bringToFront().catch(() => {});
    if (cfg.debug) console.log(`  tab[${tabIndex}] switched away briefly`);
    await sleep(rand(1200, 3200));
    await page.bringToFront().catch(() => {});
  } catch (_) {}
}

async function maybeBlurWindow(page, cfg, tabIndex) {
  if (!chance(config.reading.windowBlurChance)) return;
  try {
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('blur')); }).catch(() => {});
    await sleep(rand(600, 1700));
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')); }).catch(() => {});
    if (cfg.debug) console.log(`  tab[${tabIndex}] window blurred & refocused`);
  } catch (_) {}
}

module.exports = { runTabFlow };

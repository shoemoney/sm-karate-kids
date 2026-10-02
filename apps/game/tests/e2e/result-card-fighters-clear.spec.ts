import { expect, test } from './fixtures.js';

/**
 * The pre-bout card's controls must not be laid across the fighters.
 *
 * WHY THIS IS A BROWSER TEST AND NOT A STYLESHEET ASSERTION. The defect it
 * guards was invisible to every stylesheet-level check in this repo, and
 * `reference-tap-target.test.ts` is the proof: it reads `styles.css` as text
 * and asserts the button declares a `min-height` — so it went green while the
 * button sat squarely on Asmongold's head. A rule that says the right thing is
 * not a rule that is obeyed. This one measures boxes.
 *
 * WHAT IT MEASURED. At 390x844 on the qualifier card the reference button
 * spanned CSS y 312–358 with the fighters' heads at 330–340: 12 bright pixels
 * per scanline rendering *through* the button's own box. Giving it the same
 * `margin-top: auto` as FIGHT — the obvious fix — moved it to 399–445, clear of
 * the heads and straight across their torsos, hiding both chest emblems. Two
 * different geometries, one class of bug, and only pixels settle it.
 *
 * So the assertion is that the card's lower band owns the controls, the
 * fighters' bright pixels never appear inside either button, and the pair sits
 * together. It deliberately does NOT assert an exact y: that is a layout
 * snapshot wearing a test's clothes, and it would go red on a font change for
 * reasons that have nothing to do with the collision.
 */

/** Bounding box of the first element matching `selector`, or null. */
async function boxOf(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  }, selector);
}

/**
 * The fighters' vertical extent on the card, from the page's own layout.
 *
 * Read from the canvas region the card overlays rather than from a hardcoded
 * number, because the framing is a function of viewport size and any constant
 * here would be a second thing to keep in sync with the camera.
 */
async function fighterRows(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const card = document.querySelector('.result');
    if (!canvas || !card) return null;
    const c = canvas.getBoundingClientRect();
    const d = card.getBoundingClientRect();
    // The card spans the canvas; the fighters stand in its middle band.
    return { canvasTop: Math.round(c.top), canvasBottom: Math.round(c.bottom), cardTop: Math.round(d.top), cardBottom: Math.round(d.bottom) };
  });
}

test.describe('pre-bout card controls clear the fighters', () => {
  test('neither control is laid over a fighter, and the pair reads as one group', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
    await page.locator('.result-reference').waitFor({ state: 'visible', timeout: 30_000 });

    const ref = await boxOf(page, '.result-reference');
    const fight = await boxOf(page, '.result-rematch');
    const frame = await fighterRows(page);
    expect(ref, 'the reference button is missing').not.toBeNull();
    expect(fight, 'the FIGHT button is missing').not.toBeNull();
    expect(frame).not.toBeNull();

    // The container that owns the free space must exist. Without it the two
    // buttons are independent flex children and either can land on the
    // fighters — which is the bug, in structural form.
    const actions = await boxOf(page, '.result-actions');
    expect(actions, '.result-actions is missing — the controls are ungrouped').not.toBeNull();

    // Both controls live inside that one group, so the layout places them as a
    // unit in the card's lower band.
    expect(ref!.top).toBeGreaterThanOrEqual(actions!.top);
    expect(fight!.top).toBeGreaterThanOrEqual(actions!.top);
    expect(fight!.bottom).toBeLessThanOrEqual(actions!.bottom + 1);

    // REFERENCE sits directly above FIGHT, close enough to read as one group
    // and far enough not to touch.
    const gap = fight!.top - ref!.bottom;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(48);

    // Neither control intrudes into the band the fighters occupy: the region
    // between the card's top and the actions group is the fighters' band, and
    // the controls must start below it.
    expect(actions!.top).toBeGreaterThan(frame!.cardTop);

    // The tap floor, held here as well as in the stylesheet test, because this
    // one measures the rendered box rather than the declaration.
    expect(ref!.height).toBeGreaterThanOrEqual(44);
    expect(ref!.width).toBeGreaterThanOrEqual(44);
  });

  test('the reference button still opens the techniques sheet', async ({ page }) => {
    // The layout fix moved and re-parented the control, so "it is positioned
    // correctly" and "it still works" are separate claims and both are needed.
    await page.goto('/');
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
    await page.locator('.result-reference').waitFor({ state: 'visible', timeout: 30_000 });
    const before = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick);

    await page.locator('.result-reference').click();

    // `#tech-ref`, not `.sheet`. There are two sheets in the document — the
    // settings panel and the techniques reference — so a bare `.sheet` locator
    // is a strict-mode violation, which is the first version of this test's
    // failure and had nothing to do with the button.
    //
    // The sheet is toggled with the `hidden` attribute and a `.open` class, and
    // `.sheet[hidden] { display: none }` is what actually hides it — so
    // `getComputedStyle(...).display` on the *element* reads `flex` either way
    // and cannot see the difference. Playwright's own visibility check does,
    // because it accounts for the attribute.
    const sheet = page.locator('#tech-ref');
    await sheet.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(sheet).toHaveClass(/\bopen\b/);

    // Opening a reference must not start the bout.
    const after = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick);
    expect(after).toBe(before);
  });
});

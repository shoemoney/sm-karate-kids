import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shots = readFileSync(join(here, '../../../../tools/review-shots.mjs'), 'utf8');
const html = readFileSync(join(here, '../../index.html'), 'utf8');

/* r169. The settings capture selected `.setting-row input` by POSITION and its
 * comment named what those positions meant. r166 appended two
 * `label.setting-row` radios for the fighter pick to the top of that same
 * selector, so every index below them moved down by two and the comment became
 * a false record of the instrument.
 *
 * Measured, not inferred: clicking nth(4)/nth(5) left
 * `body.class = "coach-active large-controls left-handed"`. The frame reviewers
 * had been shown since r166 was the settings sheet with LARGE CONTROLS and
 * LEFT-HANDED LAYOUT on — a state nobody named — in the one capture whose stated
 * purpose is the sheet as it normally paints, so its contrast can be judged. The
 * exact defect r42/r25 already fixed once, reintroduced through the selector. */
describe('review set: no capture may select a settings row by position', () => {
  test('no .setting-row input is addressed by index', () => {
    // Strip comments first. This file narrates the old `rows.nth(4)` in prose so
    // the next reader knows what the guard is for; a raw grep would read its own
    // explanation as a violation.
    const code = shots
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    const positional = [...code.matchAll(/\.setting-row input[^\n]*\.nth\(/g)];
    expect(
      positional.map((m) => m[0]),
      'review-shots.mjs addresses a settings row by position; a feature added above the selector moves the index and the frame silently changes meaning',
    ).toEqual([]);
  });

  test('each settings row it toggles is named, and the name is checked', () => {
    // The fix is identity + assertion. A capture that names a row but never
    // verifies it is the same defect one step softer: the comment is a claim
    // about a DOM that nothing tests.
    const calls = [...shots.matchAll(/clickSetting\('([\w-]+)',\s*'([^']+)'\)/g)];
    expect(calls.length, 'the settings capture clicks nothing by identity').toBeGreaterThan(0);
    for (const [, id, label] of calls) {
      expect(html, `#${id} is not an input in index.html`).toContain(`id="${id}"`);
      // The label is read out of the same `.setting-row` the click targets, so it
      // must exist verbatim on that row or the assertion can never pass.
      const row = html.match(new RegExp(`id="${id}"[\\s\\S]{0,160}?<span>([^<]+)</span>`));
      expect(row?.[1]?.trim(), `#${id} does not read "${label}"`).toBe(label);
    }
  });

  test('the identity check actually compares and throws', () => {
    // Added because the mutation harness proved it: deleting the `throw` from
    // `clickSetting` left all six assertions green. Every other guard reads the
    // CALL SITE — `clickSetting('opt-muted', 'Mute sound')` is still right there
    // in the source — so removing the comparison made the function a click with
    // a string parameter, and nothing noticed. The call site is the claim; this
    // is the part that settles it.
    expect(shots).toMatch(/if \(label !== expectedLabel\)/);
    expect(shots).toMatch(/throw new Error\(`settings capture: #\$\{id\} reads/);
    // And the comparison must be inside the helper, not beside it.
    const helper = shots.match(/const clickSetting = async \([^)]*\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(helper, 'the label check is not inside clickSetting').toContain('label !== expectedLabel');
    expect(helper).toContain('throw new Error');
  });

  test('the settings frame refuses to shoot a non-default theme', () => {
    // The reason the two rows were chosen at all: this frame must show the
    // default paint so a reviewer can judge its contrast (r25, two models
    // reporting a contrast problem off a high-contrast frame). If a future row
    // makes the sheet non-default again, the capture must fail rather than
    // photograph the state it was written to avoid.
    expect(shots).toMatch(/if \(\/high-contrast\|large-controls\|left-handed\/\.test\(bodyClass\)\)/);
    expect(shots).toContain('frame would show a non-default theme');
  });
});

/* r169, second half. The fighter pick (r166) put a ⇄ button on the opening card
 * and a radio pair in Settings. `result-swap` appears ZERO times in the loop log
 * and the fighters-trade-places state was in no frame at all — r158's sentence
 * landing for the fourth time. */
describe('review set: the fighter pick is photographed in the state it creates', () => {
  test('a frame captures the pick after the press', () => {
    expect(shots).toContain("capture('23-phone-picked'");
  });

  test('and it asserts the trade AND the sim/draw alignment before writing', () => {
    // Otherwise it is a photograph of a button, which is what shot 01 already
    // was: the control in frame, its effect never once seen.
    //
    // `aligned` is the assertion that matters. r166 shipped `views` and `sim`
    // as separate lists precisely because "a swap that moved one and not the
    // other is a player steering the wrong body" — a defect a screenshot cannot
    // show and a label check cannot catch.
    expect(shots).toMatch(/not the state this frame reviews/);
    expect(shots).toMatch(/traded=\$\{traded\} aligned=\$\{aligned\} label=\$\{labelFlipped\}/);
    expect(shots).toContain('__smkk.seats()');
  });

  test('the frame is not reachable only through a query parameter', () => {
    // The player-facing route is the button on the opening card. A capture that
    // used `?as=` would photograph a state reached the way nobody reaches it.
    const block = shots.match(/await capture\('23-phone-picked'[\s\S]*?\n\}\);/)?.[0] ?? '';
    expect(block, 'the pick capture does not press the button').toContain('.result-swap');
    expect(block, 'the pick capture navigates with ?as= instead of pressing').not.toMatch(/\?as=/);
  });
});
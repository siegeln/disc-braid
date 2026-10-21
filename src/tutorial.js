// Turning a tutorial (pasted text, a video's description or transcript, or
// screenshots) into a movement rule. The page asks Claude through the
// published artifact's `sample` capability; this module builds the request
// and checks the answer, so it can be tested without a browser.

import { groupCount, isValidStrandCount, strandId } from './braid.js';
import { decodeRule, encodeRule, ruleWarnings, simulate } from './rules.js';

const FROMS = new Set(['TL', 'TR', 'BL', 'BR']);

export function buildPrompt(text, { strands, imageCount = 0 }) {
  return `You convert kumihimo (round foam disk, 盘编) braiding tutorials into a movement rule for a simulator.

THE SIMULATOR'S MODEL
- Strands sit in pairs at G = strands/2 dots round the disk (strands is a multiple of 4, 8 to 32). Dot 1 is at 12 o'clock and dots are numbered clockwise. At the start every dot holds 2 strands.
- The braider looks down at the disk. The pair at 12 o'clock is "top", the pair at 6 o'clock is "bottom".
- A step is a list of moves followed by a turn of the disk. Steps repeat in order.
- A move takes ONE strand: "TL" top-left, "TR" top-right, "BL" bottom-left or "BR" bottom-right (the outermost strand on that side of the top or bottom pair).
  It travels "ccw" (counter-clockwise) or "cw" (clockwise) round the disk for "dist" dots: 1 = the next dot, 2 = skip one dot, ..., or "opp" = the dot straight across.
  It lands in its new pair: "near" = on the side it arrives from (before the pair), "mid" = between the pair's strands, "far" = past the pair.
  Seen from above: at the top, ccw goes to the LEFT; at the bottom, ccw goes to the RIGHT. Going from bottom-right straight up to the top is ccw with dist "opp".
- "turn": how many dots to turn the disk after the step: 1 = counter-clockwise (the pair on the right comes to the top), -1 = clockwise (the pair on the left comes to the top), 0 = no turn.
- "times": how often to repeat the step before going to the next one: a number 1-16, or "round" = once per dot (G times).

EXAMPLES
- Kongo Gumi, the standard round braid ("move bottom right up to the right of the top pair, move top left down to the left of the bottom pair, turn the disk so the next pair is at the top"; 取右下放右上，取左上放左下，转盘):
  {"steps":[{"moves":[{"from":"BR","dir":"ccw","dist":"opp","land":"near"},{"from":"TL","dir":"ccw","dist":"opp","land":"near"}],"turn":1,"times":1}]}
- The same braid turning the other way (S spiral): moves BL cw opp near, TR cw opp near, turn -1.
- Reverse spiral / zig-zag (Kongoh Gaeshi): a Kongo Gumi step with "times":"round", then the mirrored step with "times":"round".

THE TUTORIAL
${text ? text.slice(0, 60000) : '(no text)'}
${imageCount ? `\n${imageCount} screenshot${imageCount > 1 ? 's' : ''} from the tutorial are attached. Read the disk positions and arrows in them.` : ''}

The simulator currently has ${strands} strands; use the tutorial's own strand count if it gives one.

Reply with only one JSON object:
{"ok": true or false,
 "strands": number or null,
 "rule": {"steps":[...]} or null,
 "colors": null or {"dots":[{"dot":1,"ccw":"#rrggbb","cw":"#rrggbb"}, ...]}   (one entry per dot, colours at the start; ccw = the strand on that dot's counter-clockwise side: the LEFT strand of the top pair, the RIGHT strand of the bottom pair),
 "name": "a short name for the braid",
 "summary": "2-4 sentences in the tutorial's language saying what you took from it",
 "unsure": ["anything you had to guess, in the tutorial's language"]}
If the tutorial is not a round-disk braid this model can express (for example a square plate, an odd number of strands, groups of 3 or more strands at a dot, or beads), set "ok": false and explain why in "summary".`;
}

const HEXCOL = /^#[0-9a-f]{6}$/i;

/**
 * Check Claude's answer and turn it into something the page can apply.
 * Returns { ok, strands, rule, colors, name, summary, unsure, problems }.
 */
export function parseAnswer(answer, { strands: current }) {
  const out = { ok: false, strands: current, rule: null, colors: null, name: '', summary: '', unsure: [], problems: [] };
  if (!answer || typeof answer !== 'object') { out.problems.push('The answer was not in the expected format.'); return out; }
  out.name = String(answer.name ?? '').slice(0, 80);
  out.summary = String(answer.summary ?? '').slice(0, 1200);
  out.unsure = Array.isArray(answer.unsure) ? answer.unsure.map((u) => String(u).slice(0, 300)).slice(0, 8) : [];
  if (answer.ok === false) return out;

  const n = Number(answer.strands);
  if (isValidStrandCount(n)) out.strands = n;

  const steps = answer.rule?.steps;
  if (!Array.isArray(steps) || !steps.length) { out.problems.push('No movement rule came back.'); return out; }
  const rule = { steps: [] };
  for (const st of steps.slice(0, 12)) {
    const moves = [];
    for (const m of Array.isArray(st?.moves) ? st.moves.slice(0, 8) : []) {
      if (!FROMS.has(m?.from)) continue;
      const dist = m.dist === 'opp' ? 'opp' : Math.round(Number(m.dist));
      if (dist !== 'opp' && !(dist >= 1 && dist <= 16)) continue;
      const mv = { from: m.from, dir: m.dir === 'cw' ? 'cw' : 'ccw', dist };
      if (m.land === 'mid' || m.land === 'far') mv.land = m.land;
      moves.push(mv);
    }
    if (!moves.length) continue;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const turn = clamp(Math.round(Number(st.turn)) || 0, -4, 4);
    const times = st.times === 'round' ? 'round' : clamp(Math.round(Number(st.times)) || 1, 1, 16);
    rule.steps.push({ moves, turn, times });
  }
  // Round-trip through the share-code form, which clamps every value to what
  // the editor can show.
  const clean = rule.steps.length ? decodeRule(encodeRule(rule)) : null;
  if (!clean) { out.problems.push('The movement rule could not be read.'); return out; }
  out.rule = clean;

  const G = groupCount(out.strands);
  const sim = simulate({ strands: out.strands, rule: clean, steps: 12 * G });
  for (const w of ruleWarnings(sim.stats, clean)) out.problems.push(`Step ${w.step + 1}, move ${w.move + 1}: ${w.text}`);
  if (sim.idle.length) out.problems.push(`${sim.idle.length} strand${sim.idle.length > 1 ? 's' : ''} never move with this rule, so their colour won't show.`);

  const dots = answer.colors?.dots;
  if (Array.isArray(dots) && dots.length) {
    const colors = new Array(out.strands).fill(null);
    for (const d of dots) {
      const g = Math.round(Number(d?.dot)) - 1;
      if (!(g >= 0 && g < G)) continue;
      if (HEXCOL.test(d.ccw)) colors[strandId(g, 0)] = d.ccw.toLowerCase();
      if (HEXCOL.test(d.cw)) colors[strandId(g, 1)] = d.cw.toLowerCase();
    }
    if (colors.every(Boolean)) out.colors = colors;
  }
  out.ok = true;
  return out;
}

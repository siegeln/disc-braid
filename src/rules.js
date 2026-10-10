// Movement rules: what the braider does at each step.
//
// A rule is a list of steps, repeated in order for as long as you braid:
//   { steps: [ { moves: [Move, ...], turn: 1, times: 1 }, ... ] }
//
// A Move takes one strand from the pair at the top or bottom of the disk and
// carries it a number of dots round the disk:
//   { from: 'TL' | 'TR' | 'BL' | 'BR', dir: 'ccw' | 'cw', dist: 1..G/2 | 'opp' }
// dist 1 is the next dot, 2 skips one dot, 'opp' is the dot straight across
// (so the rule still works when the strand count changes).
//
// The strand lands on the side of its new pair that it arrives from: going
// counter-clockwise it ends up as the clockwise-most strand there, and vice versa.
// `turn` is how many dots to turn the disk afterwards: +1 turns it
// counter-clockwise (the pair on the right comes to the top), -1 clockwise,
// 0 not at all. `times` repeats the step; 'round' repeats it once per dot.
//
// Groups are kept as lists in clockwise order, so the first strand in a list is
// the counter-clockwise-most one: top-left at the top, bottom-right at the bottom.

import { dotAngle, groupCount, isValidStrandCount, MAX_STRANDS, MIN_STRANDS, strandId } from './braid.js';

const mod = (a, m) => ((a % m) + m) % m;

export const POSITIONS = {
  TL: { name: 'top-left', at: 'top', end: 'first' },
  TR: { name: 'top-right', at: 'top', end: 'last' },
  BL: { name: 'bottom-left', at: 'bottom', end: 'last' },
  BR: { name: 'bottom-right', at: 'bottom', end: 'first' },
};

export function resolveDist(dist, G) {
  if (dist === 'opp') return G / 2;
  return Math.max(1, Math.min(G / 2, Math.round(Number(dist)) || 1));
}

export function resolveTimes(times, G) {
  if (times === 'round') return G;
  return Math.max(1, Math.min(64, Math.round(Number(times)) || 1));
}

export function distLabel(dist, G) {
  const d = resolveDist(dist, G);
  if (dist === 'opp' || d === G / 2) return 'the opposite dot';
  if (d === 1) return 'the next dot';
  return `skip ${d - 1} dot${d > 2 ? 's' : ''}`;
}

/** Plain-language instruction for one move, e.g. for the rule editor. */
export function describeMove(m, G) {
  const pos = POSITIONS[m.from];
  const way = m.dir === 'ccw' ? 'counter-clockwise' : 'clockwise';
  // Which way that looks to the braider, from where the strand starts.
  const looks = (pos.at === 'top') === (m.dir === 'ccw') ? 'left' : 'right';
  const d = resolveDist(m.dist, G);
  const where = d === G / 2 ? `across to the ${pos.at === 'top' ? 'bottom' : 'top'}` : `to the ${looks}`;
  return `Take the ${pos.name} strand ${way} (${where}) to ${distLabel(m.dist, G).replace(/^skip/, 'the dot after skipping')}.`;
}

export function describeTurn(turn) {
  if (!turn) return "Don't turn the disk.";
  const n = Math.abs(turn);
  const dots = n === 1 ? 'one dot' : `${n} dots`;
  return turn > 0
    ? `Turn the disk ${dots} counter-clockwise (the pair on the right comes to the top).`
    : `Turn the disk ${dots} clockwise (the pair on the left comes to the top).`;
}

// ---------------------------------------------------------------------------
// Presets

const kongoStep = { moves: [{ from: 'BR', dir: 'ccw', dist: 'opp' }, { from: 'TL', dir: 'ccw', dist: 'opp' }], turn: 1, times: 1 };

export const RULE_PRESETS = [
  {
    id: 'kongo',
    name: 'Opposite side · Kongo Gumi',
    hint: 'The standard round braid (金剛組)',
    rule: { steps: [kongoStep] },
  },
  {
    id: 'kongo-s',
    name: 'Opposite side, mirrored',
    hint: 'Same braid spiralling the other way',
    rule: { steps: [{ moves: [{ from: 'BL', dir: 'cw', dist: 'opp' }, { from: 'TR', dir: 'cw', dist: 'opp' }], turn: -1, times: 1 }] },
  },
  {
    id: 'next',
    name: 'Next dot',
    hint: 'Each strand moves to the neighbouring pair',
    rule: { steps: [{ moves: [{ from: 'TR', dir: 'ccw', dist: 1 }, { from: 'BL', dir: 'ccw', dist: 1 }], turn: 1, times: 1 }] },
  },
  {
    id: 'skip1',
    name: 'Skip one dot',
    hint: 'Move past the neighbouring pair',
    rule: { steps: [{ moves: [{ from: 'TR', dir: 'ccw', dist: 2 }, { from: 'BL', dir: 'ccw', dist: 2 }], turn: 1, times: 1 }] },
  },
  {
    id: 'mixed',
    name: 'Opposite round, then next-dot round',
    hint: 'Alternate the two kinds of move, one round each',
    rule: { steps: [{ ...kongoStep, times: 'round' }, { moves: [{ from: 'TR', dir: 'ccw', dist: 1 }, { from: 'BL', dir: 'ccw', dist: 1 }], turn: 1, times: 'round' }] },
  },
  {
    id: 'zigzag',
    name: 'Switch direction each round',
    hint: 'One round of Kongo Gumi, then one mirrored',
    rule: {
      steps: [
        { ...kongoStep, times: 'round' },
        { moves: [{ from: 'BL', dir: 'cw', dist: 'opp' }, { from: 'TR', dir: 'cw', dist: 'opp' }], turn: -1, times: 'round' },
      ],
    },
  },
];

export const DEFAULT_RULE = RULE_PRESETS[0].rule;

export function cloneRule(rule) {
  return { steps: rule.steps.map((s) => ({ ...s, moves: s.moves.map((m) => ({ ...m })) })) };
}

// ---------------------------------------------------------------------------
// Simulation

/** The rule expanded into the sequence of steps actually braided, one cycle long. */
export function expandRule(rule, G) {
  const seq = [];
  rule.steps.forEach((step, index) => {
    for (let i = 0, n = resolveTimes(step.times, G); i < n; i++) seq.push({ ...step, index });
  });
  return seq;
}

/** Height the cord grows in one step, as a fraction of its circumference. */
export function stepHeight(G, movesInStep) {
  return (1.3 / (G * G)) * (Math.max(1, movesInStep) / 2);
}

/**
 * Braid `steps` steps with `rule`.
 *
 * Every move lays one stitch on the cord, centred on the side the strand
 * travelled past: the middle of the arc from where it started to where it went.
 * Returns stitches in the order they were laid plus per-move statistics
 * (how many strands each move in the rule crossed, and whether it ever found
 * its pair empty).
 */
export function simulate({ strands, rule = DEFAULT_RULE, steps }) {
  if (!isValidStrandCount(strands)) throw new Error(`strand count must be a multiple of 4 between ${MIN_STRANDS} and ${MAX_STRANDS}`);
  const G = groupCount(strands);
  const seq = expandRule(rule, G);
  const groups = [];
  for (let g = 0; g < G; g++) groups.push([strandId(g, 0), strandId(g, 1)]);

  const stats = rule.steps.map((s) => s.moves.map(() => ({ minCross: Infinity, maxCross: 0, empty: 0 })));
  const stitches = [];
  const stepY = [0];
  let top = 0;
  let y = 0;

  for (let s = 0; s < steps && seq.length; s++) {
    const step = seq[s % seq.length];
    const h = stepHeight(G, step.moves.length);
    step.moves.forEach((m, mi) => {
      const pos = POSITIONS[m.from];
      const src = pos.at === 'top' ? mod(top, G) : mod(top + G / 2, G);
      const list = groups[src];
      const stat = stats[step.index][mi];
      if (!list.length) { stat.empty++; return; }
      const idx = pos.end === 'first' ? 0 : list.length - 1;
      const strand = list[idx];
      const d = resolveDist(m.dist, G);
      const sign = m.dir === 'ccw' ? 1 : -1;
      const dst = mod(src - sign * d, G);

      // Strands passed over: those in the source pair on the way out, and every
      // strand in the pairs between. It lands on the near side of its new pair.
      let cross = sign > 0 ? idx : list.length - 1 - idx;
      for (let k = 1; k < d; k++) cross += groups[mod(src - sign * k, G)].length;
      stat.minCross = Math.min(stat.minCross, cross);
      stat.maxCross = Math.max(stat.maxCross, cross);

      list.splice(idx, 1);
      if (sign > 0) groups[dst].push(strand); else groups[dst].unshift(strand);

      const angle = mod(dotAngle(src, G) + (sign * d * 360) / G / 2, 360);
      stitches.push({ strand, angle, step: s, y, h, dir: sign, crossings: cross, src, dst, rule: [step.index, mi] });
    });
    top += step.turn || 0;
    y += h;
    stepY.push(y);
  }
  for (const row of stats) for (const st of row) if (st.minCross === Infinity) st.minCross = 0;
  return { G, stitches, groups, stats, stepY, cycle: seq.length };
}

/** Kongo Gumi, kept as a named shortcut. turn: 'ccw' (standard) or 'cw'. */
export function simulateKongoGumi({ strands, steps, turn = 'ccw' }) {
  const rule = turn === 'cw'
    ? { steps: [{ ...kongoStep, turn: -1 }] }
    : DEFAULT_RULE;
  return simulate({ strands, rule, steps });
}

/** Problems worth telling the braider about, one message per rule move. */
export function ruleWarnings(stats, rule) {
  const out = [];
  rule.steps.forEach((step, si) => step.moves.forEach((m, mi) => {
    const st = stats[si]?.[mi];
    if (!st) return;
    if (st.empty) out.push({ step: si, move: mi, text: 'Sometimes there is no strand left at that position, so this move gets skipped.' });
    else if (st.maxCross === 0) out.push({ step: si, move: mi, text: "This strand never passes over another one, so it won't lock into the braid; it just twists round the others." });
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Compact text form for pattern codes: steps joined by '_', each step
// "BRao,TLao/1x1" = moves (position, a|c for anti-/clockwise, o or a number),
// then /turn, then optional x times (r = once per dot).

export function encodeRule(rule) {
  return rule.steps.map((s) => {
    const moves = s.moves.map((m) => `${m.from}${m.dir === 'ccw' ? 'a' : 'c'}${m.dist === 'opp' ? 'o' : m.dist}`).join(',');
    const times = s.times === 'round' ? 'r' : String(s.times ?? 1);
    return `${moves}/${s.turn || 0}${times === '1' ? '' : `x${times}`}`;
  }).join('_');
}

const MOVE = /^(TL|TR|BL|BR)([ac])(o|\d{1,2})$/;
const STEP = /^([^/]*)\/(-?\d{1,2})(?:x(r|\d{1,2}))?$/;

export function decodeRule(text) {
  if (!text) return null;
  const steps = [];
  for (const part of text.split('_')) {
    const sm = STEP.exec(part);
    if (!sm) return null;
    const moves = [];
    for (const tok of sm[1].split(',').filter(Boolean)) {
      const mm = MOVE.exec(tok);
      if (!mm) return null;
      moves.push({ from: mm[1], dir: mm[2] === 'a' ? 'ccw' : 'cw', dist: mm[3] === 'o' ? 'opp' : Number(mm[3]) });
    }
    if (moves.length > 8) return null;
    steps.push({ moves, turn: Number(sm[2]), times: sm[3] === 'r' ? 'round' : Number(sm[3] ?? 1) });
  }
  return steps.length && steps.length <= 12 ? { steps } : null;
}

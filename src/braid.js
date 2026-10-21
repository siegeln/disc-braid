// Kumihimo disk braid engine (pure logic, no DOM).
//
// Model
// -----
// Strands sit in pairs ("groups") around the disk, one pair per dot. With N
// strands there are G = N/2 dots, numbered clockwise from 12 o'clock (g = 0).
// Each group is an ordered list in clockwise order, so for the pair at the
// top the first entry is the top-left strand, and for the pair at the bottom
// the first entry is the bottom-right strand.
//
// What the braider does with the strands is a movement rule (see rules.js).
// Every move lays one visible stitch on the surface of the cord. The cord hangs
// from the centre of the disk and turns with it, so stitches are recorded in
// the disk's own frame:
//   angle  - where around the cord it sits (degrees, 0 = 3 o'clock, CCW +)
//   step   - when it was laid (higher = newer = closer to the disk)
// The colour sequence is exact; how much the finished cord twists is a physical
// property, exposed as `twist` so it can be calibrated against a real braid.

export const MIN_STRANDS = 8;
export const MAX_STRANDS = 32;

export function isValidStrandCount(n) {
  return Number.isInteger(n) && n >= MIN_STRANDS && n <= MAX_STRANDS && n % 4 === 0;
}

export function groupCount(n) {
  return n / 2;
}

const mod = (a, m) => ((a % m) + m) % m;

/** Angle (degrees, CCW from 3 o'clock) of dot g on a disk with G dots. */
export function dotAngle(g, G) {
  return 90 - (mod(g, G) * 360) / G;
}

/** Strand id for slot k (0 = counter-clockwise side, 1 = clockwise side) at dot g. */
export function strandId(g, k) {
  return 2 * g + k;
}

/**
 * Where each strand sits on the disk at set-up time, with the L/R labels used
 * in hand-written notes: R1 is the first strand clockwise from 12 o'clock,
 * L1 the first counter-clockwise, counting down each side. So Li and Ri are
 * mirror images of each other.
 */
export function strandLayout(n) {
  const G = groupCount(n);
  const spread = Math.min(7, 360 / G / 4);
  const strands = [];
  for (let g = 0; g < G; g++) {
    for (let k = 0; k < 2; k++) {
      const angle = dotAngle(g, G) + (k === 0 ? spread : -spread);
      strands.push({ id: strandId(g, k), g, k, angle });
    }
  }
  const x = (s) => Math.cos((s.angle * Math.PI) / 180);
  const fromTopCW = (a) => mod(90 - a, 360);
  const right = strands.filter((s) => x(s) > 1e-9).sort((a, b) => fromTopCW(a.angle) - fromTopCW(b.angle));
  const left = strands.filter((s) => x(s) <= 1e-9).sort((a, b) => fromTopCW(b.angle) - fromTopCW(a.angle));
  right.forEach((s, i) => { s.side = 'R'; s.label = `R${i + 1}`; });
  left.forEach((s, i) => { s.side = 'L'; s.label = `L${i + 1}`; });
  return strands;
}

/** The strand that sits at the mirror-image position (reflected left/right). */
export function mirrorStrand(id, n) {
  const G = groupCount(n);
  const g = Math.floor(id / 2);
  const k = id % 2;
  return strandId(mod(-g, G), 1 - k);
}

/** Steps for one full turn of the disk (every pair has been to the top once). */
export function stepsPerRound(n) {
  return groupCount(n);
}

/**
 * Cord twist is given relative to how fast the strands themselves wind round
 * the cord (180/G degrees per step): -1 untwists them completely, 0 keeps the
 * disk's frame. The default is calibrated so that opposite-pair colours spiral.
 */
export const DEFAULT_TWIST = -0.5;

/** Twist in degrees per step for a relative twist value. */
export function twistDegrees(rel, n) {
  return (rel * 180) / groupCount(n);
}

/** Angle of a stitch on the finished cord after twist is applied. */
export function cordAngle(stitch, twist) {
  return mod(stitch.angle + twist * (stitch.phase ?? stitch.step), 360);
}

// ---------------------------------------------------------------------------
// Colour layouts

export const DEFAULT_PALETTE = ['#f3ead8', '#2b2b33', '#c4623f', '#8fa58a', '#6f8fb0', '#d9a43c', '#e2a6a6', '#24345c'];

function fill(n, fn) {
  const G = groupCount(n);
  const out = new Array(n);
  for (let g = 0; g < G; g++) for (let k = 0; k < 2; k++) out[strandId(g, k)] = fn(g, k, G);
  return out;
}

function bySide(n, fn) {
  const out = new Array(n);
  for (const s of strandLayout(n)) out[s.id] = fn(s);
  return out;
}

export const PRESETS = [
  { id: 'spiral', name: 'Spiral (2 colours)', hint: 'Alternate dots A / B', make: (n, p) => fill(n, (g) => (g % 2 ? p[1] : p[0])) },
  { id: 'line', name: 'Single spiral line', hint: 'One dot in A, rest B', make: (n, p) => fill(n, (g) => (g === 0 ? p[1] : p[0])) },
  { id: 'double', name: 'Double spiral line', hint: 'Opposite dots in A', make: (n, p) => fill(n, (g, k, G) => (g === 0 || g === G / 2 ? p[1] : p[0])) },
  { id: 'split', name: 'Split pairs', hint: 'Each pair half A, half B', make: (n, p) => fill(n, (g, k) => (k ? p[1] : p[0])) },
  { id: 'halves', name: 'Half & half', hint: 'Right half A, left half B', make: (n, p) => bySide(n, (s) => (s.side === 'R' ? p[0] : p[1])) },
  { id: 'mirror', name: 'Mirror stripes', hint: 'L = R, banded from the top', make: (n, p) => bySide(n, (s) => p[Math.floor((Number(s.label.slice(1)) - 1) / 2) % p.length]) },
  { id: 'rainbow', name: 'Every dot different', hint: 'One palette colour per dot', make: (n, p) => fill(n, (g) => p[g % p.length]) },
  { id: 'diamonds', name: 'Diamonds', hint: 'L2/R2 and L5/R5 in B · use with Diamond weave', make: (n, p) => bySide(n, (s) => (['2', '5'].includes(s.label.slice(1)) ? p[1] : p[0])) },
  { id: 'solid', name: 'Solid', hint: 'All one colour', make: (n, p) => fill(n, () => p[0]) },
];

/** Copy the right half's colours onto the left half (L_i = R_i). */
export function mirrorRightToLeft(colors) {
  const n = colors.length;
  const out = colors.slice();
  for (const s of strandLayout(n)) if (s.side === 'L') out[s.id] = colors[mirrorStrand(s.id, n)];
  return out;
}

/** Shift the whole layout one dot clockwise. */
export function rotateLayout(colors, by = 1) {
  const n = colors.length;
  return colors.map((_, id) => colors[mod(id - 2 * by, n)]);
}

/** Change strand count, keeping existing colours where possible. */
export function resizeLayout(colors, n) {
  return Array.from({ length: n }, (_, i) => colors[i % colors.length]);
}

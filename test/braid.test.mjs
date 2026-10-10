import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, DEFAULT_PALETTE, decodePattern, encodePattern, groupCount, mirrorRightToLeft, mirrorStrand,
  rotateLayout, simulateKongoGumi, strandLayout,
} from '../src/braid.js';

const COUNTS = [8, 12, 16, 20, 24, 28, 32];
// Distance of an angle from 0 (mod 360), for comparing float angles.
const off = (deg) => { const m = ((deg % 360) + 360) % 360; return Math.min(m, 360 - m); };

test('rejects strand counts that cannot be split into opposite pairs', () => {
  for (const n of [6, 10, 7, 36]) assert.throws(() => simulateKongoGumi({ strands: n, steps: 1 }));
});

test('two moves per step, and every pair is back to two strands after a full round', () => {
  for (const n of COUNTS) {
    const G = groupCount(n);
    const { stitches, groups } = simulateKongoGumi({ strands: n, steps: 3 * G });
    assert.equal(stitches.length, 6 * G);
    assert.ok(groups.every((g) => g.length === 2), `n=${n}`);
  }
});

test('each strand moves exactly once every G steps, alternating up and down', () => {
  for (const turn of ['ccw', 'cw']) {
    for (const n of COUNTS) {
      const G = groupCount(n);
      const { stitches } = simulateKongoGumi({ strands: n, steps: 6 * G, turn });
      const byStrand = new Map();
      for (const s of stitches) (byStrand.get(s.strand) ?? byStrand.set(s.strand, []).get(s.strand)).push(s);
      assert.equal(byStrand.size, n);
      for (const moves of byStrand.values()) {
        const late = moves.filter((m) => m.step >= G);
        for (let i = 1; i < late.length; i++) {
          assert.equal(late[i].step - late[i - 1].step, G);
          assert.notEqual(late[i].move, late[i - 1].move);
          assert.ok(off(late[i].angle - late[i - 1].angle - 180) < 1e-9);
        }
      }
    }
  }
});

test('strands only trade places with the opposite dot', () => {
  for (const n of COUNTS) {
    const G = groupCount(n);
    const colors = Array.from({ length: n }, (_, id) => Math.floor(id / 2) % (G / 2));
    const { groups } = simulateKongoGumi({ strands: n, steps: 5 * G + 3 });
    groups.forEach((members, g) => members.forEach((id) => assert.equal(colors[id], g % (G / 2))));
  }
});

test('first step of 8-strand matches the hand instructions', () => {
  // Dots 1..4 clockwise from the top: N, E, S, W. Strand 2g is the left/CCW one.
  const { stitches } = simulateKongoGumi({ strands: 8, steps: 1 });
  assert.deepEqual(stitches.map((s) => [s.strand, s.move, s.angle]), [
    [4, 'up', 0], // bottom-right (S dot, CCW side = right when at bottom) goes up past the right side
    [0, 'down', 180], // top-left goes down past the left side
  ]);
});

test('L/R labels are mirror images and mirrorStrand agrees', () => {
  for (const n of COUNTS) {
    const layout = strandLayout(n);
    const byLabel = new Map(layout.map((s) => [s.label, s]));
    for (let i = 1; i <= n / 2; i++) {
      const l = byLabel.get(`L${i}`);
      const r = byLabel.get(`R${i}`);
      assert.ok(off(l.angle + r.angle - 180) < 1e-9, `${n} L${i}/R${i}`);
      assert.equal(mirrorStrand(r.id, n), l.id);
    }
  }
});

test('mirror and rotate layout helpers', () => {
  const colors = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const m = mirrorRightToLeft(colors);
  for (const s of strandLayout(8)) if (s.side === 'R') assert.equal(m[s.id], colors[s.id]);
  assert.deepEqual(rotateLayout(colors), ['g', 'h', 'a', 'b', 'c', 'd', 'e', 'f']);
});

test('presets produce one colour per strand', () => {
  for (const n of COUNTS) for (const p of PRESETS) {
    const out = p.make(n, DEFAULT_PALETTE);
    assert.equal(out.length, n);
    assert.ok(out.every((c) => DEFAULT_PALETTE.includes(c)), `${p.id} ${n}`);
  }
});

test('pattern links round-trip and reject junk', () => {
  const colors = PRESETS[0].make(12, DEFAULT_PALETTE);
  const back = decodePattern(encodePattern({ colors, rounds: 20, twist: -0.25, turn: 'cw' }));
  assert.deepEqual(back, { colors, rounds: 20, twist: -0.25, turn: 'cw' });
  assert.equal(decodePattern('c=ffffff.000000'), null);
  assert.equal(decodePattern('c=zzzzzz.000000.000000.000000.000000.000000.000000.000000'), null);
  assert.equal(decodePattern(''), null);
});

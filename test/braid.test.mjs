import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, DEFAULT_PALETTE, groupCount, mirrorRightToLeft, mirrorStrand, rotateLayout, strandLayout,
} from '../src/braid.js';
import { decodePattern, encodePattern } from '../src/pattern.js';
import { buildSurface, trimSteps } from '../src/render.js';
import { twistDegrees } from '../src/braid.js';
import {
  DEFAULT_RULE, RULE_PRESETS, decodeRule, describeMove, encodeRule, ruleWarnings, simulate, simulateKongoGumi, stepDetails,
} from '../src/rules.js';

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
          assert.notEqual(late[i].rule[1], late[i - 1].rule[1]); // up, then down
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
  assert.deepEqual(stitches.map((s) => [s.strand, s.angle]), [
    [4, 0], // bottom-right (S dot, CCW side = right when at bottom) goes up past the right side
    [0, 180], // top-left goes down past the left side
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
  const rule = RULE_PRESETS.find((r) => r.id === 'zigzag').rule;
  const back = decodePattern(encodePattern({ colors, rounds: 20, twist: -0.25, rule }));
  assert.deepEqual(back, { colors, rounds: 20, twist: -0.25, rule });
  assert.equal(decodePattern('c=ffffff.000000'), null);
  assert.equal(decodePattern('c=zzzzzz.000000.000000.000000.000000.000000.000000.000000'), null);
  assert.equal(decodePattern(''), null);
});

test('links from before movement rules still load', () => {
  const c = 'c=' + Array(8).fill('ffffff').join('.');
  assert.deepEqual(decodePattern(c).rule, DEFAULT_RULE);
  assert.equal(encodeRule(decodePattern(`${c}&turn=cw`).rule), 'BRao,TLao/-1');
});

test('every preset rule round-trips through its text form', () => {
  for (const p of RULE_PRESETS) assert.deepEqual(decodeRule(encodeRule(p.rule)), p.rule, p.id);
  for (const bad of ['', 'XXao/1', 'BRao/', 'BRzo/1', 'BRao/1x']) assert.equal(decodeRule(bad), null, bad);
});

test('every preset braids without running out of strands and every move crosses something', () => {
  for (const n of COUNTS) for (const p of RULE_PRESETS) {
    const G = groupCount(n);
    const r = simulate({ strands: n, rule: p.rule, steps: 8 * G });
    assert.deepEqual(ruleWarnings(r.stats, p.rule), [], `${p.id} n=${n}`);
    assert.equal(r.groups.flat().length, n);
  }
});

test('Kongo Gumi moves pass over half the other strands', () => {
  const r = simulate({ strands: 16, rule: DEFAULT_RULE, steps: 32 });
  assert.ok(r.stitches.every((s) => s.crossings === 6));
});

test('next-dot moves land on the near side of the neighbouring pair', () => {
  // Top-right strand going counter-clockwise one dot passes over top-left only.
  const rule = { steps: [{ moves: [{ from: 'TR', dir: 'ccw', dist: 1 }], turn: 0, times: 1 }] };
  const r = simulate({ strands: 8, rule, steps: 1 });
  assert.equal(r.stitches[0].strand, 1);
  assert.equal(r.stitches[0].crossings, 1);
  assert.deepEqual(r.groups[3], [6, 7, 1]); // W pair, arriving on its clockwise (upper) side
  assert.equal(r.stitches[0].angle, 135); // stitch half-way between N and W
});

test('a move that passes over nothing is flagged', () => {
  const rule = { steps: [{ moves: [{ from: 'TL', dir: 'ccw', dist: 1 }], turn: 1, times: 1 }] };
  const r = simulate({ strands: 8, rule, steps: 16 });
  assert.equal(ruleWarnings(r.stats, rule).length, 1);
});

test('mirrored Kongo Gumi is the mirror image of Kongo Gumi', () => {
  const n = 12;
  const mirrored = RULE_PRESETS.find((r) => r.id === 'kongo-s').rule;
  const a = simulate({ strands: n, rule: DEFAULT_RULE, steps: 30 }).stitches;
  const b = simulate({ strands: n, rule: mirrored, steps: 30 }).stitches;
  a.forEach((s, i) => {
    assert.equal(b[i].strand, mirrorStrand(s.strand, n));
    assert.ok(off(s.angle + b[i].angle - 180) < 1e-9);
  });
});

test('moves are described in plain language', () => {
  assert.equal(describeMove({ from: 'BR', dir: 'ccw', dist: 'opp' }, 8),
    'Take the bottom-right strand counter-clockwise (across to the top) to the opposite dot.');
  assert.equal(describeMove({ from: 'TR', dir: 'ccw', dist: 2 }, 8),
    'Take the top-right strand counter-clockwise (to the left) to the dot after skipping 1 dot.');
});

test('every preset moves every strand equally often (no colour can go missing)', () => {
  for (const n of COUNTS) for (const p of RULE_PRESETS) {
    const G = groupCount(n);
    const r = simulate({ strands: n, rule: p.rule, steps: 40 * G });
    assert.deepEqual(r.idle, [], `${p.id} n=${n}`);
    const c = new Array(n).fill(0);
    for (const s of r.stitches) if (s.step >= 20 * G) c[s.strand]++;
    assert.equal(Math.min(...c), Math.max(...c), `${p.id} n=${n}`);
  }
});

test('strands that never move are reported (the old next-dot rule lost half of them)', () => {
  const old = decodeRule('TRa1,BLa1/1');
  const r = simulate({ strands: 16, rule: old, steps: 160 });
  assert.equal(r.idle.length, 10);
  const labels = r.idle.map((id) => strandLayout(16).find((l) => l.id === id).label);
  assert.ok(labels.includes('L2') && labels.includes('L3'));
});

test('laying a strand past the pair lands it on the far side and counts those crossings', () => {
  const rule = { steps: [{ moves: [{ from: 'TR', dir: 'ccw', dist: 1, land: 'far' }], turn: 0, times: 1 }] };
  const r = simulate({ strands: 8, rule, steps: 1 });
  assert.deepEqual(r.groups[3], [1, 6, 7]); // W pair: strand 1 past both of its strands
  assert.equal(r.stitches[0].crossings, 3); // its partner plus the two it was laid over
  assert.equal(encodeRule(rule), 'TRa1f/0');
  assert.deepEqual(decodeRule('TRa1f/0'), rule);
});

test('the picture shows every strand that moves, in proportion, with no gaps', () => {
  for (const n of [8, 16, 24]) for (const p of RULE_PRESETS) {
    const G = groupCount(n);
    const sim = simulate({ strands: n, rule: p.rule, steps: 16 * G + 2 * trimSteps(G) });
    const colors = Array.from({ length: n }, () => '#808080');
    const surf = buildSurface({ stitches: sim.stitches, stepY: sim.stepY, colors, G, twist: twistDegrees(-0.5, n), resolution: 256 });
    const area = new Array(n).fill(0);
    for (const v of surf.strandAt) { assert.ok(v >= 0, 'gap in surface'); area[v]++; }
    const fair = surf.strandAt.length / n;
    for (let id = 0; id < n; id++) assert.ok(area[id] > 0.5 * fair && area[id] < 1.6 * fair, `${p.id} n=${n} strand ${id}`);
  }
});

test('step-by-step details agree with the full simulation at every step', () => {
  for (const p of RULE_PRESETS) for (const n of [8, 12]) {
    const G = groupCount(n);
    const full = simulate({ strands: n, rule: p.rule, steps: 3 * G + 1 });
    let top = 0;
    for (let k = 0; k <= 3 * G; k++) {
      const d = stepDetails({ strands: n, rule: p.rule, step: k });
      assert.equal(d.top, top, `${p.id} n=${n} step ${k}: disk turned the wrong amount`);
      const laid = full.stitches.filter((s) => s.step === k);
      assert.deepEqual(d.moves.map((m) => m.strand), laid.map((s) => s.strand), `${p.id} n=${n} step ${k}`);
      assert.deepEqual(d.moves.at(-1)?.after ?? d.before, d.after);
      top += d.turn;
    }
  }
});

import {
  DEFAULT_PALETTE, DEFAULT_TWIST, MAX_STRANDS, MIN_STRANDS, PRESETS,
  dotAngle, groupCount, mirrorRightToLeft, resizeLayout,
  rotateLayout, strandLayout, stepsPerRound, twistDegrees,
} from './braid.js';
import { decodePattern, encodePattern } from './pattern.js';
import { buildSurface, drawCord, drawUnrolled, trimSteps } from './render.js';
import { createCordView } from './cord3d.js';
import { buildPrompt, parseAnswer } from './tutorial.js';
import {
  DEFAULT_RULE, POSITIONS, RULE_PRESETS, cloneRule, describeMove, describeTurn, distLabel,
  encodeRule, resolveDist, resolveTimes, ruleWarnings, simulate as simulateRule, stepDetails,
} from './rules.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

const state = {
  colors: PRESETS[0].make(16, DEFAULT_PALETTE),
  palette: DEFAULT_PALETTE.slice(),
  brush: 1,
  rounds: 32,
  twist: DEFAULT_TWIST,
  rule: cloneRule(DEFAULT_RULE),
  view: 270,
  spin: false,
  labels: true,
};

// ---------------------------------------------------------------- persistence

function loadFromHash() {
  const p = decodePattern(location.hash.slice(1));
  if (!p) return;
  state.colors = p.colors;
  if (p.rounds) state.rounds = p.rounds;
  if (p.twist !== undefined) state.twist = p.twist;
  state.rule = cloneRule(p.rule);
  for (const c of p.colors) if (!state.palette.includes(c)) state.palette.push(c);
}

function saveToHash() {
  const hash = encodePattern(state);
  history.replaceState(null, '', `#${hash}`);
}

// ----------------------------------------------------------------------- disk

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function polar(r, deg) {
  // Screen y grows downwards, so flip the sign of sin.
  return [r * Math.cos((deg * Math.PI) / 180), -r * Math.sin((deg * Math.PI) / 180)];
}

function paint(ids) {
  const color = state.palette[state.brush];
  let changed = false;
  for (const id of ids) if (state.colors[id] !== color) { state.colors[id] = color; changed = true; }
  if (!changed) return;
  // While dragging, only redraw the disk; rebuild the cord once the finger lifts.
  if (painting) { paintedWhileDragging = true; renderDisk(); } else update();
}

// Drag across strands to paint several. The disk captures the pointer (the knob
// it started on is redrawn while painting), and strands are found by position.
let painting = false;
let paintedWhileDragging = false;
function endPaint() {
  painting = false;
  if (paintedWhileDragging) { paintedWhileDragging = false; update(); }
}
window.addEventListener('pointerup', endPaint);
window.addEventListener('pointercancel', endPaint);
function paintUnderPointer(e) {
  if (!painting) return;
  const id = document.elementFromPoint(e.clientX, e.clientY)?.getAttribute?.('data-id');
  if (id != null) paint([Number(id)]);
}

// The disk can show the set-up (step 0) or any later step of the braid, with
// the strands where they are by then and the disk turned the way the braider
// would have it. Arrows show the moves about to be made.

function strandAngles(groups, G) {
  const spread = Math.min(7, 360 / G / 4);
  const at = new Map();
  groups.forEach((list, g) => list.forEach((id, i) => at.set(id, dotAngle(g, G) + spread * (list.length - 1 - 2 * i))));
  return at;
}

// Arrow geometry for a strand travelling `sign` (1 = counter-clockwise) from
// angle a to angle b: a curve that hugs the rim for short moves and passes
// near the centre for moves across the disk.
function travel(a, b, sign) {
  const arc = ((((b - a) * sign) % 360) + 360) % 360 || 360;
  const mid = a + (sign * arc) / 2;
  const pull = Math.max(0.24, Math.cos(((arc / 2) * Math.PI) / 180) * 0.85);
  return { mid, pull };
}

function bezier(p0, c, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

let walkDetails = null;
function currentDetails() {
  const n = state.colors.length;
  if (!walkDetails || walkDetails.key !== walk.step) {
    walkDetails = { key: walk.step, ...stepDetails({ strands: n, rule: state.rule, step: walk.step }) };
  }
  return walkDetails;
}

/**
 * Draw the disk. `frame` (optional, for animation) overrides what is shown:
 *   { groups, rot, moving: { strand, from, to, sign, t }, from: Map, to: Map, t }
 */
function renderDisk(frame) {
  const svg = $('disk');
  svg.replaceChildren();
  const n = state.colors.length;
  const G = groupCount(n);
  const d = currentDetails();
  const setup = walk.step === 0 && !frame;
  const rot = frame ? frame.rot : (d.top * 360) / G;
  const R = (a) => a + rot;
  const knobR = n > 24 ? 9 : 11;

  const defs = el('defs', {}, svg);
  const marker = el('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }, marker);

  el('circle', { r: 160, class: 'disk-face' }, svg);
  el('circle', { r: 26, class: 'disk-hole' }, svg);
  el('line', { x1: 0, y1: -200, x2: 0, y2: 200, class: 'divider' }, svg);
  const lt = el('text', { x: -190, y: -186, class: 'side-label' }, svg); lt.textContent = 'L';
  const rt = el('text', { x: 190, y: -186, class: 'side-label', 'text-anchor': 'end' }, svg); rt.textContent = 'R';

  for (let i = 0; i < 32; i++) {
    const a = R(90 - (i + 0.5) * (360 / 32));
    const [x1, y1] = polar(146, a);
    const [x2, y2] = polar(160, a);
    el('line', { x1, y1, x2, y2, class: 'slot' }, svg);
  }

  const groups = frame ? frame.groups : pick ? pickSources(d).groups : d.before;
  for (let g = 0; g < G; g++) {
    const [x, y] = polar(132, R(dotAngle(g, G)));
    const dot = el('g', { class: 'dot', tabindex: 0, role: 'button', 'aria-label': `Pair at dot ${g + 1}: paint both strands` }, svg);
    el('circle', { cx: x, cy: y, r: 10 }, dot);
    el('text', { x, y: y + 4, 'text-anchor': 'middle' }, dot).textContent = g + 1;
    const both = () => paint(groups[g].slice());
    dot.addEventListener('click', both);
    dot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); both(); } });
  }

  // Where each strand is drawn.
  const at = frame ? new Map() : strandAngles(groups, G);
  const knobXY = new Map();
  if (frame) {
    for (const [id, a0] of frame.from) {
      const a1 = frame.to.get(id);
      let da = ((((a1 - a0) % 360) + 540) % 360) - 180;
      at.set(id, a0 + da * frame.t);
    }
    if (frame.moving) {
      const m = frame.moving;
      const { mid, pull } = travel(m.from, m.to, m.sign);
      const p = bezier(polar(178, R(m.from)), polar(178 * pull, R(mid)), polar(178, R(m.to)), m.t);
      knobXY.set(m.strand, p);
    }
  }
  const labels = new Map(strandLayout(n).map((l) => [l.id, l.label]));
  const movingIds = new Set(frame || pick ? [] : d.moves.map((m) => m.strand));

  for (const [id, ang] of at) {
    const [cx, cy] = knobXY.get(id) ?? polar(178, R(ang));
    const [x0, y0] = polar(30, Math.atan2(-cy, cx) * 180 / Math.PI);
    el('line', { x1: x0, y1: y0, x2: cx * 0.94, y2: cy * 0.94, stroke: state.colors[id], class: 'thread' }, svg);
    const knob = el('circle', {
      cx, cy, r: knobR, fill: state.colors[id], class: 'strand' + (movingIds.has(id) ? ' moving' : ''), tabindex: 0, role: 'button', 'data-id': id,
      'aria-label': setup ? `Strand ${labels.get(id)}` : 'Strand',
    }, svg);
    if (setup) el('title', {}, knob).textContent = labels.get(id);
    if (sim?.idle.includes(id)) el('circle', { cx, cy, r: knobR + 5, class: 'idle-ring' }, svg);
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (walk.busy || pick) return;
      try { $('disk').setPointerCapture(e.pointerId); } catch { /* not supported */ }
      painting = true;
      paint([id]);
    });
    knob.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint([id]); } });
    if (setup && state.labels) {
      const [lx, ly] = polar(199, ang);
      el('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'strand-label' }, svg).textContent = labels.get(id);
    }
  }

  if (!frame && pick) drawPick(svg, d, R, knobR);
  else if (!frame) drawMoveArrows(svg, d, R);
}

// Numbered arrows for the moves of the step about to be made.
function drawMoveArrows(svg, d, R) {
  d.moves.forEach((m, i) => {
    const from = strandAngles(m.before, d.G).get(m.strand);
    const to = strandAngles(m.after, d.G).get(m.strand);
    const { mid, pull } = travel(from, to, m.dir);
    const [x0, y0] = polar(150, R(from));
    const [x1, y1] = polar(150, R(to));
    const [cx, cy] = polar(150 * pull, R(mid));
    el('path', { d: `M${x0},${y0} Q${cx},${cy} ${x1},${y1}`, class: 'arrow', 'marker-end': 'url(#arrowhead)' }, svg);
    const [lx, ly] = bezier([x0, y0], [cx, cy], [x1, y1], 0.5);
    const tag = el('g', { class: 'arrow-tag' }, svg);
    el('circle', { cx: lx, cy: ly, r: 9 }, tag);
    el('text', { x: lx, y: ly + 3.5, 'text-anchor': 'middle' }, tag).textContent = i + 1;
  });
}

// ---------------------------------------------------------- set a move by tapping
//
// Tap one of the four strands that can be moved (top or bottom pair), then tap
// the gap it should go into. The rule move is worked out from that.

let pick = null; // { si, mi, from }

function startPick(si, mi) {
  const G = groupCount(state.colors.length);
  resetWalk();
  let k = 0;
  for (let i = 0; i < si; i++) k += resolveTimes(state.rule.steps[i].times, G);
  walk.step = k;
  walkDetails = null;
  pick = { si, mi, from: null };
  renderDisk();
  renderWalk();
  $('disk').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

function cancelPick() {
  pick = null;
  renderDisk();
  renderWalk();
}

// The pairs as they are just before the move being set.
function pickGroups(d) {
  const done = d.moves.filter((m) => m.move < pick.mi);
  return done.length ? done[done.length - 1].after : d.before;
}

function pickSources(d) {
  const G = d.G;
  const groups = pickGroups(d);
  const top = ((d.top % G) + G) % G;
  const bottom = (top + G / 2) % G;
  const out = {};
  if (groups[top].length) { out.TL = groups[top][0]; out.TR = groups[top][groups[top].length - 1]; }
  if (groups[bottom].length) { out.BR = groups[bottom][0]; out.BL = groups[bottom][groups[bottom].length - 1]; }
  return { out, top, bottom, groups };
}

function finishPick(g, k) {
  const d = currentDetails();
  const G = d.G;
  const { top, bottom, groups } = pickSources(d);
  const src = pick.from[0] === 'T' ? top : bottom;
  const m = groups[g].length;
  const ccwDist = (((src - g) % G) + G) % G;
  let dir;
  if (ccwDist < G / 2) dir = 'ccw';
  else if (ccwDist > G / 2) dir = 'cw';
  else dir = k === 0 ? 'cw' : 'ccw'; // straight across: arrive from the side that reaches that gap first
  const dist = dir === 'ccw' ? ccwDist : G - ccwDist;
  let land;
  if (k > 0 && k < m) land = 'mid';
  else if (dir === 'ccw') land = k === m ? 'near' : 'far';
  else land = k === 0 ? 'near' : 'far';
  const move = state.rule.steps[pick.si].moves[pick.mi];
  move.from = pick.from;
  move.dir = dir;
  move.dist = dist === G / 2 ? 'opp' : dist;
  if (land === 'near') delete move.land; else move.land = land;
  pick = null;
  resetWalk();
  update({ palette: false });
}

function drawPick(svg, d, R, knobR) {
  const G = d.G;
  const { out, top, bottom, groups } = pickSources(d);
  const at = strandAngles(groups, G);
  if (!pick.from) {
    for (const [pos, id] of Object.entries(out)) {
      const [cx, cy] = polar(178, R(at.get(id)));
      const ring = el('circle', { cx, cy, r: knobR + 6, class: 'pick-source', tabindex: 0, role: 'button', 'aria-label': `Move the ${POSITIONS[pos].name} strand` }, svg);
      const choose = () => { pick.from = pos; renderDisk(); renderWalk(); };
      ring.addEventListener('click', choose);
      ring.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    }
    return;
  }
  const src = pick.from[0] === 'T' ? top : bottom;
  const spread = Math.min(7, 360 / G / 4);
  const [sx, sy] = polar(178, R(at.get(out[pick.from])));
  el('circle', { cx: sx, cy: sy, r: knobR + 6, class: 'pick-chosen' }, svg);
  groups.forEach((list, g) => {
    if (g === src) return;
    const m = list.length;
    for (let k = 0; k <= m; k++) {
      const [cx, cy] = polar(150, R(dotAngle(g, G) + spread * (m - 2 * k)));
      const slot = el('g', { class: 'pick-slot', tabindex: 0, role: 'button', 'aria-label': `Put it at dot ${g + 1}, gap ${k + 1}` }, svg);
      el('circle', { cx, cy, r: 15, class: 'hit' }, slot); // bigger target for fingers
      el('circle', { cx, cy, r: 9 }, slot);
      el('text', { x: cx, y: cy + 4.5, 'text-anchor': 'middle' }, slot).textContent = '+';
      const choose = () => finishPick(g, k);
      slot.addEventListener('click', choose);
      slot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    }
  });
}

// ------------------------------------------------------------- walk-through

const walk = { step: 0, playing: false, busy: false, gen: 0 };
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function renderWalk() {
  const d = currentDetails();
  const G = d.G;
  $('walkLabel').textContent = walk.step === 0 ? 'Set-up · step 1 next' : `After ${walk.step} step${walk.step > 1 ? 's' : ''} · step ${walk.step + 1} next`;
  $('walkStart').disabled = $('walkPrev').disabled = walk.step === 0 || walk.busy;
  $('walkNext').disabled = walk.busy && !walk.playing;
  $('walkPlay').textContent = walk.playing ? 'Pause' : 'Play';
  const say = $('walkSay');
  say.replaceChildren();
  const ruleSteps = state.rule.steps.length;
  const head = document.createElement('p');
  head.className = 'walk-head';
  head.textContent = `Step ${walk.step + 1}` + (ruleSteps > 1 ? ` (uses rule step ${d.ruleStep + 1} of ${ruleSteps})` : '') + ':';
  say.append(head);
  if (pick) {
    const p = document.createElement('p');
    p.className = 'pick-say';
    p.textContent = pick.from
      ? `Now tap the + where the ${POSITIONS[pick.from].name} strand should go.`
      : `Setting move ${pick.mi + 1}${ruleSteps > 1 ? ` of rule step ${pick.si + 1}` : ''}: tap the strand to move (circled).`;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', cancelPick);
    say.replaceChildren(p, cancel);
    return;
  }
  const names = new Map(strandLayout(state.colors.length).map((l) => [l.id, l.label]));
  const ol = document.createElement('ol');
  d.rule.moves.forEach((m, mi) => {
    const li = document.createElement('li');
    li.textContent = describeMove(m, G);
    const done = d.moves.find((x) => x.move === mi);
    if (done) {
      const list = done.after[done.dst];
      const i = list.indexOf(done.strand);
      const nb = [list[i - 1], list[i + 1]].filter((x) => x !== undefined).map((x) => names.get(x))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const where = nb.length === 2 ? `between ${nb[0]} and ${nb[1]}` : nb.length ? `next to ${nb[0]}` : 'on its own';
      const end = document.createElement('span');
      end.className = 'ends';
      end.textContent = ` → ${names.get(done.strand)} ends up at dot ${done.dst + 1}, ${where}.`;
      li.append(end);
    }
    ol.append(li);
  });
  const li = document.createElement('li');
  li.className = 'turn';
  li.textContent = describeTurn(d.turn);
  ol.append(li);
  say.append(ol);
}

function animate(ms, draw) {
  if (reduceMotion) { draw(1); return Promise.resolve(); }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      draw(t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2); // ease in-out
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
}

async function stepForward() {
  if (walk.busy) return;
  const gen = walk.gen;
  walk.busy = true;
  renderWalk();
  const d = currentDetails();
  const stale = () => gen !== walk.gen; // the rule or strands changed mid-animation
  const G = d.G;
  const rot0 = (d.top * 360) / G;
  for (const m of d.moves) {
    const from = strandAngles(m.before, G);
    const to = strandAngles(m.after, G);
    if (stale()) return;
    await animate(650, (t) => !stale() && renderDisk({
      groups: m.before, rot: rot0, from, to, t,
      moving: { strand: m.strand, from: from.get(m.strand), to: to.get(m.strand), sign: m.dir, t },
    }));
  }
  if (d.turn) {
    const still = strandAngles(d.after, G);
    if (stale()) return;
    await animate(450, (t) => !stale() && renderDisk({ groups: d.after, rot: rot0 + (d.turn * 360 * t) / G, from: still, to: still, t: 0 }));
  }
  if (stale()) return;
  walk.step++;
  walk.busy = false;
  renderDisk();
  renderWalk();
}

function goTo(step) {
  if (walk.busy) return;
  walk.step = Math.max(0, step);
  renderDisk();
  renderWalk();
}

async function play() {
  walk.playing = !walk.playing;
  renderWalk();
  const gen = walk.gen;
  while (walk.playing && gen === walk.gen) {
    await stepForward();
    if (walk.playing) await new Promise((r) => setTimeout(r, reduceMotion ? 900 : 350));
  }
  renderWalk();
}

function resetWalk() {
  pick = null;
  walk.gen++;
  walk.busy = false;
  walk.playing = false;
  walk.step = 0;
  walkDetails = null;
}

// ---------------------------------------------------------------- rule editor

function option(select, value, text, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  if (selected) o.selected = true;
  select.append(o);
  return o;
}

function presetIdFor(rule) {
  const code = encodeRule(rule);
  return RULE_PRESETS.find((p) => encodeRule(p.rule) === code)?.id ?? 'custom';
}

function changeRule(fn) {
  fn(state.rule);
  resetWalk();
  update({ palette: false });
}

function renderRule() {
  const n = state.colors.length;
  const G = groupCount(n);
  const box = $('rule');
  box.replaceChildren();

  const preset = $('rulePreset');
  preset.replaceChildren();
  const current = presetIdFor(state.rule);
  for (const p of RULE_PRESETS) option(preset, p.id, p.name, p.id === current);
  if (current === 'custom') option(preset, 'custom', 'Your own rule', true);
  const presetNow = RULE_PRESETS.find((p) => p.id === current);
  $('ruleHint').textContent = presetNow?.hint ?? 'Edited by you';
  const layout = presetNow?.layout && PRESETS.find((p) => p.id === presetNow.layout);
  if (layout) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inline-btn';
    b.textContent = `Use ${layout.name.toLowerCase()} colours`;
    b.addEventListener('click', () => { state.colors = layout.make(state.colors.length, state.palette); update(); });
    $('ruleHint').append(' ', b);
  }

  const warnings = sim ? ruleWarnings(sim.stats, state.rule) : [];

  if (sim?.idle.length) {
    const labels = strandLayout(n);
    const names = sim.idle.map((id) => labels.find((l) => l.id === id).label);
    const p = document.createElement('p');
    p.className = 'warn idle';
    p.textContent = `With this rule ${names.join(', ')} never move. On a real disk they would stay put and get buried inside the cord, so their colour won't show. They're circled on the disk. Try "lay it past the pair", or a different strand or direction.`;
    box.append(p);
  }

  state.rule.steps.forEach((step, si) => {
    const card = document.createElement('fieldset');
    card.className = 'step';
    const legend = document.createElement('legend');
    legend.textContent = state.rule.steps.length > 1 ? `Step ${si + 1}` : 'Each step';
    card.append(legend);

    const list = document.createElement('ol');
    list.className = 'moves';
    step.moves.forEach((m, mi) => {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'move-row';

      const from = document.createElement('select');
      from.setAttribute('aria-label', 'Strand to take');
      for (const [k, v] of Object.entries(POSITIONS)) option(from, k, v.name, k === m.from);
      from.addEventListener('change', () => changeRule(() => { m.from = from.value; }));

      const dir = document.createElement('select');
      dir.setAttribute('aria-label', 'Direction');
      option(dir, 'ccw', '↺ anticlockwise', m.dir === 'ccw');
      option(dir, 'cw', '↻ clockwise', m.dir === 'cw');
      dir.addEventListener('change', () => changeRule(() => { m.dir = dir.value; }));

      const dist = document.createElement('select');
      dist.setAttribute('aria-label', 'How far');
      const d = resolveDist(m.dist, G);
      for (let k = 1; k < G / 2; k++) option(dist, k, distLabel(k, G).replace(/^the /, ''), m.dist !== 'opp' && d === k);
      option(dist, 'opp', 'opposite dot', m.dist === 'opp' || d === G / 2);
      dist.addEventListener('change', () => changeRule(() => { m.dist = dist.value === 'opp' ? 'opp' : Number(dist.value); }));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon';
      del.textContent = '×';
      del.title = 'Remove this move';
      del.disabled = step.moves.length === 1 && state.rule.steps.length === 1;
      del.addEventListener('click', () => changeRule((r) => {
        step.moves.splice(mi, 1);
        if (!step.moves.length) r.steps.splice(si, 1);
      }));

      const land = document.createElement('select');
      land.setAttribute('aria-label', 'Where it lands');
      option(land, 'near', 'before the pair', !m.land || m.land === 'near');
      option(land, 'mid', 'into the middle', m.land === 'mid');
      option(land, 'far', 'past the pair', m.land === 'far');
      land.addEventListener('change', () => changeRule(() => { if (land.value === 'near') delete m.land; else m.land = land.value; }));

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'pick-btn';
      pickBtn.textContent = 'Set on disk';
      pickBtn.title = 'Tap the strand to move, then where it should go';
      pickBtn.addEventListener('click', () => startPick(si, mi));

      row.append(from, dir, dist, land, pickBtn, del);
      const say = document.createElement('p');
      say.className = 'say';
      const st = sim?.stats[si]?.[mi];
      const cross = st && st.maxCross ? ` Passes over ${st.minCross === st.maxCross ? st.maxCross : `${st.minCross}–${st.maxCross}`} strand${st.maxCross === 1 ? '' : 's'}.` : '';
      say.textContent = describeMove(m, G) + cross;
      li.append(row, say);
      for (const w of warnings.filter((w) => w.step === si && w.move === mi)) {
        const p = document.createElement('p');
        p.className = 'warn';
        p.textContent = w.text;
        li.append(p);
      }
      list.append(li);
    });
    card.append(list);

    const addMove = document.createElement('button');
    addMove.type = 'button';
    addMove.textContent = '+ Add move';
    addMove.disabled = step.moves.length >= 8;
    addMove.addEventListener('click', () => changeRule(() => { step.moves.push({ from: 'TL', dir: 'ccw', dist: 'opp' }); }));

    const turnRow = document.createElement('label');
    turnRow.className = 'turn-row';
    turnRow.textContent = 'Then ';
    const turn = document.createElement('select');
    for (const t of [...new Set([1, -1, 2, -2, 0, step.turn || 0])]) option(turn, t, describeTurn(t).replace(/\.$/, '').replace(/^T/, 't').replace(/^Don't/, "don't"), (step.turn || 0) === t);
    turn.addEventListener('change', () => changeRule(() => { step.turn = Number(turn.value); }));
    turnRow.append(turn);

    const timesRow = document.createElement('label');
    timesRow.className = 'turn-row';
    timesRow.textContent = 'Do this step ';
    const times = document.createElement('select');
    for (const t of [...new Set([1, 2, 3, 4, ...(typeof step.times === 'number' ? [step.times] : [])])].sort((a, b) => a - b)) option(times, t, t === 1 ? 'once' : `${t} times`, step.times === t);
    option(times, 'round', `once per dot (${G} times)`, step.times === 'round');
    times.addEventListener('change', () => changeRule(() => { step.times = times.value === 'round' ? 'round' : Number(times.value); }));
    timesRow.append(times);
    if (state.rule.steps.length > 1) timesRow.append(' before moving on.');

    const tools = document.createElement('div');
    tools.className = 'row';
    tools.append(addMove);
    if (state.rule.steps.length > 1) {
      const delStep = document.createElement('button');
      delStep.type = 'button';
      delStep.textContent = 'Remove step';
      delStep.addEventListener('click', () => changeRule((r) => { r.steps.splice(si, 1); }));
      tools.append(delStep);
    }
    card.append(turnRow, timesRow, tools);
    box.append(card);
  });

  const addStep = document.createElement('button');
  addStep.type = 'button';
  addStep.textContent = '+ Add a different step';
  addStep.disabled = state.rule.steps.length >= 12;
  addStep.addEventListener('click', () => changeRule((r) => {
    r.steps.push(cloneRule(RULE_PRESETS.find((p) => p.id === 'next').rule).steps[0]);
  }));
  box.append(addStep);
}

// -------------------------------------------------------------------- palette

function renderPalette() {
  const box = $('palette');
  box.replaceChildren();
  const used = new Set(state.colors);
  state.palette.forEach((c, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'swatch' + (i === state.brush ? ' selected' : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = `Paint with ${c}${i < 2 ? (i ? ' (colour B)' : ' (colour A)') : ''}`;
    b.setAttribute('aria-pressed', String(i === state.brush));
    b.addEventListener('click', () => { state.brush = i; renderPalette(); });
    const edit = document.createElement('input');
    edit.type = 'color';
    edit.value = c;
    edit.title = 'Change this colour everywhere';
    // Remember which strands use this swatch when picking starts, so passing
    // over another swatch's colour while choosing doesn't merge the two.
    let mine = null;
    const grab = () => { if (!mine) mine = state.colors.map((x, id) => (x === state.palette[i] ? id : -1)).filter((id) => id >= 0); };
    edit.addEventListener('pointerdown', grab);
    edit.addEventListener('focus', grab);
    edit.addEventListener('input', () => {
      grab();
      state.palette[i] = edit.value;
      for (const id of mine) state.colors[id] = edit.value;
      b.style.background = edit.value;
      scheduleUpdate({ palette: false });
    });
    edit.addEventListener('change', () => { mine = null; renderPalette(); });
    wrap.append(b, edit);
    if (i < 2) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = i ? 'B' : 'A';
      wrap.append(tag);
    }
    if (!used.has(c) && state.palette.length > 2) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'remove';
      x.textContent = '×';
      x.title = 'Remove (not used)';
      x.addEventListener('click', () => {
        state.palette.splice(i, 1);
        if (i < state.brush) state.brush--;
        state.brush = Math.min(state.brush, state.palette.length - 1);
        renderPalette();
      });
      wrap.append(x);
    }
    box.append(wrap);
  });
  const add = document.createElement('label');
  add.className = 'swatch add';
  add.title = 'Add a colour';
  add.textContent = '+';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = '#888888';
  input.addEventListener('change', () => {
    const existing = state.palette.indexOf(input.value);
    if (existing < 0) state.palette.push(input.value);
    state.brush = existing < 0 ? state.palette.length - 1 : existing;
    renderPalette();
  });
  add.append(input);
  box.append(add);
}

function renderPresets() {
  const box = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${p.name}<small>${p.hint}</small>`;
    b.addEventListener('click', () => { state.colors = p.make(state.colors.length, state.palette); update(); });
    box.append(b);
  }
}

// -------------------------------------------------------------------- preview

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(100, Math.round(rect.width * dpr));
  const h = Math.max(200, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

let sim = null;
let surface = null;
let cord3d = null; // WebGL view; null where WebGL isn't available
let surfaceShown = null;
function simulate() {
  const n = state.colors.length;
  const G = groupCount(n);
  const steps = state.rounds * stepsPerRound(n) + 2 * trimSteps(G);
  sim = simulateRule({ strands: n, rule: state.rule, steps });
  surface = buildSurface({
    stitches: sim.stitches, stepY: sim.stepY, colors: state.colors, G, twist: twistDegrees(state.twist, n),
    resolution: 512,
  });
}

function bg() {
  return getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#fff';
}

function drawPreview() {
  const background = bg();
  const cord = $('cord');
  let dpr = window.devicePixelRatio || 1;
  if (cord3d) {
    if (surfaceShown !== surface) {
      cord3d.setSurface(surface);
      surfaceShown = surface;
      showMode(cord3d.mode);
    }
  } else {
    dpr = sizeCanvas(cord);
    drawCord(cord, { surface, background, view: state.view, dpr });
  }
  const flat = $('flat');
  sizeCanvas(flat);
  drawUnrolled(flat, { surface, background, dpr });
}

function renderOutputs() {
  const n = state.colors.length;
  const steps = state.rounds * stepsPerRound(n);
  const perStep = sim ? sim.stitches.length / Math.max(1, sim.stepY.length - 1) : 2;
  $('roundsOut').textContent = `${state.rounds} rounds · about ${Math.round(steps * perStep)} moves`;
  $('viewOut').textContent = `${Math.round(state.view)}°`;
  $('twistOut').textContent = state.twist.toFixed(2);
}

// Sliders fire faster than a big braid can be rebuilt, so coalesce rebuilds
// to one per frame.
let pending = null;
function scheduleUpdate(opts) {
  if (!pending) requestAnimationFrame(() => { const o = pending; pending = null; update(o); });
  pending = { ...pending, ...opts };
}

function update({ palette = true } = {}) {
  walkDetails = null;
  simulate();
  renderDisk();
  renderWalk();
  renderRule();
  if (palette) renderPalette();
  renderOutputs();
  drawPreview();
  saveToHash();
}

// ---------------------------------------------------------------------- wire

function init() {
  loadFromHash();

  const sel = $('strands');
  for (let n = MIN_STRANDS; n <= MAX_STRANDS; n += 4) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = `${n}`;
    sel.append(o);
  }
  sel.value = state.colors.length;
  sel.addEventListener('change', () => { state.colors = resizeLayout(state.colors, Number(sel.value)); resetWalk(); update(); });

  $('disk').addEventListener('pointermove', paintUnderPointer);
  $('walkStart').addEventListener('click', () => goTo(0));
  $('walkPrev').addEventListener('click', () => goTo(walk.step - 1));
  $('walkNext').addEventListener('click', () => { if (!walk.playing) stepForward(); });
  $('walkPlay').addEventListener('click', play);

  $('labels').checked = state.labels;
  $('labels').addEventListener('change', (e) => { state.labels = e.target.checked; renderDisk(); });

  $('rounds').value = state.rounds;
  $('rounds').addEventListener('input', (e) => { state.rounds = Number(e.target.value); renderOutputs(); scheduleUpdate({ palette: false }); });
  cord3d = createCordView($('cord'), { onModeChange: showMode });
  document.body.classList.toggle('has-3d', Boolean(cord3d));
  $('view').value = state.view;
  $('view').addEventListener('input', (e) => { state.view = Number(e.target.value); renderOutputs(); drawPreview(); });
  $('along').addEventListener('input', (e) => { cord3d?.lookAlong(Number(e.target.value) / 100); showMode(cord3d?.mode); });
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => { cord3d?.setMode(b.dataset.mode); showMode(b.dataset.mode); });
  }
  $('twist').value = state.twist;
  $('twist').addEventListener('input', (e) => { state.twist = Number(e.target.value); renderOutputs(); scheduleUpdate({ palette: false }); });
  $('twistReset').addEventListener('click', () => { state.twist = DEFAULT_TWIST; $('twist').value = state.twist; update({ palette: false }); });
  $('rulePreset').addEventListener('change', (e) => {
    const p = RULE_PRESETS.find((r) => r.id === e.target.value);
    if (p) { state.rule = cloneRule(p.rule); resetWalk(); update({ palette: false }); }
  });

  $('mirror').addEventListener('click', () => { state.colors = mirrorRightToLeft(state.colors); update(); });
  $('rotate').addEventListener('click', () => { state.colors = rotateLayout(state.colors); update(); });
  $('random').addEventListener('click', () => {
    const k = 2 + Math.floor(Math.random() * Math.min(3, state.palette.length - 1));
    const pick = state.palette.slice().sort(() => Math.random() - 0.5).slice(0, k);
    state.colors = state.colors.map(() => pick[Math.floor(Math.random() * pick.length)]);
    update();
  });

  $('share').addEventListener('click', async () => {
    saveToHash();
    const code = encodePattern(state);
    // Inside a sandboxed frame the URL can't carry state, so copy the bare code there.
    const text = window.top === window ? location.href : code;
    try {
      await navigator.clipboard.writeText(text);
      flash($('share'), 'Copied');
    } catch {
      openLoad(text, true);
    }
  });

  $('load').addEventListener('click', () => openLoad(''));
  $('loadGo').addEventListener('click', (e) => {
    const raw = $('loadCode').value.trim();
    const p = decodePattern(raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw);
    if (!p) { e.preventDefault(); $('loadError').hidden = false; return; }
    state.colors = p.colors;
    if (p.rounds) state.rounds = p.rounds;
    if (p.twist !== undefined) state.twist = p.twist;
    state.rule = cloneRule(p.rule);
    for (const c of p.colors) if (!state.palette.includes(c)) state.palette.push(c);
    resetWalk();
    syncControls();
    update();
  });

  $('save').addEventListener('click', () => {
    $('imageOut').src = cord3d ? cord3d.snapshot() : $('cord').toDataURL('image/png');
    $('imageDialog').showModal();
  });

  let last = 0;
  let ticking = false;
  const tick = (t) => {
    ticking = state.spin;
    if (state.spin) {
      if (last) state.view = (state.view + (t - last) * 0.03) % 360;
      last = t;
      $('view').value = Math.round(state.view);
      renderOutputs();
      drawPreview();
      requestAnimationFrame(tick);
    } else last = 0;
  };
  $('spin').addEventListener('change', (e) => {
    state.spin = e.target.checked;
    if (cord3d) cord3d.setSpin(state.spin);
    else if (state.spin && !ticking) { ticking = true; requestAnimationFrame(tick); }
  });

  window.addEventListener('resize', drawPreview);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawPreview);

  renderPresets();
  update();
  setupImport();
}

function showMode(mode) {
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  if (cord3d) $('along').value = Math.round(cord3d.along() * 100);
}

// ------------------------------------------------------- import from a tutorial
//
// Only on the published page, where the viewer can let it ask Claude.

const IMPORT_ERRORS = {
  not_granted: 'Claude wasn\'t allowed for this page, so importing is off.',
  sampling_disabled: 'Claude isn\'t available for this account.',
  rate_limited: 'Too many requests just now. Try again in a little while.',
  session_expired: 'Please sign in to Claude again, then retry.',
  image_rejected: 'One of the screenshots couldn\'t be used. Try a different file (JPEG or PNG).',
  prompt_too_large: 'That text is too long. Paste just the part with the steps.',
  invalid_json: 'Claude\'s answer couldn\'t be read. Try again.',
  refused: 'Claude couldn\'t help with that text.',
};

async function setupImport() {
  const sample = await window.claude?.use?.('sample').catch(() => null);
  if (!sample) return;
  const box = $('importBox');
  box.hidden = false;
  const caps = await sample.limits().catch(() => null);
  if (caps?.images) {
    $('importShotsLabel').hidden = false;
    $('importShots').accept = caps.images.mediaTypes.join(',');
  }
  let ctl = null;
  $('importStop').addEventListener('click', () => ctl?.abort());
  $('importGo').addEventListener('click', async () => {
    const text = $('importText').value.trim();
    const files = [...($('importShots').files ?? [])].slice(0, caps?.images?.maxCount ?? 0);
    const out = $('importOut');
    if (!text && !files.length) { out.textContent = 'Paste some tutorial text or add a screenshot first.'; return; }
    ctl = new AbortController();
    $('importGo').disabled = true;
    $('importStop').hidden = false;
    out.textContent = 'Reading the tutorial… this can take up to a minute.';
    try {
      const answer = await sample.json(buildPrompt(text, { strands: state.colors.length, imageCount: files.length }), {
        signal: ctl.signal,
        ...(files.length ? { images: files } : {}),
      });
      showImport(parseAnswer(answer, { strands: state.colors.length }));
    } catch (e) {
      if (e?.code === 'cancelled') out.textContent = '';
      else out.textContent = IMPORT_ERRORS[e?.code] ?? 'Something went wrong reaching Claude. Try again.';
      if (e?.code === 'not_granted' || e?.code === 'sampling_disabled') box.hidden = true;
    } finally {
      $('importGo').disabled = false;
      $('importStop').hidden = true;
    }
  });
}

function showImport(r) {
  const out = $('importOut');
  out.replaceChildren();
  const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; out.append(e); return e; };
  if (r.name) add('p', r.name, 'import-name');
  if (r.summary) add('p', r.summary);
  if (!r.ok) {
    if (!r.summary) add('p', 'This tutorial couldn\'t be turned into a rule for a round disk.');
    for (const p of r.problems) add('p', p, 'warn');
    return;
  }
  if (r.unsure.length) {
    add('p', 'Guessed:', 'import-sub');
    const ul = document.createElement('ul');
    for (const u of r.unsure) { const li = document.createElement('li'); li.textContent = u; ul.append(li); }
    out.append(ul);
  }
  for (const p of r.problems) add('p', p, 'warn');
  const row = document.createElement('div');
  row.className = 'row';
  const apply = (withColours) => {
    if (r.strands !== state.colors.length) state.colors = resizeLayout(state.colors, r.strands);
    if (withColours && r.colors) {
      state.colors = r.colors.slice();
      for (const c of r.colors) if (!state.palette.includes(c)) state.palette.push(c);
    }
    state.rule = cloneRule(r.rule);
    resetWalk();
    syncControls();
    update();
    add('p', 'Loaded. Press ▶ under the disk to check it step by step against the tutorial.', 'import-sub');
  };
  const useRule = document.createElement('button');
  useRule.type = 'button';
  useRule.textContent = r.strands !== state.colors.length ? `Use this rule (${r.strands} strands)` : 'Use this rule';
  useRule.addEventListener('click', () => apply(false));
  row.append(useRule);
  if (r.colors) {
    const both = document.createElement('button');
    both.type = 'button';
    both.textContent = 'Use the rule and its colours';
    both.addEventListener('click', () => apply(true));
    row.append(both);
  }
  out.append(row);
}

function openLoad(text, copyMode = false) {
  $('loadCode').value = text;
  $('loadError').hidden = true;
  $('loadGo').hidden = copyMode;
  $('loadDialog').showModal();
  if (copyMode) $('loadCode').select();
}

function syncControls() {
  $('strands').value = state.colors.length;
  $('rounds').value = state.rounds;
  $('twist').value = state.twist;
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1400);
}

init();

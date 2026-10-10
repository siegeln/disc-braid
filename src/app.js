import {
  DEFAULT_PALETTE, DEFAULT_TWIST, MAX_STRANDS, MIN_STRANDS, PRESETS,
  dotAngle, groupCount, mirrorRightToLeft, resizeLayout,
  rotateLayout, strandLayout, stepsPerRound, twistDegrees,
} from './braid.js';
import { decodePattern, encodePattern } from './pattern.js';
import { buildSurface, drawCord, drawUnrolled, trimSteps } from './render.js';
import { createCordView } from './cord3d.js';
import {
  DEFAULT_RULE, POSITIONS, RULE_PRESETS, cloneRule, describeMove, describeTurn, distLabel,
  encodeRule, resolveDist, ruleWarnings, simulate as simulateRule,
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
  state.rule = p.rule;
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
  if (changed) update();
}

// Drag across strands to paint several. Hit-test by position, because touch
// pointers don't fire enter events on other elements.
let painting = false;
window.addEventListener('pointerup', () => { painting = false; });
window.addEventListener('pointercancel', () => { painting = false; });
function paintUnderPointer(e) {
  if (!painting) return;
  const id = document.elementFromPoint(e.clientX, e.clientY)?.getAttribute?.('data-id');
  if (id != null) paint([Number(id)]);
}

function renderDisk() {
  const svg = $('disk');
  svg.replaceChildren();
  const n = state.colors.length;
  const G = groupCount(n);

  el('circle', { r: 160, class: 'disk-face' }, svg);
  el('circle', { r: 26, class: 'disk-hole' }, svg);
  el('line', { x1: 0, y1: -200, x2: 0, y2: 200, class: 'divider' }, svg);
  const lt = el('text', { x: -190, y: -186, class: 'side-label' }, svg); lt.textContent = 'L';
  const rt = el('text', { x: 190, y: -186, class: 'side-label', 'text-anchor': 'end' }, svg); rt.textContent = 'R';

  for (let i = 0; i < 32; i++) {
    const a = 90 - (i + 0.5) * (360 / 32);
    const [x1, y1] = polar(146, a);
    const [x2, y2] = polar(160, a);
    el('line', { x1, y1, x2, y2, class: 'slot' }, svg);
  }

  for (let g = 0; g < G; g++) {
    const a = dotAngle(g, G);
    const [x, y] = polar(132, a);
    const dot = el('g', { class: 'dot', tabindex: 0, role: 'button', 'aria-label': `Pair ${g + 1}: paint both strands` }, svg);
    el('circle', { cx: x, cy: y, r: 10 }, dot);
    const t = el('text', { x, y: y + 4, 'text-anchor': 'middle' }, dot);
    t.textContent = g + 1;
    const both = () => paint([2 * g, 2 * g + 1]);
    dot.addEventListener('click', both);
    dot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); both(); } });
  }

  for (const s of strandLayout(n)) {
    const [x0, y0] = polar(30, s.angle);
    const [x1, y1] = polar(168, s.angle);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: state.colors[s.id], class: 'thread' }, svg);
    const [cx, cy] = polar(178, s.angle);
    const knob = el('circle', {
      cx, cy, r: n > 24 ? 9 : 11, fill: state.colors[s.id], class: 'strand', tabindex: 0, role: 'button', 'data-id': s.id,
      'aria-label': `Strand ${s.label}`,
    }, svg);
    el('title', {}, knob).textContent = s.label;
    knob.addEventListener('pointerdown', (e) => { e.preventDefault(); painting = true; paint([s.id]); });
    knob.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint([s.id]); } });
    if (state.labels) {
      const [lx, ly] = polar(199, s.angle);
      const t = el('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'strand-label' }, svg);
      t.textContent = s.label;
    }
  }
  drawMoveArrows(svg, n);
}

// Arrows for the first step of the movement rule, so the rule can be checked
// against what the hands do.
function drawMoveArrows(svg, n) {
  const G = groupCount(n);
  const first = simulateRule({ strands: n, rule: state.rule, steps: 1 }).stitches;
  if (!first.length) return;
  const defs = el('defs', {}, svg);
  const marker = el('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }, marker);
  const layout = strandLayout(n);
  first.forEach((st, i) => {
    const from = layout.find((l) => l.id === st.strand).angle;
    const to = dotAngle(st.dst, G) + (st.dir > 0 ? -1 : 1) * Math.min(7, 360 / G / 4);
    const half = (resolveDist(state.rule.steps[0].moves[st.rule[1]].dist, G) * 180) / G;
    const [x0, y0] = polar(150, from);
    const [x1, y1] = polar(150, to);
    const [cx, cy] = polar(Math.max(36, 150 * Math.cos(half * Math.PI / 180) * 0.85), st.angle);
    el('path', { d: `M${x0},${y0} Q${cx},${cy} ${x1},${y1}`, class: 'arrow', 'marker-end': 'url(#arrowhead)' }, svg);
    const [lx, ly] = polar(Math.max(56, 150 * Math.cos(half * Math.PI / 180) * 0.85 + 8), st.angle);
    const tag = el('g', { class: 'arrow-tag' }, svg);
    el('circle', { cx: lx, cy: ly, r: 9 }, tag);
    el('text', { x: lx, y: ly + 3.5, 'text-anchor': 'middle' }, tag).textContent = i + 1;
  });
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
  $('ruleHint').textContent = RULE_PRESETS.find((p) => p.id === current)?.hint ?? 'Edited by you';

  const warnings = sim ? ruleWarnings(sim.stats, state.rule) : [];

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
      option(dir, 'ccw', '↺ counter-clockwise', m.dir === 'ccw');
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

      row.append(from, dir, dist, del);
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
    for (const t of [1, -1, 2, -2, 0]) option(turn, t, describeTurn(t).replace(/\.$/, '').replace(/^T/, 't').replace(/^Don't/, "don't"), (step.turn || 0) === t);
    turn.addEventListener('change', () => changeRule(() => { step.turn = Number(turn.value); }));
    turnRow.append(turn);

    const timesRow = document.createElement('label');
    timesRow.className = 'turn-row';
    timesRow.textContent = 'Do this step ';
    const times = document.createElement('select');
    for (const t of [1, 2, 3, 4]) option(times, t, t === 1 ? 'once' : `${t} times`, step.times === t);
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
    r.steps.push({ moves: [{ from: 'TR', dir: 'ccw', dist: 1 }, { from: 'BL', dir: 'ccw', dist: 1 }], turn: 1, times: 1 });
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
    edit.addEventListener('input', () => {
      const old = state.palette[i];
      state.palette[i] = edit.value;
      state.colors = state.colors.map((x) => (x === old ? edit.value : x));
      b.style.background = edit.value;
      update({ palette: false });
    });
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
    state.palette.push(input.value);
    state.brush = state.palette.length - 1;
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
    if (surfaceShown !== surface) { cord3d.setSurface(surface); surfaceShown = surface; }
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
  simulate();
  renderDisk();
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
  sel.addEventListener('change', () => { state.colors = resizeLayout(state.colors, Number(sel.value)); update(); });

  $('disk').addEventListener('pointermove', paintUnderPointer);

  $('labels').checked = state.labels;
  $('labels').addEventListener('change', (e) => { state.labels = e.target.checked; renderDisk(); });

  $('rounds').value = state.rounds;
  $('rounds').addEventListener('input', (e) => { state.rounds = Number(e.target.value); renderOutputs(); scheduleUpdate({ palette: false }); });
  cord3d = createCordView($('cord'));
  document.body.classList.toggle('has-3d', Boolean(cord3d));
  $('view').value = state.view;
  $('view').addEventListener('input', (e) => { state.view = Number(e.target.value); renderOutputs(); drawPreview(); });
  $('along').addEventListener('input', (e) => cord3d?.lookAlong(Number(e.target.value) / 100));
  $('resetView').addEventListener('click', () => { $('along').value = 50; cord3d?.resetView(); });
  $('twist').value = state.twist;
  $('twist').addEventListener('input', (e) => { state.twist = Number(e.target.value); renderOutputs(); scheduleUpdate({ palette: false }); });
  $('twistReset').addEventListener('click', () => { state.twist = DEFAULT_TWIST; $('twist').value = state.twist; update({ palette: false }); });
  $('rulePreset').addEventListener('change', (e) => {
    const p = RULE_PRESETS.find((r) => r.id === e.target.value);
    if (p) { state.rule = cloneRule(p.rule); update({ palette: false }); }
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
    state.rule = p.rule;
    for (const c of p.colors) if (!state.palette.includes(c)) state.palette.push(c);
    syncControls();
    update();
  });

  $('save').addEventListener('click', () => {
    $('imageOut').src = cord3d ? cord3d.snapshot() : $('cord').toDataURL('image/png');
    $('imageDialog').showModal();
  });

  let last = 0;
  const tick = (t) => {
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
    else if (state.spin) requestAnimationFrame(tick);
  });

  window.addEventListener('resize', drawPreview);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawPreview);

  renderPresets();
  update();
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

import {
  DEFAULT_PALETTE, DEFAULT_TWIST, MAX_STRANDS, MIN_STRANDS, PRESETS,
  decodePattern, dotAngle, encodePattern, groupCount, mirrorRightToLeft, resizeLayout,
  rotateLayout, simulateKongoGumi, strandLayout, stepsPerRound, twistDegrees,
} from './braid.js';
import { drawCord, drawUnrolled, trimSteps } from './render.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

const state = {
  colors: PRESETS[0].make(16, DEFAULT_PALETTE),
  palette: DEFAULT_PALETTE.slice(),
  brush: 1,
  rounds: 16,
  twist: DEFAULT_TWIST,
  turn: 'ccw',
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
  state.turn = p.turn;
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
  const w = Math.max(100, Math.round(rect.width));
  const h = Math.max(200, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: w, height: h };
}

let sim = null;
function simulate() {
  const n = state.colors.length;
  const steps = state.rounds * stepsPerRound(n) + 2 * trimSteps(groupCount(n));
  sim = simulateKongoGumi({ strands: n, steps, turn: state.turn });
}

function bg() {
  return getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#fff';
}

function drawPreview() {
  const n = state.colors.length;
  const common = {
    stitches: sim.stitches,
    colors: state.colors,
    G: sim.G,
    twist: twistDegrees(state.twist, n),
    turn: state.turn,
    background: bg(),
  };
  const cord = sizeCanvas($('cord'));
  drawCord(cord.ctx, { ...common, view: state.view, width: cord.width, height: cord.height });
  const flat = sizeCanvas($('flat'));
  drawUnrolled(flat.ctx, { ...common, width: flat.width, height: flat.height });
}

function renderOutputs() {
  const n = state.colors.length;
  const steps = state.rounds * stepsPerRound(n);
  $('roundsOut').textContent = `${state.rounds} rounds · ${steps * 2} moves`;
  $('viewOut').textContent = `${Math.round(state.view)}°`;
  $('twistOut').textContent = state.twist.toFixed(2);
}

function update({ palette = true } = {}) {
  simulate();
  renderDisk();
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
  $('rounds').addEventListener('input', (e) => { state.rounds = Number(e.target.value); update({ palette: false }); });
  $('view').value = state.view;
  $('view').addEventListener('input', (e) => { state.view = Number(e.target.value); renderOutputs(); drawPreview(); });
  $('twist').value = state.twist;
  $('twist').addEventListener('input', (e) => { state.twist = Number(e.target.value); update({ palette: false }); });
  $('twistReset').addEventListener('click', () => { state.twist = DEFAULT_TWIST; $('twist').value = state.twist; update({ palette: false }); });
  $('turn').value = state.turn;
  $('turn').addEventListener('change', (e) => { state.turn = e.target.value; update({ palette: false }); });

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
    state.turn = p.turn;
    for (const c of p.colors) if (!state.palette.includes(c)) state.palette.push(c);
    syncControls();
    update();
  });

  $('save').addEventListener('click', () => {
    $('imageOut').src = $('cord').toDataURL('image/png');
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
  $('spin').addEventListener('change', (e) => { state.spin = e.target.checked; if (state.spin) requestAnimationFrame(tick); });

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
  $('turn').value = state.turn;
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1400);
}

init();

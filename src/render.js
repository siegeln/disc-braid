// Canvas renderers for the simulated cord.
//
// Every stitch is drawn as one tile of the braid's stitch lattice. Tiles are
// parallelograms spanned by the lattice's two directions, so they cover the
// cord with no gaps; the shading inside each tile runs along the strand.

import { cordAngle } from './braid.js';

const RAD = Math.PI / 180;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b], f) {
  // f < 1 darkens towards black, f > 1 lightens towards white.
  const t = f >= 1 ? [r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)] : [r * f, g * f, b * f];
  return `rgb(${t.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
}

/**
 * Lattice geometry shared by both views, in (angle degrees, step) units.
 * column:  from a stitch to the next one laid in the same place (G/2 steps later)
 * side:    from a stitch to its neighbour around the cord (laid one step later)
 * strand:  direction the strand itself runs, used for the grain of the stitch
 */
function lattice(G, twist, turn) {
  const dir = turn === 'cw' ? -1 : 1;
  const colSteps = G / 2;
  return {
    column: [twist * colSteps, colSteps],
    side: [-dir * (360 / G) + twist, 1],
    strand: [180 / G + twist, 1],
  };
}

function tileCorners(st, lat, twist) {
  // Centre the tile on the stitch, spanning half a lattice cell each way.
  const a = cordAngle(st, twist);
  const s = st.step;
  const [ca, cs] = lat.column;
  const [sa, ss] = lat.side;
  const corner = (u, v) => [a + u * ca + v * sa, s + u * cs + v * ss];
  return [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)];
}

function sampleEdge(p, q, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return pts;
}

function outline(corners, n = 4) {
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push(...sampleEdge(corners[i], corners[(i + 1) % 4], n));
  return pts;
}

/**
 * Draw the cord as a 3D cylinder hanging from the disk (newest braiding at the top).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 */
/**
 * Stitch cells are drawn a little taller than wide. The cord keeps a believable
 * thickness: long cords are cropped (newest part shown) rather than squashed.
 */
/**
 * The newest and oldest ends of a braid are ragged (the edge runs round the
 * cord as a helix), so both views trim this many steps off each end. Simulate
 * 2 * trimSteps(G) extra steps to show a given length in full.
 */
export function trimSteps(G) {
  return G / 2 + 1;
}

export function cordGeometry(G, steps, maxR, maxHeight) {
  const perStepPerR = (2.6 * Math.PI) / (G * G);
  const minR = maxR * 0.6;
  const R = Math.max(minR, Math.min(maxR, maxHeight / (steps * perStepPerR)));
  const h = R * perStepPerR;
  return { R, h, shownSteps: Math.floor(maxHeight / h) };
}

export function drawCord(ctx, o) {
  const { stitches, colors, G, twist, turn, view, width, height, background } = o;
  const steps = stitches.length ? stitches[stitches.length - 1].step + 1 : 0;
  ctx.clearRect(0, 0, width, height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  if (!steps) return;

  const margin = 24;
  const trim = trimSteps(G);
  const body = steps - 2 * trim;
  if (body <= 0) return;
  const newest = steps - trim;
  const g = cordGeometry(G, body, width * 0.3, height - 2 * margin);
  const { R, h } = g;
  const cx = width / 2;
  const shown = Math.min(body, g.shownSteps);
  const top = margin + (height - 2 * margin - shown * h) / 2;
  const bottom = top + shown * h;
  const yOf = (step) => top + (newest - step) * h;

  const lat = lattice(G, twist, turn);
  const rgb = colors.map(hexToRgb);

  const project = ([a, s]) => {
    let d = ((a - view + 540) % 360) - 180;
    d = Math.max(-90, Math.min(90, d));
    return [cx + R * Math.sin(d * RAD), yOf(s)];
  };

  const tiles = [];
  for (const st of stitches) {
    const a = cordAngle(st, twist);
    const d = ((a - view + 540) % 360) - 180;
    if (Math.abs(d) > 115 || yOf(st.step - G) < top || yOf(st.step + G) > bottom) continue;
    tiles.push({ st, d });
  }
  tiles.sort((p, q) => Math.abs(q.d) - Math.abs(p.d) || p.st.step - q.st.step);

  // Soft shadow behind the cord.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(cx - R + 4, top + 4, 2 * R, bottom - top);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - R - 2, top, 2 * R + 4, bottom - top);
  ctx.clip();

  const light = -30; // light from the viewer's upper left
  for (const { st, d } of tiles) {
    const corners = tileCorners(st, lat, twist);
    const pts = outline(corners).map(project);
    const lambert = Math.max(0, Math.cos((d - light) * RAD));
    const base = 0.35 + 0.65 * lambert;
    const c = rgb[st.strand];

    // Grain runs along the strand through the tile centre.
    const a = cordAngle(st, twist);
    const [ga, gs] = lat.strand;
    const span = G / 4;
    const p0 = project([a - ga * span, st.step - gs * span]);
    const p1 = project([a + ga * span, st.step + gs * span]);
    const grad = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
    grad.addColorStop(0, shade(c, base * 0.62));
    grad.addColorStop(0.5, shade(c, base * 1.02 + 0.08 * lambert));
    grad.addColorStop(1, shade(c, base * 0.62));

    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(0.5, R / 120);
    ctx.stroke();

    // Fibre lines.
    if (R > 40) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = shade(c, base * 1.25);
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = Math.max(0.5, R / 160);
      const [sa, ss] = lat.side;
      for (const off of [-0.25, 0, 0.25]) {
        const q0 = project([a - ga * span + sa * off, st.step - gs * span + ss * off]);
        const q1 = project([a + ga * span + sa * off, st.step + gs * span + ss * off]);
        ctx.beginPath();
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Silhouette edge darkening for roundness.
  const edge = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.35)');
  edge.addColorStop(0.12, 'rgba(0,0,0,0)');
  edge.addColorStop(0.88, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = edge;
  ctx.fillRect(cx - R, top, 2 * R, bottom - top);
  ctx.restore();
}

/**
 * Draw the cord's surface unrolled flat: the full circumference left to right,
 * newest braiding at the top. Useful as a printable pattern chart.
 */
export function drawUnrolled(ctx, o) {
  const { stitches, colors, G, twist, turn, width, height, background } = o;
  const steps = stitches.length ? stitches[stitches.length - 1].step + 1 : 0;
  ctx.clearRect(0, 0, width, height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  if (!steps) return;

  const pad = 8;
  const w = width - 2 * pad;
  // Same proportions as the cord view: the width is the circumference.
  const R = w / (2 * Math.PI);
  const h = cordGeometry(G, steps, R, Infinity).h;
  const trim = trimSteps(G);
  const body = steps - 2 * trim;
  if (body <= 0) return;
  const shown = Math.min(body, Math.floor((height - 2 * pad) / h));
  const top = pad;
  const xOf = (a) => pad + (a / 360) * w;
  const yOf = (s) => top + (steps - trim - s) * h;
  const lat = lattice(G, twist, turn);
  const rgb = colors.map(hexToRgb);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, top, w, shown * h);
  ctx.clip();
  for (const st of stitches) {
    if (yOf(st.step - G) < top || yOf(st.step + G) > top + shown * h) continue;
    const corners = tileCorners(st, lat, twist);
    for (const wrap of [-360, 0, 360]) {
      const pts = corners.map(([a, s]) => [xOf(a + wrap), yOf(s)]);
      const minX = Math.min(...pts.map((p) => p[0]));
      const maxX = Math.max(...pts.map((p) => p[0]));
      if (maxX < pad || minX > pad + w) continue;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = shade(rgb[st.strand], 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
  }
  ctx.restore();
}

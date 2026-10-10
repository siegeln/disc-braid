// Renders the simulated cord.
//
// The cord's surface is built once as a texture (the whole circumference
// unrolled, newest braiding at the top). Every pixel belongs to the stitch
// nearest to it. Distances are stretched along each stitch's "column" - the
// line to the next stitch laid at the same place round the cord - because
// stitches stack on top of one another there. That way the stitches tile the
// surface whatever movement rule laid them. The unrolled view shows the texture flat;
// the cord view wraps it round a lit cylinder.

import { cordAngle } from './braid.js';

const RAD = Math.PI / 180;
const STRETCH = 1.6; // how much closer a stitch's column neighbours count

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The newest and oldest ends of a braid are ragged (the edge runs round the
 * cord as a helix), so both views trim this many steps off each end. Simulate
 * 2 * trimSteps(G) extra steps to show a given length in full.
 */
export function trimSteps(G) {
  return G / 2 + 1;
}

/**
 * Build the surface texture.
 * @param {object} o
 * @param {Array} o.stitches  from simulate()
 * @param {number[]} o.stepY  cord height at the start of each step (circumferences)
 * @param {string[]} o.colors strand colours
 * @param {number} o.G        number of dots
 * @param {number} o.twist    degrees per step
 * @param {number} [o.maxHeight]   most cord to build, in circumferences
 * @param {number} [o.resolution]  texture pixels round the cord
 */
export function buildSurface({ stitches, stepY, colors, G, twist, maxHeight = Infinity, resolution = 512 }) {
  const steps = stepY.length - 1;
  const trim = trimSteps(G);
  if (steps <= 2 * trim) return null;
  const yHi = stepY[steps - trim];
  // Only the newest part fits on screen, so only build that much.
  const yLo = Math.max(stepY[trim], yHi - maxHeight);

  const W = Math.max(16 * G, resolution);
  const H = Math.max(1, Math.ceil((yHi - yLo) * W));
  const pad = 0.05; // circumferences of stitches kept beyond each end
  const used = stitches.filter((s) => s.y > yLo - pad && s.y < yHi + pad);
  if (!used.length) return null;

  // Column direction of each stitch, in pixels: towards the next stitch laid
  // at the same angle on the disk (or from the previous one, for the newest).
  const half = 180 / G;
  const col = new Array(used.length);
  const last = new Map();
  used.forEach((st, i) => {
    const bin = Math.round((st.angle - 90) / half);
    const key = ((bin % (2 * G)) + 2 * G) % (2 * G);
    const p = last.get(key);
    if (p !== undefined) {
      let da = cordAngle(st, twist) - cordAngle(used[p], twist);
      da = ((da + 540) % 360) - 180;
      col[p] = [(da / 360) * W, -(st.y - used[p].y) * W];
      if (!col[i]) col[i] = col[p];
    }
    last.set(key, i);
  });

  const area = (W * (yHi - yLo + 2 * pad) * W) / used.length; // pixels per stitch
  const unit = Math.sqrt(area);
  const reach = Math.ceil(2.1 * unit);
  const invS2 = 1 / (STRETCH * STRETCH);

  const best = new Float32Array(W * H).fill(Infinity);
  const second = new Float32Array(W * H).fill(Infinity);
  const along = new Float32Array(W * H);
  const owner = new Int32Array(W * H).fill(-1);

  used.forEach((st, i) => {
    const px = (cordAngle(st, twist) / 360) * W;
    const py = (yHi - st.y) * W;
    const [cx, cy] = col[i] ?? col[used.length - 1] ?? [0, -1];
    const len = Math.hypot(cx, cy) || 1;
    const gx = cx / len;
    const gy = cy / len;
    const newer = i * 1e-7; // ties go to the newer stitch, which lies on top

    const y0 = Math.max(0, Math.floor(py - reach));
    const y1 = Math.min(H - 1, Math.ceil(py + reach));
    const xa = Math.floor(px - reach);
    const xb = Math.ceil(px + reach);
    const x0 = ((xa % W) + W) % W;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - py;
      const row = y * W;
      let x = x0;
      for (let xi = xa; xi <= xb; xi++) {
        const dx = xi + 0.5 - px;
        const par = dx * gx + dy * gy;
        const perp = dy * gx - dx * gy;
        const d = par * par * invS2 + perp * perp - newer;
        const k = row + x;
        if (d < best[k]) {
          second[k] = best[k];
          best[k] = d;
          owner[k] = i;
          along[k] = (2 * par) / len;
        } else if (d < second[k]) {
          second[k] = d;
        }
        if (++x === W) x = 0;
      }
    }
  });

  const rgb = colors.map(hexToRgb);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const i = owner[k];
    const o = k * 4;
    if (i < 0) { data[o] = data[o + 1] = data[o + 2] = 40; data[o + 3] = 255; continue; } // a gap shows the core
    const c = rgb[used[i].strand];
    // Darken towards the edge of each stitch and towards its two ends.
    const edge = Math.sqrt(Math.max(0, best[k]) / Math.max(1e-6, second[k]));
    let f = 1.08 - 0.5 * edge ** 3;
    f *= 1 - 0.3 * Math.min(1, along[k] * along[k]);
    data[o] = c[0] * f;
    data[o + 1] = c[1] * f;
    data[o + 2] = c[2] * f;
    data[o + 3] = 255;
  }
  return { width: W, height: H, data, circumference: W };
}

function textureCanvas(surface) {
  if (surface.canvas) return surface.canvas;
  const c = document.createElement('canvas');
  c.width = surface.width;
  c.height = surface.height;
  c.getContext('2d').putImageData(new ImageData(surface.data, surface.width, surface.height), 0, 0);
  surface.canvas = c;
  return c;
}

function prepare(canvas, background) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  return ctx;
}

/** Flat chart of the whole surface, scaled to the canvas width, cropped to its height. */
export function drawUnrolled(canvas, { surface, background, dpr = 1 }) {
  const ctx = prepare(canvas, background);
  if (!surface) return;
  const pad = Math.round(8 * dpr);
  const w = canvas.width - 2 * pad;
  const scale = w / surface.width;
  const h = Math.min(canvas.height - 2 * pad, surface.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(textureCanvas(surface), 0, 0, surface.width, h / scale, pad, pad, w, h);
}

/** The cord as a lit cylinder, seen from angle `view` (degrees round the cord). */
export function drawCord(canvas, { surface, background, view, dpr = 1 }) {
  const ctx = prepare(canvas, background);
  if (!surface) return;
  const margin = 24 * dpr;
  const maxR = canvas.width * 0.3;
  const maxH = canvas.height - 2 * margin;
  // Keep a believable thickness: long cords are cropped (newest part shown).
  const fitR = maxH / ((surface.height / surface.circumference) * 2 * Math.PI);
  const R = Math.max(maxR * 0.6, Math.min(maxR, fitR));
  const pxPerTex = (2 * Math.PI * R) / surface.circumference;
  const shownH = Math.min(maxH, Math.floor(surface.height * pxPerTex));
  const top = Math.round(margin + (maxH - shownH) / 2);
  const left = Math.round(canvas.width / 2 - R);
  const cw = Math.round(2 * R);

  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(left + 4 * dpr, top + 4 * dpr, cw, shownH);

  const img = ctx.getImageData(left, top, cw, shownH);
  const out = img.data;
  const { width: W, height: H, data } = surface;
  const light = -30;
  for (let x = 0; x < cw; x++) {
    const xn = (x + 0.5 - R) / R;
    if (xn <= -1 || xn >= 1) continue;
    const phi = Math.asin(xn) / RAD; // angle from the line of sight
    const lambert = Math.max(0, Math.cos((phi - light) * RAD));
    const spec = 0.18 * Math.max(0, Math.cos((phi + 22) * RAD)) ** 24;
    const bright = 0.32 + 0.68 * lambert;
    const rim = Math.min(1, 6 * (1 - Math.abs(xn))); // soften the silhouette
    let u = (((view + phi) % 360) + 360) % 360 / 360 * W - 0.5;
    if (u < 0) u += W;
    const u0 = Math.floor(u);
    const fu = u - u0;
    const u1 = (u0 + 1) % W;
    for (let y = 0; y < shownH; y++) {
      const v = Math.min(H - 1.001, Math.max(0, (y + 0.5) / pxPerTex - 0.5));
      const v0 = Math.floor(v);
      const fv = v - v0;
      const a = (v0 * W + u0) * 4;
      const b = (v0 * W + u1) * 4;
      const c = ((v0 + 1) * W + u0) * 4;
      const d = ((v0 + 1) * W + u1) * 4;
      const o = (y * cw + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const t = (data[a + ch] * (1 - fu) + data[b + ch] * fu) * (1 - fv) + (data[c + ch] * (1 - fu) + data[d + ch] * fu) * fv;
        out[o + ch] = t * bright + 255 * spec;
      }
      out[o + 3] = 255 * rim;
    }
  }
  // Blend over the background rather than replacing it, so the edges stay soft.
  const tmp = document.createElement('canvas');
  tmp.width = cw;
  tmp.height = shownH;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, left, top);
}

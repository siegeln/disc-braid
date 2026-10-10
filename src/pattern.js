// Shareable pattern codes: colours, length, twist and movement rule in one
// URL-safe string, e.g. "c=f3ead8.2b2b33...&r=16&tw=-0.5&m=BRao,TLao/1".

import { isValidStrandCount } from './braid.js';
import { DEFAULT_RULE, cloneRule, decodeRule, encodeRule } from './rules.js';

export const MIN_ROUNDS = 4;
export const MAX_ROUNDS = 150;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const HEX = /^#?([0-9a-f]{6})$/i;

export function encodePattern({ colors, rounds, twist, rule }) {
  const p = new URLSearchParams();
  p.set('c', colors.map((c) => c.replace('#', '')).join('.'));
  p.set('r', String(rounds));
  p.set('tw', String(Math.round(twist * 100) / 100)); // relative twist
  p.set('m', encodeRule(rule ?? DEFAULT_RULE));
  return p.toString();
}

export function decodePattern(str) {
  const p = new URLSearchParams(str.replace(/^#/, ''));
  const raw = (p.get('c') || '').split('.').filter(Boolean);
  const colors = raw.map((c) => HEX.exec(c)).filter(Boolean).map((m) => `#${m[1].toLowerCase()}`);
  if (colors.length !== raw.length || !isValidStrandCount(colors.length)) return null;
  const rounds = Number(p.get('r'));
  const twist = Number(p.get('tw'));
  let rule = decodeRule(p.get('m'));
  // Links made before movement rules existed only said which way to turn.
  if (!rule) rule = p.get('turn') === 'cw' ? decodeRule('BRao,TLao/-1') : cloneRule(DEFAULT_RULE);
  return {
    colors,
    rounds: Number.isFinite(rounds) && rounds > 0 ? clamp(Math.round(rounds), MIN_ROUNDS, MAX_ROUNDS) : undefined,
    twist: p.has('tw') && Number.isFinite(twist) ? clamp(Math.round(twist * 20) / 20, -1.5, 1.5) : undefined,
    rule,
  };
}

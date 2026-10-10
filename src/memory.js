import { OBSESSION_EMO } from './emotion.js';

export { OBSESSION_EMO };

/** 复习次数 → 半衰期（天） */
const HALF_LIFE = [0.5, 1, 3, 7, 16, 35, 90, 180];

/** 复习到这个次数就当成永久记忆，不再衰减 */
export const PERMANENT_HITS = 7;

/** 低于这个保留度就算"忘了" */
export const FORGET_BELOW = 0.25;

/** 半衰期（天） */
export function halfLifeDays(hits) {
  const h = Math.max(0, Math.floor(Number(hits) || 0));
  return HALF_LIFE[Math.min(h, HALF_LIFE.length - 1)];
}

export function isObsession(meta) {
  return (Number(meta?.emo) || 0) >= OBSESSION_EMO;
}

export function isPermanent(meta) {
  if (meta?.pinned === true) return true;
  if (isObsession(meta)) return true;
  return (Number(meta?.hits) || 0) >= PERMANENT_HITS;
}

/** 为什么它是永久记忆（给界面显示用） */
export function permanentReason(meta) {
  if (meta?.pinned === true) return '钉住';
  if (isObsession(meta)) return '执念';
  if ((Number(meta?.hits) || 0) >= PERMANENT_HITS) return '很牢';
  return '';
}

export function retention(meta, now) {
  if (isPermanent(meta)) return 1;
  const hits = Number(meta?.hits) || 0;
  const last = Number(meta?.lastHit) || now;
  const days = Math.max(0, (now - last) / 86400000);
  return Math.pow(0.5, days / halfLifeDays(hits));
}

/** 新建一条记忆的元数据 */
export function newMeta(now, { pinned = false, hits = 1, emo = 0 } = {}) {
  return {
    hits,
    lastHit: now,
    created: now,
    ...(Number(emo) > 0 ? { emo: Number(emo) } : {}),
    ...(pinned ? { pinned: true } : {}),
  };
}

export function touchMeta(meta, now, { delta = 1, emo = 0 } = {}) {
  const m = meta && typeof meta === 'object' ? { ...meta } : newMeta(now);
  m.hits = Math.max(1, (Number(m.hits) || 0) + delta);
  m.lastHit = now;
  if (!m.created) m.created = now;
  if (Number(emo) > (Number(m.emo) || 0)) m.emo = Number(emo);
  return m;
}

export function decayFacts(facts, meta, now, opts = {}) {
  const { below = FORGET_BELOW, maxForget = 3 } = opts;
  const src = Array.isArray(facts) ? facts : [];
  const metaIn = meta && typeof meta === 'object' ? meta : {};

  const alive = [];
  const fading = [];
  for (const f of src) {
    const m = metaIn[f] || newMeta(now);
    const r = retention(m, now);
    if (isPermanent(m) || r >= below) alive.push(f);
    else fading.push({ f, r });
  }

  fading.sort((a, b) => a.r - b.r);
  const forgotten = fading.slice(0, maxForget).map((x) => x.f);
  const kept = alive.concat(fading.slice(maxForget).map((x) => x.f));

  const metaOut = {};
  for (const f of kept) metaOut[f] = metaIn[f] || newMeta(now);

  return { kept, forgotten, meta: metaOut };
}

/** 给人看的记忆强度标签 */
export function strengthLabel(meta, now) {
  if (isObsession(meta)) return '执念';
  if (isPermanent(meta)) return '很牢';
  const r = retention(meta, now);
  if (r >= 0.85) return '清楚';
  if (r >= 0.6) return '还行';
  if (r >= 0.4) return '有点模糊';
  if (r >= FORGET_BELOW) return '快忘了';
  return '基本忘了';
}

/** 记忆强度 0..100（给 UI 画进度用） */
export function strengthPercent(meta, now) {
  return Math.round(retention(meta, now) * 100);
}

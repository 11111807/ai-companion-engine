/**
 * 记忆曲线（艾宾浩斯遗忘曲线的实用版）
 *
 * 核心想法：**反复提到的、重要的忘得慢；说过一次的小事忘得快。**
 *
 * 每条记忆记三个数：
 *   hits     被提到 / 复习过多少次
 *   lastHit  最后一次是什么时候（用内置时钟，不是现实时间）
 *   emo      这件事当时的**情绪强度** 0..10（见 emotion.js）
 *
 * 保留度 = 0.5 ^ (距上次的天数 / 半衰期)
 *
 * 半衰期随复习次数增长，参考艾宾浩斯那套复习间隔：
 *   第 1 次记住 → 约 1 天忘一半
 *   复习到 2 次 → 约 3 天
 *   3 次        → 约 7 天
 *   4 次        → 约 16 天
 *   5 次        → 约 35 天
 *   7 次以上    → 基本不会忘（永久记忆）
 *
 * 所以"每天做饭"这种反复出现的生活习惯会自动变成永久记忆，
 * 而"他今天中午吃了拉面"这种一次性的会慢慢淡掉。
 *
 * ---------------------------------------------------------------
 * 但光有复习次数不够 —— 还有**执念**。
 *
 * 遗忘曲线描述的是"不用就淡"，可情绪强烈的事是**"用不用都忘不了"**：
 * 有人几十年没提过某件事，它却一直在。所以：
 *   emo >= OBSESSION_EMO（默认 7）→ 直接算永久记忆，不受曲线影响，
 *   哪怕一次都没再提过，十年后依然是"你一直放不下的事"。
 *
 * 这两套机制是**并存**的：
 *   反复提到（hits）→ 熟练度 → 记得住
 *   情绪强烈（emo） → 分量   → 放不下
 */

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

/**
 * 是不是"执念"：情绪强度够高的事，永远忘不掉。
 * 这是独立于复习次数的一条路 —— 一次都没再提过也算。
 */
export function isObsession(meta) {
  return (Number(meta?.emo) || 0) >= OBSESSION_EMO;
}

/**
 * 是不是永久记忆。
 * 三条路任一条成立：用户钉住的、复习够次的、情绪强度够高的（执念）。
 */
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

/**
 * 当前保留度 0..1。1 = 记得很清楚，0 = 完全忘了。
 * @param {{hits?:number,lastHit?:number,pinned?:boolean}} meta
 * @param {number} now 虚拟时间（毫秒）
 */
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

/**
 * 复习一次：次数 +1，时间刷新。
 * 注意 hits 可以是小数（比如被检索命中算半次）。
 *
 * emo 只升不降：同一件事再被提起时如果这次情绪更重，就按更重的算
 * （"他妈住院" → 后来说"他妈走了"，强度要跟着涨上去）。
 */
export function touchMeta(meta, now, { delta = 1, emo = 0 } = {}) {
  const m = meta && typeof meta === 'object' ? { ...meta } : newMeta(now);
  m.hits = Math.max(1, (Number(m.hits) || 0) + delta);
  m.lastHit = now;
  if (!m.created) m.created = now;
  if (Number(emo) > (Number(m.emo) || 0)) m.emo = Number(emo);
  return m;
}

/**
 * 按照遗忘曲线，把已经淡忘的记忆挑出来。
 *
 * @param {string[]} facts       现有的记忆条目
 * @param {object} meta          { 文本: 元数据 }
 * @param {number} now           虚拟时间
 * @param {object} [opts]
 * @param {number} [opts.below]  低于这个保留度算忘掉
 * @param {number} [opts.maxForget] 一次最多忘掉几条（防止一口气清空）
 * @returns {{kept:string[], forgotten:string[], meta:object}}
 */
export function decayFacts(facts, meta, now, opts = {}) {
  const { below = FORGET_BELOW, maxForget = 3 } = opts;
  const src = Array.isArray(facts) ? facts : [];
  const metaIn = meta && typeof meta === 'object' ? meta : {};

  const alive = [];
  const fading = [];
  for (const f of src) {
    const m = metaIn[f] || newMeta(now);      // 没有元数据的当成刚记住
    const r = retention(m, now);
    if (isPermanent(m) || r >= below) alive.push(f);
    else fading.push({ f, r });
  }

  // 按"忘得最狠"排序，但一次最多忘几条
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

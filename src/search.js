/**
 * 搜聊天记录 —— 记忆页最上面那个搜索框背后的事。
 *
 * ⚠️ 别和 `recall.js` 搞混，两者目的相反：
 *
 * | | 自动检索（`recall.js`） | 这里（用户主动搜） |
 * |---|---|---|
 * | 谁在用 | 模型（自动） | 人（打字搜） |
 * | 匹配方式 | 2/3-gram + IDF 打分，"相关"就算 | **子串精确匹配**，搜「猫」就必须有「猫」 |
 * | 目的 | 让她想起很久以前的事 | 让我找到那句话 |
 *
 * 所以这里**刻意用最笨的办法**：不分词、不算权重。
 * 把"猫咪""养猫"当成命中「猫」，对人来说反而是错的。
 *
 * 全部是纯函数：不碰 DOM、不碰 state，消息列表由调用方传进来。
 */

/** 一次最多列这么多条命中，免得列表把页面撑爆 */
export const SEARCH_MAX_HITS = 40;

/**
 * 查询串 → 词表（全小写）。
 * 空格分隔的多个词是 **and** 关系（跟搜索引擎一样，越多词越准）。
 */
export function termsOf(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
}

/**
 * 在**全部**历史里找他/她说过的话。
 *
 * @param {Array} messages 完整聊天记录
 * @param {string} query
 * @returns {Array<{i:number, m:object}>} i 是在原数组里的下标（点结果要跳回去）
 */
export function searchMessages(messages, query) {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const list = Array.isArray(messages) ? messages : [];

  const hits = [];
  // 从后往前找，新的排在前面
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.role === 'system') continue;
    const text = String(m.content || '');
    if (!text) continue;
    const low = text.toLowerCase();
    if (!terms.every((t) => low.includes(t))) continue;
    hits.push({ i, m });
    if (hits.length >= SEARCH_MAX_HITS) break;
  }
  return hits;
}

/** 命中词附近的一小段，前后加省略号（列表里不能把整条都铺出来） */
export function snippetOf(text, terms, max = 64) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;

  const low = raw.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const p = low.indexOf(t);
    if (p >= 0 && (at < 0 || p < at)) at = p;
  }
  if (at < 0) return raw.slice(0, max) + '…';

  // 命中点往左留三分之一，右边占剩下的，看着才不会"词在最右边看不见"
  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(raw.length, start + max);
  return (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
}

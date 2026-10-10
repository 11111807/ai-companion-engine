/** 一次最多列这么多条命中，免得列表把页面撑爆 */
export const SEARCH_MAX_HITS = 40;

export function termsOf(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
}

export function searchMessages(messages, query) {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const list = Array.isArray(messages) ? messages : [];

  const hits = [];

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

  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(raw.length, start + max);
  return (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
}

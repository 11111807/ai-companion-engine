const LEAKED = /系统提示|\[系统\]|\[指令\]|作为一个\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|As an AI/i;

/** 这一条能不能上屏 */
export const isLeaked = (text) => LEAKED.test(String(text || ''));

export function stripLabel(text) {
  return String(text || '')
    .replace(/^[ \t]*[【\[［]\s*([^】\]］，。！？；~\n]{1,12})\s*[】\]］][ \t]*/gmu, '')
    .trim();
}

export function splitMessages(text, { maxBurst = 2, nameAlt = [] } = {}) {
  let t = String(text || '').trim();
  if (!t) return [];

  const alt = [nameAlt].flat().filter(Boolean)
    .map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (alt.length) t = t.replace(new RegExp(`^(?:${alt.join('|')}|我)\\s*[:：]\\s*`, 'gm'), '');

  t = t

    .replace(/^[ \t]*(?:【|\[|\(|（)?\s*空\s*行\s*(?:】|\]|\)|）)?[ \t]*$/gm, '')

    .replace(/(?:【|\[|\(|（)\s*空\s*行\s*(?:】|\]|\)|）)/g, '\n\n')
    .replace(/\\n/g, '\n')
    .replace(/^[ \t]*(?:【|\[|\(|（)?\s*换\s*行\s*(?:】|\]|\)|）)?[ \t]*$/gm, '')
    .replace(/(?:【|\[|\(|（)\s*换\s*行\s*(?:】|\]|\)|）)/g, '\n');

  let parts = t.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);

  if (parts.length === 1 && /\n/.test(parts[0])) {
    const single = parts[0].split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (single.length > 1) parts = single;
  }

  const solid = (p) => p.replace(/[\s\p{P}]/gu, '').length > 0;
  parts = parts.filter(solid).filter((p) => !isLeaked(p)).map(stripLabel).filter(solid);
  if (!parts.length) return [];

  if (parts.length > maxBurst) {
    const keep = parts.slice(0, Math.max(1, maxBurst - 1));
    keep.push(parts.slice(Math.max(1, maxBurst - 1)).join('\n\n'));
    parts = keep;
  }
  return parts;
}

export function replyItems(segments, { maxBurst = 2, nameAlt = [] } = {}) {
  const items = [];
  let left = Math.max(1, Number(maxBurst) || 2);
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (seg?.narr) { items.push({ content: seg.text, narr: true }); continue; }
    const parts = splitMessages(seg?.text, { maxBurst: left, nameAlt });
    left = Math.max(1, left - parts.length);
    for (const p of parts) items.push({ content: p, narr: false });
  }
  return items;
}

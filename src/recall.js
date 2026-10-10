/** 索引最多覆盖多少条历史（再多就是极端情况了，建索引会变慢） */
export const MAX_INDEXED = 20000;

const STOP = new Set([
  '今天', '明天', '昨天', '后天', '现在', '刚才', '一会', '时候',
  '这个', '那个', '这些', '那些', '这里', '那里', '这样', '那样',
  '什么', '怎么', '为什', '哪个', '哪儿', '多少',
  '可以', '没有', '不是', '就是', '还是', '但是', '因为', '所以',
  '如果', '已经', '一直', '有点', '感觉', '好像', '应该', '可能',
  '需要', '知道', '觉得', '真的', '其实', '反正', '而且', '然后',
  '我们', '你们', '他们', '她们', '自己', '大家', '别人',
  '一个', '一次', '一下', '一点', '出来', '起来', '过来', '过去',
  '回来', '上去', '下去', '了的', '的了', '的是', '是在', '不在',
  '哈哈', '嘿嘿', '呵呵', '嗯嗯', '哦哦', '好的', '行吧', '没事',
  '谢谢', '对不起', '没关系', '怎么样', '怎么办',
]);

export function keywords(text) {
  const s = String(text || '');
  const out = new Set();

  for (const m of s.matchAll(/[a-zA-Z][a-zA-Z0-9]{1,}/g)) out.add(m[0].toLowerCase());

  for (const seg of s.split(/[^\u4e00-\u9fa5]+/)) {
    if (seg.length < 2) continue;
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const w = seg.slice(i, i + n);
        if (!STOP.has(w)) out.add(w);
      }
    }
  }
  return out;
}

export function buildIndex(msgs) {
  const start = Math.max(0, msgs.length - MAX_INDEXED);
  const index = { postings: new Map(), msgWords: new Map(), n: 0, start };
  appendToIndex(index, msgs, start);
  return index;
}

export function appendToIndex(index, msgs, from) {
  for (let i = from; i < msgs.length; i++) {
    const ws = keywords(msgs[i]?.content);
    index.msgWords.set(i, ws);
    for (const w of ws) {
      let p = index.postings.get(w);
      if (!p) { p = new Map(); index.postings.set(w, p); }
      p.set(i, (p.get(i) || 0) + 1);
    }
  }
  index.n = Math.max(0, msgs.length - index.start);
}

export function search(index, query, opts = {}) {
  const { limit = 5, excludeFrom = Infinity, minScore = 0.5 } = opts;
  if (!index || !index.n) return [];

  const qs = keywords(query);
  if (!qs.size) return [];

  const scores = new Map();
  for (const w of qs) {
    const p = index.postings.get(w);
    if (!p) continue;

    const idf = Math.log(1 + index.n / p.size);

    const w2 = w.length >= 3 ? 1 : 0.75;
    for (const [i, cnt] of p) {
      if (i >= excludeFrom) continue;
      scores.set(i, (scores.get(i) || 0) + idf * w2 * Math.min(cnt, 3));
    }
  }

  return [...scores.entries()]
    .filter(([, s]) => s >= minScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([i, score]) => ({ index: i, score }));
}

export function formatHits(msgs, hits, maxChars = 600) {
  if (!hits?.length) return '';
  const picked = hits
    .map((h) => ({ m: msgs[h.index], i: h.index }))
    .filter((x) => x.m && x.m.content)
    .sort((a, b) => (a.m.ts || 0) - (b.m.ts || 0));

  const lines = [];
  let used = 0;
  let prevText = '';
  for (const { m } of picked) {
    const t = String(m.content).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!t || t === prevText) continue;
    prevText = t;
    const d = new Date(m.ts || Date.now());
    const when = `${d.getMonth() + 1}/${d.getDate()}`;
    const who = m.role === 'user' ? '他说' : '你说';
    const line = `- ${when} ${who}：${t}`;
    if (used + line.length > maxChars) break;
    used += line.length;
    lines.push(line);
  }
  return lines.join('\n');
}

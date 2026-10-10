/** 片段长度：4 字太容易撞（"我觉得""今天就"），6 字又常常跨不过语气词，5 字最稳 */
const GRAM = 5;

/** 纯汉字才算（标点 / emoji / 数字切出来的片段没有意义） */
const CJK = /^[\u4e00-\u9fff]+$/;

const SMALL = [
  '我觉得', '我以为', '然后就', '就是说', '但是', '不过', '因为', '所以',
  '而且是', '其实我', '真的', '好吧', '怎么办', '怎么了', '什么时',
  '你怎么', '我不知', '不知道', '一下子', '一会儿', '有点不',
];

const isNoise = (g) => SMALL.some((w) => g.includes(w));

function roundsOf(msgs, n) {
  const rounds = [];
  let cur = null;
  for (const m of msgs) {

    if (m?.role === 'user') { cur = null; continue; }
    if (m?.role !== 'assistant') continue;
    const say = m.narr ? '' : String(m.content || '').trim();
    const think = String(m.think || '').trim();
    if (!say && !think) continue;
    if (!cur) { cur = []; rounds.push(cur); }
    if (say) cur.push(say);
    if (think) cur.push(think);
  }
  return rounds.slice(-n).map((r) => r.join(' '));
}

export function repeatedTopics(msgs, { rounds = 6, minHits = 2, max = 3 } = {}) {
  const list = roundsOf(Array.isArray(msgs) ? msgs : [], rounds);
  if (list.length < minHits) return [];

  const hits = new Map();
  for (let r = 0; r < list.length; r++) {
    const text = list[r];
    const seen = new Set();
    for (let i = 0; i + GRAM <= text.length; i++) {
      const g = text.slice(i, i + GRAM);
      if (!CJK.test(g) || seen.has(g) || isNoise(g)) continue;
      seen.add(g);
      if (!hits.has(g)) hits.set(g, []);
      hits.get(g).push({ round: r, at: i });
    }
  }

  const ranked = [...hits.entries()]
    .filter(([, arr]) => arr.length >= minHits)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const out = [];
  for (const [g, arr] of ranked) {
    if (out.some((o) => sameSentence(o.spots, arr))) continue;
    out.push({ text: g, hits: arr.length, spots: arr });
    if (out.length >= max) break;
  }
  return out.map(({ text, hits: n }) => ({ text, hits: n }));
}

function sameSentence(a = [], b = []) {
  return a.some((x) => b.some((y) => x.round === y.round && Math.abs(x.at - y.at) < GRAM));
}

export function repeatBlock(list = []) {
  const items = (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === 'string' ? { text: x, hits: 0 } : x))
    .filter((x) => x?.text)
    .slice(0, 4);
  if (!items.length) return '';

  return `【你最近老在说的】（别每轮都提同一件事）
${items.map((x) => `- ${x.text}`).join('\n')}

上面这些是**从你最近几轮的话和内心独白里挑出来的**（你在反复提到它们）。
这一轮：
- **话里别提、心里也别再想了**。两个地方都出现同一件事，他一看就觉得假
- 除非他刚问起，或者它真的跟你们此刻在说的事有关
- 尤其别把它塞在第二条里当"补充内容"。凑不出第二条就**只发一条**，
  比硬塞一句不相干的话强得多（他明确说过那样很出戏）
- 内心那一块也一样：这一轮想点**当下的**（他刚说的这句话、你手上正在做的事），
  别又惦记同一桩
- 要是上面只是碰巧重复的零碎词、并不是你真正在念叨的事，忽略这一条就行`;
}

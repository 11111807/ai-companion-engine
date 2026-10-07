/**
 * 关键词检索式记忆
 *
 * 为什么需要它：
 *   LLM 本身没有记忆，每次都要把"希望它记得的内容"重新塞进 prompt。
 *   最近 200 条好办，但更早的只能压成要点，细节就丢了。
 *   这里做的是：聊到某个话题时，从**全部历史**里把相关的那几条翻出来，
 *   只占很小一段 prompt，却能捞起很久以前说过的事。
 *
 * 为什么不用向量检索：
 *   手机端跑 embedding 要额外下模型、额外算力。中文用「关键词 + IDF 加权」
 *   这一档，对"做饭""加班""猫""项目"这类具体话题已经够用，而且零成本。
 *
 * 中文没有空格，所以用 n-gram（2 字 + 3 字）切分，再用 IDF 把
 * "今天""什么"这种高频噪音自动压下去——不需要维护词典。
 */

/** 索引最多覆盖多少条历史（再多就是极端情况了，建索引会变慢） */
export const MAX_INDEXED = 20000;

/**
 * 高频虚词/口头语。这些词命中率极高但毫无信息量，
 * 光靠 IDF 也能压下去，但直接扔掉更干净。
 */
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

/**
 * 从一段文字里抽关键词。
 * 做法：英文/数字按词切；汉字切成 2-gram 和 3-gram，去掉停用词。
 * @returns {Set<string>}
 */
export function keywords(text) {
  const s = String(text || '');
  const out = new Set();

  // 英文单词、数字
  for (const m of s.matchAll(/[a-zA-Z][a-zA-Z0-9]{1,}/g)) out.add(m[0].toLowerCase());

  // 汉字片段：按非汉字切段，段内切 2-gram / 3-gram
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

/**
 * 建倒排索引。
 *
 * 用**消息在原数组里的绝对下标**做 key（不是 0 起）——这样追加重建、
 * 前缀裁剪都不会让下标错位。
 *
 * @param {Array<{role:string,content:string,ts?:number}>} msgs 只要 user/assistant
 */
export function buildIndex(msgs) {
  const start = Math.max(0, msgs.length - MAX_INDEXED);
  const index = { postings: new Map(), msgWords: new Map(), n: 0, start };
  appendToIndex(index, msgs, start);
  return index;
}

/**
 * 增量追加：只处理新来的消息，不用整表重建。
 * @param {object} index buildIndex 的返回值
 * @param {Array} msgs   完整的消息数组
 * @param {number} from  从第几条开始是新的
 */
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

/**
 * 检索跟 query 最相关的历史消息。
 *
 * @param {object} index
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=5]       最多返回几条
 * @param {number} [opts.excludeFrom]   这个下标之后的都不算（已经在最近上下文里了）
 * @param {number} [opts.minScore=0.5]  低于这个分数不要（避免瞎凑）
 * @returns {Array<{index:number, score:number}>} index 是原消息数组里的下标
 */
export function search(index, query, opts = {}) {
  const { limit = 5, excludeFrom = Infinity, minScore = 0.5 } = opts;
  if (!index || !index.n) return [];

  const qs = keywords(query);
  if (!qs.size) return [];

  const scores = new Map();
  for (const w of qs) {
    const p = index.postings.get(w);
    if (!p) continue;
    // IDF：越少见的词越有信息量。"做饭"比"今天"值钱得多。
    const idf = Math.log(1 + index.n / p.size);
    // 2-gram 的区分度不如 3-gram，给点折扣。
    // 折扣不能太狠：消息少的时候 IDF 本来就低，压太狠会一条都捞不出来。
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

/**
 * 把检索结果拼成一段给模型看的文字。
 * 按时间正序排列（读起来有先后感），并去掉重复的相邻内容。
 *
 * @param {Array} msgs  原消息数组
 * @param {Array} hits  search 的返回值
 * @param {number} [maxChars=600]
 */
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

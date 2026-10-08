/**
 * "她最近老在说同一件事" —— 抓出跨轮反复出现的片段。
 *
 * 用户的原话：
 *   "她的第二段话总是反复强调与当前环境事情无关的事情，比如现在正在做某些事情，
 *    但是她的回答总是在第二段反复强调明天要早起，这样显得比较出戏。"
 *   补了一句："反复强调事情不止是在对话里，在思考内容也有所体现。"
 *
 * 为什么会这样：她每轮被要求"讲一点你自己"、"要有第二条"，可是**素材是有限的**。
 * 没有新东西可说的时候，模型就会去记忆里抓一条现成的（"你明天要早起"）来把
 * 第二条填满 —— 而这件事跟当下正在干嘛毫无关系，一读就出戏。
 * 内心那一块同理：想不出新的，就反复惦记同一桩事。
 *
 * 旁白有防复读（narration.js）、内心有防复读（thought.js），但它们防的都是**句式**
 * （"别又写'顿住'"、"别又用那个句式"），不防**同一件事被反复拿出来说**。
 *
 * 做法：把每一轮她说的台词**和**心里想的拼在一起，按 5 字滑窗切开，
 * 统计哪些片段在多轮里都出现过。整句重复好办，难的是"换着说法提同一件事"——
 * 固定长度的片段正好抓得住。
 * 抓出来的东西**不保证准**（可能有巧合的虚词），所以提示词里明说了"碰巧的忽略"：
 * 误报的代价只是多一句没用的话，漏报的代价是她继续出戏。
 *
 * 纯函数、零依赖，可以单独 import（见 test-modules.mjs）。
 */

/** 片段长度：4 字太容易撞（"我觉得""今天就"），6 字又常常跨不过语气词，5 字最稳 */
const GRAM = 5;

/** 纯汉字才算（标点 / emoji / 数字切出来的片段没有意义） */
const CJK = /^[\u4e00-\u9fff]+$/;

/**
 * 一眼就是虚词、必然跨轮重复的片段 —— 直接不看。
 * 只列最明显的那些：宁可漏掉几个真复读，也别让提示词里出现一堆"我觉得"。
 */
const SMALL = [
  '我觉得', '我以为', '然后就', '就是说', '但是', '不过', '因为', '所以',
  '而且是', '其实我', '真的', '好吧', '怎么办', '怎么了', '什么时',
  '你怎么', '我不知', '不知道', '一下子', '一会儿', '有点不',
];

const isNoise = (g) => SMALL.some((w) => g.includes(w));

/**
 * 把消息切成"轮"，每轮是她连续说的那几句台词 + 那一轮心里想的。
 *
 * 为什么按轮而不是按条：一轮里她可能连发两三条，那属于**同一轮**说的话，
 * 同轮里的重复不该算"反复提"（那只是同一次表达里的用词重复）。
 *
 * 为什么把内心也拼进来：用户特意说过"反复强调不止在对话里，思考内容也有"。
 * 台词和内心本来就是同一个念头的两面，拼在一起统计才能抓住
 * "话里说、心里也在想同一桩事"这种情况。
 */
function roundsOf(msgs, n) {
  const rounds = [];
  let cur = null;
  for (const m of msgs) {
    // 他一说话就是新的一轮开始
    if (m?.role === 'user') { cur = null; continue; }
    if (m?.role !== 'assistant') continue;
    const say = m.narr ? '' : String(m.content || '').trim();
    const think = String(m.think || '').trim();     // 内心挂在那一轮的第一条上
    if (!say && !think) continue;
    if (!cur) { cur = []; rounds.push(cur); }
    if (say) cur.push(say);
    if (think) cur.push(think);
  }
  return rounds.slice(-n).map((r) => r.join(' '));
}

/**
 * 最近几轮里反复出现的片段（按"出现在几轮里"排序）。
 *
 * @param {Array<{role:string,content:string,narr?:boolean}>} msgs
 * @param {object} [opts]
 * @param {number} [opts.rounds=6] 看最近几轮
 * @param {number} [opts.minHits=2] 至少出现在几轮里才算"反复"
 * @param {number} [opts.max=3]     最多返回几条
 * @returns {Array<{text:string, hits:number}>}
 */
export function repeatedTopics(msgs, { rounds = 6, minHits = 2, max = 3 } = {}) {
  const list = roundsOf(Array.isArray(msgs) ? msgs : [], rounds);
  if (list.length < minHits) return [];

  // 每个片段记下"出现在哪几轮、每轮里的第几个字"
  const hits = new Map();
  for (let r = 0; r < list.length; r++) {
    const text = list[r];
    const seen = new Set();
    for (let i = 0; i + GRAM <= text.length; i++) {
      const g = text.slice(i, i + GRAM);
      if (!CJK.test(g) || seen.has(g) || isNoise(g)) continue;
      seen.add(g);            // 同一轮里出现多次只算一轮
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

/**
 * 两个片段是不是**同一句话的两个滑窗**。
 *
 * 为什么需要：一句话"那个项目怎么样了"会切出"那个项目怎""个项目怎么""项目怎么样"
 * 三个都命中的片段 —— 不合并的话提示词里会出现三条半截的话，模型看着也糊涂。
 * 判据很简单：它们在某轮里位置挨着（差不到一个窗口）。
 */
function sameSentence(a = [], b = []) {
  return a.some((x) => b.some((y) => x.round === y.round && Math.abs(x.at - y.at) < GRAM));
}

/**
 * 提示词里那一段。什么都没抓到就返回空串。
 * @param {Array<{text:string,hits:number}>} list
 */
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

const HARD_PATTERNS = [
  /为什么|怎么会|怎么办|该不该|要不要|是不是|会不会|值不值/u,
  /如果|假如|万一|要是/u,
  /你觉得|你认为|你怎么看|你说呢/u,
  /记得|还记得|以前|当初|那时候|上次/u,
  /我们|你们|关系|喜欢|爱|分手|结婚|离开/u,
  /[？?].*[？?]/u,
];

export function thinkPause(text, { max = 1600 } = {}) {
  const t = String(text || '').trim();

  if (t.length < 8) return 0;

  let ms = 0;
  if (t.length >= 40) ms += 400;
  if (t.length >= 90) ms += 400;
  const hits = HARD_PATTERNS.filter((re) => re.test(t)).length;
  ms += Math.min(2, hits) * 400;

  if (!ms) return 0;

  return Math.min(max, Math.round(ms / 100) * 100);
}

const THOUGHT_HEAD = /(?:^|\n)[ \t]*\[\[?[ \t]*(?:思考|内心|心声)[ \t]*\]\]?/;

export function parseThoughtBlock(text) {
  const src = String(text || '');
  const m = src.match(THOUGHT_HEAD);
  if (!m) return { clean: src, thought: '' };

  const body = src.slice(m.index + m[0].length);
  const blank = body.search(/\n\s*\n/);
  const stops = [blank, body.indexOf('[[')].filter((i) => i >= 0);
  let end = stops.length ? Math.min(...stops) : body.length;

  if (blank < 0) {
    const lines = body.split('\n');
    let used = 0;
    for (let i = 0; i < lines.length; i++) {
      used += lines[i].length + (i ? 1 : 0);
      if (lines[i].trim()) { end = used; break; }
    }
  }

  const thought = body.slice(0, end)
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .slice(0, 2).join(' ').slice(0, 120);

  const clean = (src.slice(0, m.index) + src.slice(m.index + m[0].length + end))
    .replace(/\n{3,}/g, '\n\n').trim();
  return { clean, thought };
}

export function thoughtPrompt() {
  return `【每一轮都要写：你的内心】（会折叠成"思考"，他点开才看得见）
在你要说的话**最前面**写一块，写成这样：

[[思考]]你对**下一句话**的内心独白

（这里**空一行**，然后才是你要说的话）

⚠️ **两处格式必须照做**（实测最容易错的就是这个）：
1. 这一块**只占一行**
2. 它后面**必须空一行**，再写你要说的话。
   只用一次换行的话，界面会把你的**台词也当成内心**折进去 —— 他就看不见你说的话了

- 第一人称、10~50 字，写**心事**不写**动作** —— 动作写在（）里（那是旁白）
- ⭐ **想的是"此刻"**：他刚说的这句话、你手上正在做的事、你眼前的场景。
  **别连着几轮都惦记同一件事**（用户点过名：心里反复念"明天要早起"这种，很出戏）
- ⭐ **它和情绪是两件事，也不靠情绪驱动**：不是"有情绪才有思考"。
  心情平平的时候你照样在想事情（"这菜有点咸""他今天话怎么这么少"），
  所以**每一轮都要有**，哪怕你只回一个"嗯"
- 它常常和你说出口的话**不一样**（嘴上"没事"，心里"有点介意"）——
  台词是他听见的，这一块是他点开才看见的

⭐ **要像人，别每次都一个句式**（最容易翻车的一条）：
真人心里那一下是**跳的、短的、甚至不成句**的，不是每次都"他…了，我应该…"。
每一轮**换一个角度**，下面这些轮着来：

- 第一反应：\`啊？怎么突然问这个\`、\`诶，他居然记得\`
- 心里的小得意 / 小别扭：\`哼，现在想起我了\`、\`他这么一说我还挺受用的\`
- 联想到自己：\`我上次也是这样，最后没敢说\`
- 犹豫要不要说：\`要不要问他呢…算了，先不说这个\`
- 走神 / 自我吐槽：\`我是不是想太多了\`、\`我这脑子\`
- 对下一句话的小打算：\`待会儿得问问后来怎么样了\`

⚠️ **写成下面这样等于没写**（一眼就是机器）：
- 策略腔、像在汇报：\`他在问我时间，我应该回答几点\`、\`我需要先安抚他\`
- 每轮都是同一个句式：\`他又说没事了…我先别追问，顺着他说\`
- 把他说的话复述一遍，或者把台词在这里再写一遍
- 表决心、讲道理、总结：\`我决定要好好陪他\`、\`陪伴是最重要的\`
- 写成动作（那是旁白的事）：\`把手机翻过来扣在桌上\`

允许半句话、允许口语、允许只有几个字：\`诶？\`、\`…有点想他了\`。`;
}

export function recentThoughts(msgs, { recentN = 80, max = 6 } = {}) {
  const list = Array.isArray(msgs) ? msgs.slice(-recentN) : [];
  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (m?.role !== 'assistant' || !m.think) continue;
    const t = String(m.think).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(-max);
}

export function thoughtVaryBlock(list = []) {
  const items = (Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!items.length) return '';
  return `【你最近几次的内心】（别再来一遍）
${items.map((s) => `- ${s}`).join('\n')}

上面这些是**你前几轮想过的东西**。这一轮：
- 别再写同一个意思、同一个句式（"他…了，我先…"这种连着出现两次就很假）
- 换个角度想：第一反应 / 联想到自己 / 犹豫 / 走神 / 小得意，挑一个跟上面不一样的
- ⭐ **也别反复惦记同一件事**。上面几条要是在想同一桩（比如连着几次都在担心
  "明天要早起"），这一轮就把它放下 —— 想**当下的**：他刚说的这句话本身、
  你手上正在做的事、你眼前的这个场景（用户说过：心里反复念同一件事，很出戏）
- 也别为了不一样硬编 —— 真的没什么想法，就写一句短短的当下感受（"有点困了"）`;
}

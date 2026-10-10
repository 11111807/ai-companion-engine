const PAIR = /([（(])([^（()）\n]{1,120})([)）])/g;

/** 半角括号里得有中文才算旁白 —— "(lol)"、"(๑•̀ㅂ•́)و" 是台词的一部分 */
const HAS_CJK = /[\u3400-\u9fff]/;
const NO_ASCII_WORD = /^[^A-Za-z0-9]*$/;

const MARKER = /^(?:空|换)行$/;

/** 这一段括号算不算旁白 */
const looksLikeNarration = (body, open) => (
  !MARKER.test(body)
  && (open === '（' || (HAS_CJK.test(body) && NO_ASCII_WORD.test(body)))
);

/** 攒台词：把行内多余空格收掉，空片段丢掉 */
function pushSpeech(out, raw) {
  const t = String(raw).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  if (!t) return;

  const tail = out[out.length - 1];
  if (tail && !tail.narr) { tail.text += t; return; }
  out.push({ text: t, narr: false });
}

export function splitNarration(text) {
  const src = String(text || '');
  const out = [];
  let at = 0;
  let m;

  PAIR.lastIndex = 0;
  while ((m = PAIR.exec(src))) {
    const body = m[2].trim();
    if (!looksLikeNarration(body, m[1])) continue;
    pushSpeech(out, src.slice(at, m.index));
    if (body) out.push({ text: body, narr: true });
    at = m.index + m[0].length;
  }
  pushSpeech(out, src.slice(at));
  return out;
}

export function recentNarrations(msgs, { recentN = 80, max = 8 } = {}) {
  const list = Array.isArray(msgs) ? msgs.slice(-recentN) : [];
  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (!m?.narr || m.role !== 'assistant') continue;
    const t = String(m.content || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(-max);
}

export function narrationVaryBlock(list = []) {
  const items = (Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!items.length) return '';
  const lazy = items.filter(isLazyNarration);
  const extra = lazy.length
    ? `\n\n⚠️ 上面有 ${lazy.length} 条是**没有画面的空动作**（"${lazy.slice(0, 3).join('""')}"）。
那种词等于什么都没写 —— 这次换一个**看得见、听得到**的动作。`
    : '';
  return `【你最近写过的旁白】（别原样再来一遍）
${items.map((s) => `- （${s}）`).join('\n')}

同一批动作连着用会显得机械（真人不会每次都"笑""愣住"）。
这一轮换个**动作或角度**：写点别的正在发生的事 —— 手上的、周围的、你没说出口的。
不用躲得干干净净，但至少别一模一样地重复。${extra}`;
}

/** 空动作：情绪空转、没有画面、没有对象的词 */
export const LAZY_ACTIONS = [
  '顿住', '愣住', '愣住了', '愣了几秒', '怔住', '呆住', '僵住',
  '沉默', '沉默了几秒', '没说话', '没出声', '没反应', '无言以对',
  '没躲', '没有躲', '没接话', '不吭声', '不知道该说什么',
  '表情复杂', '神色复杂', '若有所思', '陷入沉思', '想了想', '思考了一下',

  '勾了勾嘴角',
  '脸红', '红了脸', '脸一红', '心跳加速', '心跳漏了一拍',
];

const SMILE_OK = /(?:出声|摇头|点头|弯腰|直不起腰|捂|扶|趴|拍桌|眼泪|岔气|不行|不出来|死我|起来)/;

const SMILE_FILLER = /(?:笑|了|着|一下|一|微微|轻轻|地|的|起来|出声|出了声)/g;
const smileOnly = (t) => {
  if (!/笑/.test(t)) return false;
  if (SMILE_OK.test(t) || /[，。；、,;]/.test(t)) return false;
  return t.replace(SMILE_FILLER, '').trim().length <= 2;
};

/** 这一条旁白是不是"空动作"（命中黑名单、或者只是在笑，就算） */
export function isLazyNarration(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return LAZY_ACTIONS.some((w) => t.includes(w)) || smileOnly(t);
}

export function lazyNarrationBlock() {
  return `【别写"空动作"】（这是最容易被浪费掉的一种旁白）
下面这些词**不算旁白**，它们只是"她有个反应"，既看不见也听不到：
${LAZY_ACTIONS.slice(0, 12).join('、')}……

⚠️ **最常犯的是"笑"**（用户点过名："旁白老是笑，我说完一句她就笑，光笑那能行吗"）：
- 不合格：**（笑）**、**（笑了笑）**、**（微微一笑）**、**（笑着说）**
  —— 只有情绪，没有画面，而且是"敷衍式的反应"
- 合格：**（看到消息，忍不住笑出声）**、**（把脸埋在枕头里笑了一下）**、
  **（笑着摇了摇头）**、**（一边打字一边笑）**
  —— 有对象、有方向、有声音，能拍出来
- 一晚上连着写三次"笑"，比不写还糟

- 反例：他问"几点了" → 你写 **（顿住）** —— 读者什么画面都没有，等于白写
- 正例：**（抬头看了一眼墙上的钟）**、**（伸手把床头柜上的手机摸过来）**、
  （把被子往上拉了拉，眼睛都没睁开）
- 判断标准很简单：**这句话能不能拍出来？**
  能看见谁在动、动的是什么、在哪个方向 → 合格；
  只有一个情绪词（顿住 / 沉默 / 脸红 / 笑）→ 不合格，重写一个具体的动作
- 旁白不是"她有个反应"的占位符，而是**让这一句台词落到具体画面上**：
  他在问时间 → 你看钟 / 摸手机；他在哄你 → 你把脸埋进枕头；
  你想掩饰 → 你低头去拽衣角
- ⭐ **旁白要扣住"此刻的环境"**（他明确要求过）：用眼前现成的东西 ——
  台灯、被子、耳机、奶茶、外面的雨、食堂的盘子、手机屏幕的光。
  写"（把台灯拧小了一圈）"永远好过写"（笑）"
- ⭐ **实在没有动作可写，就一个字都不写**（这条很重要）：
  硬凑一个"（笑）"出来，比不写差得多 —— 他宁可看不到旁白，也不想每轮都看到"笑"`;
}

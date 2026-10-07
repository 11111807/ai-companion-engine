/**
 * 旁白：（）里的**动作 / 神态 / 环境 / 心里话**。
 *
 * 界面上的规矩（用户定的，别再改回去）：
 *   - 她说的话在**左边**，她的旁白也在**左边**（灰色虚线小框）
 *   - 我说的话在右边，我写的旁白也在右边
 * 也就是说旁白**不能混在台词气泡里** —— 得先在这里拆开，
 * 界面才知道这一轮该画几个框、哪个框画在哪边。
 *
 * 为什么不是"提示词里禁止她写括号"：
 *   那条规则写过两轮，模型还是照写（"（夹了口菜）"），
 *   而它写出来的东西本来就是对的 —— 错的是把它和台词塞进同一个气泡。
 *   提示词管不住的事，在渲染这一层兜住：拆开以后，她写括号反而成了对的行为。
 *
 * 纯函数、零依赖，可以单独 import（见 test-modules.mjs）。
 */

/**
 * 一对括号。全角半角都认（模型偶尔混着写），但**不许跨行** ——
 * 跨行匹配会把上一段的"（"和好几行之后的"）"配成一对，
 * 那就不是旁白，是把整段聊天吃进去了。
 */
const PAIR = /([（(])([^（()）\n]{1,120})([)）])/g;

/** 半角括号里得有中文才算旁白 —— "(lol)"、"(๑•̀ㅂ•́)و" 是台词的一部分 */
const HAS_CJK = /[\u3400-\u9fff]/;
const NO_ASCII_WORD = /^[^A-Za-z0-9]*$/;

/**
 * 模型偶尔把"空行 / 换行"当成要输出的文字写出来（写成了"（空行）"这种）。
 * 那是分段标记，不是旁白 —— 得留给 splitMessages 去还原成真的换行，
 * 否则一句话会被拆成"台词 + 旁白:空行 + 台词"三个框。
 */
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
  // 括号被整对丢掉时（"（ ）"这种空旁白）会把一句话切成两截，接回去
  const tail = out[out.length - 1];
  if (tail && !tail.narr) { tail.text += t; return; }
  out.push({ text: t, narr: false });
}

/**
 * 把她的回复拆成**台词**和**旁白**两种条目，顺序不变。
 *
 * 例：`（夹了口菜）好吃吗？\n你也尝尝`
 *   → [{ text: '夹了口菜', narr: true },
 *      { text: '好吃吗？\n你也尝尝', narr: false }]
 *
 * 括号前后的话会各自成为一条台词（"我没事（笑）真的" → 台词 / 旁白 / 台词），
 * 位置保留了，所以界面上读起来还是原来那句话的顺序。
 *
 * @param {string} text
 * @returns {Array<{text: string, narr: boolean}>}
 */
export function splitNarration(text) {
  const src = String(text || '');
  const out = [];
  let at = 0;
  let m;

  PAIR.lastIndex = 0;
  while ((m = PAIR.exec(src))) {
    const body = m[2].trim();
    if (!looksLikeNarration(body, m[1])) continue;  // 不是旁白 → 留在台词里
    pushSpeech(out, src.slice(at, m.index));
    if (body) out.push({ text: body, narr: true });
    at = m.index + m[0].length;
  }
  pushSpeech(out, src.slice(at));
  return out;
}

// ---------------------------------------------------------------- 别写重样
//
// 用户的第二条要求是"她的旁白可以更灵动，动作也可以更丰富"。
// 光在提示词里说"别重复"没用 —— 得把它**最近真写过什么**摆回去：
// 模型看不见自己前几轮写了什么（上下文里虽然有，但没人点名它就会复读）。
// 这里把最近几条旁白捞出来，提示词里明确列一遍"这几个刚用过，换一个"。

/**
 * 她最近写过的旁白（去重、从旧到新）。
 * @param {Array<{role:string,content:string,narr?:boolean}>} msgs
 * @param {object} [opts]
 * @param {number} [opts.recentN=80] 只看最近多少条消息
 * @param {number} [opts.max=8]      最多列几条
 * @returns {string[]}
 */
export function recentNarrations(msgs, { recentN = 80, max = 8 } = {}) {
  const list = Array.isArray(msgs) ? msgs.slice(-recentN) : [];
  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (!m?.narr || m.role !== 'assistant') continue;   // 只算**她**写的
    const t = String(m.content || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(-max);
}

/**
 * 把"最近写过的旁白"拼成提示词里的一段。
 * 一条都没写过就返回空串（新用户别塞一段空的进提示词）。
 * @param {string[]} list
 */
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

// ---------------------------------------------------------------- 空动作
//
// 用户的原话：
//   "我问几点了，为什么会顿住呢，为什么不可以是，抬头看了一眼呢……
//    不能总是顿住，没躲，这种无感情的描述，需要更灵动一点，感情更丰富一点。
//    我加旁白这个功能不止是简单描述，而是画龙点睛身临其境的感觉。"
//
// 所以这里是**一份黑名单**：这些词本身不构成画面 —— 它们只是"她有个反应"，
// 但既看不见也听不到，等于把旁白这个功能浪费掉了。
// 一份词表两处用：提示词里的反面例子（persona.js）+ 最近旁白里的点名提醒。

/** 空动作：情绪空转、没有画面、没有对象的词 */
export const LAZY_ACTIONS = [
  '顿住', '愣住', '愣住了', '愣了几秒', '怔住', '呆住', '僵住',
  '沉默', '沉默了几秒', '没说话', '没出声', '没反应', '无言以对',
  '没躲', '没有躲', '没接话', '不吭声', '不知道该说什么',
  '表情复杂', '神色复杂', '若有所思', '陷入沉思', '想了想', '思考了一下',
  '笑了笑', '轻笑', '微微一笑', '勾了勾嘴角',
  '脸红', '红了脸', '脸一红', '心跳加速', '心跳漏了一拍',
];

/** 这一条旁白是不是"空动作"（命中黑名单就算） */
export function isLazyNarration(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return LAZY_ACTIONS.some((w) => t.includes(w));
}

/**
 * 提示词里那段"别写空动作"（含反面 → 正面的对照）。
 * 一条黑名单都不命中时也要输出 —— 它是规则，不是提醒。
 */
export function lazyNarrationBlock() {
  return `【别写"空动作"】（这是最容易被浪费掉的一种旁白）
下面这些词**不算旁白**，它们只是"她有个反应"，既看不见也听不到：
${LAZY_ACTIONS.slice(0, 12).join('、')}……

- 反例：他问"几点了" → 你写 **（顿住）** —— 读者什么画面都没有，等于白写
- 正例：**（抬头看了一眼墙上的钟）**、**（伸手把床头柜上的手机摸过来）**、
  （把被子往上拉了拉，眼睛都没睁开）
- 判断标准很简单：**这句话能不能拍出来？**
  能看见谁在动、动的是什么、在哪个方向 → 合格；
  只有一个情绪词（顿住 / 沉默 / 脸红）→ 不合格，重写一个具体的动作
- 旁白不是"她有个反应"的占位符，而是**让这一句台词落到具体画面上**：
  他在问时间 → 你看钟 / 摸手机；他在哄你 → 你把脸埋进枕头；
  你想掩饰 → 你低头去拽衣角`;
}

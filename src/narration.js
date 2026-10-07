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

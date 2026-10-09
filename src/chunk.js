/**
 * 她的回复 → 待上屏的条目。
 *
 * 这一层专门收拾"模型写得不规矩"的地方，全是纯函数（不碰 DOM、不碰 state，
 * 名字是当参数传进来的）—— 所以能单独 import、单独测（见 test-modules.mjs）。
 *
 * 从 app.js 搬出来是因为那边又顶到行数线了（这套规矩已经抬过太多次）。
 * 搬的是"解析"这一半：连发拆分、行首标签、角色名前缀、`（空行）`这种写错的标记。
 */

/**
 * 剥掉她自己在行首加的"标签"。
 *
 * 用户实测的原文（截图里就是这条）：
 *   【回应他的"嗯嗯"】我只是在等你，不用急
 * 模型把"这是在回应什么"当标题写进了正文 —— 提示词里明明禁止写标题，
 * 它偶尔还是会这么干，而且一眼就出戏。
 *
 * 按老规矩：**提示词管不住的事，在渲染这一层兜住**（旁白那套也是这么办的）。
 * 判据：行首、括号里不超过 12 字、不带句读 —— 微信里没人这么开头，几乎不会误伤。
 */
export function stripLabel(text) {
  return String(text || '')
    .replace(/^[ \t]*[【\[［]\s*([^】\]］，。！？；~\n]{1,12})\s*[】\]］][ \t]*/gmu, '')
    .trim();
}

/**
 * 把模型生成的内容拆成"几条短消息"。
 *
 * 模型被要求用空行分隔多条，但经常只换行，所以两种都要处理。
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxBurst=2] 最多几条（超出的并进最后一条）
 * @param {string[]} [opts.nameAlt]  可以剥掉的角色名前缀（"小雨："这种）
 */
export function splitMessages(text, { maxBurst = 2, nameAlt = [] } = {}) {
  let t = String(text || '').trim();
  if (!t) return [];

  // 去掉可能的角色名前缀（"小雨："、"新名字："）
  // 名字是可改的，所以不能写死 —— 调用方把她当前的名字传进来。
  const alt = [nameAlt].flat().filter(Boolean)
    .map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (alt.length) t = t.replace(new RegExp(`^(?:${alt.join('|')}|我)\\s*[:：]\\s*`, 'gm'), '');

  // 模型有时会把"空行"当成要输出的文字：写成【空行】/(空行)/（空行）/[空行]，
  // 或者输出 "\n\n" 这种字面转义。这些还原成真正的换行，否则会露馅。
  // ⚠️ 半角 `(` 和全角 `（` 都要认 —— 中文模型写出来基本是全角，早先只认半角，
  //    于是"（空行）"原样留在了气泡里。
  t = t
    // 单独成行的标记 → 变成真空行（先做，因为带空格/变体多）
    .replace(/^[ \t]*(?:【|\[|\(|（)?\s*空\s*行\s*(?:】|\]|\)|）)?[ \t]*$/gm, '')
    // 夹在文字中间的标记 → 变成换行
    .replace(/(?:【|\[|\(|（)\s*空\s*行\s*(?:】|\]|\)|）)/g, '\n\n')
    .replace(/\\n/g, '\n')
    .replace(/^[ \t]*(?:【|\[|\(|（)?\s*换\s*行\s*(?:】|\]|\)|）)?[ \t]*$/gm, '')
    .replace(/(?:【|\[|\(|（)\s*换\s*行\s*(?:】|\]|\)|）)/g, '\n');

  // 优先按空行拆
  let parts = t.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);

  // 如果没有空行，按单换行拆（微信里换行通常就是新消息）
  if (parts.length === 1 && /\n/.test(parts[0])) {
    const single = parts[0].split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (single.length > 1) parts = single;
  }

  // 过滤掉纯标点的碎片；再剥掉行首自己加的标签（剥完可能是空的，再滤一次）
  const solid = (p) => p.replace(/[\s\p{P}]/gu, '').length > 0;
  parts = parts.filter(solid).map(stripLabel).filter(solid);
  if (!parts.length) return [];

  // 限制条数：超出的合并到最后一条，避免刷屏。
  // 注意：合并要用空行而不是单换行。否则合并出来的气泡里会残留换行，
  // 下一次拆分时又会被当成多条消息处理。
  if (parts.length > maxBurst) {
    const keep = parts.slice(0, Math.max(1, maxBurst - 1));
    keep.push(parts.slice(Math.max(1, maxBurst - 1)).join('\n\n'));
    parts = keep;
  }
  return parts;
}

/**
 * 她的整段回复 → 待发出的条目（台词 / 旁白各成一条）。
 *
 * 旁白**不占连发条数**：它是舞台说明，不是她发的消息，
 * 一轮里带一两个很正常，不该因此把台词挤掉。
 * 台词照旧受 maxBurst 限制（多了就并进上一条，见 splitMessages）。
 *
 * @param {Array<{text:string,narr:boolean}>} segments splitNarration() 的结果
 * @param {object} [opts] 见 splitMessages
 * @returns {Array<{content: string, narr: boolean}>}
 */
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

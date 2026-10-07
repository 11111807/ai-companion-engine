/**
 * 相处习惯：统计他反复做的「动作旁白」，让她对熟动作有习惯性反应。
 *
 * 为什么需要：
 *   他说"（抱住）"，第一次她"（愣住）"很自然；
 *   但他做过十次了，心情还不错的时候还回"（愣住）""（没躲）"，
 *   就显得非常生硬、像失忆。真人早习惯了，甚至会主动回应
 *   （"（反手抱住）今天怎么这么黏人"）。
 *
 * 做法：从最近的对话里统计他用过的括号动作，出现次数多的写进提示词，
 * 告诉她"这个他常做，你早该习惯了，别再给第一次的反应"。
 */

/**
 * 同义动作归到一组，免得"抱住 / 抱抱 / 抱紧"各算各的。
 * 顺序有讲究：先匹配更具体的（"摸头"要在"抱"之前判断不会冲突，
 * 但"搂"和"抱"归一组是故意的）。
 */
const ACTION_GROUPS = [
  { key: '抱住', words: ['抱住', '抱抱', '抱紧', '抱一下', '搂住', '搂', '抱'] },
  { key: '摸头', words: ['摸头', '摸摸头', '揉头', '摸头发', '揉头发', '拍头'] },
  { key: '牵手', words: ['牵手', '拉手', '握住手', '抓手', '牵'] },
  { key: '亲亲', words: ['亲亲', '亲一下', '亲额头', '亲脸', '亲', '吻'] },
  { key: '靠着', words: ['靠着', '靠肩', '靠一下', '依偎', '蹭'] },
  { key: '捏脸', words: ['捏脸', '掐脸', '戳脸', '捏'] },
  { key: '喂东西', words: ['喂一口', '喂食', '喂'] },
  { key: '递东西', words: ['递给', '塞给', '递'] },
  { key: '拍拍', words: ['拍拍', '拍肩', '拍背', '轻拍'] },
];

/** 从一句话里抽出括号里的动作。中英文括号都认。 */
export function extractActions(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/[（(]([^）)]{1,14})[）)]/g)) {
    const a = m[1].trim();
    if (a) out.push(a);
  }
  return out;
}

/** 把动作归到组里；归不上就用原词（去掉时态助词、截断） */
export function groupOf(action) {
  const a = String(action || '').replace(/\s+/g, '');
  if (!a) return '';
  for (const g of ACTION_GROUPS) {
    if (g.words.some((w) => a === w || a.includes(w))) return g.key;
  }
  return a.replace(/[了着过]/g, '').slice(0, 6);
}

/**
 * 统计他做过哪些动作、各做了几次。
 * @param {Array<{role:string,content:string}>} msgs
 * @param {object} [opts]
 * @param {number} [opts.recentN=200] 只看最近多少条
 * @returns {Map<string, number>} 动作 → 次数
 */
export function countActions(msgs, { recentN = 200 } = {}) {
  const list = msgs.length > recentN ? msgs.slice(-recentN) : msgs;
  const count = new Map();
  for (const m of list) {
    if (m.role !== 'user') continue;          // 只统计**他**做的动作
    for (const a of extractActions(m.content)) {
      const g = groupOf(a);
      if (!g) continue;
      count.set(g, (count.get(g) || 0) + 1);
    }
  }
  return count;
}

/**
 * 生成给模型看的「相处习惯」段落。
 * @param {Array} msgs
 * @param {object} [opts]
 * @param {number} [opts.minCount=2] 至少做过几次才算"习惯"
 * @param {number} [opts.maxItems=6]
 * @returns {string} 没有习惯动作时返回空串
 */
export function habitsBlock(msgs, { minCount = 2, maxItems = 6, recentN = 200 } = {}) {
  const count = countActions(msgs, { recentN });
  const items = [...count.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems);
  if (!items.length) return '';

  return `【你们的相处习惯】（这些动作他反复做过，你早该习惯了）
${items.map(([k, n]) => `- 「${k}」：${n >= 5 ? '经常' : '有过几次'}`).join('\n')}

⚠️ 上面这些是**背景知识，不是台词**：
- **不要把"次数""你老是这样""你已经做过好多次了"说出来**——
  那听起来像在记账。你只是"习惯"了，不需要报数字
- 做过很多次的动作，**不要再给"（愣住）""（没躲）""（脸红）""（心跳快了）"
  这种第一次才有的反应**——那显得你们像刚认识，很假

熟悉之后应该是这样的：
- 自然的、习惯性的接住（"（往他怀里靠了靠）"）
- 甚至主动一点、带点调侃（"（反手抱住）今天怎么这么黏人"）
- **心情好的时候更黏、更主动；心情不好或正生着气，冷淡一点也正常**
- 同一个动作别每次都用同一句旁白——上次说过的话这次换一个说法`;
}

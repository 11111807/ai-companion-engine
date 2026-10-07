/**
 * 记忆系统 —— 读写、检索、以及那些"要不要说出口"的取舍。
 *
 * 这是整个应用最要紧的一块：她像不像真人，八成取决于"她记得什么、记得多牢"。
 * 原来它被劈成三块散在 app.js 和 memory.js 里（写入在 app.js、
 * 遗忘曲线在 memory.js、检索一半在 recall.js 一半在 app.js），
 * 改一个功能要跳三个文件 —— 所以合成这一个模块。
 *
 * 三层职责（改的时候别混）：
 *   1. **写入**：她回复里带的 `[[记忆]]{...}` → 落成 profile.facts
 *   2. **淡忘**：复习次数 + 情绪强度 + 遗忘曲线（数学在 memory.js，政策在这里）
 *   3. **检索**：很久以前的对话，靠关键词 + IDF 翻出来塞进提示词
 *
 * 这个模块**不碰 DOM**；凡是需要"现在"的地方都由调用方传 `now` 进来
 * （应用里的"现在"是**虚拟时钟**，不是 Date.now()，传错了时间就会错乱）。
 */

import { buildIndex, appendToIndex, search as recallSearch, formatHits } from './recall.js';
import { newMeta, touchMeta } from './memory.js';
import { intensityOf, OBSESSION_EMO } from './emotion.js';

/** 生平要点最多留几条（多了会把提示词里的记忆名额占满） */
export const BIO_MAX_POINTS = 12;

// ---------------------------------------------------------------- 一、写入

/**
 * 从她的回复末尾解析隐藏的记忆块：
 * [[记忆]]{"name":"小林","facts":["养了只猫"],"mood":"累"}
 *
 * 模型经常把 JSON 写坏，所以解析失败时也要把标记本身擦掉 ——
 * 否则用户会在聊天框里看见 `[[记忆]]` 这种东西。
 */
export function parseMemoryBlock(text) {
  const re = /\[\[记忆\]\]\s*(\{[\s\S]*?\})\s*$/;
  const m = String(text || '').match(re);
  if (!m) return { clean: String(text || ''), mem: null };
  try {
    const mem = JSON.parse(m[1]);
    return { clean: String(text).replace(re, '').trim(), mem };
  } catch {
    return { clean: String(text).replace(re, '').replace(/\[\[记忆\]\][\s\S]*$/, '').trim(), mem: null };
  }
}

/**
 * 把解析出来的记忆写进档案（原地修改 profile）。
 *
 * 已经记过类似的算一次「复习」—— 记忆曲线的核心就是这个：
 * 反复提到的越来越牢，最后变成永久记忆。
 *
 * @param {object} mem      parseMemoryBlock 的 mem
 * @param {object} profile  state.profile（原地改）
 * @param {number} t        当前时间（虚拟时钟）
 * @returns {{added:number, reviewed:number, name:string, mood:string}}
 */
export function applyMemory(mem, profile, t) {
  const out = { added: 0, reviewed: 0, name: '', mood: '' };
  if (!mem || typeof mem !== 'object' || !profile) return out;

  if (mem.name && typeof mem.name === 'string') {
    profile.name = mem.name.slice(0, 12);
    out.name = profile.name;
  }
  if (!profile.factsMeta || typeof profile.factsMeta !== 'object') profile.factsMeta = {};
  if (!Array.isArray(profile.facts)) profile.facts = [];

  // 模型可以顺手标一下哪几条分量重（"heavy" 列表，或者把 facts 写成 {t,e}）。
  // 但它经常不配合，所以真正靠得住的是下面的本地情绪词检测。
  const heavy = Array.isArray(mem.heavy) ? mem.heavy.map((x) => String(x)) : [];
  const isHeavy = (s) => heavy.some((h) => h && (h.includes(s) || s.includes(h)));

  if (Array.isArray(mem.facts)) {
    for (const raw of mem.facts) {
      // 兼容两种写法：字符串 "他喜欢猫" / 对象 {t:"他妈妈去世了", e:10}
      const text = typeof raw === 'string' ? raw : (raw && typeof raw.t === 'string' ? raw.t : '');
      if (!text) continue;
      const clean = text.trim().slice(0, 40);
      if (!clean) continue;

      // 情绪强度：模型标的 和 本地关键词检测的 取大的那个
      const emo = Math.max(
        Number(raw && typeof raw === 'object' ? raw.e : 0) || 0,
        intensityOf(clean),
        isHeavy(clean) ? OBSESSION_EMO : 0
      );

      const old = profile.facts.find((x) => x.includes(clean) || clean.includes(x));
      if (old) {
        profile.factsMeta[old] = touchMeta(profile.factsMeta[old], t, { emo });
        out.reviewed++;
        continue;
      }
      profile.facts.push(clean);
      profile.factsMeta[clean] = newMeta(t, { emo });
      out.added++;
    }
  }

  if (mem.mood && typeof mem.mood === 'string') {
    profile.lastMood = mem.mood.slice(0, 20);
    out.mood = profile.lastMood;
  }
  return out;
}

/**
 * 手动把一条记忆标成 / 取消「执念」（记忆页每条旁边的 ☆）。
 *
 * 为什么一定要有手动这一档：情绪强度是关键词猜的，猜不准的时候
 * 得让用户说了算 —— 而且"哪些事我放不下"本来就只有他自己知道。
 *
 * @returns {boolean} 现在是不是执念
 */
export function toggleObsession(profile, text, t) {
  if (!text || !profile) return false;
  const meta = profile.factsMeta?.[text] || newMeta(t);
  const on = Number(meta.emo) >= OBSESSION_EMO;
  profile.factsMeta[text] = { ...meta, emo: on ? 0 : OBSESSION_EMO };
  return !on;
}

// ---------------------------------------------------------------- 二、他的生平

/**
 * 把他写的"大致生平"拆成一条条要点。
 *
 * 按换行 / 分号 / 句号切，顺手去掉行首的 "• - *" 和多余空白。
 * 每条截到 40 字（记忆条目本来就不该是一整段）。
 */
export function parseBioPoints(text) {
  return String(text || '')
    .split(/[\n\r；;。！!？?]+/)
    .map((s) => s.replace(/^[\s\-•·*、,，]+/, '').trim())
    .filter((s) => s.length >= 2)
    .map((s) => toThirdPerson(s).slice(0, 40))
    .slice(0, BIO_MAX_POINTS);
}

/**
 * 把第一人称改写成第三人称。
 *
 * 用户多半会写"我今年 27 岁"，但这段会显示成
 * "你记得关于他的事：我今年 27 岁" —— 明显不对。
 * 注意别把"我们"改成"他们"。
 */
export function toThirdPerson(s) {
  return String(s || '')
    .replace(/我们/g, '\u0000')
    .replace(/我/g, '他')
    .replace(/\u0000/g, '我们');
}

/**
 * 把生平要点写进她的永久记忆（原地改 profile）。
 *
 * 存进 factsManual —— 那一档在存盘时会被标成 pinned（永久、不参与遗忘）。
 * bioFacts 记着"哪些条目是从生平来的"，
 * 这样改完生平重新保存时，只撤掉上次这几条，**聊天中学到的记忆一条都不碰**。
 *
 * @returns {string[]} 这次真正新增的条目
 */
export function applyUserBio(profile, bioText) {
  const points = parseBioPoints(bioText);
  const old = Array.isArray(profile.bioFacts) ? profile.bioFacts : [];

  const drop = new Set(old);
  profile.facts = (profile.facts || []).filter((f) => !drop.has(f));
  profile.factsManual = (profile.factsManual || []).filter((f) => !drop.has(f));
  for (const f of old) {
    if (profile.factsMeta) delete profile.factsMeta[f];
  }

  const already = new Set(profile.facts);
  const next = points.filter((p) => !already.has(p));
  profile.facts = [...profile.facts, ...next];
  profile.factsManual = [...(profile.factsManual || []), ...next];
  profile.bioFacts = next;
  return next;
}

// ---------------------------------------------------------------- 三、要点压缩

/** 压要点时要丢掉的纯寒暄 */
const NOISE = /^(嗯+|哦+|啊+|哈+|在吗|在么|在不在|早|晚安|好|好的|行|是|对|哈哈+|嘿嘿|6|666|\.+|\?+|？+|！+|!+)$/;

/** 把一条消息压成短句：去空白、去语气词尾巴、截断 */
const squeeze = (s, n) => String(s)
  .replace(/\s+/g, ' ')
  .replace(/^(那个|就是|然后|所以|其实|反正)[，,、]?/g, '')
  .trim()
  .slice(0, n);

/**
 * 把一段对话压成一行要点，作为长期记忆。
 *
 * 老写法每轮只取 6 条用户消息、每条截 28 字 ——
 * 一轮聊 30 条的话会丢掉七成内容，这就是"她明明听我说过却像没听过"的原因之一。
 * 现在：全部保留，但按信息量取舍、字数压缩。
 *
 * @param {Array} msgs   只含 user/assistant 的消息
 * @param {object} opts
 * @param {number} opts.since      上次压到哪儿了（profile.summarizedUpTo）
 * @param {number} [opts.keepRecent=6] 最近多少条留给完整上下文，不压
 * @returns {{line:string, pointer:number}|null} 不够压的时候返回 null
 */
export function summarizeConversation(msgs, { since = 0, keepRecent = 6 } = {}) {
  const list = Array.isArray(msgs) ? msgs : [];
  // 累积够 10 条新的才压一次，避免太碎
  if (list.length - since < 10) return null;

  const slice = list.slice(since, list.length - keepRecent);
  if (slice.length < 4) return null;

  const hisAll = slice.filter((m) => m.role === 'user')
    .map((m) => squeeze(m.content, 26))
    .filter((t) => t.length >= 3 && !NOISE.test(t));

  // 信息多的优先留下（长句通常信息量大），但保持原来的先后顺序
  const his = hisAll.length <= 8
    ? hisAll
    : hisAll.map((t, i) => ({ t, i, w: t.length }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 8)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.t);

  // 她自己的话只在有关键内容时留一两句（避免整段都是寒暄）
  const her = slice.filter((m) => m.role === 'assistant')
    .map((m) => squeeze(m.content, 18))
    .filter((t) => t.length >= 5 && !NOISE.test(t))
    .slice(-2);

  const when = new Date(slice[0].ts || Date.now());
  const hh = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const line = `${when.getMonth() + 1}/${when.getDate()} ${hh} 那次聊到：他提到「${his.join('；')}」`
    + (her.length ? `；你当时说「${her.join('；')}」` : '');

  return { line: line.slice(0, 320), pointer: list.length - keepRecent };
}

// ---------------------------------------------------------------- 四、检索

// 索引是**增量**维护的：只有它一直活着，才谈得上"零成本翻旧账"。
let recallIndex = null;
let recallIndexed = 0;

/** 记录被清空/替换之后要把索引丢掉（不然会指向不存在的消息） */
export function resetRecallIndex() {
  recallIndex = null;
  recallIndexed = 0;
}

/**
 * 拿到（必要时建立 / 增量更新）检索索引。
 * @returns {Array} 过滤掉 system 之后的消息数组（下标必须和索引一致）
 */
function recallIndexFor(messages) {
  const msgs = (Array.isArray(messages) ? messages : [])
    .filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!recallIndex || msgs.length < recallIndexed) {
    // 第一次，或者记录被清空 / 裁剪过
    recallIndex = buildIndex(msgs);
    recallIndexed = msgs.length;
  } else if (msgs.length > recallIndexed) {
    appendToIndex(recallIndex, msgs, recallIndexed);
    recallIndexed = msgs.length;
  }
  return msgs;
}

/**
 * 从很久以前的记录里，翻出跟当前话题相关的几条。
 *
 * ⚠️ `excludeRecent` 必须传**实际带进上下文的条数**，
 * 否则会把已经在上下文里的消息又捞一遍（重复）——
 * 这是踩过的坑，别图省事写死。
 *
 * @returns {{text:string, count:number}}
 */
export function recallOldMessages(messages, query, { limit = 5, excludeRecent = 40 } = {}) {
  const msgs = recallIndexFor(messages);
  if (msgs.length < 30) return { text: '', count: 0 };   // 记录太少，没得翻

  const excludeFrom = Math.max(0, msgs.length - Math.max(1, excludeRecent));
  const hits = recallSearch(recallIndex, query, { limit, excludeFrom });
  if (!hits.length) return { text: '', count: 0 };
  return { text: formatHits(msgs, hits), count: hits.length };
}

/**
 * 把检索结果拼成给模型看的一段话。
 *
 * ⚠️ 里面那几条"怎么用"很重要：少了它们，她会说出
 * "你以前也这么说过""你跟我说过好几遍了" —— 那像在核对聊天记录，不像人在聊天。
 */
export function recallBlock(messages, query, excludeRecent) {
  const r = recallOldMessages(messages, query, { excludeRecent });
  if (!r.text) return '';
  return `【很久以前你们说过的】（这些是很早的对话，你记得）
${r.text}

怎么用（用错了会很假，注意）：
- 自然地把里面的**内容**接上就行，不要宣告"你以前说过这个"
- **绝对不要说"你以前也这么说过""出现过很多次""你跟我说过好几遍了"**
  这类话——那听起来像在核对聊天记录，不像人在聊天
- **尤其不要提"次数"**。你知道这件事就够了，别报统计数字
- 提起来要短、要随口（"诶你上次不是说…"）；跟现在聊的没关系就干脆不提
- 他要是自己先提了同一件事，你顺着聊就行，不用强调"我也记得"`;
}

// ---------------------------------------------------------------- 五、导入

/**
 * 解析导出的聊天记录文本。
 * 支持两种行格式：
 *   [7/14 22:13] 阿哲：今天好累
 *   阿哲：今天好累
 * 同一人连续的多条会合并成一条（导出的连发是分开的行，合并后才像一条正常消息）。
 *
 * @param {string} text
 * @param {string[]} herNames 哪些名字算"她"（她现在的名字、本名、旧名字…）
 */
export function parseHistoryText(text, herNames = []) {
  const lines = String(text || '').split(/\r?\n/);
  const msgs = [];
  let facts = [];
  const names = (herNames || []).filter(Boolean);
  const timeRe = /^\s*\[(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\]\s*(.+)$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    // 头部元信息
    const fm = line.match(/^她记得关于你的事[：:]\s*(.+)$/);
    if (fm) {
      const v = fm[1].trim();
      if (v && v !== '（无）') facts = v.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    // 跳过导出文件的其他头部
    if (/^#\s/.test(line) || /^对话要点[：:]?\s*$/.test(line) || /^---+$/.test(line)) continue;
    if (/^-\s/.test(line)) continue;   // 要点条目
    if (/^\[?\d{4}-\d{2}-\d{2}/.test(line) && !timeRe.test(line)) continue;

    const tm = line.match(timeRe);
    const body = tm ? tm[5] : line.trim();
    const sep = body.indexOf('：') >= 0 ? '：' : (body.indexOf(':') >= 0 ? ':' : null);
    if (!sep) continue;

    const idx = body.indexOf(sep);
    const who = body.slice(0, idx).trim();
    const content = body.slice(idx + 1).trim();
    if (!who || !content) continue;

    const isHer = names.some((n) => who.includes(n));
    const role = isHer ? 'assistant' : 'user';

    // 合并同一人连续消息
    const prev = msgs[msgs.length - 1];
    if (prev && prev.role === role) {
      prev.content += '\n' + content;
      continue;
    }
    msgs.push({ role, content, _t: tm ? { m: +tm[1], d: +tm[2], h: +tm[3], min: +tm[4] } : null });
  }

  return { messages: msgs, facts };
}

/** 把导入消息的时间戳排到当前时间之前（保持先后顺序，且不会显示成"未来"） */
export function normalizeTimestamps(msgs, t = Date.now()) {
  const n = msgs.length;
  return msgs.map((m, i) => {
    const base = t - (n - i) * 60 * 1000;
    let ts = base;
    if (m._t) {
      const d = new Date(t);
      d.setMonth(m._t.m - 1, m._t.d);
      d.setHours(m._t.h, m._t.min, 0, 0);
      ts = d.getTime();
    }
    const { _t, ...rest } = m;
    return { ...rest, ts };
  });
}

/**
 * 导入时把"她记得的事"也并进来，跳过已有的。
 * @returns {number} 新增了几条
 */
export function mergeFacts(profile, facts) {
  let added = 0;
  for (const f of facts || []) {
    const clean = String(f || '').slice(0, 40);
    if (!clean) continue;
    if ((profile.facts || []).some((x) => x.includes(clean) || clean.includes(x))) continue;
    profile.facts.push(clean);
    added++;
  }
  return added;
}

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
 * 事件词：出现了就说明这句在讲"发生了什么"，而不是闲聊。
 *
 * ⚠️ 为什么非要它：用户实测那个 bug 的根子就是**长度被当成了信息量**
 * ——"随便聊聊第37条，今天天气还行"比"中午带你去公司开个会"还长。
 * 光把"按长度全局排序"改成"按时间分段"还不够（段内取最长照样是闲聊赢），
 * 所以段内用这个加权评分来挑。
 */
const EVENT = /(带|去|来|见|约|买|吃|喝|玩|送|接|开会|上班|下班|加班|上课|考试|面试|医院|学校|公司|机场|车站|搬家|修|签|定|说好|答应|计划|明天|后天|下周|周末|点开始|几点)/;

/** 一句的"信息量"：长度打底，讲了事件就大幅加分 */
const weight = (t) => t.length + (EVENT.test(t) ? 14 : 0);

/**
 * 从一串消息里挑 n 条，要求**覆盖整段时间**。
 *
 * 做法：按顺序均分成 n 段，每段里挑**信息量最高**（见 weight）的那句。
 * 为什么不直接按长度全局排序：那样同一时段的几句长话就占满了名额，
 * 一天里靠后的时段全被丢掉（用户实测：中午的事到晚上就想不起来）。
 * 为什么不直接取前 n 条：那等于只记得住最早那半小时。
 */
function spread(items, n) {
  if (items.length <= n) return items;
  const out = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * items.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * items.length) / n));
    const seg = items.slice(from, to);
    out.push(seg.reduce((a, b) => (weight(b) > weight(a) ? b : a), seg[0]));
  }
  return out;
}

/**
 * 把一段对话压成一行要点，作为长期记忆。
 *
 * 老写法每轮只取 6 条用户消息、每条截 28 字 ——
 * 一轮聊 30 条的话会丢掉七成内容，这就是"她明明听我说过却像没听过"的原因之一。
 *
 * ⚠️ 中间那版更坑（用户实测踩到的："中午带她去开会，晚上就忘了"）：
 * 它按**长度**排序取前 8 条，理由是"长句信息量大"。
 * 可是"随便聊聊第37条，今天天气还行"有 15 个字，
 * "中午带你去公司开个会，一点开始"只有 14 个 —— **闲聊比事件长，事件就被丢掉了**。
 * 现在改成：不排序、按时间顺序全都留（最多 MAX_POINT_ITEMS 条），
 * 只把纯寒暄（嗯 / 好的 / 哈哈）滤掉。一天的对话本来就该整段留下来。
 *
 * @param {Array} msgs   只含 user/assistant 的消息
 * @param {object} opts
 * @param {number} opts.since      上次压到哪儿了（profile.summarizedUpTo）
 * @param {number} [opts.keepRecent=6] 最近多少条留给完整上下文，不压
 * @returns {{line:string, pointer:number}|null} 不够压的时候返回 null
 */
export function summarizeConversation(msgs, { since = 0, keepRecent = 6 } = {}) {
  const list = Array.isArray(msgs) ? msgs : [];
  // 累积够 6 条新的就压一次（原来是 10）。
  // 用户："提取要点的频率加快，加多" —— 压得越勤，掉出上下文的那些话越早变成长期记忆。
  if (list.length - since < 6) return null;

  const slice = list.slice(since, list.length - keepRecent);
  if (slice.length < 4) return null;

  const hisAll = slice.filter((m) => m.role === 'user')
    .map((m) => squeeze(m.content, 34))
    .filter((t) => t.length >= 3 && !NOISE.test(t));
  // 一段对话可能要压 250+ 条，而一行要点最多装 14 句。
  // 直接取前 14 条 = 只记得住最早那半小时（中午、下午、晚上全丢），
  // 所以按时间**均匀分段**、每段里挑最长的一句：覆盖一整天，又优先要信息量高的。
  const his = spread(hisAll, MAX_POINT_ITEMS);
  const dropped = Math.max(0, hisAll.length - his.length);

  // 她自己的话只在有关键内容时留一两句（避免整段都是寒暄）
  const her = slice.filter((m) => m.role === 'assistant')
    .map((m) => squeeze(m.content, 24))
    .filter((t) => t.length >= 5 && !NOISE.test(t))
    .slice(-2);

  const when = new Date(slice[0].ts || Date.now());
  const hh = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const line = `${when.getMonth() + 1}/${when.getDate()} ${hh} 那次聊到：他提到「${his.join('；')}」`
    + (her.length ? `；你当时说「${her.join('；')}」` : '')
    + (dropped ? `（还有 ${dropped} 句闲聊没记）` : '');

  // 上限 700（原来是 400）：一条要点要装 22 句，400 字会把最后面的时段整段截掉
  //（实测：早上、中午的事件都在，晚上那件被切没了）。
  return { line: line.slice(0, 700), pointer: list.length - keepRecent };
}

/** 一条要点里最多写几条他的消息（一条要点对应一段对话） */
export const MAX_POINT_ITEMS = 22;

// ---------------------------------------------------------------- 三点五、今天发生过什么

/** 一条事件线里最多列几条 */
export const TIMELINE_MAX = 20;

/**
 * "今天发生过什么" —— 只取**已经掉出完整上下文窗口**的那部分。
 *
 * 为什么需要它（用户实测）：
 *   他中午带她去开会、下午带她出去，晚上她就"忘了中午开过会"。
 *   原因是三件事同时发生：完整上下文只带最近 200 条（一天的对话装不下）、
 *   要点又被按"长度"挑过一遍、关键词检索还得靠 query 命中"开会"才翻得出来。
 *   所以这里单独给一块**当日事件线**：不需要命中关键词，天然覆盖"今天做过什么"。
 *
 * 只在"窗口之前还有今天的消息"时才输出 —— 都在窗口里的话没必要重复占 token。
 *
 * @param {Array} msgs      全部消息（user/assistant）
 * @param {number} now      虚拟时钟（毫秒）
 * @param {object} [opts]
 * @param {number} [opts.before] 完整上下文从第几条开始（之前的都算"掉出窗口"）
 * @param {number} [opts.max]    最多列几条
 * @returns {string} 提示词片段；没有可说的返回空串
 */
export function todayTimeline(msgs, now, { before = 0, max = TIMELINE_MAX } = {}) {
  const list = (Array.isArray(msgs) ? msgs : [])
    .filter((m) => m.role === 'user' || m.role === 'assistant');
  const head = Math.max(0, Math.min(Number(before) || 0, list.length));
  if (!head) return '';

  const d = new Date(now);
  const isToday = (ts) => {
    const x = new Date(Number(ts) || 0);
    return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth()
      && x.getDate() === d.getDate();
  };

  const rows = [];
  for (let i = 0; i < head; i++) {
    const m = list[i];
    if (!isToday(m.ts)) continue;
    const text = squeeze(m.content, 40);
    if (!text || NOISE.test(text)) continue;
    const at = new Date(Number(m.ts) || 0);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const who = m.role === 'user' ? '他说' : '你说';
    const row = `${hhmm} ${who}：${text}`;
    // 连续重复的（他连发同一句）只留一条
    if (rows.at(-1)?.endsWith(text)) continue;
    rows.push(row);
  }
  if (!rows.length) return '';

  const shown = rows.length > max ? rows.slice(-max) : rows;
  return `【今天你们已经做过的事】（这部分掉出了上面的完整记录，但**都是今天真实发生过的**）
${shown.map((r) => `- ${r}`).join('\n')}

⚠️ 这是你**亲身经历**的，不是听说的：他要是晚上再提起来（"中午那个会""下午去的那儿"），
你要接得上，别像没发生过；也别说得像刚听说（"啊？有吗"）。
具体的细节（几点、穿的什么）可以记不清，但**事情本身和当时的感受要记得**。`;
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

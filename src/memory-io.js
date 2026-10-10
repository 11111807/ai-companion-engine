import { buildIndex, appendToIndex, search as recallSearch, formatHits } from './recall.js';
import { newMeta, touchMeta } from './memory.js';
import { intensityOf, OBSESSION_EMO } from './emotion.js';

/** 生平要点最多留几条（多了会把提示词里的记忆名额占满） */
export const BIO_MAX_POINTS = 12;

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

export function applyMemory(mem, profile, t) {
  const out = { added: 0, reviewed: 0, name: '', mood: '' };
  if (!mem || typeof mem !== 'object' || !profile) return out;

  if (mem.name && typeof mem.name === 'string') {
    profile.name = mem.name.slice(0, 12);
    out.name = profile.name;
  }
  if (!profile.factsMeta || typeof profile.factsMeta !== 'object') profile.factsMeta = {};
  if (!Array.isArray(profile.facts)) profile.facts = [];

  const heavy = Array.isArray(mem.heavy) ? mem.heavy.map((x) => String(x)) : [];
  const isHeavy = (s) => heavy.some((h) => h && (h.includes(s) || s.includes(h)));

  if (Array.isArray(mem.facts)) {
    for (const raw of mem.facts) {

      const text = typeof raw === 'string' ? raw : (raw && typeof raw.t === 'string' ? raw.t : '');
      if (!text) continue;
      const clean = text.trim().slice(0, 40);
      if (!clean) continue;

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

export function toggleObsession(profile, text, t) {
  if (!text || !profile) return false;
  const meta = profile.factsMeta?.[text] || newMeta(t);
  const on = Number(meta.emo) >= OBSESSION_EMO;
  profile.factsMeta[text] = { ...meta, emo: on ? 0 : OBSESSION_EMO };
  return !on;
}

export function parseBioPoints(text) {
  return String(text || '')
    .split(/[\n\r；;。！!？?]+/)
    .map((s) => s.replace(/^[\s\-•·*、,，]+/, '').trim())
    .filter((s) => s.length >= 2)
    .map((s) => toThirdPerson(s).slice(0, 40))
    .slice(0, BIO_MAX_POINTS);
}

export function toThirdPerson(s) {
  return String(s || '')
    .replace(/我们/g, '\u0000')
    .replace(/我/g, '他')
    .replace(/\u0000/g, '我们');
}

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

/** 压要点时要丢掉的纯寒暄 */
const NOISE = /^(嗯+|哦+|啊+|哈+|在吗|在么|在不在|早|晚安|好|好的|行|是|对|哈哈+|嘿嘿|6|666|\.+|\?+|？+|！+|!+)$/;

/** 把一条消息压成短句：去空白、去语气词尾巴、截断 */
const squeeze = (s, n) => String(s)
  .replace(/\s+/g, ' ')
  .replace(/^(那个|就是|然后|所以|其实|反正)[，,、]?/g, '')
  .trim()
  .slice(0, n);

const EVENT = /(带|去|来|见|约|买|吃|喝|玩|送|接|开会|上班|下班|加班|上课|考试|面试|医院|学校|公司|机场|车站|搬家|修|签|定|说好|答应|计划|明天|后天|下周|周末|点开始|几点)/;

/** 一句的"信息量"：长度打底，讲了事件就大幅加分 */
const weight = (t) => t.length + (EVENT.test(t) ? 14 : 0);

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

export function summarizeConversation(msgs, { since = 0, keepRecent = 6 } = {}) {
  const list = Array.isArray(msgs) ? msgs : [];

  if (list.length - since < 6) return null;

  const slice = list.slice(since, list.length - keepRecent);
  if (slice.length < 4) return null;

  const hisAll = slice.filter((m) => m.role === 'user')
    .map((m) => squeeze(m.content, 34))
    .filter((t) => t.length >= 3 && !NOISE.test(t));

  const his = spread(hisAll, MAX_POINT_ITEMS);
  const dropped = Math.max(0, hisAll.length - his.length);

  const her = slice.filter((m) => m.role === 'assistant')
    .map((m) => squeeze(m.content, 24))
    .filter((t) => t.length >= 5 && !NOISE.test(t))
    .slice(-2);

  const when = new Date(slice[0].ts || Date.now());
  const hh = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const line = `${when.getMonth() + 1}/${when.getDate()} ${hh} 那次聊到：他提到「${his.join('；')}」`
    + (her.length ? `；你当时说「${her.join('；')}」` : '')
    + (dropped ? `（还有 ${dropped} 句闲聊没记）` : '');

  return { line: line.slice(0, 700), pointer: list.length - keepRecent };
}

/** 一条要点里最多写几条他的消息（一条要点对应一段对话） */
export const MAX_POINT_ITEMS = 22;

/** 一条事件线里最多列几条 */
export const TIMELINE_MAX = 20;

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

let recallIndex = null;
let recallIndexed = 0;

/** 记录被清空/替换之后要把索引丢掉（不然会指向不存在的消息） */
export function resetRecallIndex() {
  recallIndex = null;
  recallIndexed = 0;
}

function recallIndexFor(messages) {
  const msgs = (Array.isArray(messages) ? messages : [])
    .filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!recallIndex || msgs.length < recallIndexed) {

    recallIndex = buildIndex(msgs);
    recallIndexed = msgs.length;
  } else if (msgs.length > recallIndexed) {
    appendToIndex(recallIndex, msgs, recallIndexed);
    recallIndexed = msgs.length;
  }
  return msgs;
}

export function recallOldMessages(messages, query, { limit = 5, excludeRecent = 40 } = {}) {
  const msgs = recallIndexFor(messages);
  if (msgs.length < 30) return { text: '', count: 0 };

  const excludeFrom = Math.max(0, msgs.length - Math.max(1, excludeRecent));
  const hits = recallSearch(recallIndex, query, { limit, excludeFrom });
  if (!hits.length) return { text: '', count: 0 };
  return { text: formatHits(msgs, hits), count: hits.length };
}

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

export function parseHistoryText(text, herNames = []) {
  const lines = String(text || '').split(/\r?\n/);
  const msgs = [];
  let facts = [];
  const names = (herNames || []).filter(Boolean);
  const timeRe = /^\s*\[(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\]\s*(.+)$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const fm = line.match(/^她记得关于你的事[：:]\s*(.+)$/);
    if (fm) {
      const v = fm[1].trim();
      if (v && v !== '（无）') facts = v.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    if (/^#\s/.test(line) || /^对话要点[：:]?\s*$/.test(line) || /^---+$/.test(line)) continue;
    if (/^-\s/.test(line)) continue;
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

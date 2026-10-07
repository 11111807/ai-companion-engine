/**
 * 实时情绪 —— 她此刻的心情，以及这件事怎么落到字面上。
 *
 * ⚠️ 别和另外两个东西搞混（这个项目里"情绪"有三个含义）：
 *
 * | 名字 | 在哪 | 是什么 |
 * |---|---|---|
 * | **情绪强度** | `emotion.js` | 一件事有多重（0–10，≥7 算执念，影响会不会被忘掉） |
 * | **好感度** | `affection.js` | 她对你整体的温度（长期，慢慢攒） |
 * | **实时情绪** | 本文件 | 她**此刻**的心情（短时，几句话就变） |
 *
 * 三者的时间尺度完全不同：好感度是几个月，实时情绪是几分钟。
 * 所以实时情绪**绝对不能**直接去改好感度 —— 那样"她刚才生气了"会变成
 * 永久扣分，聊几句就掉到底。
 *
 * 情绪怎么来的：
 *   1. 她回复里带的隐藏块 `[[情绪]]{"anger":8,"sad":3}` —— 她自己的判断
 *   2. 本地兜底：他那句话的冷暖（复用 affection.js 那套词表）
 * 两者都要过 `blend()`：新情绪并进旧情绪，旧的随时间衰减。
 */

/**
 * 允许的情绪。key 要稳定（进存档、进提示词），label 给界面用。
 *
 * 为什么就这几个：情绪表开太长，模型会开始瞎标（把"有点无奈"也叫"失望 40%"），
 * 而界面上那一行也放不下。常用的喜怒哀乐 + 嫉妒/焦虑/害羞就够了。
 */
export const MOODS = [
  { key: 'joy', label: '开心', emoji: '😄', color: '#f5b301' },
  { key: 'anger', label: '生气', emoji: '😠', color: '#e4572e' },
  { key: 'sad', label: '难过', emoji: '😔', color: '#5b7cba' },
  { key: 'love', label: '心动', emoji: '💗', color: '#e8638c' },
  { key: 'jealous', label: '吃醋', emoji: '😤', color: '#9b59b6' },
  { key: 'anxious', label: '焦虑', emoji: '😰', color: '#7f8c8d' },
  { key: 'shy', label: '害羞', emoji: '☺️', color: '#f08a5d' },
  { key: 'tired', label: '疲惫', emoji: '😩', color: '#8d99ae' },
];

export const MOOD_KEYS = MOODS.map((m) => m.key);
const BY_KEY = new Map(MOODS.map((m) => [m.key, m]));

export const moodMeta = (key) => BY_KEY.get(key) || null;

/** 界面上一行最多显示几个（多了会挤成一团） */
export const MAX_SHOWN = 3;

/**
 * 情绪是会退的。
 *
 * 每过 `HALF_LIFE_MIN` 分钟衰减一半 —— 用半衰期而不是"每分钟减 X"，
 * 是因为前者不会在低值区拖尾（"生气 2%"挂一整天很不自然）。
 */
export const HALF_LIFE_MIN = 25;
/** 低于这个就当没有了（免得界面上一直挂着"1%"） */
export const FLOOR = 3;
/** 单次最高（模型偶尔会标 100，那太夸张） */
const CAP = 95;

const clampPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(CAP, Math.round(n)));
};

/**
 * 按时间衰减再过一遍。
 * @param {object} mood   { joy: 20, anger: 8 }
 * @param {number} dtMin  距上次更新过了多少分钟
 * @returns {object} 衰减后的新对象（低于 FLOOR 的直接去掉）
 */
export function decayMood(mood, dtMin) {
  const out = {};
  if (!mood || typeof mood !== 'object') return out;
  const dt = Math.max(0, Number(dtMin) || 0);
  const factor = Math.pow(0.5, dt / HALF_LIFE_MIN);
  for (const key of MOOD_KEYS) {
    const v = clampPct(mood[key]) * factor;
    if (v >= FLOOR) out[key] = Math.round(v);
  }
  return out;
}

/**
 * 把新来的情绪并进旧情绪。
 *
 * 为什么不是"直接覆盖"：她说了一句带气的话，旧的那点开心不该瞬间清零 ——
 * 真人也会"又气又舍不得"。所以取的是**并集**，同一种取较大值。
 *
 * @param {object} oldMood
 * @param {object} incoming 她这次标出来的（或本地兜底推出来的）
 * @param {number} dtMin    距上次过了多久（先衰减再加）
 */
export function blend(oldMood, incoming, dtMin = 0) {
  const out = decayMood(oldMood, dtMin);
  if (!incoming || typeof incoming !== 'object') return out;
  for (const key of MOOD_KEYS) {
    if (!(key in incoming)) continue;
    const v = clampPct(incoming[key]);
    if (v <= 0) continue;
    out[key] = clampPct(Math.max(out[key] || 0, v));
  }
  return out;
}

/** 按强度排序后的情绪列表（界面和提示词都用这个顺序） */
export function topMoods(mood, limit = MAX_SHOWN) {
  if (!mood || typeof mood !== 'object') return [];
  return MOOD_KEYS
    .map((key) => ({ ...BY_KEY.get(key), value: clampPct(mood[key]) }))
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * 从她的回复里解析情绪块：`[[情绪]]{"anger":8}`
 *
 * 和记忆块一样容错：JSON 坏了就把标记擦干净 —— 绝不能让
 * `[[情绪]]` 这种东西出现在聊天气泡里。
 *
 * @returns {{clean:string, mood:object|null}}
 */
export function parseMoodBlock(text) {
  const s = String(text || '');
  const re = /\[\[情绪\]\]\s*(\{[\s\S]*?\})\s*$/;

  // ⚠️ 不管正则有没有匹配上，最后都必须把 `[[情绪]]...` 整段擦掉。
  //    模型写坏 JSON 时可能是 `[[情绪]]{"anger":8`（没有右括号），
  //    匹配失败就原样返回的话，`[[情绪]]` 会出现在聊天气泡里。
  //    `[[记忆]]` 那边也是同样的道理（见 memory-io.js）。
  const scrub = (t) => t.replace(/\[\[情绪\]\][\s\S]*$/, '').trim();
  const m = s.match(re);
  if (!m) return { clean: scrub(s), mood: null };
  try {
    return { clean: s.replace(re, '').trim(), mood: normalize(JSON.parse(m[1])) };
  } catch {
    return { clean: scrub(s), mood: null };
  }
}

/** 只留下认识的 key，并且把数字夹紧（模型经常多标几个没用的） */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of MOOD_KEYS) {
    if (!(key in raw)) continue;
    const v = clampPct(raw[key]);
    if (v > 0) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 本地兜底：从他这句话的冷暖推一个情绪。
 *
 * 为什么需要：模型经常不配合（不带情绪块，或者标得离谱）。
 * 和 emotion.js（执念）一样，**宁可漏判也不误伤** ——
 * 所以只认很明确的词，其余一律返回 null。
 */
const ANGER_HINT = /滚开|滚远点|讨厌你|烦死你了|闭嘴|别理我|神经病|你有病/;
const SAD_HINT = /分手|离婚|不要我了|不理我了|我很失望|算了吧/;
const LOVE_HINT = /喜欢你|想你|想见你|爱你|抱抱|亲亲|宝贝/;
const JOY_HINT = /哈哈|太好了|好开心|好高兴|笑死|嘿嘿/;
const JEALOUS_HINT = /跟别人|和别人|她是谁|那个女生|那个男生|前任/;

export function guessMood(text) {
  const t = String(text || '');
  if (!t) return null;
  if (ANGER_HINT.test(t)) return { anger: 45, sad: 15 };
  if (JEALOUS_HINT.test(t)) return { jealous: 30 };
  if (SAD_HINT.test(t)) return { sad: 35 };
  if (LOVE_HINT.test(t)) return { love: 35, joy: 15 };
  if (JOY_HINT.test(t)) return { joy: 30 };
  return null;
}

/**
 * 情绪那一段提示词。
 *
 * 两件事一起说：**她现在的情绪**，以及**这些情绪该怎么落在字面上**
 *（用户特意要求"表情和颜文字要和情绪关联匹配"）。
 *
 * ⚠️ 没有情绪时不要输出这一段。写一段"你现在心情平静"会让模型
 * 每轮都去演一遍"平静"，反而更假。
 */
export function moodBlock(mood) {
  const top = topMoods(mood, MAX_SHOWN);
  if (!top.length) return '';

  const lines = ['【你此刻的心情】（这是**这一会儿**的情绪，不是你对他的整体感觉）'];
  lines.push(top.map((m) => `${m.label} ${m.value}%`).join('　'));
  lines.push('');

  // 情绪 → 表达方式（用户要求表情/颜文字要跟情绪对上）
  const guide = [];
  for (const m of top) {
    const g = EXPRESS[m.key];
    if (g) guide.push(`- 你现在${m.label} → ${g}`);
  }
  if (guide.length) {
    lines.push('照着这个来（**表情和颜文字必须跟情绪对上**，别乱发）：');
    lines.push(...guide);
  }

  lines.push('');
  lines.push(`注意：
- 这是短时的情绪。**别把它说成"我对你的感觉"** —— 那是好感度，是两回事
- 别报数字、别念百分比。你只是碰巧心情是这样
- 情绪会变：他哄你、或者说了别的，下一轮就该跟着变，别一直卡在同一个情绪上
- 心情不好的时候**不要硬卖萌**（心情差还"好呀~"就假了）`);
  return lines.join('\n');
}

/** 每种情绪对应的表达方式（要具体到"发什么表情"） */
const EXPRESS = {
  joy: '消息变长、感叹号和波浪号变多，可以连发；表情用 😄🥰😆✨🎉 这类；颜文字可以用 (๑˃̵ᴗ˂̵)و ヽ(✿ﾟ▽ﾟ)ノ',
  anger: '句子变短、用句号收尾；**不要发表情和颜文字**，最多一个 😤 或 💢；心情很差时连这个都别发',
  sad: '句子短但软、省略号变多、会欲言又止；表情最多一个 🥺😔，颜文字用 (｡•́︿•̀｡) 这种低落的',
  love: '语气软下来、会突然说一句粘人的话；表情用 💗🥺😳💞；颜文字用 (///▽///) (´,,•ω•,,)',
  jealous: '会拐着弯打探、带点刺；表情用 😤🙄😒；颜文字用 (￣へ￣) ˋ▽ˊ',
  anxious: '会连着问、担心他；表情用 🥺😰，别用太欢快的',
  shy: '会躲、会答非所问、会用"…"；表情用 😳☺️🙈；颜文字用 (*/ω＼*) (〃▽〃)',
  tired: '话变少、有点敷衍、会说自己累；表情最多一个 😩😪，别硬撑可爱',
};

/** 给界面用的一行文字："生气 8%　难过 5%" */
export function moodText(mood) {
  const top = topMoods(mood);
  if (!top.length) return '';
  return top.map((m) => `${m.label} ${m.value}%`).join('　');
}

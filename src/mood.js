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

export function parseMoodBlock(text) {
  const s = String(text || '');
  const re = /\[\[情绪\]\]\s*(\{[\s\S]*?\})\s*$/;

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

export function moodBlock(mood) {
  const top = topMoods(mood, MAX_SHOWN);
  if (!top.length) return '';

  const lines = ['【你此刻的心情】（这是**这一会儿**的情绪，不是你对他的整体感觉）'];
  lines.push(top.map((m) => `${m.label} ${m.value}%`).join('　'));
  lines.push('');

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

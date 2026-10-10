import { decayFacts, newMeta } from './memory.js';
import { upgradeModel } from './api.js';

/** localStorage 的三个 key（也是导出/导入的版本号） */
export const CFG_KEY = 'xiaoyu.config.v1';
export const CHAT_KEY = 'xiaoyu.chat.v1';
export const PROFILE_KEY = 'xiaoyu.profile.v1';

export const GLOBAL_KEY = 'xiaoyu.global.v1';

/** 哪些字段是全局的 */
export const GLOBAL_FIELDS = [

  'apiKey', 'provider', 'model', 'endpoint',

  'userName', 'myEmoji', 'myAvatar', 'myJob', 'myAge', 'myGender', 'myBirthday',

  'clockOffset',
];

/** 浏览器 localStorage 大约 5MB。用来算"还剩多少"，不保证精确 */
export const QUOTA_BYTES = 5 * 1024 * 1024;

/** 从 localStorage 读一个 JSON。坏数据 / 不存在都当成 fallback，不抛错 */
export function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** 写一个 JSON。坏数据不抛错，只返回失败 */
export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function pickGlobal(config) {

  const src = config && typeof config === 'object' ? config : {};
  const out = {};
  for (const k of GLOBAL_FIELDS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

export function readGlobal(legacy = {}) {
  const saved = readJSON(GLOBAL_KEY, null);
  if (saved && typeof saved === 'object') return pickGlobal(saved);
  const seed = pickGlobal(legacy);
  if (Object.keys(seed).length) writeJSON(GLOBAL_KEY, seed);
  return seed;
}

/** 写全局设置（只覆盖那几项，不动别的） */
export function writeGlobal(patch = {}) {
  const cur = readJSON(GLOBAL_KEY, {}) || {};
  return writeJSON(GLOBAL_KEY, { ...cur, ...pickGlobal(patch) });
}

export function omitGlobal(config = {}) {
  const out = { ...config };
  for (const k of GLOBAL_FIELDS) delete out[k];
  return out;
}

/** 缺字段就补默认值（老版本存下来的数据没有新字段） */
export function fillDefaults(obj, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    const cur = obj[k];
    const wantArray = Array.isArray(v);
    if (wantArray && !Array.isArray(cur)) obj[k] = [];
    else if (typeof v === 'object' && !wantArray) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) obj[k] = { ...v };
    } else if (typeof cur !== typeof v) obj[k] = v;
  }
  return obj;
}

export function fixConfigShape(config, onUpgraded = () => {}) {
  fillDefaults(config, { herTraits: [], personaDone: false });
  if (config.herGender !== 'm') config.herGender = 'f';

  if (config.provider !== 'deepseek' && !/^deepseek-/i.test(config.model || '')) return config;

  const fixed = upgradeModel(config.model);
  if (fixed !== config.model) {
    config.model = fixed;
    onUpgraded();
  }
  return config;
}

export function fixProfileShape(profile, messages = []) {
  fillDefaults(profile, {
    facts: [], summary: [], factsManual: [], summaryManual: [],
    factsMeta: {}, faded: [], bioFacts: [],
    sceneCustom: false,
    msgCount: messages.length,
  });

  profile.affection = sanitizeAffection(profile.affection);
  profile.affectionBase = sanitizeAffection(profile.affectionBase);
  return profile;
}

export function sanitizeAffection(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** 整个 localStorage 用掉多少字节（UTF-16 所以 ×2） */
export function storageUsed() {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += (String(k).length + String(localStorage.getItem(k) || '').length) * 2;
    }
  } catch {}
  return n;
}

/** 聊天记录占多少字节 */
export function historyBytes(messages) {
  try { return JSON.stringify(messages).length * 2; } catch { return 0; }
}

export function writeChat({ messages, key = CHAT_KEY }) {
  const list = Array.isArray(messages) ? messages : [];
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return { ok: true, kept: list, dropped: 0 };
  } catch {}

  let lo = 0;
  let hi = list.length;
  let kept = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const slice = list.slice(list.length - mid);
    try {
      localStorage.setItem(key, JSON.stringify(slice));
      kept = slice;
      hi = mid - 1;
    } catch {
      lo = mid + 1;
    }
  }

  if (!kept) return { ok: false, kept: null, dropped: list.length };
  return { ok: true, kept, dropped: list.length - kept.length };
}

/** 存储满了要告诉他的话（界面 toast + 聊天区里留一条系统消息） */
export function quotaWarning(dropped, keptCount) {
  const mb = (QUOTA_BYTES / 1024 / 1024).toFixed(0);
  return {
    toast: `⚠️ 手机本地存储快满了（上限约 ${mb}MB）：为了能继续聊，`
      + `最早 ${dropped} 条记录没能存下来（现在保留最近 ${keptCount} 条）。`
      + `建议到「她记得的事」里导出一份备份，然后清空重来。`,
    sys: `⚠️ 本地存储满了：最早 ${dropped} 条记录没能保存。`
      + `去 ··· → 🧠 她记得的事 导出备份，再考虑清空。`,
  };
}

/** 写档案（记忆、场景、好感度都在这里） */
export function writeProfile(profile, json, key = PROFILE_KEY) {
  try { localStorage.setItem(key, JSON.stringify(json || profile)); return true; } catch { return false; }
}

/** 写配置 */
export function writeConfig(config, key = CFG_KEY) {
  try { localStorage.setItem(key, JSON.stringify(config)); return true; } catch { return false; }
}

export function removeKeys(keys = []) {
  let n = 0;
  for (const k of keys) {
    if (!k) continue;
    try { localStorage.removeItem(k); n++; } catch {}
  }
  return n;
}

export function decayProfileFacts(profile, t) {
  const dm = decayFacts(profile.facts || [], profile.factsMeta || {}, t);
  if (dm.forgotten.length) {
    profile.faded = [...(profile.faded || []), ...dm.forgotten].slice(-40);
  }
  profile.facts = dm.kept;
  profile.factsMeta = dm.meta;
}

/** 手动加的条目永远留着、置顶，并且标成"钉住"（永久记忆） */
export function hoistManualEntries(profile, t) {
  const KEYS = [
    { all: 'facts', manual: 'factsManual', keep: 60 },
    { all: 'summary', manual: 'summaryManual', keep: 100 },
  ];
  for (const { all, manual, keep } of KEYS) {
    const man = Array.isArray(profile[manual]) ? profile[manual].slice(-30) : [];
    profile[manual] = man;
    const auto = (profile[all] || []).filter((x) => !man.includes(x));

    profile[all] = [...new Set([...man, ...auto.slice(-keep)])];
  }
  for (const f of profile.factsManual || []) {
    profile.factsMeta[f] = { ...(profile.factsMeta[f] || newMeta(t)), pinned: true };
  }
}

/** 只给还活着的条目留元数据，别让 factsMeta 无限长大 */
export function pruneFactsMeta(profile) {
  const alive = new Set([...(profile.facts || []), ...(profile.summary || [])]);
  for (const k of Object.keys(profile.factsMeta || {})) {
    if (!alive.has(k)) delete profile.factsMeta[k];
  }
}

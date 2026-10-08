/**
 * 存储层 —— localStorage 的三个抽屉，以及"存之前要先整理一遍"的那些规矩。
 *
 * 为什么单独一个模块：
 *   这块逻辑原来埋在 app.js 里（读、写、老数据补字段、配额满了怎么办、
 *   记忆的淘汰与钉住），跟界面代码混在一起。它是**唯一碰磁盘的地方**，
 *   单独放一处之后，"数据长什么样、写下去之前会被怎么改"一眼能看全。
 *
 * 这个模块**不碰 DOM、不碰全局 state** ——
 * 要操作哪个对象、用哪个"现在"，都由调用方传进来。
 * 好处是它可测、可复用，也不会和 app.js 纠缠成循环依赖。
 *
 * ⚠️ 一个必须守住的约定：**只做原地修改（Object.assign），不许替换对象**。
 * app.js 里 `state.config` / `state.profile` 的引用是长期持有的，
 * 一旦这里 `state.config = {...}`，界面上拿到的还是旧那个对象。
 */

import { decayFacts, newMeta } from './memory.js';
import { upgradeModel } from './api.js';

/** localStorage 的三个 key（也是导出/导入的版本号） */
export const CFG_KEY = 'xiaoyu.config.v1';
export const CHAT_KEY = 'xiaoyu.chat.v1';
export const PROFILE_KEY = 'xiaoyu.profile.v1';

/**
 * 「全局设置」单独一个 key —— **所有好友共用一份**。
 *
 * 为什么要分两种"全局"（用户连问了两个问题：
 *   "重新开一个好友，需要另外的 API 吗，不能用一个吗"
 *   "为什么新建好友后，我的以前预设的自己的信息为什么没了"）：
 *
 *   1. **部署级**：Key / 模型 / 接口 —— "这个部署连哪个模型"，跟她是谁都无关
 *   2. **用户级**：我的名字 / 头像 / 职业 / 性别 / 年龄 / 生日（见 me.js）——
 *      用户在「我」里填一次，**所有好友都该看到同一份**
 *
 *   这两种以前都存在**每个好友各自的 config** 里（新建好友时那份 config
 *   从空白开始）→ 每加一个好友都要重填 Key、连"我是谁"都被清掉了。
 *   现在都收在这一份里，好友自己的 config 只管人设/关系/回复风格。
 */
export const GLOBAL_KEY = 'xiaoyu.global.v1';

/** 哪些字段是全局的 */
export const GLOBAL_FIELDS = [
  // 部署级：连哪个模型
  'apiKey', 'provider', 'model', 'endpoint',
  // 用户级：「我」的资料（所有好友看到的是同一个人）
  'userName', 'myEmoji', 'myAvatar', 'myJob', 'myAge', 'myGender', 'myBirthday',
];

/** 浏览器 localStorage 大约 5MB。用来算"还剩多少"，不保证精确 */
export const QUOTA_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- 读

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

/**
 * 把 config 里那几项**全局字段**摘出来（Key / 模型 / 接口）。
 * 只取存在的键，不补默认值 —— 没设过就别往全局里写空值。
 */
export function pickGlobal(config = {}) {
  const out = {};
  for (const k of GLOBAL_FIELDS) {
    if (config[k] !== undefined) out[k] = config[k];
  }
  return out;
}

/**
 * 读全局设置，并把老数据迁进来。
 *
 * 老用户的 Key 还在**某个好友**的 config 里（那时候还没有全局这一说）：
 * 全局是空的话，就拿传入的这份 config 当种子写一次 ——
 * 于是"他升级之后 Key 还在"，而新加的好友也能直接用同一个 Key。
 *
 * @param {object} [legacy] 当前好友的 config（迁移用）
 * @returns {object} 全局字段
 */
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

/**
 * 反过来：把全局字段从一份 config 里剔掉。
 *
 * 存**好友自己的** config 时用它 —— Key 只留全局那一份，
 * 别再散在 N 个好友的配置里（改一次要对 N 处负责，迟早不一致）。
 * 内存里的 state.config 仍然带着这几项，界面照常用。
 */
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

/**
 * 把存下来的东西恢复成一个能用的 state.config。
 *
 * 注意是**原地合并**（Object.assign），不能替换对象：见文件顶部那条约定。
 * 老配置升级后需要落盘时，由调用方通过 onUpgraded 回调决定（这里不写盘）。
 */
export function fixConfigShape(config, onUpgraded = () => {}) {
  fillDefaults(config, { herTraits: [], personaDone: false });
  if (config.herGender !== 'm') config.herGender = 'f';

  // 老配置升级：DeepSeek 已经下线 deepseek-chat / deepseek-reasoner，
  // 不换过来的话一开口就报错（用户看到的就是「API 坏了」）。
  if (config.provider !== 'deepseek' && !/^deepseek-/i.test(config.model || '')) return config;

  const fixed = upgradeModel(config.model);
  if (fixed !== config.model) {
    config.model = fixed;
    onUpgraded();
  }
  return config;
}

/**
 * 档案里那些"老数据没有、要补上"的字段。
 *
 * ⚠️ 好感度**不能写进 fillDefaults 的默认表**：那张表按"类型不一致就覆盖"工作，
 * 而"没设过"的默认值只能是 null —— null 和数字类型不同，会把用户设过的
 * 62 直接覆盖成 null（踩过一次，test-persona 的 [6] 一节当场变红）。
 * 所以它单独走 sanitizeAffection：只有真的缺/坏了才变成 null。
 */
export function fixProfileShape(profile, messages = []) {
  fillDefaults(profile, {
    facts: [], summary: [], factsManual: [], summaryManual: [],
    factsMeta: {}, faded: [], bioFacts: [],
    sceneCustom: false,
    msgCount: messages.length,
  });
  // 好感度没设过就是 null（不是 0）——0 会被当成"她讨厌你"，那是两回事
  profile.affection = sanitizeAffection(profile.affection);
  profile.affectionBase = sanitizeAffection(profile.affectionBase);
  return profile;
}

/**
 * 存下来的好感度只做范围校验，**不取整** ——
 * 取整会把"每句涨 0.4"的进度抹掉，越聊越不涨。
 *
 * null / undefined / '' 要单独挡掉：Number(null) === 0，
 * 不挡的话"没设过"会被读成"好感度 0（她讨厌你）"。
 */
export function sanitizeAffection(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------- 占用

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

// ---------------------------------------------------------------- 写

/**
 * 写聊天记录。storage 满的时候会**尽量少砍**，而不是闷声砍掉四分之一。
 *
 * 老写法是失败就砍掉最早的四分之一 —— 用户导入一大批记录后会看到
 * "导入成功了但记录没了"，非常坑。现在二分找到"砍到多少条才存得下"。
 *
 * @param {object} p
 * @param {Array}  p.messages    要存的记录
 * @returns {{ok:boolean, kept:Array, dropped:number}}
 *          ok=false 表示一条都没存下（多半是头像图片太大）
 */
export function writeChat({ messages, key = CHAT_KEY }) {
  const list = Array.isArray(messages) ? messages : [];
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return { ok: true, kept: list, dropped: 0 };
  } catch {}

  // 二分找"砍到多少条才存得下"，尽量少砍
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

// ---------------------------------------------------------------- 存盘前的整理

/**
 * 按遗忘曲线淘汰：反复提到的留下，说过一次的小事慢慢淡掉。
 * 淘汰掉的不直接丢，挪进 faded（记忆页里能看到"她淡忘了什么"）。
 */
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
    // 去重：手动和自动可能撞车
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

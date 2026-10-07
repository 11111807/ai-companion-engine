/**
 * 微信风格的 AI 陪聊 · 主程序
 *
 * 三个关键机制：
 * 1. 连发：把模型一次生成的内容拆成几条短消息，逐条带"正在输入"发出来
 * 2. 记忆：从对话里提取关于用户的事实，跨会话保留，让她"记得你"
 * 3. 情绪：不解决问题、不讲道理，靠人格设定 + 互动节奏实现
 */

import {
  CHARACTER,
  buildSystemPrompt,
  memoryBlock,
  greeting,
  pickScene,
  evolveScene,
  describeTime,
  sceneHint,
  intimacyStage,
  HISTORY_LIMIT,
  futureHint,
  SCENES,
  SCENES_GENERIC,
  TRAIT_PRESETS,
} from './persona.js';
import { SIGNS, parseBirthday, birthdayText, signSummary } from './zodiac.js';
import {
  levelOf, clamp as clampAffection, drift as affectionDrift,
  decayForGap, affectionPercent, affectionSummary,
  suggestFromTraits, traitAffectionWarning,
} from './affection.js';
import {
  RELATIONS, RELATION_NAMES, findRelation, defaultAffectionFor, relationViewText,
  relationAffectionWarning, detectRelationSignal, relationMatches,
  relationTipText, relationShiftHint,
} from './relation.js';
import { streamChat, DEFAULT_ENDPOINT, DEFAULT_MODEL, isLocalEndpoint, upgradeModel } from './api.js';
import { PROVIDERS, getProvider, detectProvider, isLocalProvider } from './providers.js';
import { habitsBlock } from './habits.js';
import { newMeta, isPermanent, isObsession, strengthLabel, strengthPercent, OBSESSION_EMO } from './memory.js';
import { intensityOf, intensityLabel } from './emotion.js';
import { esc, isEmojiOnly, timeText as formatTimeText, gapText } from './format.js';
import {
  CFG_KEY, CHAT_KEY, PROFILE_KEY, QUOTA_BYTES,
  readJSON, writeJSON, fillDefaults, fixConfigShape, fixProfileShape, sanitizeAffection,
  storageUsed, historyBytes, writeChat, quotaWarning, writeProfile, writeConfig,
  decayProfileFacts, hoistManualEntries, pruneFactsMeta,
} from './storage.js';
import {
  PERSONA_PRESETS, findPreset, presetToForm,
} from './presets.js';
import { ME_DEFAULTS, readMe, applyMe, meSummary } from './me.js';
import { createFriendUI } from './friend-ui.js';
import {
  PERSONAS_KEY, DEFAULT_ID,
  migrate, keysFor, activeKeys, orderedList, byRecency, findPersona,
  addPersona, removePersona, setActive, patchPersona, noteActivity, clearUnread,
} from './personas.js';
import {
  BIO_MAX_POINTS, parseMemoryBlock, applyMemory as applyMemoryTo, toggleObsession as toggleObsessionIn,
  parseBioPoints, applyUserBio as applyUserBioTo,
  summarizeConversation, resetRecallIndex, recallOldMessages as recallOld,
  recallBlock as recallBlockOf, parseHistoryText as parseHistory, normalizeTimestamps as stampImported,
  mergeFacts,
} from './memory-io.js';
import { SEARCH_MAX_HITS, searchMessages as searchIn, snippetOf } from './search.js';
import { APK_URL } from './config.js';

// APK 环境才有 native.js（网页版部署包里没有这个文件），
// 所以用动态 import 并且允许失败——否则网页版一加载就报错。
// 注意不能用顶层 await：测试环境通过 eval 载入，不支持顶层 await。
//
// 另外加超时保护：万一某个原生调用挂住，不能让它把整个 UI 卡在"未配置"状态。
let native = null;
let nativeReady = false;

/** 轻量原生判断：只读 Capacitor.isNativePlatform()，不碰 Plugins（会挂起） */
function isNativePlatformLite() {
  try {
    return !!(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

// 关键：在原生环境里立刻判定"手机本地模型可用"，
// 不等动态 import 完成。
// 之前是等 import 成功才置 true，一旦 import 慢或失败，
// "📱 手机本地模型"就永远不出现在下拉里，用户完全找不到这个功能。
// 真正的可用性在调用时（loadLocalModel/localCompletion）会再校验一次。
if (isNativePlatformLite()) nativeReady = true;

const nativeReadyPromise = (async () => {
  try {
    const mod = await Promise.race([
      import('./native.js'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('native.js 载入超时')), 8000)),
    ]);
    if (mod) native = mod;
  } catch {
    native = null;
  }
  return nativeReady;
})();

/** 当前可用的服务商：手机本地模型只在 APK 里出现 */
function availableProviders() {
  return PROVIDERS.filter((p) => !p.native || nativeReady);
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/**
 * 内置时钟 —— 她感知的"现在"。
 *
 * 不跟现实世界绑定：等于「现在的真实时间 + 你设的偏移」。
 * 这样你可以在输入栏的「+」里把时间往前拨：
 * 比如看一场两小时的电影，点一下「+2 小时」，
 * 她就真的觉得过了两小时，而不是还没看完你就回来了。
 * 偏移是持久化的，关掉再打开还在。
 */
const now = () => Date.now() + (Number(state.config.clockOffset) || 0);

/** 时钟偏移换算成人话（用于界面提示） */
function clockOffsetText() {
  const min = Math.round((Number(state.config.clockOffset) || 0) / 60000);
  if (!min) return '';
  const sign = min > 0 ? '+' : '−';
  const a = Math.abs(min);
  if (a < 60) return `${sign}${a} 分钟`;
  if (a < 60 * 24) {
    const h = Math.floor(a / 60);
    const m = a % 60;
    return `${sign}${h} 小时${m ? ` ${m} 分` : ''}`;
  }
  const d = Math.floor(a / 1440);
  const h = Math.floor((a % 1440) / 60);
  return `${sign}${d} 天${h ? ` ${h} 小时` : ''}`;
}

/** 把时钟状态画到「+」面板里 */
function renderClock() {
  const el = $('#clockNow');
  if (!el) return;
  const d = new Date(now());
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  el.textContent = `${d.getMonth() + 1}/${d.getDate()} ${weeks[d.getDay()]} ${hh}:${mm}`;

  const note = $('#clockNote');
  if (note) {
    const off = clockOffsetText();
    note.textContent = off
      ? `已经往前拨了 ${off}。跳过去之后，她会觉得真的过了这么久。`
      : '时间是内置的，不跟现实走。看场两小时的电影就点「+2 小时」；想跳到某一天，直接点上面的时间自己选。';
  }
  syncClockPicker();
}

/** 时间戳 → datetime-local 要的 "YYYY-MM-DDTHH:MM"（本地时区） */
function toClockInputValue(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 把「她那边的现在」写进日期时间输入框（正在选的时候别打断他） */
function syncClockPicker() {
  const el = $('#clockPick');
  if (!el || document.activeElement === el) return;
  el.value = toClockInputValue(now());
}

/**
 * 时间跳了之后的收尾。
 *
 * ⚠️ 这里**不能同步调 renderChat()** —— 那会重画整页气泡，
 * 消息一多按钮就有明显延迟（用户反馈"改变时间的按钮延迟过高"）。
 * 现在只做两件便宜的事：刷新时钟显示、把时间分隔条的文字改一下
 * （分隔条是相对时间，"3 小时前"跳一天就变成"昨天"了）。
 */
function applyTimeJump() {
  renderClock();
  refreshTimeDividers();
  // 时间一跳，场景很可能得跟着变（晚上 → 第二天早上）
  ensureScene();
  const off = clockOffsetText();
  toast(off ? `时间已拨到 ${off}` : '时间已回到现在', 1800);
}

/** 只改时间分隔条的文字，不重画气泡（便宜得多） */
function refreshTimeDividers() {
  for (const el of $$('#messages .wx-time[data-ts]')) {
    el.textContent = timeText(Number(el.dataset.ts));
  }
}

/** 调整内置时钟（单位：分钟；传 'reset' 归零） */
function shiftClock(minutes) {
  if (minutes === 'reset') {
    state.config.clockOffset = 0;
  } else {
    const m = Number(minutes) || 0;
    state.config.clockOffset = (Number(state.config.clockOffset) || 0) + m * 60000;
  }
  saveConfig();
  applyTimeJump();
}

/** 直接把「她那边的现在」设成某个时间点（日期时间选择器用） */
function setClockTo(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t)) return;
  state.config.clockOffset = t - Date.now();
  saveConfig();
  applyTimeJump();
}

// ---------------------------------------------------------------- 状态

const state = {
  config: {
    apiKey: '',
    provider: 'deepseek',
    model: DEFAULT_MODEL,
    endpoint: DEFAULT_ENDPOINT,
    maxTokens: 250,
    burst: 3,
    temperature: 1.0,
    thinking: false,   // 深度思考：默认关（陪聊要快），开了她会先想清楚再回
    autoSpeak: true,   // 你不出声时，她会主动找你说两句
    clockOffset: 0,    // 内置时钟偏移（毫秒）：可以在「+」里把时间往前拨
    userName: '',
    // ---- 人设（「开始之前」那一页设的） ----
    herGender: 'f',        // 'f' 她 / 'm' 他
    herAge: 0,             // 0 = 没设，走默认 20 岁
    herJob: '',            // 职业
    herRelation: '',       // 她和你的关系（同学 / 同事 / 网友…）
    herBirthday: '',       // 'M-D'，由它推出星座
    herTraits: [],         // 性格标签
    herTraitNote: '',      // 自己补的性格描述
    userBio: '',           // 他（用户）的大致生平，会拆成永久记忆
    personaDone: false,    // 走过「开始之前」没有
    // ---- 我自己的资料（全局：所有好友共用一份，见 src/me.js） ----
    myJob: '',             // 我的职业/专业（她据此判断是不是同行）
    myAge: 0,
    myGender: '',          // 'm' / 'f' / ''
    myBirthday: '',        // 'M-D'
  },
  messages: [],      // { role, content, ts }
  profile: {         // 跨会话记忆
    name: '',
    facts: [],
    lastMood: '',
    sessions: 0,
    sceneId: null,   // 本次会话固定的场景
    sceneText: '',
    sceneCustom: false, // 初始环境是用户自己写的 → 不按时间乱换
    summary: [],     // 更早对话的要点（长期记忆）
    msgCount: 0,     // 累计消息数（用于亲密度估算）
    affection: null,     // 好感度 0..100。null = 没设过（老用户），退回按聊天量估算
    affectionBase: null, // 初始好感度，用来告诉她"这个数字是会动的"
  },
  generating: false,
  abort: null,
  typingNode: null,
  // 多好友索引：{ list, order, active }。当前好友的 config/messages/profile
  // 就在上面这三个字段里 —— loadPersona() 负责按 active 换掉它们。
  nav: null,
};

// ================================================================
// ================================================================
//  好友界面
//
//  消息页 / 好友页 / 我 / 加好友 / 我的资料都在 src/friend-ui.js。
//  它是唯一一个"界面模块持有 app.js 依赖"的地方（用工厂模式），
//  因为这一块需要的状态和函数太多，硬做成参数传入会让调用点没法看。
// ================================================================

/** 我自己的资料（全局，所有好友共用一份） */
const myMe = () => readMe(state.config);

let friendUI = null;

function initFriendUI() {
  friendUI = createFriendUI({
    state, $, $$, esc, timeText,
    CHARACTER, PERSONA_PRESETS, findPreset, presetToForm,
    keysFor, findPersona, orderedList, byRecency,
    addPersona, setActive, patchPersona, clearUnread,
    readJSON, saveConfig, saveProfile, saveChat, savePersonaIndex,
    fixProfileShape, fixConfigShape, loadPersona, now,
    renderHerIdentity, renderAffection, renderClock, renderChat,
    openPersona, openSettings, openMenu, toast,
    nearestAffPreset, defaultAffectionFor,
    // 「我」那一页
    readMe, applyMe, meSummary,
    herName, herEmoji, parseBirthday,
    setSegOn, segOn, renderAvatarPreview, onSeg,
    pickAvatarForMe: () => {
      avatarTarget = 'me';
      renderChips('#avatarEmojiList', MY_EMOJIS, (v) => v === myEmoji());
      $('#avatarPanelTitle').textContent = '给你自己选一个头像';
      $('#avatarPanel').hidden = false;
      requestAnimationFrame(() => $('#avatarPanel').classList.add('show'));
    },
  });
}

// 薄封装：别处按老名字调用就行（它们原来就是 app.js 里的函数）
const switchPersona = (id) => friendUI.switchPersona(id);
const openChat = (id) => friendUI.openChat(id);
const closeChat = () => friendUI.closeChat();
const showTab = (tab) => friendUI.showTab(tab);
const renderNav = () => friendUI.renderNav();
const renderMsgList = () => friendUI.renderMsgList();
const renderMe = () => friendUI.renderMe();
const refreshUnreadDot = () => friendUI.refreshUnreadDot();
const bindHome = () => friendUI.bindHome();
const renderMoodStrip = () => {};   // 旁白/情绪那一块还没做，后面几步会填

// ---------------------------------------------------------------- 存储
//
// 真正碰 localStorage 的代码全在 src/storage.js 里（读、写、老数据补字段、
// 配额满了怎么办、记忆的淘汰与钉住）。这里只留三个薄封装：
// 把 state、虚拟时钟和界面回调喂进去。
//
// 为什么这么切：那是**唯一碰磁盘的地方**，和界面代码混在一起的时候，
// "数据长什么样、写下去之前会被怎么改"很难一眼看全。

// ---------------------------------------------------------------- 多好友
//
// 以前只有一个人格，三个 key 平铺。现在支持多个好友，但**默认好友
// （id='default'，就是小雨）继续用那三个老 key** —— 老用户零迁移、
// 老行为不动，多好友是纯增量。这个"特例"收在 src/personas.js 的 keysFor() 里，
// 下面这几个薄封装只是把 nav 传进去。

function loadNav() {
  const legacy = readJSON(CFG_KEY, null) || readJSON(CHAT_KEY, null) || readJSON(PROFILE_KEY, null);
  const { nav, migrated } = migrate(readJSON(PERSONAS_KEY, null), { hasLegacyData: !!legacy });
  state.nav = nav;
  if (migrated) writeJSON(PERSONAS_KEY, nav);
  return nav;
}

const saveNav = () => writeJSON(PERSONAS_KEY, state.nav);
/** 当前好友的存储键（默认好友=老 key，其他好友=自己的命名空间） */
const navKeys = () => activeKeys(state.nav);
/** 当前好友在列表里的那条记录 */
const mePersona = () => findPersona(state.nav, state.nav.active) || findPersona(state.nav, DEFAULT_ID);

/**
 * 把某个好友的存档读进 state（config / messages / profile 三件套）。
 *
 * ⚠️ 必须是**原地合并**（Object.assign / 改属性），不能 `state.profile = {...}`：
 * 界面代码长期持有这三个对象的引用，一换对象它拿到的就还是旧的那个。
 */
function loadPersona(id) {
  const k = keysFor(id);
  Object.assign(state.config, readJSON(k.config, {}));
  const chat = readJSON(k.chat, []);
  // 完整保留历史（用户希望能回看过去聊了什么）。
  // 给模型看多少由 buildChatContext 按 token 预算决定，不在这里砍。
  state.messages = Array.isArray(chat) ? chat : [];

  const prof = readJSON(k.profile, {});
  for (const key of Object.keys(state.profile)) delete state.profile[key];
  Object.assign(state.profile, prof);
  fixProfileShape(state.profile, state.messages);
  fixConfigShape(state.config, saveConfig);
}

function loadLocal() {
  loadNav();
  loadPersona(state.nav.active);
}

function saveConfig() {
  writeConfig(state.config, navKeys().config);
}

/** 配额满了：尽量少砍，并且把砍了多少明确告诉他（别闷声丢记录） */
function saveChat() {
  const r = writeChat({ messages: state.messages, key: navKeys().chat });
  if (!r.ok) {
    // 一条都存不下（多半是头像图片太大）
    toast('本地存储满了：连一条记录都存不下。去设置里换个小头像，或者清空聊天记录。', 5200);
    return;
  }
  state.messages = r.kept;
  if (!r.dropped) return;
  const w = quotaWarning(r.dropped, r.kept.length);
  toast(w.toast, 6000);
  appendSys(w.sys);
}

/**
 * 写档案。**每次存盘前都要先按遗忘曲线整理一遍**：
 *   1. 按遗忘曲线淘汰（反复提到的留下，说过一次的小事慢慢淡掉）
 *   2. 手动加的条目永远留着、置顶、标成"钉住"
 *   3. 清掉已经不在表里的元数据
 *
 * 顺序不能换：先淘汰再置顶，否则手动条目会被当成"最近没提到"删掉。
 */
function saveProfile() {
  const t = now();
  decayProfileFacts(state.profile, t);
  hoistManualEntries(state.profile, t);
  pruneFactsMeta(state.profile);
  writeProfile(state.profile, state.profile, navKeys().profile);
}

/** 存好友索引（列表、顺序、当前是谁） */
const savePersonaIndex = () => writeJSON(PERSONAS_KEY, state.nav);

/**
 * 场景随时间自然演变。
 *
 * 规则（解决"跨天不演变"和"场景乱跳"这两个矛盾的需求）：
 * - 3 小时内接着聊 → 场景完全不变
 * - 隔久了（跨小时/跨天）→ 按新时间选，但**优先同一地点**
 *   （昨晚宿舍床上 → 今早宿舍醒来，很自然）
 * - 只有同地点确实没合适场景时，才换到别处
 *
 * @param {boolean} force 强制重选（"换个场景"按钮用）
 */
function ensureScene(force = false) {
  const t = now();
  const pool = scenePool();

  // 初始环境是用户自己在人设页里写/选的 → 就以那个为准，不要按时间乱换地方。
  // （他还是能点「换个场景」强制换）
  if (state.profile.sceneCustom && !force) return;

  if (force) {
    const s = pickScene(new Date(t), pool);
    state.profile.sceneId = s.id;
    state.profile.sceneText = s.text;
    state.profile.sceneAt = t;
    state.profile.sceneCustom = false;
    saveProfile();
    return;
  }

  // 第一次：直接选一个
  if (!state.profile.sceneId) {
    const s = pickScene(new Date(t), pool);
    state.profile.sceneId = s.id;
    state.profile.sceneText = s.text;
    state.profile.sceneAt = t;
    saveProfile();
    return;
  }

  // 之后：根据距上次聊天的时间演变
  const { scene, changed } = evolveScene(
    state.profile.sceneId,
    state.profile.sceneAt || state.profile.lastChatAt || null,
    t,
    pool
  );
  if (changed || scene.id !== state.profile.sceneId) {
    state.profile.sceneId = scene.id;
    state.profile.sceneText = scene.text;
    state.profile.sceneAt = t;
    saveProfile();
  }
}

const currentScene = () => ({ id: state.profile.sceneId, text: state.profile.sceneText });

/** 当前时间描述（让她有时间观念） */
const currentTimeText = () =>
  describeTime(now(), state.profile.lastChatAt || null);

/**
 * 能不能开始聊：
 * 云端服务需要 key；本地模型不需要 key，只要能连上就行。
 */
const hasKey = () => {
  const p = getProvider(state.config.provider);
  if (p.local) return true;
  return !!state.config.apiKey?.trim();
};

/** 真的还没有可用的凭据（用于决定要不要弹设置页） */
const needsSetup = () => {
  const p = getProvider(state.config.provider);
  if (p.local) return false;
  return !state.config.apiKey?.trim();
};

// ---------------------------------------------------------------- 工具

function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, ms);
}

const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch {} };

// esc / isEmojiOnly / gapText 都是纯函数，住在 src/format.js（顶部已 import）。
// timeText 要拿**虚拟时间**算"今天/昨天"，所以在这儿包一层把 now() 喂进去。
const timeText = (ts) => formatTimeText(ts, now());

/** 她的名字（可自定义） */
const herName = () => (state.config.herName?.trim() || CHARACTER.name);
/** 她的头像 emoji（可自定义） */
const herEmoji = () => (state.config.herEmoji || CHARACTER.emoji);
/** 她的头像图片（base64 dataURL，可选；设了就用图片） */
const herAvatarPic = () => state.config.herAvatar || null;

// ---------------------------------------------------------------- 人设

/** 她是"她"还是"他"（人设页里选的性别） */
const isMale = () => state.config.herGender === 'm';
/** 第三人称代词：她 / 他 */
const ta = () => (isMale() ? '他' : '她');

/**
 * 用户到底设没设过人设。
 *
 * 只要动过一项就算设过（性别、年龄、职业、生日、性格、关系…），
 * 因为一旦设过，提示词里那些写死的"20 岁大二女大学生 / 住宿舍"就不能再用了。
 */
function personaIsCustom() {
  const c = state.config;
  const age = Number(c.herAge) || 0;
  return !!(c.herGender === 'm' || (age && age !== CHARACTER.age) ||
    String(c.herJob || '').trim() ||
    String(c.herRelation || '').trim() ||
    String(c.herBirthday || '').trim() ||
    (Array.isArray(c.herTraits) && c.herTraits.length) ||
    String(c.herTraitNote || '').trim());
}

/** 组装给提示词用的人设对象 */
function personaForPrompt() {
  const c = state.config;
  const bd = parseBirthday(c.herBirthday || '');
  return {
    gender: isMale() ? 'm' : 'f',
    age: Number(c.herAge) || CHARACTER.age,
    job: String(c.herJob || '').trim(),
    // 他的职业/专业：她据此判断"是不是同行"——同行能聊专业，不同行只聊自己那摊
    userJob: String(c.userJob || '').trim(),
    birthday: bd || null,
    traits: Array.isArray(c.herTraits) ? c.herTraits : [],
    traitNote: String(c.herTraitNote || '').trim(),
    custom: personaIsCustom(),
  };
}

/** 场景池：设过人设的用通用池，否则用学生池 */
const scenePool = () => (personaIsCustom() ? SCENES_GENERIC : SCENES);

/** 当前好感度（可能为 null = 没设过）。注意是浮点：普通聊天每句只涨 0.4 */
const affection = () => (state.profile.affection == null ? null : state.profile.affection);

// sanitizeAffection 住在 src/storage.js —— "存下来的数据怎么校验"是存储层的事。

const affectionRounded = () => {
  const v = affection();
  return v == null ? null : Math.round(v);
};

/** 你的头像 emoji（可自定义） */
const myEmoji = () => state.config.myEmoji || '';
/** 你的头像图片（base64 dataURL，可选；设了就用图片） */
const myAvatarPic = () => state.config.myAvatar || null;
/** 你在她那儿显示的名字 */
const myName = () => (state.config.userName?.trim() || state.profile.name?.trim() || '他');

const herInitial = () => (herName().slice(-1) || CHARACTER.realName.slice(-1));
const myInitial = () => (state.config.userName?.trim()?.[0]) || '我';

// ---------------------------------------------------------------- 连发拆分

/**
 * 把模型生成的内容拆成"几条短消息"
 * 模型被要求用空行分隔多条，但经常只换行，所以两种都要处理。
 */
function splitMessages(text, maxBurst = 2) {
  let t = String(text || '').trim();
  if (!t) return [];

  // 去掉可能的角色名前缀（"小雨："、"新名字："）
  // 名字是可改的，所以不能再写死 —— 只认 CHARACTER.name 的话，
  // 改了名之后模型偶尔冒出的"新名字：xxx"就漏过去了。
  const nameAlt = [herName(), CHARACTER.name, CHARACTER.realName]
    .filter(Boolean)
    .map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((v, i, a) => a.indexOf(v) === i);
  t = t.replace(new RegExp(`^(?:${nameAlt.join('|')}|我)\\s*[:：]\\s*`, 'gm'), '');

  // 模型有时会把"空行"当成要输出的文字：写成【空行】/(空行)/[空行]，
  // 或者输出 "\n\n" 这种字面转义。这些还原成真正的换行，否则会露馅。
  t = t
    // 单独成行的标记 → 变成真空行（先做，因为带空格/变体多）
    .replace(/^[ \t]*(?:【|\[|\()?\s*空\s*行\s*(?:】|\]|\))?[ \t]*$/gm, '')
    // 夹在文字中间的标记 → 变成换行
    .replace(/(?:【|\[|\()\s*空\s*行\s*(?:】|\]|\))/g, '\n\n')
    .replace(/\\n/g, '\n')
    .replace(/^[ \t]*(?:【|\[|\()?\s*换\s*行\s*(?:】|\]|\))?[ \t]*$/gm, '')
    .replace(/(?:【|\[|\()\s*换\s*行\s*(?:】|\]|\))/g, '\n');

  // 优先按空行拆
  let parts = t.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);

  // 如果没有空行，按单换行拆（微信里换行通常就是新消息）
  if (parts.length === 1 && /\n/.test(parts[0])) {
    const single = parts[0].split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (single.length > 1) parts = single;
  }

  // 过滤掉纯标点的碎片
  parts = parts.filter((p) => p.replace(/[\s\p{P}]/gu, '').length > 0);
  if (!parts.length) return [];

  // 限制条数：超出的合并到最后一条，避免刷屏
  // 注意：合并要用空行而不是单换行。否则合并出来的气泡里会残留换行，
  // 下一次拆分时又会被当成多条消息处理。
  if (parts.length > maxBurst) {
    const keep = parts.slice(0, maxBurst - 1);
    keep.push(parts.slice(maxBurst - 1).join('\n\n'));
    parts = keep;
  }
  return parts;
}

// ---------------------------------------------------------------- 记忆提取
//
// 解析和落盘的实际逻辑在 src/memory-io.js（那一块的说明也写在那儿）。
// 这里只留三个薄封装：把 state 和虚拟时钟喂进去。

/** 从她的回复末尾摘掉隐藏的 `[[记忆]]{...}`，返回干净文本 + 记忆对象 */
const extractMemory = (text) => parseMemoryBlock(text);

function applyMemory(mem) {
  const r = applyMemoryTo(mem, state.profile, now());
  // 他要是还没起过名字，就用她记下来的那个
  if (r.name && !state.config.userName) state.config.userName = state.profile.name;
  saveProfile();
  saveConfig();
}

/**
 * 手动把一条记忆标成 / 取消「执念」。
 *
 * 为什么一定要有手动这一档：情绪强度是关键词猜的，猜不准的时候
 * 得让用户说了算 —— 而且"哪些事我放不下"本来就只有他自己知道。
 */
function toggleObsession(text) {
  if (!text) return;
  const becameObsession = toggleObsessionIn(state.profile, text, now());
  saveProfile();
  renderMemoryPage();
  toast(becameObsession ? '标成执念了，她永远不会忘' : '当成普通记忆了，会随时间淡', 2200);
}

// ---------------------------------------------------------------- 渲染

function avatarHTML(who) {
  if (who === 'her') {
    const pic = herAvatarPic();
    if (pic) {
      return `<div class="wx-avatar her pic" style="background-image:url(${pic})"></div>`;
    }
    return `<div class="wx-avatar her">${esc(herEmoji())}</div>`;
  }
  const pic = myAvatarPic();
  if (pic) {
    return `<div class="wx-avatar me pic" style="background-image:url(${pic})"></div>`;
  }
  const em = myEmoji();
  return `<div class="wx-avatar me">${esc(em || myInitial())}</div>`;
}

/** 时间分隔条：与上一条间隔超过 5 分钟才显示 */
function maybeTimeDivider(ts, prevTs) {
  if (prevTs && ts - prevTs < 5 * 60 * 1000) return '';
  // 记着 ts：时钟跳了之后可以只改文字，不用重画整页气泡
  return `<div class="wx-time" data-ts="${ts}">${timeText(ts)}</div>`;
}

function messageHTML(msg, prev, idx) {
  const out = msg.role === 'user';
  const emojiOnly = isEmojiOnly(msg.content);
  const cls = [
    'wx-row',
    out ? 'out' : 'in',
    msg.mid ? 'mid' : '',
  ].filter(Boolean).join(' ');
  // data-i 是它在 state.messages 里的下标。
  // 搜索命中后要"跳到那一条"，没有这个就只能靠数 DOM 节点——
  // 中间还夹着时间分隔条，数不准。
  const at = Number.isInteger(idx) ? ` data-i="${idx}"` : '';
  return `${maybeTimeDivider(msg.ts, prev?.ts)}
    <div class="${cls}"${at}>
      ${avatarHTML(out ? 'me' : 'her')}
      <div class="wx-bubble${emojiOnly ? ' emoji-only' : ''}">${esc(msg.content)}</div>
    </div>`;
}

function renderChat() {
  const box = $('#messages');
  let html = '';
  let prev = null;
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    html += messageHTML(m, prev, i);
    prev = m;
  }
  box.innerHTML = html;
  scrollToLatest(true);
}

function appendRow(msg) {
  const box = $('#messages');
  const idx = state.messages.lastIndexOf(msg);
  const prev = idx > 0 ? state.messages[idx - 1] : null;
  const wrap = document.createElement('div');
  wrap.innerHTML = messageHTML(msg, prev, idx);
  const nodes = [...wrap.children];
  for (const n of nodes) box.appendChild(n);
  return nodes.at(-1);
}

function appendError(text) {
  const d = document.createElement('div');
  d.className = 'wx-error';
  d.textContent = text;
  $('#messages').appendChild(d);
  scrollToLatest();
}

function appendSys(text) {
  const d = document.createElement('div');
  d.className = 'wx-sys';
  d.textContent = text;
  $('#messages').appendChild(d);
  scrollToLatest();
}

// ---------------------------------------------------------------- 滚动

function nearBottom(threshold = 120) {
  const box = $('#messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < threshold;
}

function scrollToLatest(force = false) {
  const box = $('#messages');
  if (force || nearBottom(400)) {
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }
}

// ---------------------------------------------------------------- 输入栏

function autoGrow() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function syncSendBtn() {
  const has = $('#input').value.trim().length > 0;
  $('#btnSend').hidden = !has || state.generating;
  $('#btnPlus').classList.toggle('off', has);
}

function closePanels() {
  $('#emojiPanel').hidden = true;
  $('#plusPanel').hidden = true;
}

const EMOJIS = [
  '😊','😂','🥺','😭','😅','🙈','😳','😌','😴','🤔','😤','😮‍💨',
  '🥰','😍','😘','🤗','😜','😏','🙃','😔','😞','😢','😠','🤯',
  '🌧️','☀️','🌙','⭐','🌸','🍃','🔥','💧',
  '🍜','🧋','🍰','🍕','🍎','☕','🍺','🍬',
  '🐱','🐶','🐰','🐻','🐼','🦊','🐣','🦋',
  '❤️','💔','💕','✨','🎉','👍','🙏','💪',
];

function buildEmojiPanel() {
  $('#emojiGrid').innerHTML = EMOJIS
    .map((e) => `<button type="button" data-emoji="${e}">${e}</button>`)
    .join('');
}

// ---------------------------------------------------------------- 打字状态

function showTyping() {
  if (state.typingNode) return;
  const row = document.createElement('div');
  row.className = 'wx-row in';
  row.dataset.typing = '1';
  row.innerHTML = `${avatarHTML('her')}
    <div class="wx-bubble" style="padding:8px 13px"><span class="wx-typing"><i></i><i></i><i></i></span></div>`;
  $('#messages').appendChild(row);
  state.typingNode = row;
  setNavSub('对方正在输入…');
  scrollToLatest();
}

/** 开了深度思考时，让她先"想"，顶栏给个提示，别让人以为卡住了 */
function showThinkingHint() {
  const sub = $('#navSub');
  if (sub && state.typingNode) sub.textContent = '她正在想…';
}

function hideTyping() {
  if (state.typingNode) {
    state.typingNode.remove();
    state.typingNode = null;
  }
  setNavSub('');
}

function setNavSub(text) {
  const el = $('#navSub');
  el.textContent = text;
  el.classList.toggle('on', !!text);
}

// ---------------------------------------------------------------- 发送

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || state.generating) return;

  if (!hasKey()) {
    toast('先填一个 API Key');
    openSettings();
    return;
  }

  closePanels();
  input.value = '';
  autoGrow();
  syncSendBtn();
  buzz();

  // 他出现了，重置"主动开口"的次数
  state.idleSpoken = 0;

  const userMsg = { role: 'user', content: text, ts: now() };
  state.messages.push(userMsg);
  appendRow(userMsg);
  scrollToLatest(true);
  saveChat();

  // 好感度跟着他这句话的冷暖动一点点（见 affection.js 的 drift）
  bumpAffection(text);

  // 他这句话是不是在把关系定下来（表白 / 求婚 / 分手）？
  // 设置里的关系要是还停在旧的，下一轮提示词就会把她拉回去 —— 所以这里要提示用户改。
  noteRelationSignal(text);

  await respond();
}

// ---------------------------------------------------------------- 关系变了？

/** 这一轮检测到的关系变化信号（respond 组提示词时要用） */
let pendingRelationSignal = null;

/**
 * 他刚说的这句话有没有"关系变了"的意思。
 *
 * 检测到就弹一条提示（可以一键改关系），并且记下来给这一轮的提示词用 ——
 * 因为在用户真去改设置之前，提示词里的关系定位说的还是旧关系，
 * 她会很容易又退回"我们只是朋友"。
 */
function noteRelationSignal(text) {
  pendingRelationSignal = detectRelationSignal(text);
  if (!pendingRelationSignal) { hideRelationTip(); return; }

  // 已经是这个关系了（比如本来就设着"恋人"，他又说了一次）→ 不用提示
  if (relationMatches(state.config.herRelation, pendingRelationSignal.suggest)) {
    hideRelationTip();
    return;
  }
  // 用户说过"不用改" → 这一类就不再烦他
  const dismissed = state.profile.relationTipDismissed || {};
  if (dismissed[pendingRelationSignal.kind]) { hideRelationTip(); return; }

  showRelationTip(pendingRelationSignal);
}

function showRelationTip(signal) {
  const tip = $('#relationTip');
  if (!tip) return;
  $('#relationTipText').textContent = relationTipText(signal);
  tip.hidden = false;
}

function hideRelationTip() {
  const tip = $('#relationTip');
  if (tip) tip.hidden = true;
}

/** 点「改」：把关系换成信号建议的那个 */
function applyRelationTip() {
  const signal = pendingRelationSignal;
  hideRelationTip();
  if (!signal) return;
  quickSetRelation(signal.suggest);
  toast(`关系改成「${signal.suggest}」，她下一句就会按新身份说话`, 2600);
}

/** 点 ✕：这一类信号以后不再提示 */
function dismissRelationTip() {
  hideRelationTip();
  const kind = pendingRelationSignal?.kind;
  if (!kind) return;
  state.profile.relationTipDismissed = { ...(state.profile.relationTipDismissed || {}), [kind]: true };
  saveProfile();
  toast('好，那就不提醒了（随时可以在 + 面板里自己改）', 2400);
}

/**
 * 按他这一句话微调好感度。
 *
 * 只在已经设过好感度时生效（老用户是 null，保持"按聊天量估算"的老行为）。
 * 涨幅刻意很小 —— 一句话不该让关系大变，主要是别让它像个死数字。
 */
function bumpAffection(text) {
  if (state.profile.affection == null) return;
  const before = state.profile.affection;
  const after = affectionDrift(before, text);
  if (after !== before) {
    state.profile.affection = after;
    state.profile.affectionAt = now();
    saveProfile();
    renderAffection();
  }
}

/**
 * 隔久了没聊，感情会淡一点（见 affection.js 的 decayForGap）。
 *
 * 为什么要单独做：drift() 是"每句话"的微调，管不了"三个月没说话了"。
 * 原来好感度只会涨不会降 —— 晾着不管，她也一直 80 分。
 *
 * 基准取 max(上次聊天, 上次因久不聊而降温)：
 * 冷却过一次就重新开始计时，所以是"每冷落一段时间淡一点"，
 * 而不是每次打开都扣。
 */
function applyAffectionDecay() {
  if (state.profile.affection == null) return false;
  const base = Math.max(
    Number(state.profile.lastChatAt) || 0,
    Number(state.profile.affectionAt) || 0
  );
  if (!base) return false;

  const days = (now() - base) / 86400000;
  const next = decayForGap(state.profile.affection, days);
  if (Math.round(next) === Math.round(state.profile.affection)) return false;

  state.profile.affection = next;
  state.profile.affectionAt = now();
  saveProfile();
  return true;
}

/**
 * 分层组装喂给模型的上下文。
 *
 * 完整历史会一直存在本地（用户要能回看），但不可能全塞进提示词。
 * 所以按"越近越完整"分配预算：
 *   1. 先放最近的完整对话
 *   2. 放不下时从最早开始压缩，并给"更早的对话要点"留位置
 * 这样既不会突然断片，也不会把 token 烧光。
 *
 * 预算按后端分：
 *   - DeepSeek 新模型上下文 1M，而且前缀命中缓存后极便宜 → 给足，别让她失忆
 *   - 本地小模型只有 4k~8k 上下文 → 必须收着，否则又慢又胡说
 */
function contextBudget() {
  const isNative = getProvider(state.config.provider)?.id === 'native-local';
  return isNative ? { maxChars: 6000, maxMsgs: 30 } : { maxChars: 40000, maxMsgs: 200 };
}

function buildChatContext(maxChars, maxMsgs) {
  const budget = contextBudget();
  if (maxChars === undefined) maxChars = budget.maxChars;
  if (maxMsgs === undefined) maxMsgs = budget.maxMsgs;

  const all = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!all.length) return [];

  // 要点条目现在每条更长（最多 320 字），给它的预算也要跟着涨，
  // 否则 memoryBlock 里塞了 16 条、实际只放得下几条。
  const summaryBudget = state.profile.summary?.length ? 6000 : 0;
  const recentBudget = Math.max(1600, maxChars - summaryBudget);

  // 从最新往回收集
  const picked = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const len = [...String(m.content)].length;
    if (picked.length >= maxMsgs) break;
    if (used + len > recentBudget && picked.length >= 6) break;
    picked.unshift({ role: m.role, content: m.content });
    used += len;
  }
  return picked;
}

// ---------------------------------------------------------------- 记忆检索
//
// 最近 200 条本来就在上下文里，但 200 条之外的内容只能靠检索才能被想起来。
// 这是"她记得很久以前的事"的关键一环——不用向量模型，中文靠关键词 + IDF。

// 索引、检索、要点压缩都在 src/memory-io.js 里（含"增量维护索引"那些坑的说明）。
// 这里只留薄封装：把 state.messages 和虚拟时钟喂进去。

/**
 * 从很久以前的记录里，翻出跟当前话题相关的几条。
 * @param {string} query 用他的话做查询
 * @param {number} excludeRecent 最近多少条已经进了上下文，不用重复捞
 * @returns {{text:string, count:number}}
 */
const recallOldMessages = (query, opts) => recallOld(state.messages, query, opts);

/** 把检索结果拼成给模型看的一段话（里面那几条"别像在核对记录"很重要） */
const recallBlock = (query, excludeRecent) => recallBlockOf(state.messages, query, excludeRecent);

/** 把一段对话压成要点，作为长期记忆（不够 10 条新的就什么都不做） */
function pushSummary() {
  const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const sum = summarizeConversation(msgs, { since: state.profile.summarizedUpTo || 0 });
  if (!sum) return;
  state.profile.summary.push(sum.line);
  state.profile.summarizedUpTo = sum.pointer;
  saveProfile();
}

/** 手机本地模型（APK 专用）：加载模型 → 本地推理 → 返回完整文本 */
async function nativeStreamChat({ systemPrompt, messages, temperature, maxTokens, signal }) {
  if (!native) throw new Error('本地推理模块不可用');
  if (!native.getLocalModelInfo()?.path) {
    throw new Error('还没有下载本地模型。设置 → 手机本地模型 → 下载模型');
  }
  setNavSub('正在加载模型…');
  await native.loadLocalModel((p) => {
    const pct = Math.round((Number(p) || 0) * 100);
    setNavSub(`加载模型 ${pct}%`);
  });
  setNavSub('本地生成中…');
  const text = await native.localCompletion({
    systemPrompt,
    messages,
    temperature,
    maxTokens,
    signal,
    onDelta: () => {},   // 本地推理通常一次性出来，不做逐字
  });
  return text;
}

/** 让她回复（也被"重新开始"复用） */
async function respond() {
  setGenerating(true);
  const ctrl = new AbortController();
  state.abort = ctrl;

  const history = buildChatContext();

  // 隔太久没聊 → 先把她凉一点，再拿这个数字去组提示词
  applyAffectionDecay();

  // 用他最新说的那句话去更早的记录里翻相关内容。
  // 只取最后一条：把前面几条也拼进来会引入一堆噪音词
  //（实测"随便聊聊第N条 今天天气还行"这种重复模式会把真正的话题压下去）。
  const query = String(
    [...state.messages].reverse().find((m) => m.role === 'user')?.content || ''
  );

  const systemPrompt = [
    buildSystemPrompt(state.profile, {
      scene: currentScene(),
      timeText: currentTimeText(),
      summary: state.profile.summary,
      herName: herName(),
      persona: personaForPrompt(),
      me: myMe(),
      affection: affection(),
      affectionBase: state.profile.affectionBase,
      relation: state.config.herRelation,
    }),
    recallBlock(query, history.length),
    // 他说了"明天下午"这类 → 先把"还有多久"算好，免得她自己脑补紧迫感
    futureHint(query, now()),
    // 他刚才那句像是在把关系往前推（表白 / 分手）→ 当轮先提醒她认新身份，
    // 别等用户去改设置（设置还没改的时候，上面那块关系定位说的还是旧的）
    relationShiftHint(pendingRelationSignal),
    // 他反复做过的动作（抱住、摸头…）→ 提醒她别再给"第一次"的反应
    habitsBlock(state.messages.filter((m) => m.role === 'user' || m.role === 'assistant')),
    `【记住前面聊过的】（很重要）
上面给了你最近的完整对话记录。你必须**记得并沿用**这些内容：
- 他刚说过的名字、地点、事情、情绪，不要当成没听过
- 如果前面几轮你已经问过某个问题、说过某件事，不要再重复问一遍
- **更不要问你已经知道答案的问题**。比如他天天说自己做饭，你还问"你做过饭吗"，
  那就跟失忆一样。不确定就先翻上面的记忆和对话，宁可说"你之前是不是提过…"
- 话题要延续，不要突然换个不相干的话题
- 如果他说"刚才""之前""刚才说的"，你要知道指的是什么
- 开口前先扫一遍上面的对话和记忆，别只回答他最后那一句

【记忆】把这次对话里关于他的新信息记下来，在回复的最后另起一行加上：
[[记忆]]{"name":"","facts":[],"mood":""}

**必须记的**（哪怕你觉得是小事、是废话，也要记）：
- 他的日常习惯、反复做的事："每天下班自己做饭""晚上跑步""周末打游戏"
- 他生活里反复出现的人和物：同事名字、宠物、常去的地方
- 他的喜好和厌恶：爱吃什么、不吃什么、讨厌什么
- 他的工作 / 学习 / 健康 / 家庭情况
- 他提过的计划、约定、时间点（"下周上线""说好周末看电影"）
- 他明确说过的情绪，以及为什么

写法要求：
- 一次最多 3 条，每条不超过 20 字
- 写成陈述句，带上主语和频率："他每天下班自己做饭"，别只写"做饭"
- 不要记一次性的琐事（"他刚说要喝水"）——除非他重复提过
- **把"事情本身"和"细节"分开写**，这一条很重要：
  · 事情本身 → 一条（"他爱人五年前离开了他"）
  · 具体细节 → **另起一条**（"他爱人那天穿灰色风衣"）
  前者会变成「执念」被永久记住，后者会像普通记忆一样慢慢淡掉 ——
  真人就是这样：五年后还记得她走了、记得当时多难受，但说不准几点、她穿的什么。
  所以细节那条**不要**放进 heavy。
- **如果这件事分量很重**（生离死别、大病、失业、失恋、结婚、被骗、被欺负…
  那种他会记很多年的事），把**事情本身**那条**原样再写进 heavy 数组**一份：
  [[记忆]]{"name":"","facts":["他爱人五年前离开了他","他爱人那天穿灰色风衣"],"mood":"沉重","heavy":["他爱人五年前离开了他"]}
  这类事她会一直记着，不受遗忘曲线影响 —— 所以宁可多标，别漏标

这一行不会显示给他，所以不要写在正常消息里。
如果这次真的没有任何新信息，就完全不要输出这行。`,
  ].filter(Boolean).join('\n\n');

  try {
    let full = '';

    if (getProvider(state.config.provider).id === 'native-local') {
      // 手机本地推理：不用网络、不花 token
      full = await nativeStreamChat({
        systemPrompt,
        messages: history,
        temperature: Number(state.config.temperature) || 1.0,
        maxTokens: Number(state.config.maxTokens) || 250,
        signal: ctrl.signal,
      });
    } else {
      await streamChat({
        apiKey: state.config.apiKey.trim(),
        endpoint: state.config.endpoint || DEFAULT_ENDPOINT,
        model: state.config.model || DEFAULT_MODEL,
        systemPrompt,
        messages: history,
        temperature: Number(state.config.temperature) || 1.0,
        maxTokens: Number(state.config.maxTokens) || 250,
        thinking: !!state.config.thinking,
        signal: ctrl.signal,
        onReasoning() {
          showThinkingHint();
        },
        onDelta(piece) {
          // 先攒着，等生成完再拆分逐条发（微信节奏）
          full += piece;
        },
      });
    }

    const { clean, mem } = extractMemory(full);
    applyMemory(mem);

    const parts = splitMessages(clean, Number(state.config.burst) || 2);

    if (!parts.length) {
      hideTyping();
      showTyping();
      await sleep(400);
      hideTyping();
      const fb = { role: 'assistant', content: '……嗯', ts: now() };
      state.messages.push(fb);
      appendRow(fb);
      saveChat();
      return;
    }

    // 逐条"发出来"
    const totalBudget = 4200; // 总节奏上限，别让她"打字"太久
    let spent = 0;

    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i];
      const isLast = i === parts.length - 1;

      showTyping();
      // 打字时长：按字数估，单条 260-900ms
      let delay = Math.min(900, Math.max(260, piece.length * 42));
      // 限制总时长
      if (spent + delay > totalBudget) delay = Math.max(120, totalBudget - spent);
      spent += delay;
      await sleep(delay);
      hideTyping();

      const msg = {
        role: 'assistant',
        content: piece,
        ts: now(),
        mid: !isLast, // 连发中的前几条不画尾巴，视觉上是一串
      };
      state.messages.push(msg);
      appendRow(msg);
      scrollToLatest();
      buzz(8);

      if (!isLast) await sleep(Math.min(420, 120 + piece.length * 8));
    }

    saveChat();
    // 累计消息数（亲密度估算）与长期记忆摘要
    state.profile.msgCount = state.messages.length;
    pushSummary();
    saveProfile();
    updateDataInfo();
  } catch (err) {
    hideTyping();
    if (err.name === 'AbortError' || ctrl.signal.aborted) {
      appendSys('（已停止）');
    } else {
      // 把刚才那条没人回应的用户消息撤掉
      const i = state.messages.map((m) => m.role).lastIndexOf('user');
      if (i >= 0 && i === state.messages.length - 1) state.messages.splice(i, 1);
      saveChat();
      renderChat();
      appendError(err.message);
      toast(err.message, 3200);
    }
  } finally {
    hideTyping();
    setGenerating(false);
    state.abort = null;
    syncSendBtn();
    // 记录本次聊天时间：下次进来据此判断过了多久、场景该怎么变
    state.profile.lastChatAt = now();
    saveProfile();
    // 他刚说完、她也回完了，重新开始"他多久没动静"的计时
    armIdleTimer();
  }
}

function setGenerating(on) {
  state.generating = on;
  $('#input').disabled = on;
  syncSendBtn();
}

function stopGen() {
  if (state.abort) {
    state.abort.abort();
    toast('已停止');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 设置

function updateDataInfo() {
  const n = state.messages.length;
  const facts = state.profile.facts?.length || 0;
  $('#dataInfo').textContent = `${n} 条消息 · 她记得 ${facts} 件事`;
}

/** 用服务商预置填充表单 */
function applyProvider(id) {
  const p = getProvider(id);
  state.config.provider = p.id;
  if (p.id !== 'custom') {
    state.config.endpoint = p.endpoint;
    state.config.model = p.model;
    $('#inpEndpoint').value = p.endpoint;
  }
  // 模型下拉
  const models = p.models?.length ? p.models : [state.config.model || ''];
  $('#inpModel').innerHTML = models
    .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`)
    .join('');
  $('#inpModel').value = state.config.model || models[0] || '';

  // 说明与申请入口
  $('#providerHint').textContent = p.hint || '';
  const link = $('#signupLink');
  if (p.signup) {
    link.href = p.signup;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
  // 非自定义时地址由预置决定，不让误改；本地模型除外——手机必须把
  // 127.0.0.1 换成电脑的局域网 IP，所以本地服务商允许编辑地址。
  const lockEndpoint = p.id !== 'custom' && !p.local;
  $('#inpEndpoint').readOnly = lockEndpoint;
  $('#inpEndpoint').classList.toggle('locked', lockEndpoint);

  // 本地模型不需要 API Key
  const keyLabel = $('#inpKey').closest('.wx-cell')?.querySelector('label');
  if (p.noKey) {
    $('#inpKey').placeholder = '本地模型不需要，留空即可';
    if (keyLabel) keyLabel.textContent = 'API Key（本地不需要）';
  } else {
    $('#inpKey').placeholder = 'sk-...';
    if (keyLabel) keyLabel.textContent = 'API Key';
  }

  // 手机本地模型：显示模型管理面板
  toggleNativePanel();
}

function onProviderChange() {
  applyProvider($('#inpProvider').value);
  saveConfig();
  $('#testResult').hidden = true;
}

function syncSettingsUI() {
  // 服务商下拉（按「手机本地 / 本地服务 / 云端」分组）
  // 「手机本地模型」排最前：这是"完全离线"的那个，也是这个 APK 的主打功能，
  // 之前它排在最后，用户很容易误选成需要开电脑的 Ollama。
  const all = availableProviders();
  const nativeP = all.filter((p) => p.native);
  const otherLocal = all.filter((p) => p.local && !p.native);
  const cloud = all.filter((p) => !p.local);
  const opt = (p) => `<option value="${p.id}">${esc(p.name)}</option>`;
  $('#inpProvider').innerHTML =
    (nativeP.length ? `<optgroup label="手机本地（完全离线）">${nativeP.map(opt).join('')}</optgroup>` : '') +
    (otherLocal.length ? `<optgroup label="连电脑使用（需要电脑开着）">${otherLocal.map(opt).join('')}</optgroup>` : '') +
    `<optgroup label="云端 API（需要联网+Key）">${cloud.map(opt).join('')}</optgroup>`;

  // 兼容老配置
  if (!state.config.provider) {
    state.config.provider = detectProvider(state.config.endpoint, state.config.model);
  }
  if (!availableProviders().some((p) => p.id === state.config.provider)) {
    state.config.provider = 'deepseek';
  }
  $('#inpProvider').value = state.config.provider;

  applyProvider(state.config.provider);

  $('#inpKey').value = state.config.apiKey || '';
  $('#inpUserName').value = state.config.userName || state.profile.name || '';

  for (const [id, key] of [['#segLen', 'maxTokens'], ['#segBurst', 'burst'], ['#segTemp', 'temperature'], ['#segThink', 'thinking'], ['#segSpeak', 'autoSpeak']]) {
    $$(`${id} button`).forEach((b) =>
      b.classList.toggle('on', Math.abs(Number(b.dataset.v) - Number(state.config[key])) < 0.01));
  }
  $('#setupBanner').hidden = !needsSetup();
  updateDataInfo();
}

// ------------------------------------------------------------ 手机本地模型

function nativeModelInfo() {
  return native?.getLocalModelInfo?.() || null;
}

function renderNativeModelPanel() {
  if (!nativeReady || !native) return;
  const info = nativeModelInfo();
  $('#nativeStatus').textContent = info?.path
    ? `✅ 已就绪：${info.name}（${info.size}）`
    : '还没有模型。选一个下载，之后就能完全离线聊天了。';

  const list = native.LOCAL_MODELS || [];
  $('#nativeModels').innerHTML = list.map((m) => {
    const isCurrent = info?.id === m.id;
    return `<div class="wx-native-item${isCurrent ? ' current' : ''}">
      <div class="info">
        <div class="nm">${esc(m.name)}${isCurrent ? '<span class="badge">已下载</span>' : ''}</div>
        <div class="sz">${esc(m.size)}</div>
        <div class="nt">${esc(m.note)}</div>
      </div>
      ${isCurrent
        ? `<button class="act ghost" data-nm-del="${m.id}">删除</button>`
        : `<button class="act" data-nm-dl="${m.id}">下载</button>`}
    </div>`;
  }).join('');
}

function toggleNativePanel() {
  const p = getProvider(state.config.provider);
  if (!p.native) {
    $('#nativePanel').hidden = true;
    return;
  }
  $('#nativePanel').hidden = false;
  renderNativeModelPanel();
}

async function downloadNativeModel(id) {
  const m = (native?.LOCAL_MODELS || []).find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`下载 ${m.name}（${m.size}）？\n\n建议用 WiFi。下完之后一直离线可用，不花流量也不花 token。`)) return;

  const box = $('#nativeProgress');
  const bar = $('#nativeBar');
  const txt = $('#nativeProgressText');
  box.hidden = false;
  bar.style.width = '0%';
  txt.textContent = '开始下载…';

  try {
    await native.downloadLocalModel(m, (p) => {
      const pct = Math.max(0, Math.min(100, Math.round((Number(p?.progress) || 0) * 100)));
      bar.style.width = pct + '%';
      const done = p?.downloadedBytes ? (p.downloadedBytes / 1024 / 1024).toFixed(0) : null;
      const total = p?.totalBytes ? (p.totalBytes / 1024 / 1024).toFixed(0) : null;
      txt.textContent = p?.failed
        ? `下载失败：${p.errorMessage || '未知错误'}`
        : p?.completed
          ? '下载完成 ✅'
          : done && total ? `${pct}%  (${done}/${total} MB)` : `${pct}%`;
    });
    toast('模型下载完成，可以离线聊了', 3000);
    renderNativeModelPanel();
  } catch (e) {
    toast(e.message, 4000);
    txt.textContent = e.message;
  }
}

function deleteNativeModel() {
  if (!confirm('删除已下载的模型？下次要用需要重新下载。')) return;
  native?.forgetLocalModel?.();
  native?.unloadLocalModel?.().catch?.(() => {});
  renderNativeModelPanel();
  toast('已删除');
}

/**
 * 扫描手机里已有的模型文件。
 * 用于"模型是别人帮放进来的"或"下载记录丢了但文件还在"的情况。
 */
async function scanModels() {
  if (!native?.scanLocalModels) {
    toast('当前环境不支持扫描');
    return;
  }
  const btn = $('#btnScanModels');
  btn.disabled = true;
  btn.textContent = '📂 扫描中…';
  try {
    const found = await native.scanLocalModels();
    if (!found.length) {
      toast('没找到 .gguf 模型文件。如果你刚下载过，等下载完再试。', 3200);
      return;
    }
    const cur = nativeModelInfo();
    // 已经登记过的就不用再选
    const fresh = found.filter((f) => f.name !== cur?.filename);
    if (!fresh.length) {
      toast(`找到 ${found.length} 个模型，但已经在用了`);
      renderNativeModelPanel();
      return;
    }
    const list = fresh
      .map((f, i) => `${i + 1}. ${f.name}（${(f.size / 1024 / 1024).toFixed(0)}MB）`)
      .join('\n');
    const pick = prompt(`找到这些模型，输入序号使用：\n\n${list}`, '1');
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= fresh.length) return;

    const info = await native.adoptLocalModel(fresh[idx]);
    toast(`已启用：${info.name}`, 2600);
    renderNativeModelPanel();
  } catch (e) {
    toast(`扫描失败：${e.message}`, 3200);
  } finally {
    btn.disabled = false;
    btn.textContent = '📂 扫描手机里已有的模型';
  }
}

/** 自检：逐项给出结果，方便定位问题 */
/**
 * 本地模型测速。
 *
 * 为什么要有这个：引擎的 ARM 加速（dotprod/i8mm/repack）是编译期决定的，
 * 光看构建日志证明不了手机上到底跑多快。让你点一下就出数字，
 * 既能验证优化有没有生效，也能直观对比不同模型。
 *
 * 先跑一次短的预热（首次要加载模型、分配 KV cache，不能算进成绩），
 * 再跑正式的那一次。
 */
async function runSpeedTest() {
  const btn = $('#btnSpeedTest');
  const log = $('#speedLog');
  if (!log) return;
  log.hidden = false;

  if (!native?.localCompletion) {
    log.textContent = '当前环境不支持本地推理（不是 APK，或插件没加载成功）';
    return;
  }

  const info = native.getLocalModelInfo?.();
  if (!info?.path) {
    log.textContent = '还没有本地模型。先在上面下载一个，或者点「扫描手机里已有的模型」。';
    return;
  }

  // 测速要跑几十秒到几分钟。屏幕一黑，WebView 会被系统挂起，整个任务就卡死了
  // （实测踩过：跑到一半息屏，远程等了 10 分钟没有任何输出）。
  // 用 Wake Lock 在这期间保持屏幕常亮。
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  btn.disabled = true;
  btn.textContent = '测速中…';
  let lines = [`模型：${info.filename || info.path}`];
  const push = () => { log.textContent = lines.join('\n'); log.scrollTop = log.scrollHeight; };
  push();

  try {
    // 预热：不算成绩
    lines.push('预热中（首次要加载模型）…'); push();
    await native.localCompletion({
      systemPrompt: '你在用微信跟人闲聊。',
      messages: [{ role: 'user', content: '在吗' }],
      temperature: 0.8,
      maxTokens: 8,
    });

    // 正式计时
    lines.push('开始计时…'); push();
    const t0 = Date.now();
    const text = await native.localCompletion({
      systemPrompt: '你在用微信跟朋友闲聊，用口语化的短句。',
      messages: [{ role: 'user', content: '跟我说说你今天都干什么了' }],
      temperature: 0.8,
      maxTokens: 100,
    });
    const ms = Date.now() - t0;

    const st = native.getLastCompletionStats?.() || {};
    const tokens = st.tokens || [...String(text)].length;   // 拿不到精确值就按字数估
    const tps = ms > 0 ? (tokens / (ms / 1000)) : 0;

    lines = lines.slice(0, 2);
    lines.push('');
    lines.push(`⚡ ${tps.toFixed(1)} tok/s`);
    lines.push(`   ${tokens} 个 token / ${(ms / 1000).toFixed(1)} 秒`);
    lines.push('');
    lines.push(`她说的：${String(text).replace(/\n/g, ' / ').slice(0, 80)}`);
    lines.push('');
    lines.push(tps >= 8 ? '速度不错，聊天很顺。'
      : tps >= 4 ? '能用，稍微有点慢，但陪着聊天够了。'
      : '偏慢。可以换小一号的模型（比如 MiniCPM5 2B）。');
  } catch (e) {
    lines.push(`❌ 测速失败：${e.message}`);
  } finally {
    try { await wakeLock?.release(); } catch {}
    push();
    btn.disabled = false;
    btn.textContent = '⚡ 测速（看每秒能生成多少字）';
  }
}

async function runSelfTest() {
  const btn = $('#btnSelfTest');
  const log = $('#selfTestLog');
  if (!log) return;
  log.hidden = false;
  if (!native?.selfTest) {
    log.textContent = '当前环境不支持自检（不是 APK，或插件没加载成功）';
    return;
  }
  btn.disabled = true;
  btn.textContent = '自检中…（首次会加载模型，要十几秒）';
  log.textContent = '';
  const lines = [];
  try {
    await native.selfTest((line) => {
      lines.push(line);
      log.textContent = lines.join('\n');
      log.scrollTop = log.scrollHeight;
    });
  } catch (e) {
    lines.push(`❌ 自检本身出错：${e.message}`);
    log.textContent = lines.join('\n');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 运行自检（排查问题用）';
  }
}

/** 把表单当前值读进 config（不落盘） */
function readForm() {
  const k = $('#inpKey').value.trim();
  if (k) state.config.apiKey = k;
  state.config.model = $('#inpModel').value || state.config.model;
  const ep = $('#inpEndpoint').value.trim();
  if (ep) state.config.endpoint = ep;
  state.config.userName = $('#inpUserName').value.trim().slice(0, 12);
  if (state.config.userName) state.profile.name = state.config.userName;
  return state.config;
}

function openSettings() {
  // 关掉所有可能遮挡的东西，避免它盖住设置页里的按钮
  closePanels();
  closeMenu();
  syncSettingsUI();
  $('#screen-settings').classList.add('show');
}

function openMenu() {
  closePanels();
  // 用内联样式控制显隐：不依赖外部 CSS 是否加载，也不受 [hidden] 优先级影响
  $('#mask').style.display = 'flex';
}

function closeMenu() {
  $('#mask').style.display = 'none';
}

async function testConnection() {
  const btn = $('#btnTest');
  const out = $('#testResult');

  // 先把表单当前值读进来，确保测的就是用户刚填的
  const cfg = readForm();
  const p = getProvider(cfg.provider);
  const key = cfg.apiKey?.trim();
  const isLocal = !!p.local || isLocalEndpoint(cfg.endpoint);

  if (!key && !isLocal) {
    out.hidden = false;
    out.className = 'wx-test-result bad';
    out.textContent = '请先填入 API Key。';
    return;
  }
  btn.disabled = true;
  btn.textContent = '测试中…';
  out.hidden = true;

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  else if (isLocal) headers.Authorization = 'Bearer local';

  try {
    const r = await fetch(cfg.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '在吗' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (!r.ok) {
      let msg = '';
      try { msg = JSON.parse(await r.text())?.error?.message || ''; } catch {}
      out.hidden = false;
      out.className = 'wx-test-result bad';
      if (isLocal) {
        out.textContent = r.status === 404
            ? '连上了本地服务，但找不到这个模型名。检查设置里的模型名是否和本地加载的一致。'
          : `本地服务返回 ${r.status}${msg ? '：' + msg : ''}`;
      } else {
        out.textContent = r.status === 401
            ? `API Key 无效。确认你填的是「${p.name}」的 Key（不同平台不通用）。`
          : r.status === 402 ? '账户余额不足，需要先充值。'
          : r.status === 404 ? '接口地址或模型名不对，检查一下设置。'
          : r.status === 429 ? '请求太频繁或额度用完了，等一会儿再试。'
          : `失败（${r.status}）${msg ? '：' + msg : ''}`;
      }
    } else {
      out.hidden = false;
      out.className = 'wx-test-result ok';
      out.textContent = isLocal
        ? '连上本地模型了，不花 token ✅'
        : '连接成功，可以开始聊了 ✅';
      saveSettingsFields();
    }
  } catch {
    out.hidden = false;
    out.className = 'wx-test-result bad';
    out.textContent = isLocal
      ? '连不上。确认电脑开着、本地服务已启动，地址里的 IP 是电脑的局域网 IP（不是 127.0.0.1），手机和电脑在同一个 WiFi。'
      : '连不上，检查手机网络，或者换个服务商试试。';
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function saveSettingsFields() {
  readForm();
  if (!state.config.endpoint) state.config.endpoint = DEFAULT_ENDPOINT;
  saveConfig();
  saveProfile();
  updateDataInfo();
}

// ---------------------------------------------------------------- 她记得的事

/**
 * 手动加进记忆里的条目。
 *
 * 单独记一份的原因：facts / summary 会被"只保留最近 N 条"的规则裁掉，
 * 用户亲手写的东西被自动压缩挤掉会很气人。这里保证手动的永远留着。
 */
function manualList(which) {
  const key = which === 'fact' ? 'factsManual' : 'summaryManual';
  if (!Array.isArray(state.profile[key])) state.profile[key] = [];
  return state.profile[key];
}

/** 模型/导入自动产生的条目 = 全部 - 手动加的 */
function autoList(which) {
  const all = (which === 'fact' ? state.profile.facts : state.profile.summary) || [];
  const man = manualList(which);
  const rest = all.slice();
  for (const m of man) {
    const i = rest.indexOf(m);
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

function addMemory(which, text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, which === 'fact' ? 40 : 80);
  if (!clean) { toast('写点什么再添加'); return false; }

  const all = which === 'fact' ? state.profile.facts : state.profile.summary;
  const man = manualList(which);
  if (all.some((x) => x === clean)) { toast('她已经记着这条了'); return false; }

  man.push(clean);
  all.push(clean);

  // 手动加的也算一下情绪强度：
  // 一是标签要显示成「执念」而不是「很牢」（行为上都是永久，但用户想看到区别）；
  // 二是【执念】那段提示词只在真有执念时才注入 —— 不算的话，
  //    她不会收到"事情记得、细节会糊、别编细节"那条指令。
  if (which === 'fact') {
    if (!state.profile.factsMeta || typeof state.profile.factsMeta !== 'object') {
      state.profile.factsMeta = {};
    }
    const emo = intensityOf(clean);
    state.profile.factsMeta[clean] = {
      ...(state.profile.factsMeta[clean] || {}),
      ...(state.profile.factsMeta[clean] || newMeta(now())),
      ...(emo > 0 ? { emo: Math.max(emo, Number(state.profile.factsMeta[clean]?.emo) || 0) } : {}),
    };
  }

  saveProfile();
  renderMemoryPage();
  toast('已加入她的记忆', 1800);
  return true;
}

function deleteMemory(which, text) {
  if (text === undefined || text === null) return;
  const all = which === 'fact' ? state.profile.facts : state.profile.summary;
  const i = all.indexOf(text);
  if (i < 0) return;
  all.splice(i, 1);
  const man = manualList(which);
  const mi = man.indexOf(text);
  if (mi >= 0) man.splice(mi, 1);
  // 如果这条是从"他的大致生平"来的，也从那份名单里摘掉，
  // 否则下次保存人设时会以为"这条还没写进去"，又给你加回来
  if (which === 'fact' && Array.isArray(state.profile.bioFacts)) {
    state.profile.bioFacts = state.profile.bioFacts.filter((f) => f !== text);
  }
  saveProfile();
  renderMemoryPage();
  toast('已删掉这条', 1400);
}

/**
 * 用文本（而不是下标）标记待删条目。
 * saveProfile 会把手动条目挪到前面，下标随时可能变，用文本才稳。
 */
function memItemHTML(text, which, dim) {
  // 事实类记忆带「记忆强度」——按遗忘曲线算出来的。
  // 反复提到的会显示「很牢」，很久没提过的会显示「快忘了」，
  // 而情绪强度够高的会显示「执念」（那类不参与遗忘）。
  let badge = '';
  let star = '';
  if (which === 'fact') {
    const meta = state.profile.factsMeta?.[text];
    if (meta) {
      const pct = strengthPercent(meta, now());
      const label = strengthLabel(meta, now());
      const hits = Math.round(Number(meta.hits) || 1);
      const emo = Number(meta.emo) || 0;
      // 必须夹到 3：pct = 100 时算出的是 s4，而 CSS 只定义了 s0~s3，
      // 结果最牢的那几条反而顶着一个没样式的灰标签。
      const grade = Math.max(0, Math.min(3, Math.floor(pct / 25)));
      const obs = isObsession(meta);
      badge = `<span class="wx-mem-strength ${obs ? 'obs' : `s${grade}`}"`
        + ` title="记忆强度 ${pct}%，被提到 ${hits} 次${emo ? `，情绪强度 ${emo}/10` : ''}">`
        + `${label}</span>`;
      // 手动标/取消"执念"：强度是猜的，哪些事放不下只有他自己知道
      star = `<button class="wx-mem-star${obs ? ' on' : ''}" data-obs-text="${encodeURIComponent(text)}"`
        + ` title="${obs ? '取消执念（会随时间淡）' : '标成执念（她永远不会忘）'}"`
        + ` aria-label="标成执念">${obs ? '★' : '☆'}</button>`;
    }
  }
  return `<div class="wx-mem-item${dim ? ' dim' : ''}">`
    + `<span class="dot">•</span>`
    + `<span class="tx">${esc(text)}</span>`
    + badge
    + star
    + `<button class="wx-mem-del" data-del-who="${which}"`
    + ` data-del-text="${encodeURIComponent(text)}" aria-label="删掉这条">✕</button>`
    + `</div>`;
}

// ---------------------------------------------------------------- 他的大致生平
//
// 拆分规则、第一人称改写、"只撤上次那几条"的记账都在 src/memory-io.js。
// 这里只留薄封装（生平的要点最终也会变成永久记忆，见那里的说明）。

/**
 * 把生平要点写进她的永久记忆。
 * 存进 factsManual —— 那一档在 saveProfile 里会被标成 pinned（永久、不参与遗忘）。
 */
function applyUserBio() {
  const next = applyUserBioTo(state.profile, state.config.userBio);
  // saveProfile 会把 factsManual 标成 pinned，并去重
  saveProfile();
  return next;
}

/** 生平那栏的即时预览：让用户看到"会被拆成哪几条" */
function renderBioPreview() {
  const el = $('#perBioPreview');
  const cnt = $('#perBioCount');
  const raw = $('#perBio')?.value || '';
  const points = parseBioPoints(raw);

  if (cnt) {
    cnt.textContent = points.length
      ? `会记成 ${points.length} 条永久记忆`
      : (raw.trim() ? '太短了，至少写两个字' : '还没写');
  }
  if (!el || el.hidden) return;
  el.innerHTML = points.length
    ? points.map((p) => `<div class="wx-mem-item"><span class="dot">•</span><span class="tx">${esc(p)}</span></div>`).join('')
    : `<div class="wx-mem-item dim"><span class="dot">·</span><span class="tx">（还没有要点）</span></div>`;
}

// ---------------------------------------------------------------- 好感度

/**
 * 把好感度画到「+」面板里。
 *
 * 没设过好感度时（老用户）显示成"还没设过"，而不是显示 0 ——
 * 0 会被理解成"她讨厌你"，那是两码事。
 */
function renderAffection() {
  const box = $('#affPanel');
  if (!box) return;

  const label = $('#affLabel');
  if (label) label.textContent = `${ta()}此刻对你的感觉`;

  const v = affection();
  if (v == null) {
    box.classList.add('unset');
    $('#affNum').textContent = '—';
    $('#affBar').style.width = '0%';
    $('#affRel').textContent = '还没设过好感度。';
    $('#affNote').textContent = '设置 →「她的样子」→ 重新设定，把人设填一遍，她就会按好感度调整对你的态度。';
    return;
  }

  box.classList.remove('unset');
  const lv = levelOf(v);
  $('#affNum').textContent = String(Math.round(v));
  const bar = $('#affBar');
  bar.style.width = v + '%';
  bar.dataset.lv = String(lv.min);
  $('#affRel').textContent = relationViewText(v, state.config.herRelation);

  const base = state.profile.affectionBase;
  $('#affNote').textContent = `${lv.label}。`
    + (typeof base === 'number' && Math.round(base) !== Math.round(v)
      ? `（一开始是 ${Math.round(base)}）` : '')
    + '聊得好会慢慢涨，也能自己调。';

  // 关系是独立的另一栏：身份，跟温度分开显示
  const rel = String(state.config.herRelation || '').trim();
  if ($('#affRelationName')) $('#affRelationName').textContent = rel || '没设';
  if ($('#quickRelationChips') && !$('#quickRelationChips').hidden) renderQuickRelation();
}

/** 「+」面板里的关系快改：聊着聊着关系变了，两下就能改过来 */
function renderQuickRelation() {
  const cur = String(state.config.herRelation || '').trim();
  renderChips('#quickRelationChips', RELATION_PRESETS, (v) => v === cur);
}

/** 快速改关系（不改好感度，但会提醒两者是否矛盾） */
function quickSetRelation(name) {
  state.config.herRelation = String(name || '').trim().slice(0, 12);
  // 关系变了 → 如果她的初始好感度从没设过，顺手按新关系给一个
  if (state.profile.affection == null) {
    const v = nearestAffPreset(defaultAffectionFor(state.config.herRelation));
    state.profile.affection = v;
    state.profile.affectionBase = v;
  }
  saveConfig();
  saveProfile();
  renderAffection();
  const warn = relationAffectionWarning(state.config.herRelation, affection() ?? 45);
  toast(warn ? `关系改成「${state.config.herRelation}」。${warn}` : `关系改成「${state.config.herRelation}」`, warn ? 6000 : 2000);
  $('#quickRelationChips').hidden = true;
  renderQuickRelation();
}

// ---------------------------------------------------------------- 人设页（开始之前）

/** 关系标签直接用 relation.js 里那份（名字和提示词里的定义是同一份，不会跑偏） */
const RELATION_PRESETS = RELATION_NAMES;

/** 初始环境——校园和工作场景都给一些，谁都能用上 */
const SCENE_PRESETS = [
  '晚上在宿舍，刚洗完澡，头发还没干',
  '图书馆里，摊着书但一个字没看进去',
  '上课中，老师在讲台上念 PPT',
  '刚下班到家，瘫在沙发上不想动',
  '在公司加班，办公室就剩我一个',
  '通勤路上，人挤人，一只手抓扶手',
  '常去的咖啡店，坐着发呆',
  '窝在自己房间，只开了一盏台灯',
  '刚吃完饭，一个人慢慢走回家',
];

/** 初始好感度——用档位名而不是数字，用户更好理解 */
const AFF_PRESETS = [
  { v: 15, label: '刚认识' },
  { v: 35, label: '有点好感' },
  { v: 55, label: '聊得来' },
  { v: 72, label: '挺喜欢' },
  { v: 88, label: '很喜欢' },
];

/**
 * 「你的职业 / 专业」的快捷标签。
 *
 * 为什么要有：填了之后她能判断出你俩是不是同行 ——
 * 同行就能聊到一块，不同行她就只聊自己那摊、不硬接你的专业。
 * 光靠打字也认得出（profession.js 里有关键词表），标签只是省事。
 */
const USER_JOB_PRESETS = [
  '程序员', '设计师', '学生', '老师', '医生', '会计',
  '销售', '运营', '土木工程', '厨师', '护士', '自由职业',
];

let perAvatar = '';        // 人设页里正在选的头像 emoji
let perTraits = [];        // 正在选的性格标签
let perAff = 45;           // 正在选的好感度
let perAffTouched = false; // 用户自己动过好感度没有（动过就不再按性格自动推荐）

/**
 * 把任意好感度吸附到最近的那一档预设。
 * 不吸附的话，性格推荐出来一个 21，而标签只有 15/35/55/72/88，
 * 结果五个标签一个都没亮，用户会以为坏了。
 */
function nearestAffPreset(v) {
  return AFF_PRESETS.reduce(
    (best, p) => (Math.abs(p.v - v) < Math.abs(best - v) ? p.v : best),
    AFF_PRESETS[0].v
  );
}

/**
 * 按「关系 + 性格」推荐初始好感度。
 *
 * 两个轴合起来算：**关系给基准**（恋人天生就热），**性格给偏移**（慢热的要减）。
 * 用户要的就是"初始设置的性格与好感度相对应"，关系同理。
 */
function suggestPerAff() {
  const rel = ($('#perRelation')?.value || '').trim();
  const base = defaultAffectionFor(rel);
  const traitAdj = suggestFromTraits(perTraits) - 45;   // 45 是 suggestFromTraits 的基准
  return nearestAffPreset(base + traitAdj);
}

/** 画一排可点的标签 */
function renderChips(sel, items, isOn) {
  const box = $(sel);
  if (!box) return;
  box.innerHTML = items.map((it) => {
    const v = typeof it === 'string' ? it : it.v;
    const label = typeof it === 'string' ? it : it.label;
    return `<button type="button" class="wx-chip${isOn(v) ? ' on' : ''}"`
      + ` data-chip="${esc(String(v))}">${esc(String(label))}</button>`;
  }).join('');
}

/** 单选的一组 seg 按钮（性别那排） */
function setSegOn(sel, v) {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
}
function segOn(sel) {
  const b = $$(`${sel} button`).find((x) => x.classList.contains('on'));
  return b ? b.dataset.v : '';
}

/** 生日那行的提示：实时显示推出的星座 */
function updateSignNote() {
  const el = $('#perSignNote');
  if (!el) return;
  const bd = parseBirthday($('#perBirthday').value);
  if (!bd) {
    el.textContent = '填了生日会自动推出星座，给她一点点底色（只是参考，不会全按星座演）。';
    return;
  }
  el.innerHTML = `生日 ${esc(birthdayText(bd.month, bd.day))} → `
    + `<b>${esc(signSummary(bd.sign))}</b><br>`
    + `星座只是参考：她会挑其中一两条像自己的，别的按上面选的性格来。`;
}

/** 好感度那行的提示：档位含义 + 跟性格/关系冲不冲突 */
function updateAffNote() {
  const el = $('#perAffNote');
  if (!el) return;
  const lv = levelOf(perAff);
  const rel = ($('#perRelation')?.value || '').trim() || '刚认识的人';
  const warns = [
    relationAffectionWarning($('#perRelation')?.value || '', perAff),
    traitAffectionWarning(perTraits, perAff),
  ].filter(Boolean);
  el.innerHTML = `现在是 <b>${perAff}</b>（${esc(lv.label)}）。<br>${esc(lv.view(rel))}`
    + warns.map((w) => `<br><span style="color:#c0392b">${esc(w)}</span>`).join('');

  const bar = $('#perAffBar');
  if (bar) {
    bar.style.width = perAff + '%';
    bar.dataset.lv = String(lv.min);
  }
}

/** 刷新人设页里所有标签的选中态 */
function renderPersonaChips() {
  renderChips('#perAvatarList', HER_EMOJIS, (v) => v === perAvatar);
  renderChips('#chipsRelation', RELATION_PRESETS, (v) => v === ($('#perRelation').value || '').trim());
  renderChips('#chipsUserJob', USER_JOB_PRESETS, (v) => v === ($('#perUserJob').value || '').trim());
  renderChips('#chipsTraits', TRAIT_PRESETS, (v) => perTraits.includes(v));
  renderChips('#chipsScene', SCENE_PRESETS, (v) => v === ($('#perScene').value || '').trim());
  renderChips('#chipsAff', AFF_PRESETS, (v) => v === perAff);
  updateSignNote();
  updateAffNote();
}

/**
 * 打开「开始之前」。
 * @param {object} [opts]
 * @param {boolean} [opts.fromSettings] 从设置页进来的（那就给个返回键）
 */
function openPersona({ fromSettings = false, asNew = false } = {}) {
  closePanels();
  closeMenu();
  const c = state.config;

  $('#perName').value = c.herName || '';
  perAvatar = c.herEmoji || CHARACTER.emoji;
  $('#perAvatarPreview').textContent = perAvatar;
  setSegOn('#segGender', isMale() ? 'm' : 'f');
  $('#perAge').value = c.herAge || '';
  $('#perJob').value = c.herJob || '';
  $('#perUserJob').value = c.userJob || '';
  $('#perRelation').value = c.herRelation || '';
  $('#perBirthday').value = c.herBirthday || '';
  $('#perTraitNote').value = c.herTraitNote || '';
  perTraits = Array.isArray(c.herTraits) ? c.herTraits.slice(0, 4) : [];
  // 大致生平
  $('#perBio').value = c.userBio || '';
  $('#perBioPreview').hidden = true;
  $('#btnBioPreview').textContent = '看看拆成几条';
  renderBioPreview();
  $('#perScene').value = state.profile.sceneCustom ? (state.profile.sceneText || '') : '';
  perAff = affection() ?? suggestPerAff();
  perAffTouched = affection() != null;

  // 第一次进来（还没设过）不给返回键：要么设完，要么点「开始聊天」。
  // 新加的好友（asNew）也算第一次 —— 得让他确认完这个人才算数。
  $('#btnClosePersona').hidden = asNew || (!fromSettings && !c.personaDone);
  $('#personaIntro').hidden = asNew ? false : !!c.personaDone;
  $('#perAvatarList').hidden = true;

  renderPersonaChips();
  // 上次可能滚到过中间，重新打开要回到顶部
  const body = $('#screen-persona').querySelector('.wx-settings-body');
  if (body) body.scrollTop = 0;
  $('#screen-persona').classList.add('show');
}

function closePersona() {
  $('#screen-persona').classList.remove('show');
  // 从人设页退出来时如果一条消息都没有（比如点了"恢复默认"再返回），
  // 聊天区会是一片空白。这里补一句开场白，别让她对着空屏幕。
  if (!state.messages.length) {
    ensureScene();
    bootGreeting();
    renderChat();
  }
}

/** 把人设页里的内容写进配置（不负责关页面） */
function applyPersona() {
  const c = state.config;

  const name = $('#perName').value.trim().slice(0, 8);
  if (name) c.herName = name; else delete c.herName;
  c.herEmoji = perAvatar || CHARACTER.emoji;

  c.herGender = segOn('#segGender') === 'm' ? 'm' : 'f';
  const age = Number($('#perAge').value);
  c.herAge = age >= 14 && age <= 80 ? Math.round(age) : 0;
  c.herJob = $('#perJob').value.trim().slice(0, 20);
  c.userJob = $('#perUserJob').value.trim().slice(0, 20);
  c.herRelation = $('#perRelation').value.trim().slice(0, 12);

  const bd = parseBirthday($('#perBirthday').value);
  c.herBirthday = bd ? `${bd.month}-${bd.day}` : '';

  c.herTraits = perTraits.slice(0, 4);
  c.herTraitNote = $('#perTraitNote').value.trim().slice(0, 40);
  c.userBio = $('#perBio').value.trim().slice(0, 600);
  c.personaDone = true;
  saveConfig();

  // 生平要点 → 永久记忆（改过就按新的重写一遍）
  applyUserBio();

  // 初始环境：写了就固定用它（之后不按时间乱换地方）
  const sc = $('#perScene').value.trim().slice(0, 60);
  if (sc) {
    state.profile.sceneText = sc;
    state.profile.sceneId = 'custom';
    state.profile.sceneAt = now();
    state.profile.sceneCustom = true;
  } else if (state.profile.sceneCustom) {
    state.profile.sceneCustom = false;
    state.profile.sceneId = null;
    ensureScene(true);
  }

  state.profile.affection = clampAffection(perAff);
  state.profile.affectionBase = state.profile.affection;
  saveProfile();

  renderHerIdentity();
  renderAffection();
  if ($('#inpHerName')) $('#inpHerName').value = c.herName || '';
  // 好友列表里的名字/头像跟着换（他刚在表单里改过的）
  state.nav = patchPersona(state.nav, state.nav.active, {
    name: herName(), emoji: herEmoji(),
  });
  savePersonaIndex();
  renderNav();
}

/** 「开始聊天」：存下来 + 如果是第一次，顺便把开场白发出来 */
function startPersona() {
  const firstRun = !state.messages.length;
  applyPersona();
  closePersona();
  if (firstRun) {
    if (!state.profile.sceneId && !state.profile.sceneCustom) ensureScene();
    bootGreeting();
    renderChat();
  } else {
    toast(`${herName()}的样子改好了`, 1800);
  }
}

/** 「恢复默认」：清掉人设，回到写死的小雨 */
function resetPersona() {
  const c = state.config;
  delete c.herName;
  delete c.herEmoji;
  delete c.herAvatar;
  c.herGender = 'f';
  c.herAge = 0;
  c.herJob = '';
  c.userJob = '';
  c.herRelation = '';
  c.herBirthday = '';
  c.herTraits = [];
  c.herTraitNote = '';
  c.userBio = '';
  c.personaDone = true;      // 别下次又弹出来
  saveConfig();

  // 生平来的那几条也跟着撤掉
  const bioOld = new Set(Array.isArray(state.profile.bioFacts) ? state.profile.bioFacts : []);
  state.profile.facts = (state.profile.facts || []).filter((f) => !bioOld.has(f));
  state.profile.factsManual = (state.profile.factsManual || []).filter((f) => !bioOld.has(f));
  for (const f of bioOld) if (state.profile.factsMeta) delete state.profile.factsMeta[f];
  state.profile.bioFacts = [];

  state.profile.sceneCustom = false;
  state.profile.sceneId = null;
  state.profile.affection = null;
  state.profile.affectionBase = null;
  saveProfile();
  ensureScene(true);

  perAvatar = CHARACTER.emoji;
  perTraits = [];
  perAff = 45;
  perAffTouched = false;

  renderHerIdentity();
  renderAffection();
  openPersona({ fromSettings: true });   // 重新填一遍表单，让人看到默认值
  toast('已经回到默认的小雨', 1800);
}

// ---------------------------------------------------------------- 搜聊天记录
//
// 匹配逻辑（纯子串、多词 and、片段截取）都在 src/search.js 里。
// ⚠️ 和【记忆检索】那一块是反着来的：那个是给模型用的"相关就行"，
// 这个是给人用的"必须原样出现"。别把两边的匹配方式搞混。

/** 在全部历史里搜（薄封装，补上消息列表） */
const searchMessages = (q) => searchIn(state.messages, q);

/**
 * 把命中的词包成 <mark>。
 * 先匹配原始文本、再逐段转义，不能在转义后的字符串上找 ——
 * 否则「&」会变成「&amp;」，下标全乱了。
 */
function markTerms(text, terms) {
  const raw = String(text || '');
  if (!terms.length) return esc(raw);

  const low = raw.toLowerCase();
  const spans = [];
  for (const t of terms) {
    let from = 0;
    for (;;) {
      const at = low.indexOf(t, from);
      if (at < 0) break;
      spans.push([at, at + t.length]);
      from = at + t.length;
    }
  }
  if (!spans.length) return esc(raw);

  // 多个词可能重叠，先合并再输出，避免嵌套 <mark>
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }

  let out = '';
  let cur = 0;
  for (const [a, b] of merged) {
    out += esc(raw.slice(cur, a)) + '<mark>' + esc(raw.slice(a, b)) + '</mark>';
    cur = b;
  }
  return out + esc(raw.slice(cur));
}

function searchHitHTML(hit, terms) {
  const out = hit.m.role === 'user';
  const who = out ? (state.config.userName || '我') : herName();
  const snip = markTerms(snippetOf(hit.m.content, terms), terms);
  return `<div class="wx-hit" data-jump="${hit.i}" role="button" tabindex="0">
    <div class="wx-hit-hd">
      <span class="who ${out ? 'me' : 'her'}">${esc(who)}</span>
      <span class="ts">${timeText(hit.m.ts)}</span>
    </div>
    <div class="wx-hit-tx">${snip}</div>
  </div>`;
}

function renderSearchResults() {
  const input = $('#memSearch');
  const panel = $('#memSearchPanel');
  const box = $('#memSearchHits');
  if (!input || !panel || !box) return;

  const q = input.value.trim();
  $('#btnMemSearchClear').hidden = !q;
  if (!q) {
    panel.hidden = true;
    box.innerHTML = '';
    return;
  }

  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  const hits = searchMessages(q);
  panel.hidden = false;
  $('#memSearchInfo').textContent = hits.length
    ? `找到 ${hits.length} 条${hits.length >= SEARCH_MAX_HITS ? '（只显示最近的这些）' : ''}`
    : '没找到。换个词试试，比如只搜「猫」。';
  box.innerHTML = hits.length
    ? hits.map((h) => searchHitHTML(h, terms)).join('')
    : `<div class="wx-mem-item dim"><span class="dot">·</span><span class="tx">你们还没聊过这个。</span></div>`;
}

/** 点搜索结果 → 回到聊天页并滚到那一条，闪一下 */
function jumpToMessage(i) {
  const m = state.messages[i];
  if (!m) return;
  $('#screen-memory').classList.remove('show');
  requestAnimationFrame(() => {
    const box = $('#messages');
    const row = box?.querySelector(`[data-i="${i}"]`);
    if (!row) return;
    // jsdom 没实现 scrollIntoView，加个可选调用免得测试炸
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1500);
  });
}

function clearSearch() {
  const input = $('#memSearch');
  if (!input) return;
  input.value = '';
  renderSearchResults();
}

function renderMemoryPage() {
  const p = state.profile;
  $('#memScene').textContent = p.sceneText || '（还没定）';

  const facts = p.facts || [];
  $('#memFacts').innerHTML = facts.length
    ? facts.map((f) => memItemHTML(f, 'fact', false)).join('')
    : `<div class="wx-mem-item dim"><span class="dot">•</span><span class="tx">还没记住什么。多聊几句她就开始记了，你也可以自己写一条。</span></div>`;

  const sum = p.summary || [];
  $('#memSummary').innerHTML = sum.length
    ? sum.slice().reverse().map((t) => memItemHTML(t, 'summary', true)).join('')
    : `<div class="wx-mem-item dim"><span class="dot">•</span><span class="tx">你们聊得还不够多。攒够 10 条消息她就会把这段对话压成要点记住。</span></div>`;

  // 「最近淡忘的」——让她遗忘这件事可见，不然用户会以为是 bug
  const faded = p.faded || [];
  const fadedWrap = $('#memFadedWrap');
  const fadedList = $('#memFaded');
  if (fadedWrap && fadedList) {
    const show = faded.slice(-6).reverse();
    fadedWrap.hidden = !show.length;
    fadedList.innerHTML = show
      .map((f) => `<div class="wx-mem-item dim"><span class="dot">·</span><span class="tx">${esc(f)}</span></div>`)
      .join('');
  }

  const n = state.messages.filter((m) => m.role !== 'system').length;
  const usedPct = Math.round((storageUsed() / QUOTA_BYTES) * 100);
  const solid = facts.filter((f) => isPermanent(p.factsMeta?.[f])).length;
  $('#memStats').textContent =
    `${n} 条消息 · ${facts.length} 件事（${solid} 件很牢） · ${sum.length} 条要点 · 存储 ${usedPct}%`;

  // 折叠标题右边的数量：收起来也能一眼看到"里面有多少东西"
  const setFoldN = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt || ''; };
  setFoldN('#foldNFacts', facts.length ? `${facts.length} 条` : '空的');
  setFoldN('#foldNSummary', sum.length ? `${sum.length} 条` : '暂无');
  setFoldN('#foldNHistory', `${n} 条`);
  setFoldN('#foldNFaded', faded.length ? `${faded.length} 条` : '');

  if ($('#memPreview') && !$('#memPreview').hidden) renderMemoryPreview();
}

/**
 * 把她这次要读到的记忆**原样**显示出来。
 *
 * 用 memoryBlock() 生成，和真正发出去的是同一段代码——
 * 预览和实际不一致就等于骗人。
 */
function renderMemoryPreview() {
  const el = $('#memPreview');
  if (!el) return;

  const blocks = [];
  const mem = memoryBlock(state.profile, state.profile.summary);
  blocks.push(mem || '（她还什么都没记住——多聊几句，或者在上面手动加几条）');

  blocks.push(`【现在的时间】\n${currentTimeText()}`);

  const s = currentScene();
  if (s?.text) blocks.push(sceneHint(s));

  const recent = buildChatContext();
  const chars = recent.reduce((a, m) => a + String(m.content).length, 0);
  blocks.push(`【最近的对话记录】\n这次会带上最近 ${recent.length} 条（约 ${chars} 字）`);
  if (recent.length) {
    blocks.push(recent.slice(-6).map((m) =>
      `${m.role === 'user' ? '他' : '你'}：${String(m.content).replace(/\n/g, ' / ').slice(0, 40)}`).join('\n'));
  }

  el.textContent = blocks.join('\n\n──────────\n\n');
}

function toggleMemoryPreview() {
  const el = $('#memPreview');
  if (!el) return;
  el.hidden = !el.hidden;
  $('#btnShowRecap').textContent = el.hidden ? '看看' : '收起';
  if (!el.hidden) renderMemoryPreview();
}

/** 让"手动加的"这些东西真正进到她脑子里（下一次回复就会带上） */
function memoryRecap() {
  return {
    facts: autoList('fact').length + manualList('fact').length,
    summary: autoList('summary').length + manualList('summary').length,
  };
}

/** 记忆页的添加/删除（事件委托，列表是动态渲染的） */
function bindMemoryEditing() {
  const wire = (btnSel, inpSel, which) => {
    const btn = $(btnSel);
    const inp = $(inpSel);
    if (!btn || !inp) return;
    const submit = () => {
      if (addMemory(which, inp.value)) inp.value = '';
    };
    btn.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  };
  wire('#btnAddFact', '#inpNewFact', 'fact');
  wire('#btnAddSummary', '#inpNewSummary', 'summary');

  $('#btnShowRecap')?.addEventListener('click', toggleMemoryPreview);

  $('#screen-memory').addEventListener('click', (e) => {
    // ☆/★：标成执念（她永远不会忘）或取消
    const s = e.target.closest('.wx-mem-star');
    if (s) {
      let t = '';
      try { t = decodeURIComponent(s.dataset.obsText || ''); } catch {}
      toggleObsession(t);
      return;
    }
    const b = e.target.closest('.wx-mem-del');
    if (!b) return;
    const which = b.dataset.delWho === 'summary' ? 'summary' : 'fact';
    let text = '';
    try { text = decodeURIComponent(b.dataset.delText || ''); } catch {}
    deleteMemory(which, text);
  });
}


function openMemory() {
  closePanels();
  closeMenu();
  renderMemoryPage();
  renderSearchResults();
  $('#screen-memory').classList.add('show');
}

function changeScene() {
  ensureScene(true);
  renderMemoryPage();
  toast('换了个场景', 1600);
}

function buildHistoryText() {
  const lines = state.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const t = new Date(m.ts || Date.now());
      const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `[${t.getMonth() + 1}/${t.getDate()} ${hm}] ${m.role === 'user' ? (state.config.userName || '他') : herName()}：${m.content}`;
    });
  return `# 和${herName()}的聊天记录\n` +
    `她记得关于你的事：${(state.profile.facts || []).join('；') || '（无）'}\n` +
    `对话要点：\n${(state.profile.summary || []).map((s) => '- ' + s).join('\n') || '（无）'}\n\n` +
    `---\n\n${lines.join('\n')}`;
}

async function copyHistory() {
  const text = buildHistoryText();
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制，可以粘给别的 AI', 2400);
  } catch {
    // 老浏览器兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); }
    catch { toast('复制失败，试试"存成文件"', 2600); }
    ta.remove();
  }
}

function downloadHistory() {
  const text = buildHistoryText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `和${herName()}的聊天记录_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('已导出');
}

function clearSummary() {
  if (!confirm('清空对话要点？（完整聊天记录会保留）')) return;
  state.profile.summary = [];
  state.profile.summarizedUpTo = 0;
  saveProfile();
  renderMemoryPage();
  toast('要点已清空');
}

// ---------------------------------------------------------------- 导入聊天记录
//
// 文本解析、时间戳归一化、记忆合并都在 src/memory-io.js。
// 这里只做"读表单 → 落进 state → 重画界面 → 告诉用户结果"。

/** 解析导出的聊天记录文本（哪些名字算"她"，由提示词那边的名字决定） */
function parseHistoryText(text) {
  return parseHistory(text, [herName(), CHARACTER.name, CHARACTER.realName, '小雨', 'AI', '助手']);
}

function doImportHistory() {
  const out = $('#importResult');
  const raw = $('#importText').value;
  const mode = $('#segImport button.on')?.dataset.v || 'merge';

  const { messages, facts } = parseHistoryText(raw);
  if (!messages.length) {
    out.hidden = false;
    out.className = 'wx-test-result bad';
    out.textContent = '没解析出任何消息。请确认格式像这样：\n[7/14 22:13] 阿哲：今天好累';
    return;
  }

  const incoming = stampImported(messages, now());
  const added = messages.filter((m) => m.role === 'user').length;

  if (mode === 'replace') {
    if (!confirm(`用导入的 ${incoming.length} 条消息替换全部现有记录？`)) return;
    state.messages = incoming;
  } else {
    state.messages = [...state.messages, ...incoming];
  }

  // 顺带导入她记得的事
  const factsAdded = mergeFacts(state.profile, facts);
  state.profile.msgCount = state.messages.length;
  saveProfile();
  saveChat();

  // 导入后让她重新认识上下文（把导入的记录压成要点）
  pushSummary();

  renderChat();
  renderMemoryPage();

  const total = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  out.hidden = false;
  out.className = 'wx-test-result ok';
  out.textContent = `✅ 导入成功：${incoming.length} 条消息（其中你的 ${added} 条）`
    + (factsAdded ? `，新增 ${factsAdded} 条记忆` : '')
    + (mode === 'merge' ? '。已追加到现有记录后面。' : '。已替换原有记录。')
    + `\n\n她现在一共记得 ${total} 条对话。`
    + `\n想确认她真的读到了？点上面的「看看」，会把她这次要读的记忆原样列出来。`;
  toast('导入完成，她已经记住了', 3000);
}

function toggleImportPanel() {
  const panel = $('#importPanel');
  panel.hidden = !panel.hidden;
  // 它现在藏在「完整聊天记录」这个折叠区里，得先把折叠展开
  if (!panel.hidden) {
    const fold = $('#foldHistory');
    if (fold) fold.open = true;
    // jsdom 没实现 scrollIntoView，加个可选调用免得测试炸
    panel.scrollIntoView?.({ block: 'center' });
    $('#importText').focus();
  }
}

// ---------------------------------------------------------------- 名字与头像（你 / 她）

const HER_EMOJIS = ['🌧️','🌸','🌙','✨','🎧','🐱','🍃','💫','🌊','🦋','🍰','☕','🎀','🌻','🐰','🌼'];
const MY_EMOJIS  = ['😀','😎','🐱','🐶','🦊','🐼','🐧','🐻','🎮','⚽','🎧','📷','☕','🌙','⭐','🚀'];

/** 当前头像面板在给谁换：'her' 或 'me' */
let avatarTarget = 'her';

/** 头像相关的一组访问器，避免到处写 if (who === 'her') */
function avatarOps(who) {
  const her = who === 'her';
  return {
    who,
    title: her ? '给她选一个头像' : '给你自己选一个头像',
    list: her ? HER_EMOJIS : MY_EMOJIS,
    preview: her ? '#herAvatarPreview' : '#myAvatarPreview',
    pic: () => (her ? herAvatarPic() : myAvatarPic()),
    emoji: () => (her ? herEmoji() : myEmoji()),
    // 没有 emoji 也没图片时，预览里显示的占位
    fallback: () => (her ? herEmoji() : myInitial()),
    setEmoji(e) {
      if (her) { state.config.herEmoji = e; delete state.config.herAvatar; }
      else { state.config.myEmoji = e; delete state.config.myAvatar; }
    },
    setPic(dataUrl) {
      if (her) { state.config.herAvatar = dataUrl; }
      else { state.config.myAvatar = dataUrl; }
    },
    reset() {
      if (her) { delete state.config.herAvatar; delete state.config.herEmoji; }
      else { delete state.config.myAvatar; delete state.config.myEmoji; }
    },
  };
}

/** 画一个头像预览圆点 */
function renderAvatarPreview(who) {
  const op = avatarOps(who);
  const el = $(op.preview);
  if (!el) return;
  const pic = op.pic();
  if (pic) {
    el.style.backgroundImage = `url(${pic})`;
    el.textContent = '';
    el.classList.add('pic');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('pic');
    el.textContent = who === 'her' ? op.emoji() : (op.emoji() || op.fallback());
  }
}

/** 头像 emoji 候选列表（跟着 avatarTarget 走） */
function renderAvatarPanel() {
  const op = avatarOps(avatarTarget);
  const title = $('#avatarPanelTitle');
  if (title) title.textContent = op.title;

  const list = $('#avatarEmojiList');
  if (!list) return;
  const pic = op.pic();
  const cur = op.emoji();
  list.innerHTML = op.list
    .map((e) => `<button data-emoji="${e}" class="${!pic && e === cur ? 'on' : ''}">${e}</button>`)
    .join('');
}

/** 把名字/头像应用到界面各处 */
function renderHerIdentity() {
  // 顶栏名字
  const nav = $('#navName');
  if (nav) nav.textContent = herName();
  // 浏览器标签页也跟着走（PWA 加到桌面后看的就是它）
  document.title = herName();

  // 设置页输入框
  const inp = $('#inpHerName');
  if (inp && document.activeElement !== inp) inp.value = state.config.herName || '';
  const inpMe = $('#inpUserName');
  if (inpMe && document.activeElement !== inpMe) inpMe.value = state.config.userName || '';

  renderAvatarPreview('her');
  renderAvatarPreview('me');
  renderAvatarPanel();
}

/** 改完头像/名字后重画聊天，让气泡头像立即更新 */
function refreshAll() {
  renderHerIdentity();
  renderChat();
  if (typeof renderMemoryPage === 'function') {
    try { renderMemoryPage(); } catch {}
  }
}

function setAvatarEmoji(emoji) {
  avatarOps(avatarTarget).setEmoji(emoji);
  saveConfig();
  refreshAll();
  toast(avatarTarget === 'her' ? '她的头像已更换' : '你的头像已更换', 1600);
}

function resetAvatar() {
  avatarOps(avatarTarget).reset();
  saveConfig();
  refreshAll();
  toast('已恢复默认', 1600);
}

/** 读图片文件 → 压到 256px 存成 base64（避免 localStorage 爆掉） */
function handleAvatarFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('请选一张图片'); return; }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // 居中裁成正方形
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      avatarOps(avatarTarget).setPic(dataUrl);
      saveConfig();
      refreshAll();
      toast('头像已更新', 1800);
    };
    img.onerror = () => toast('这张图读不了，换一张试试');
    img.src = String(reader.result);
  };
  reader.onerror = () => toast('读取文件失败');
  reader.readAsDataURL(file);
}

/** 打开"下载安卓版"页面 */
function openDownloadPage() {  // 已经在安卓版里就没必要再下载
  if (nativeReady) {
    toast('你正在用安卓版 ✅ 已经可以离线聊了', 2600);
    return;
  }
  window.location.href = './download';
}

// ---------------------------------------------------------------- 隔久了再打开

/**
 * 打开时要不要让她主动开口（同步判断，供 init 决策）。
 *
 * 注意：真正的开场白是交给**模型生成**的（见 speakUp('return')），
 * 不是模板拼接。
 */
function shouldSpeakOnReturn() {
  if (!state.config.autoSpeak) return false;
  if (state.profile.msgCount < 4) return false;          // 刚认识，别自来熟
  const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (msgs.length < 2) return false;
  const gapH = (now() - (msgs[msgs.length - 1].ts || 0)) / 3600000;
  return gapH >= 2;                                      // 刚聊完就别硬打招呼
}

/** 从一句话里抠出一个能当"话题"的短句（只在降级时用） */
function pickTopic(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u.test(t)) return '';   // 纯表情

  // 结束语 / 寒暄：这种句子**不能**当话题来追问。
  // 以前没这层过滤，于是"睡吧"会被拼成"上次你说睡吧，后来呢"——非常傻。
  if (/^(睡吧|睡了|我去睡|晚安|早安|好的|好吧|行吧|行|嗯+|哦+|啊+|是吗|在吗|在么|在不在|你好|哈喽|拜拜|再见|88|先这样|回头聊|晚点聊|我忙|忙去了|出去一下|不聊了|我困了|哈哈+|嘿嘿|呵呵|笑死|6+|ok|okay|hi|hey|bye)[。！？!?~～，,、\s]*$/i.test(t)) return '';

  // 他问的问题，不该当成"你说过的事"再追问他
  if (/[？?]$/.test(t)) return '';

  t = t.replace(/^(在吗|在不在|在么|你好|哈喽|hi|hey|喂)[，,。!！~～\s]*/i, '');
  t = t.replace(/[。！？!?~～，,、\s]+$/, '');
  if ([...t].length < 8) return '';         // 太短，当话题没意义
  return [...t].slice(0, 20).join('');
}

/**
 * 模型用不了时的兜底开场白。
 *
 * 刻意**不套用他最后说的那句话**——机械拼接在"睡吧""好的"这种
 * 结束语上会非常生硬。宁可只说一句通用的招呼，也不要硬接。
 */
function returnFallbackGreeting() {
  const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (msgs.length < 2) return false;
  const gapH = (now() - (msgs[msgs.length - 1].ts || 0)) / 3600000;
  if (!(gapH >= 2)) return false;

  const far = gapH > 72;
  const lines = far
    ? ['好久没见你冒泡了', '最近在忙什么']
    : ['诶 你回来啦', '在忙吗'];

  const t = now();
  lines.forEach((content, i) => {
    state.messages.push({
      role: 'assistant',
      content,
      ts: t + i,
      mid: i < lines.length - 1,
    });
  });
  saveChat();
  return true;
}

// ---------------------------------------------------------------- 她会主动找你说话

/**
 * 主动开口。
 *
 * 和 respond() 的区别：respond 是"回应他"，这是"自己起话头"。
 * 所以系统提示里要额外说明当前情况，并明确允许她起新话题。
 *
 * 触发时机：
 *   - 隔了很久再打开（init 时）
 *   - 打开着聊天页但他半天没动静（定时器）
 *   - 从后台切回前台（说明他刚回来看手机）
 */

/** 一次会话里最多主动开口几次，免得烦人 */
const IDLE_SPEAK_LIMIT = 2;
/** 他多久没动静，她才主动开口（毫秒） */
const IDLE_MS = 4 * 60 * 1000;

let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/** 每次他说话 / 她回复之后调用：重新开始计时 */
function armIdleTimer() {
  clearIdleTimer();
  if (!state.config.autoSpeak) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (state.profile.msgCount < 4) return;        // 刚认识，别自来熟
  idleTimer = setTimeout(tryIdleSpeak, IDLE_MS);
}

async function tryIdleSpeak() {
  idleTimer = null;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (state.generating) return;
  if (!state.config.autoSpeak) return;
  if ((state.idleSpoken || 0) >= IDLE_SPEAK_LIMIT) return;
  // 没配 Key（也不是本地模型）就别白费力气
  if (!hasKey() && !getProvider(state.config.provider)?.local) return;
  state.idleSpoken = (state.idleSpoken || 0) + 1;
  await speakUp('idle');
}

/** 从后台切回前台：他刚回来看手机，隔了一会儿就由她先开口 */
function onVisibilityChange() {
  if (document.hidden) { clearIdleTimer(); return; }
  const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const lastTs = msgs[msgs.length - 1]?.ts || 0;
  const awayMin = lastTs ? (now() - lastTs) / 60000 : 0;
  if (state.config.autoSpeak && awayMin >= 10 && awayMin < 60 * 12
      && !state.generating && (state.idleSpoken || 0) < IDLE_SPEAK_LIMIT
      && state.profile.msgCount >= 4) {
    state.idleSpoken = (state.idleSpoken || 0) + 1;
    speakUp('return');
    return;
  }
  armIdleTimer();
}

/**
 * 让她说一句"不是回应他"的话。
 * @param {'idle'|'return'} reason
 * @returns {Promise<boolean>} 真的开口了才 true（失败/没条件时 false，好让调用方走兜底）
 */
async function speakUp(reason) {
  if (state.generating) return false;
  if (!hasKey() && !getProvider(state.config.provider)?.local) return false;

  setGenerating(true);
  const ctrl = new AbortController();
  state.abort = ctrl;
  showTyping();
  let said = false;

  try {
    const history = buildChatContext();
    const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const lastTs = msgs[msgs.length - 1]?.ts || now();

    const situation = reason === 'idle'
      ? `他刚才还在跟你聊，但已经 ${gapText(now() - lastTs)} 没动静了。`
      : `他刚打开手机看你们的聊天，距离上次说话过了 ${gapText(now() - lastTs)}。`;

    const systemPrompt = [
      buildSystemPrompt(state.profile, {
        scene: currentScene(),
        timeText: currentTimeText(),
        summary: state.profile.summary,
        herName: herName(),
        persona: personaForPrompt(),
      me: myMe(),
        affection: affection(),
        affectionBase: state.profile.affectionBase,
        relation: state.config.herRelation,
      }),
      `【现在的情况】
${situation}

现在轮到你**主动开口**——注意，不是回应他，是你自己起话头。

⚠️ 最容易犯的错（一定要避开）：
**不要机械地把他最后说的那句话当成话题来追问。**
比如他最后一句是"睡吧""好的""在吗""嗯"，你回一句"上次你说睡吧，后来呢"——那就非常傻。
他是人，那句话只是在结束对话，不是一件事。

判断一下他最后那句话是哪种：
- **结束语 / 寒暄**（睡吧、晚安、好的、行、在吗、哈哈、拜拜、我先忙）
  → 别接那句。自然点：打个招呼（"醒啦""在忙吗"）、说说你自己的事、或者起个新话题
- **有内容的事**（项目上线、跟人吵架、要考试、家里的事）
  → 可以关心进展（"你那个项目怎么样了"），但要说得像随口问的，不要像复述

其他可选的开口方式：
- 说说你自己刚发生的事（"我刚跟圆圆吵了一架"）
- 突然想到什么（"诶我问你个事"）
- 看到/听到什么好玩的想分享
- 实在没得说，就简单一句"在忙吗""人呢"——也比硬接那句话好

说 1-2 条短消息就行，别一次堆太多。可以带一个括号旁白（但后面必须有话）。`,
    ].join('\n\n');

    let full = '';
    if (getProvider(state.config.provider).id === 'native-local') {
      full = await nativeStreamChat({
        systemPrompt,
        messages: history,
        temperature: Number(state.config.temperature) || 1.0,
        maxTokens: 120,
        signal: ctrl.signal,
      });
    } else {
      await streamChat({
        apiKey: state.config.apiKey.trim(),
        endpoint: state.config.endpoint || DEFAULT_ENDPOINT,
        model: state.config.model || DEFAULT_MODEL,
        systemPrompt,
        messages: history,
        temperature: Number(state.config.temperature) || 1.0,
        maxTokens: 120,
        thinking: !!state.config.thinking,
        signal: ctrl.signal,
        onDelta(piece) { full += piece; },
      });
    }

    const { clean } = extractMemory(full);
    let parts = splitMessages(clean, 2);
    if (!parts.length) { hideTyping(); return false; }

    hideTyping();
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i];
      const isLast = i === parts.length - 1;
      showTyping();
      await sleep(Math.min(700, Math.max(240, piece.length * 40)));
      hideTyping();
      const msg = { role: 'assistant', content: piece, ts: now(), mid: !isLast };
      state.messages.push(msg);
      appendRow(msg);
      scrollToLatest();
      if (!isLast) await sleep(220);
    }
    saveChat();
    said = true;
  } catch (e) {
    // 主动开口失败就算了，别弹错误打扰他
    hideTyping();
  } finally {
    hideTyping();
    setGenerating(false);
    state.abort = null;
    state.profile.lastChatAt = now();
    saveProfile();
    armIdleTimer();
  }
  return said;
}

/**
 * 安卓版下载入口。
 *
 * 聊天页顶部原来挂着一条绿横幅（"📱 装安卓版可完全离线聊"），
 * 用户说太抢眼 —— 现在是**整块删掉**，不再靠 `hidden` 藏。
 *
 * 为什么不留着靠 hidden 藏：`.wx-dl-bar` 有 `display: flex`，
 * 会盖过 [hidden] 的默认处理，于是 bar.hidden = true 完全不起作用，
 * 横幅照挂（用户就是这么又看到它的）。看不见的东西不如不存在。
 * 现在入口只有「设置 → 数据 → 手机离线版」和 ··· 菜单里那一条。
 */
/**
 * 下载入口：只在"这个部署真的发了安装包"时才露出来。
 *
 * 判断依据就是 config.js 里的 APK_URL —— 留空 = 不发安装包（开源版就是这样），
 * 那就别把这个入口挂在那儿骗人点。
 */
function setupDownloadEntry() {
  $('#btnDownloadBar')?.addEventListener('click', openDownloadPage);
  if (!APK_URL) $('#apkEntry')?.setAttribute('hidden', '');
}

// ---------------------------------------------------------------- 启动

function bootGreeting() {
  if (state.messages.length) return;
  const t = now();

  // 从预设加的好友：用预设自带的开场白，比通用问候更像这个人
  // （只在第一次见面时用一次，之后就按普通聊天走）
  const presetOpening = String(state.config.pendingOpening || '').trim();
  if (presetOpening) {
    delete state.config.pendingOpening;
    saveConfig();
    const parts = presetOpening.split('\n\n').map((s) => s.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      state.messages.push({
        role: 'assistant', content: p, ts: t + i, mid: i < parts.length - 1,
      });
    });
    saveChat();
    return;
  }

  const parts = greeting(t).split('\n\n').filter(Boolean);
  parts.forEach((p, i) => {
    state.messages.push({
      role: 'assistant',
      content: p,
      ts: t + i,
      mid: i < parts.length - 1,
    });
  });
  saveChat();
}

// ---------------------------------------------------------------- 事件绑定
//
// 原来这里是一个 300 多行的 bindEvents（圈复杂度 51）—— 四个界面的绑定全堆在
// 一起，想找一个按钮得在 300 行里翻。现在按界面拆开，每组只管自己那一块；
// 「点标签」「点单选组」这两种出现很多次的样板也抽成了通用绑定器。

/**
 * 点标签的通用绑定：把最近的那个 [data-chip] 的值交给回调。
 *
 * 关系 / 性格 / 初始环境 / 好感度 / 头像 / 快改关系 —— 全是这个模式，
 * 以前每处都要写一遍 closest + 判空，六份样板。
 */
function onChip(sel, handler) {
  const box = $(sel);
  if (!box) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (b) handler(b.dataset.chip, b);
  });
}

/** 一组单选按钮（seg）的通用绑定 */
function onSeg(sel, handler) {
  const box = $(sel);
  if (!box) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) handler(b.dataset.v, b);
  });
}

/** 聊天页底部：输入框、表情、发送、回到最新 */
function bindComposer() {
  const input = $('#input');
  input.addEventListener('input', () => { autoGrow(); syncSendBtn(); });
  input.addEventListener('focus', closePanels);
  input.addEventListener('keydown', (e) => {
    // 手机上回车是换行，电脑上回车直接发
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (e.key === 'Enter' && !e.shiftKey && !mobile) {
      e.preventDefault();
      send();
    }
  });
  $('#btnSend').addEventListener('click', send);

  $('#btnEmoji').addEventListener('click', () => {
    const open = $('#emojiPanel').hidden;
    closePanels();
    $('#emojiPanel').hidden = !open;
    if (open) input.blur();
  });
  $('#emojiGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-emoji]');
    if (!b) return;
    input.value += b.dataset.emoji;
    autoGrow();
    syncSendBtn();
    buzz(8);
  });
  $('#btnPlus').addEventListener('click', () => {
    const open = $('#plusPanel').hidden;
    closePanels();
    $('#plusPanel').hidden = !open;
    if (open) {
      renderClock();       // 打开时刷新一下时钟显示
      renderAffection();   // 好感度也可能刚变过
    }
  });

  $('#messages').addEventListener('scroll', () => {
    $('#btnScrollBottom').hidden = nearBottom(160);
  });
  $('#btnScrollBottom').addEventListener('click', () => scrollToLatest(true));
}

/** 「+」面板：好感度手动调、关系快改、关系提示条、内置时钟、清空/设置入口 */
function bindPlusPanel() {
  const panel = $('#plusPanel');

  // 好感度 ±
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aff]');
    if (!b) return;
    const cur = affection() ?? 50;
    state.profile.affection = clampAffection(cur + Number(b.dataset.aff));
    // 第一次手动调之前没设过 → 就当这成了她的初始值
    if (state.profile.affectionBase == null) state.profile.affectionBase = state.profile.affection;
    saveProfile();
    renderAffection();
  });

  // 内置时钟：时间调节
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clock]');
    if (!b) return;
    shiftClock(b.dataset.clock);
    buzz(10);
  });

  // 直接选日期时间（手机上点开是系统滚轮，年月日时分都能改）
  $('#clockPick').addEventListener('change', (e) => {
    const t = new Date(e.target.value).getTime();
    if (Number.isFinite(t)) setClockTo(t);
  });

  // 关系快改
  $('#btnQuickRelation').addEventListener('click', () => {
    const box = $('#quickRelationChips');
    box.hidden = !box.hidden;
    if (!box.hidden) renderQuickRelation();
  });
  onChip('#quickRelationChips', quickSetRelation);

  // 「关系好像变了？」提示条
  $('#btnRelationTipApply').addEventListener('click', applyRelationTip);
  $('#btnRelationTipClose').addEventListener('click', dismissRelationTip);

  $('#btnClearChat').addEventListener('click', () => { closePanels(); clearAll(); });
  $('#btnSettings')?.addEventListener('click', () => { closePanels(); openSettings(); });
}

/** 底部菜单（···）里的动作 */
function bindMenu() {
  $('#btnMore').addEventListener('click', openMenu);

  // 用 data-act 查表分发：加一项只要加一行，不用再写一个 if
  const ACTIONS = {
    restart: restartChat,
    clearHistory: clearAll,
    forget: forgetMemory,
    settings: openSettings,
    memory: openMemory,
    download: openDownloadPage,
  };
  $('#mask').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    closeMenu();
    if (!act || act === 'cancel') return;
    ACTIONS[act]?.();
  });
}

/** 人设页（「开始之前」） */
function bindPersonaForm() {
  $('#btnOpenPersona')?.addEventListener('click', () => openPersona({ fromSettings: true }));
  $('#btnPersonaStart').addEventListener('click', startPersona);
  $('#btnPersonaReset').addEventListener('click', resetPersona);
  $('#btnClosePersona').addEventListener('click', closePersona);

  // 头像
  $('#btnPerAvatar')?.addEventListener('click', () => {
    const list = $('#perAvatarList');
    list.hidden = !list.hidden;
    renderPersonaChips();
  });
  onChip('#perAvatarList', (v) => {
    perAvatar = v;
    $('#perAvatarPreview').textContent = perAvatar;
    $('#perAvatarList').hidden = true;
    renderPersonaChips();
  });

  // 性别
  onSeg('#segGender', (v) => {
    setSegOn('#segGender', v);
    renderAffection();   // 「她/他此刻对你的感觉」这句话要跟着变
  });

  // 关系
  onChip('#chipsRelation', (v) => {
    $('#perRelation').value = v;
    // 关系变了 → 温度基准也变（用户没自己动过好感度的话）
    if (!perAffTouched) perAff = suggestPerAff();
    renderPersonaChips();
  });
  $('#perRelation').addEventListener('input', () => {
    renderChips('#chipsRelation', RELATION_PRESETS, (v) => v === ($('#perRelation').value || '').trim());
    if (!perAffTouched) perAff = suggestPerAff();
    renderChips('#chipsAff', AFF_PRESETS, (v) => v === perAff);
    updateAffNote();
  });

  // 我的职业 / 专业（只影响她知道什么、以及"同行能不能聊专业"）
  onChip('#chipsUserJob', (v) => { $('#perUserJob').value = v; renderPersonaChips(); });
  $('#perUserJob').addEventListener('input', () =>
    renderChips('#chipsUserJob', USER_JOB_PRESETS, (v) => v === $('#perUserJob').value.trim()));

  // 性格（最多 4 个）
  onChip('#chipsTraits', (t) => {
    if (perTraits.includes(t)) perTraits = perTraits.filter((x) => x !== t);
    else if (perTraits.length >= 4) { toast('最多挑 4 个', 1600); return; }
    else perTraits = [...perTraits, t];
    // 用户没自己动过好感度 → 按「关系 + 性格」自动推荐
    if (!perAffTouched) perAff = suggestPerAff();
    renderPersonaChips();
  });

  // 生日 → 星座
  $('#perBirthday').addEventListener('input', updateSignNote);

  // 大致生平：这里只做拆分预览，点「开始聊天」才真的写进记忆
  $('#perBio').addEventListener('input', renderBioPreview);
  $('#btnBioPreview').addEventListener('click', () => {
    const el = $('#perBioPreview');
    el.hidden = !el.hidden;
    $('#btnBioPreview').textContent = el.hidden ? '看看拆成几条' : '收起';
    renderBioPreview();
  });

  // 初始环境
  const syncSceneChips = () =>
    renderChips('#chipsScene', SCENE_PRESETS, (v) => v === $('#perScene').value);
  onChip('#chipsScene', (v) => { $('#perScene').value = v; syncSceneChips(); });
  $('#perScene').addEventListener('input', syncSceneChips);

  // 初始好感度
  onChip('#chipsAff', (v) => {
    perAff = clampAffection(v);
    perAffTouched = true;
    renderPersonaChips();
  });
}

/** 「她记得的事」：搜索、手动增删、导入导出 */
function bindMemoryScreen() {
  $('#btnOpenMemory').addEventListener('click', openMemory);
  $('#btnCloseMemory').addEventListener('click', () => {
    $('#screen-memory').classList.remove('show');
  });
  $('#btnChangeScene').addEventListener('click', changeScene);

  // 搜聊天记录
  const search = $('#memSearch');
  search.addEventListener('input', renderSearchResults);
  // 手机上回车不换行：直接收起键盘，把结果留在眼前
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  $('#btnMemSearchClear').addEventListener('click', clearSearch);
  // 点一条结果 → 跳到那段聊天（事件委托，列表是动态渲染的）
  $('#memSearchHits').addEventListener('click', (e) => {
    const hit = e.target.closest('[data-jump]');
    if (hit) jumpToMessage(Number(hit.dataset.jump));
  });

  bindMemoryEditing();
  $('#btnCopyHistory').addEventListener('click', copyHistory);
  $('#btnTxtHistory').addEventListener('click', downloadHistory);
  $('#btnClearSummary').addEventListener('click', clearSummary);
  $('#btnShowImport').addEventListener('click', toggleImportPanel);
  $('#btnDoImport').addEventListener('click', doImportHistory);
  onSeg('#segImport', (v, b) => {
    $$('#segImport button').forEach((x) => x.classList.toggle('on', x === b));
  });
}

/** 设置页：模型 / Key / 本地模型 / 数据 */
function bindSettingsForm() {
  $('#btnCloseSettings').addEventListener('click', () => {
    saveSettingsFields();
    $('#screen-settings').classList.remove('show');
  });
  $('#btnTest').addEventListener('click', testConnection);

  // 服务商切换 → 自动带出接口地址和模型
  $('#inpProvider').addEventListener('change', onProviderChange);
  $('#inpModel').addEventListener('change', () => {
    state.config.model = $('#inpModel').value;
    saveConfig();
    $('#testResult').hidden = true;
  });
  // 填完 key 就记住，不用非得点测试
  $('#inpKey').addEventListener('change', () => {
    state.config.apiKey = $('#inpKey').value.trim();
    saveConfig();
    $('#setupBanner').hidden = !needsSetup();
  });

  // 手机本地模型的下载 / 删除（事件委托，列表是动态渲染的）
  $('#nativeModels').addEventListener('click', (e) => {
    const dl = e.target.closest('[data-nm-dl]');
    const del = e.target.closest('[data-nm-del]');
    if (dl) downloadNativeModel(dl.dataset.nmDl);
    if (del) deleteNativeModel();
  });
  $('#btnSelfTest')?.addEventListener('click', runSelfTest);
  $('#btnSpeedTest')?.addEventListener('click', runSpeedTest);
  $('#btnScanModels')?.addEventListener('click', scanModels);

  bindNamesAndAvatars();
  bindReplyStyle();
  $('#btnWipe').addEventListener('click', clearAll);
}

/** 「你是」和「她的样子」：名字、头像 */
function bindNamesAndAvatars() {
  $('#inpHerName')?.addEventListener('input', () => {
    const v = $('#inpHerName').value.trim().slice(0, 8);
    if (v) state.config.herName = v; else delete state.config.herName;
    saveConfig();
    const nav = $('#navName');
    if (nav) nav.textContent = herName();
    document.title = herName();
  });

  $('#inpUserName')?.addEventListener('input', () => {
    const v = $('#inpUserName').value.trim().slice(0, 12);
    state.config.userName = v;
    if (v) state.profile.name = v;
    saveConfig();
    saveProfile();
    // 头像还是首字的话，跟着一起变
    if (!myEmoji() && !myAvatarPic()) renderAvatarPreview('me');
  });

  // 「更换」按钮：先记下这次要改的是谁，再开面板
  $$('[data-pick-avatar]').forEach((b) => {
    b.addEventListener('click', () => {
      avatarTarget = b.dataset.pickAvatar === 'me' ? 'me' : 'her';
      const p = $('#avatarPanel');
      if (!p) return;
      p.hidden = false;
      renderAvatarPanel();
      p.scrollIntoView?.({ block: 'nearest' });
    });
  });

  $('#avatarEmojiList')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-emoji]');
    if (!b) return;
    setAvatarEmoji(b.dataset.emoji);
  });
  $('#btnUploadAvatar')?.addEventListener('click', () => $('#avatarFile')?.click());
  $('#avatarFile')?.addEventListener('change', (e) => {
    handleAvatarFile(e.target.files?.[0]);
    e.target.value = '';   // 允许重复选同一个文件
  });
  $('#btnResetAvatar')?.addEventListener('click', resetAvatar);
}

/** 「她怎么回」那五组单选 */
function bindReplyStyle() {
  const SEGS = [
    ['#segLen', 'maxTokens'],
    ['#segBurst', 'burst'],
    ['#segTemp', 'temperature'],
    ['#segThink', 'thinking'],
    ['#segSpeak', 'autoSpeak'],
  ];
  for (const [sel, key] of SEGS) {
    onSeg(sel, (v) => {
      state.config[key] = Number(v);
      saveConfig();
      syncSettingsUI();
      // 刚关掉就主动开口取消计时，刚打开就重新开始计
      if (key === 'autoSpeak') { state.idleSpoken = 0; armIdleTimer(); }
      buzz(8);
    });
  }
}

function bindEvents() {
  bindComposer();
  bindPlusPanel();
  bindMenu();
  bindPersonaForm();
  bindMemoryScreen();
  bindSettingsForm();
  bindHome();
}

async function restartChat() {
  if (!confirm('清空聊天，让她重新跟你打招呼？\n（她会换个场景重新开始，但还记得关于你的事）')) return;
  state.messages = [];
  resetRecallIndex();     // 记录清空了，检索索引必须跟着丢（否则指向不存在的消息）
  saveChat();
  ensureScene(true);      // 重新开始 → 换个场景
  renderChat();
  bootGreeting();
  renderChat();
  toast('已经重新开始了');
}

async function clearAll() {
  if (!confirm('清空全部聊天记录？她就不会记得这些了。')) return;
  state.messages = [];
  resetRecallIndex();
  saveChat();
  renderChat();
  bootGreeting();
  renderChat();
  toast('已清空');
}

function forgetMemory() {
  if (!confirm('让她忘掉记住的关于你的事？\n（聊天记录会保留，但她不再"记得"）')) return;
  state.profile = {
    name: '', facts: [], lastMood: '', sessions: 0,
    sceneId: state.profile.sceneId,      // 场景不变
    sceneText: state.profile.sceneText,
    sceneAt: state.profile.sceneAt,
    summary: [],
    factsManual: [],
    summaryManual: [],
    msgCount: state.messages.length,
    summarizedUpTo: 0,
  };
  state.config.userName = '';
  $('#inpUserName').value = '';
  saveProfile();
  saveConfig();
  updateDataInfo();
  toast('她已经忘掉了');
}

function init() {
  loadLocal();
  applyAffectionDecay();   // 隔太久了？先让她凉一点，再画界面

  // 全新用户：没人设、也没聊天记录。
  // 这种情况**先别发开场白** —— 开场白是按场景和时间生成的，
  // 而人设页里能改名字、改初始环境，发早了就等于按旧设定说了一遍。
  const freshUser = !state.messages.length && !state.config.personaDone;

  ensureScene();          // 会话开始定一次场景，之后不再乱跳
  buildEmojiPanel();
  // 隔久了再打开 → 让她主动开口。
  //
  // 关键：走**模型生成**（speakUp），不是模板拼接。
  // 以前是"上次你说{他最后一句话}，后来呢"——遇到"睡吧""好的"这种结束语
  // 就会变成"上次你说睡吧，后来呢"，非常生硬。
  // 没配 Key / 调用失败才退回保守的兜底开场白（而且兜底也不套用他的话）。
  const willSpeak = !freshUser && shouldSpeakOnReturn();
  if (!freshUser && !willSpeak) bootGreeting();   // 只有全新用户才需要开场白
  renderChat();
  initFriendUI();       // 好友界面要用到上面那些函数，所以在这儿初始化
  bindEvents();
  setupDownloadEntry();
  renderAffection();
  if (freshUser) openPersona();      // 先把她定下来，再开始聊
  closeMenu();
  closePanels();
  syncSettingsUI();

  // 落到哪个页面：
  //   有聊天记录 → 直接进聊天页（老用户/老测试的默认行为，别改）
  //   全新用户   → 也进聊天页，人设页会盖在上面
  //   加了好友但还没跟这个人说过话 → 停在消息列表，让底部导航露出来
  renderNav();
  const hadHistory = state.messages.length > 0;
  if (hadHistory || freshUser) openChat();
  else showTab('msgs');
  renderMoodStrip();

  // 他打开聊天页之后要是一直不说话，隔几分钟让她主动开口
  armIdleTimer();
  document.addEventListener('visibilitychange', onVisibilityChange);

  // 隔久了刚打开：让模型生成一句自然的开场白
  if (willSpeak) {
    state.idleSpoken = (state.idleSpoken || 0) + 1;
    setTimeout(async () => {
      const ok = await speakUp('return');
      if (!ok) returnFallbackGreeting();   // 模型用不了就退回保守开场白
    }, 400);
  }
  autoGrow();
  syncSendBtn();
  $('#input').placeholder = '';
  $('#navName').textContent = herName();
  renderHerIdentity();

  if (needsSetup()) {
    setTimeout(() => {
      appendSys('还没有填 API Key，点右上角 ··· → 设置 填一下就能聊了');
      openSettings();
    }, 500);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // 早期版本注册过 Service Worker，它会把旧页面缓存住，
      // 导致更新网站后用户看不到新版。这里主动注销掉，保证始终加载最新。
      navigator.serviceWorker.getRegistrations?.()
        .then((regs) => {
          for (const r of regs) r.unregister().catch(() => {});
        })
        .catch(() => {});
      // 顺便清掉缓存
      if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
    });
  }

  // 原生探测是异步的（APK 里会成功、网页版会失败）。
  // 完成后刷新设置界面，让"手机本地模型"选项正确出现或消失。
  // （下载入口不在这里处理了：它现在只是"把横幅藏起来"，
  //   同步做掉就行，不用等原生探测，也就不会在窗口关掉之后还去碰 DOM。）
  nativeReadyPromise
    .then(() => {
      syncSettingsUI();
      renderNativeModelPanel();
    })
    .catch(() => {});

  // 测试钩子：APK 里挂上，方便远程调试/自动化验证。
  // 即使 native.js 动态导入失败，只要在原生环境里也给出基础能力，
  // 这样出问题时仍然能远程排查。
  if (isNativePlatformLite()) {
    try {
      native?.exposeTestHooks?.();
    } catch {}
    if (!window.__xiaoyu) {
      window.__xiaoyu = {
        ready: () => nativeReady,
        hasNativeModule: () => !!native,
        via: 'fallback',
      };
    }
  }

  // 测试钩子：把内部状态暴露出来，方便测试断言"当前是谁"这类东西。
  // （jsdom 的 VirtualConsole 不会把页面里的 console.log 转发出来，
  //   所以排查问题时不能靠打日志，得能读到真实状态。）
  window.__xiaoyu = Object.assign(window.__xiaoyu || {}, {
    nav: () => JSON.parse(JSON.stringify(state.nav)),
    activeName: () => herName(),
    chatScreenShown: () => $('#screen-chat').classList.contains('show'),
    chatCount: () => state.messages.length,
    openChat,
    switchPersona,
  });
}

init();

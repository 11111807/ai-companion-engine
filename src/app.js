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

  ruptureShift, ruptureBlock, turn as affectionTurn, AMEND_NEED,
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
  decayProfileFacts, hoistManualEntries, pruneFactsMeta, removeKeys,
  readGlobal, writeGlobal, omitGlobal,
} from './storage.js';
import {
  PERSONA_PRESETS, findPreset, presetToForm,
} from './presets.js';
import { ME_DEFAULTS, readMe, applyMe, meSummary } from './me.js';
import { createFriendUI } from './friend-ui.js';

import { createEndingUI } from './ending-ui.js';

import { createRepair } from './repair.js';
import {
  MOODS, MOOD_KEYS, MAX_SHOWN, moodMeta, topMoods, decayMood, blend, normalize as normalizeMood,
  parseMoodBlock, guessMood, moodBlock, moodText,
} from './mood.js';
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
  mergeFacts, todayTimeline,
} from './memory-io.js';
import { SEARCH_MAX_HITS, searchMessages as searchIn, snippetOf } from './search.js';
import { splitNarration, recentNarrations, narrationVaryBlock, isLazyNarration } from './narration.js';

import { replyItems as chunkItems, isLeaked } from './chunk.js';
import { parseThoughtBlock, thinkPause, recentThoughts, thoughtVaryBlock } from './thought.js';

import { repeatedTopics, repeatBlock } from './repeat.js';

import { voiceOf, voiceHint } from './voice.js';
import { detectEnding, DREAM_NARRATION, ENDING_DIALOG } from './ending.js';
import { APK_URL } from './config.js';

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
      ? `她那边比现实${off.startsWith('+') ? '快' : '慢'} ${off.slice(1)}`
        + `（**累计**的：你之前拨过的也算在里面）。她说"几点了"就按上面那个时刻。`
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

function applyTimeJump() {
  renderClock();
  refreshTimeDividers();

  ensureScene();
  const off = clockOffsetText();

  const d = new Date(now());
  const at = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  toast(off ? `她那边现在是 ${at}` : '时间已回到现在', 1800);
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

const state = {
  config: {
    apiKey: '',
    provider: 'deepseek',
    model: DEFAULT_MODEL,
    endpoint: DEFAULT_ENDPOINT,
    maxTokens: 250,
    burst: 3,
    temperature: 1.0,
    thinking: false,
    showThink: true,
    autoSpeak: true,
    clockOffset: 0,
    userName: '',

    herGender: 'f',
    herAge: 0,
    herJob: '',
    herRelation: '',
    herBirthday: '',
    herTraits: [],
    herTraitNote: '',
    userBio: '',
    personaDone: false,

    myJob: '',
    myAge: 0,
    myGender: '',
    myBirthday: '',
  },
  messages: [],
  profile: {
    name: '',
    facts: [],
    lastMood: '',
    sessions: 0,
    sceneId: null,
    sceneText: '',
    sceneCustom: false,
    summary: [],
    msgCount: 0,
    affection: null,
    affectionBase: null,

    rupture: false,
    amends: 0,
    scar: 0,
  },
  generating: false,
  abort: null,
  typingNode: null,

  pendingDream: false,

  nav: null,
};

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

    applyGlobalConfig,

    notePendingNew,
    resetChatRender,
    renderHerIdentity, renderAffection, renderClock, renderChat,
    openPersona, openSettings, openMenu, toast,
    nearestAffPreset, defaultAffectionFor,

    readMe, applyMe, meSummary,
    herName, herEmoji, parseBirthday,
    setSegOn, segOn, renderAvatarPreview, onSeg,
    pickAvatarForMe: () => openAvatarPanel('me'),
  });
}

const switchPersona = (id) => friendUI.switchPersona(id);
const openChat = (id) => friendUI.openChat(id);
const closeChat = () => friendUI.closeChat();
const showTab = (tab) => friendUI.showTab(tab);
const renderNav = () => friendUI.renderNav();
const renderMsgList = () => friendUI.renderMsgList();
const renderMe = () => friendUI.renderMe();
const refreshUnreadDot = () => friendUI.refreshUnreadDot();
const bindHome = () => friendUI.bindHome();

function openAvatarPanel(who) {
  avatarTarget = who === 'me' ? 'me' : 'her';
  const p = $('#avatarPanel');
  if (!p) return;
  p.hidden = false;
  renderAvatarPanel();
  requestAnimationFrame(() => p.classList.add('show'));
}

function closeAvatarPanel() {
  const p = $('#avatarPanel');
  if (!p) return;
  p.classList.remove('show');
  p.hidden = true;
}

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

function loadPersona(id) {

  if (!id || !findPersona(state.nav, id)) {
    state.messages = [];
    for (const key of Object.keys(state.profile)) delete state.profile[key];
    fixProfileShape(state.profile, state.messages);
    return;
  }

  const k = keysFor(id);
  Object.assign(state.config, readJSON(k.config, {}));

  applyGlobalConfig();
  const chat = readJSON(k.chat, []);

  state.messages = Array.isArray(chat) ? chat : [];

  const prof = readJSON(k.profile, {});
  for (const key of Object.keys(state.profile)) delete state.profile[key];
  Object.assign(state.profile, prof);
  fixProfileShape(state.profile, state.messages);
  fixConfigShape(state.config, saveConfig);

  applyMe(state.profile, state.config);
}

function loadLocal() {
  loadNav();
  loadPersona(state.nav.active);
}

function saveConfig() {

  writeGlobal(state.config);

  writeConfig(omitGlobal(state.config), navKeys().config);
}

function applyGlobalConfig() {
  Object.assign(state.config, readGlobal(state.config));
}

/** 配额满了：尽量少砍，并且把砍了多少明确告诉他（别闷声丢记录） */
function saveChat() {
  const r = writeChat({ messages: state.messages, key: navKeys().chat });
  if (!r.ok) {

    toast('本地存储满了：连一条记录都存不下。去设置里换个小头像，或者清空聊天记录。', 5200);
    return;
  }
  state.messages = r.kept;
  if (!r.dropped) return;
  const w = quotaWarning(r.dropped, r.kept.length);
  toast(w.toast, 6000);
  appendSys(w.sys);
}

function saveProfile() {
  const t = now();
  decayProfileFacts(state.profile, t);
  hoistManualEntries(state.profile, t);
  pruneFactsMeta(state.profile);
  writeProfile(state.profile, state.profile, navKeys().profile);
}

/** 存好友索引（列表、顺序、当前是谁） */
const savePersonaIndex = () => writeJSON(PERSONAS_KEY, state.nav);

/** 当前好友此刻的情绪（存在他的档案里，所以每个好友各是各的） */
const currentMood = () => state.profile.mood || null;

function applyMood(incoming) {
  if (!incoming) return false;
  const t = now();
  const last = Number(state.profile.moodAt) || t;
  const dtMin = Math.max(0, (t - last) / 60000);
  state.profile.mood = blend(currentMood(), incoming, dtMin);
  state.profile.moodAt = t;
  saveProfile();
  renderMoodStrip();
  renderEmojiPanelForMood();
  return true;
}

/** 时间在走，情绪也会退：每次画界面时顺手按时间衰减一遍 */
function decayCurrentMood() {
  const mood = currentMood();
  if (!mood) return;
  const t = now();
  const last = Number(state.profile.moodAt) || t;
  const dtMin = (t - last) / 60000;
  if (dtMin < 3) return;
  state.profile.mood = decayMood(mood, dtMin);
  state.profile.moodAt = t;
  saveProfile();
}

function renderMoodStrip() {
  const el = $('#moodStrip');
  if (!el) return;

  decayCurrentMood();
  const top = topMoods(currentMood());
  if (!top.length) { el.hidden = true; el.innerHTML = ''; return; }

  el.hidden = false;
  el.innerHTML = top.map((m) => `
    <span class="wx-mood-chip" style="color:${m.color}">
      <i></i>${esc(m.emoji)}<b>${esc(m.label)}</b>
      <span style="color:#888">${m.value}%</span>
    </span>`).join('');
}

const MOOD_EMOJI_ORDER = {
  joy: ['😄', '😆', '🥰', '✨', '🎉', '哈哈哈哈'],
  anger: ['😤', '💢', '🙄', '😒'],
  sad: ['🥺', '😔', '💧', '(｡•́︿•̀｡)'],
  love: ['💗', '🥺', '😳', '💞', '(///▽///)'],
  jealous: ['😤', '🙄', '😒', '(￣へ￣)'],
  anxious: ['🥺', '😰', '😖'],
  shy: ['😳', '☺️', '🙈', '(*/ω＼*)'],
  tired: ['😩', '😪', '🫠'],
};

/** 按当前情绪重排表情面板（没情绪就保持原样） */
function renderEmojiPanelForMood() {
  const grid = $('#emojiGrid');
  if (!grid || grid.hidden) return;
  const top = topMoods(currentMood(), 2);
  if (!top.length) return;
  const first = MOOD_EMOJI_ORDER[top[0].key] || [];
  const rest = EMOJIS.filter((e) => !first.includes(e));
  grid.innerHTML = [...first.filter((e) => EMOJIS.includes(e)), ...rest]
    .map((e) => `<button type="button" data-emoji="${esc(e)}">${esc(e)}</button>`).join('');
}

/** 旁白进模型上下文时的样子 */
const narrLine = (text) => `（${String(text || '').trim()}）`;

/** 界面上旁白气泡的样子（灰、斜体、居中，一眼看出不是她说的话） */
const isNarration = (m) => !!m?.narr;

function ensureScene(force = false) {
  const t = now();
  const pool = scenePool();

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

  if (!state.profile.sceneId) {
    const s = pickScene(new Date(t), pool);
    state.profile.sceneId = s.id;
    state.profile.sceneText = s.text;
    state.profile.sceneAt = t;
    saveProfile();
    return;
  }

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

const timeText = (ts) => formatTimeText(ts, now());

/** 她的名字（可自定义） */
const herName = () => (state.config.herName?.trim() || CHARACTER.name);
/** 她的头像 emoji（可自定义） */
const herEmoji = () => (state.config.herEmoji || CHARACTER.emoji);
/** 她的头像图片（base64 dataURL，可选；设了就用图片） */
const herAvatarPic = () => state.config.herAvatar || null;

/** 她是"她"还是"他"（人设页里选的性别） */
const isMale = () => state.config.herGender === 'm';
/** 第三人称代词：她 / 他 */
const ta = () => (isMale() ? '他' : '她');

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

    userJob: String(myMe().job || '').trim(),
    birthday: bd || null,
    traits: Array.isArray(c.herTraits) ? c.herTraits : [],
    traitNote: String(c.herTraitNote || '').trim(),
    custom: personaIsCustom(),
  };
}

/** 场景池：设过人设的用通用池，否则用学生池 */
const scenePool = () => (personaIsCustom() ? SCENES_GENERIC : SCENES);

const styleNow = () => ({
  maxTokens: state.config.maxTokens,
  burst: state.config.burst,
  temperature: state.config.temperature,
});

/** 当前这套设置对应的劲头（设置页要显示"安静 · 1 条 · 约 90 字"） */
const voiceNow = () => voiceOf(styleNow());

/** 当前好感度（可能为 null = 没设过）。注意是浮点：普通聊天每句只涨 0.4 */
const affection = () => (state.profile.affection == null ? null : state.profile.affection);

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

/** 她的回复（文本）→ 待发出的条目（台词 / 旁白各成一条） */
const replyItems = (text, maxBurst) => chunkItems(splitNarration(text), {
  maxBurst,
  nameAlt: [herName(), CHARACTER.name, CHARACTER.realName],
});

/** 从她的回复末尾摘掉隐藏的 `[[记忆]]{...}`，返回干净文本 + 记忆对象 */
const extractMemory = (text) => parseMemoryBlock(text);

function applyMemory(mem) {
  const r = applyMemoryTo(mem, state.profile, now());

  if (r.name && !state.config.userName) state.config.userName = state.profile.name;
  saveProfile();
  saveConfig();
}

function toggleObsession(text) {
  if (!text) return;
  const becameObsession = toggleObsessionIn(state.profile, text, now());
  saveProfile();
  renderMemoryPage();
  toast(becameObsession ? '标成执念了，她永远不会忘' : '当成普通记忆了，会随时间淡', 2200);
}

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

  return `<div class="wx-time" data-ts="${ts}">${timeText(ts)}</div>`;
}

function messageHTML(msg, prev, idx) {
  const out = msg.role === 'user';
  const nar = isNarration(msg);
  const emojiOnly = !nar && isEmojiOnly(msg.content);
  const cls = [
    'wx-row',
    out ? 'out' : 'in',
    msg.mid ? 'mid' : '',
  ].filter(Boolean).join(' ');

  const at = Number.isInteger(idx) ? ` data-i="${idx}"` : '';

  if (nar) {

    return `${maybeTimeDivider(msg.ts, prev?.ts)}
    ${thinkHTML(msg, out)}
    <div class="wx-row narr ${out ? 'out' : 'in'}"${at}>
      <div class="wx-bubble narr">${esc(msg.content)}</div>
    </div>`;
  }
  return `${maybeTimeDivider(msg.ts, prev?.ts)}
    ${thinkHTML(msg, out)}
    <div class="${cls}${thinkHTML(msg, out) ? ' has-think' : ''}"${at}>
      ${avatarHTML(out ? 'me' : 'her')}
      <div class="wx-bubble${emojiOnly ? ' emoji-only' : ''}">${esc(msg.content)}</div>
    </div>`;
}

function thinkHTML(msg, out) {
  if (!msg?.think || out) return '';
  if (state.config.showThink === false) return '';

  if (isLeaked(msg.think)) return '';
  const ms = Number(msg.thinkMs);

  const secs = ms > 0 ? ` ${Math.max(0.1, ms / 1000).toFixed(1)} 秒` : '';
  return `<div class="wx-think" data-think="1">
    <div class="wx-think-head">💭 思考${secs}</div>
    <div class="wx-think-body">${esc(msg.think)}</div>
  </div>`;
}

let _drawn = 0;
let _sigs = [];
let _from = 0;
let _expanded = false;

const CHAT_PAGE = 200;

const msgSig = (m) => `${m.role}|${m.narr ? 'n' : ''}|${m.ts}|${m.think || ''}|${m.content}`;

/** 顶部那条"上面还有 N 条更早的" */
const moreHTML = (from) => (from > 0
  ? `<div class="wx-more" data-more="1">上面还有 ${from} 条更早的 · 点这里展开</div>`
  : '');

/** 展开更早的一批（点顶部那条时调用） */
function loadEarlierMessages() {
  if (_from <= 0) return;
  const target = Math.max(0, _from - CHAT_PAGE);

  _drawn = 0;
  _sigs = [];
  _from = target;
  _expanded = true;
  renderChat({ keepScroll: true });
}

function renderChat({ keepScroll = false } = {}) {
  const box = $('#messages');
  if (!box) return;

  const msgs = state.messages;

  const floor = Math.max(0, msgs.length - CHAT_PAGE);
  if (!_expanded && _from < floor) _from = floor;
  if (_from > msgs.length) _from = 0;

  const canAppend = _drawn > 0 && _drawn <= msgs.length
    && _sigs.length >= _drawn
    && msgs.slice(0, _drawn).every((m, i) => msgSig(m) === _sigs[i]);

  if (canAppend) {

    const piece = document.createElement('div');
    let html = '';
    for (let i = _drawn; i < msgs.length; i++) {
      html += messageHTML(msgs[i], msgs[i - 1] || null, i);
    }
    piece.innerHTML = html;
    for (const n of [...piece.children]) box.appendChild(n);
  } else {
    let html = moreHTML(_from);
    let prev = _from > 0 ? msgs[_from - 1] : null;
    for (let i = _from; i < msgs.length; i++) {
      html += messageHTML(msgs[i], prev, i);
      prev = msgs[i];
    }
    box.innerHTML = html;
    _sigs = msgs.map(msgSig);
  }
  _drawn = msgs.length;

  if (keepScroll) {

    const first = box.querySelector(`[data-i="${_from + CHAT_PAGE}"]`) || box.firstElementChild;
    if (first) first.scrollIntoView?.({ block: 'start' });
    else scrollToLatest(true);
  } else {
    scrollToLatest(true);
  }
  renderMoodStrip();
}

/** 从零重画（清空、导入、换好友时用）—— 顺便把增量状态清掉，免得前缀判断出错 */
function resetChatRender() {
  _drawn = 0;
  _sigs = [];
  _from = 0;
  _expanded = false;
}

function appendRow(msg) {
  const box = $('#messages');
  const idx = state.messages.lastIndexOf(msg);
  const prev = idx > 0 ? state.messages[idx - 1] : null;
  const wrap = document.createElement('div');
  wrap.innerHTML = messageHTML(msg, prev, idx);
  const nodes = [...wrap.children];
  for (const n of nodes) box.appendChild(n);

  if (idx >= 0) {
    _drawn = Math.max(_drawn, idx + 1);
    _sigs[idx] = msgSig(msg);
  }
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

function autoGrow() {
  const el = $('#input');
  el.style.height = 'auto';
  const h = el.scrollHeight;
  el.style.height = (h > 0 ? Math.min(h, 100) : 23) + 'px';
}

function syncSendBtn() {

  const msg = $('#input').value.trim().length > 0;
  const nar = ($('#narrInput')?.value || '').trim().length > 0;
  const has = msg || nar;
  $('#btnSend').hidden = !has || state.generating;
  $('#btnPlus').classList.toggle('off', has);

  const btn = $('#btnSend');
  if (btn) {
    btn.classList.toggle('narr', nar && !msg);
    btn.textContent = nar && !msg ? '发旁白' : '发送';
  }
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

async function send() {
  const input = $('#input');
  const narr = $('#narrInput');
  const narrText = narr ? narr.value.trim() : '';
  const text = input.value.trim();

  if ((!narrText && !text) || state.generating) return;

  if (!hasKey()) {
    toast('先填一个 API Key');
    openSettings();
    return;
  }

  closePanels();
  narr.value = '';
  input.value = '';
  autoGrow();
  syncSendBtn();
  buzz();

  state.idleSpoken = 0;

  if (narrText) {
    const hit = detectEnding(narrText, { narr: true });
    if (hit) {
      const wiped = await runEndingFlow(hit);
      if (wiped) return;
    }
  }

  const t = now();

  if (narrText) pushUserMessage({ role: 'user', content: narrText, ts: t, narr: true });
  if (text) pushUserMessage({ role: 'user', content: text, ts: t + (narrText ? 1 : 0) });

  if (state.pendingDream) {
    state.pendingDream = false;
    pushUserMessage({ role: 'assistant', content: DREAM_NARRATION, ts: t + 1, narr: true });
  }

  if (text) {

    applyTurn(text);

    noteRelationSignal(text);

    applyMood(guessMood(text));
  }

  await respond();
}

/** 发出一条（我自己的）消息：落盘 + 上屏 + 滚到底 */
function pushUserMessage(msg) {
  state.messages.push(msg);
  appendRow(msg);
  scrollToLatest(true);
  saveChat();
}

let endingUI = null;

let repair = null;

function initRepair() {
  repair = createRepair({
    state, getProvider, nativeStreamChat, streamChat, DEFAULT_ENDPOINT, DEFAULT_MODEL,
    parseThoughtBlock, parseMoodBlock, extractMemory, replyItems, narrLine,
  });
}

const askForWords = (a) => repair.askForWords(a);
const askForThought = (a) => repair.askForThought(a);
const askAgain = (a) => repair.askAgain(a);

function initEndingUI() {
  endingUI = createEndingUI({
    state, $, toast, herName, keysFor, removeKeys, findPersona, removePersona, setActive,
    savePersonaIndex, loadPersona, resetChatRender, resetRecallIndex, fixProfileShape,
    renderHerIdentity, renderAffection, renderClock, renderChat, renderMoodStrip,
    renderNav, updateDataInfo, showTab, DEFAULT_ID, ENDING_DIALOG,
  });
}

const openConfirm = (opts) => endingUI.openConfirm(opts);
const runEndingFlow = (hit) => endingUI.runEndingFlow(hit);
const confirmDeleteFriend = () => endingUI.confirmDeleteFriend();
const deleteFriend = (id) => endingUI.deleteFriend(id);

/** 这一轮检测到的关系变化信号（respond 组提示词时要用） */
let pendingRelationSignal = null;

function noteRelationSignal(text) {
  pendingRelationSignal = detectRelationSignal(text);
  if (!pendingRelationSignal) { hideRelationTip(); return; }

  if (relationMatches(state.config.herRelation, pendingRelationSignal.suggest)) {
    hideRelationTip();
    return;
  }

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

/** 破裂那三种结果各说一句人话（别弹"好感度 −25"这种系统腔） */
const RUPTURE_TIP = {
  break: '她这次是真的伤心了 —— 光说一句"对不起"是不够的',
  amend: '她还在生气，不过语气缓和了一点',
  heal: '她好像没那么生气了',
};

function applyTurn(text) {
  if (state.profile.affection == null) return;
  const p = state.profile;
  const r = affectionTurn(p, text);
  const dirty = r.affection !== p.affection || r.rupture !== !!p.rupture || !!r.event;
  if (!dirty) return;
  Object.assign(p, {
    affection: r.affection, rupture: r.rupture, amends: r.amends, scar: r.scar, affectionAt: now(),
  });
  if (r.event) toast(RUPTURE_TIP[r.event], 3200);
  saveProfile();
  renderAffection();
}

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

function contextBudget() {
  const isNative = getProvider(state.config.provider)?.id === 'native-local';
  return isNative ? { maxChars: 6000, maxMsgs: 30 } : { maxChars: 80000, maxMsgs: 600 };
}

let _ctxStart = 0;

function buildChatContext(maxChars, maxMsgs) {
  const budget = contextBudget();
  if (maxChars === undefined) maxChars = budget.maxChars;
  if (maxMsgs === undefined) maxMsgs = budget.maxMsgs;

  const all = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  _ctxStart = all.length;
  if (!all.length) return [];

  const summaryBudget = state.profile.summary?.length ? 16000 : 0;
  const recentBudget = Math.max(1600, maxChars - summaryBudget);

  const picked = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const len = [...String(m.content)].length;
    if (picked.length >= maxMsgs) break;
    if (used + len > recentBudget && picked.length >= 6) break;

    picked.unshift({ role: m.role, content: isNarration(m) ? narrLine(m.content) : m.content });
    used += len;
  }
  _ctxStart = all.length - picked.length;
  return picked;
}

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
    onDelta: () => {},
  });
  return text;
}

const movedAway = (owner) => state.nav.active !== owner;
/** 这一段话里，有没有又提起那几件\"最近反复提\"的事 */
const hitsRepeat = (text, list) => (Array.isArray(list) ? list : [])
  .some((x) => x?.text && String(text || '').includes(x.text));

/** 让她回复（也被"重新开始"复用） */
async function respond() {
  setGenerating(true);
  const ctrl = new AbortController();
  state.abort = ctrl;

  const owner = state.nav.active;

  const history = buildChatContext();

  applyAffectionDecay();

  const userMsgs = state.messages.filter((m) => m.role === 'user');
  const lastUser = String(userMsgs.at(-1)?.content || '');
  const prevUser = String(userMsgs.at(-2)?.content || '');
  const query = lastUser.length >= 6 || !prevUser ? lastUser : `${prevUser} ${lastUser}`;

  const systemPrompt = [
    buildSystemPrompt(state.profile, {
      scene: currentScene(),
      timeText: currentTimeText(),

      now: now(),

      showThink: state.config.showThink !== false,

      style: styleNow(),
      summary: state.profile.summary,
      herName: herName(),
      persona: personaForPrompt(),
      me: myMe(),
      mood: moodBlock(currentMood()),
      affection: affection(),
      affectionBase: state.profile.affectionBase,
      rupture: !!state.profile.rupture,
      amends: Number(state.profile.amends) || 0,
      relation: state.config.herRelation,
    }),
    recallBlock(query, history.length),

    futureHint(query, now()),

    relationShiftHint(pendingRelationSignal),

    habitsBlock(state.messages.filter((m) => m.role === 'user' || m.role === 'assistant')),

    narrationVaryBlock(recentNarrations(state.messages)),

    thoughtVaryBlock(recentThoughts(state.messages)),

    repeatBlock(repeatedTopics(state.messages)),

    todayTimeline(state.messages, now(), { before: _ctxStart }),
    `【记住前面聊过的】（很重要）
上面给了你最近的完整对话记录。你必须**记得并沿用**这些内容：
- 他刚说过的名字、地点、事情、情绪，不要当成没听过
- 如果前面几轮你已经问过某个问题、说过某件事，不要再重复问一遍
- **今天你们一起经历过的事**（他带你去哪了、你们做了什么）必须记得 ——
  那是你们共同的经历，晚上再提起来你要接得上，不能像没发生过
- **更不要问你已经知道答案的问题**。比如他天天说自己做饭，你还问"你做过饭吗"，
  那就跟失忆一样。不确定就先翻上面的记忆和对话，宁可说"你之前是不是提过…"
- 话题要延续，不要突然换个不相干的话题
- 如果他说"刚才""之前""刚才说的"，你要知道指的是什么
- 开口前先扫一遍上面的对话和记忆，别只回答他最后那一句

【记忆】把这次对话里关于他的新信息记下来，在回复的最后另起一行加上：
[[记忆]]{"name":"","facts":[],"mood":""}

**必须记的**（哪怕你觉得是小事、是废话，也要记）：
- **今天你们一起做过的事**：他带你去了哪、见了谁、做了什么（"中午带她去公司开会"）
  —— 这类"共同的经历"最容易被晚上忘掉，一定要写进来
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

    const t0 = Date.now();
    const pause = thinkPause(query);
    if (pause) {
      showTyping();
      await sleepUntil(pause, ctrl.signal);
      if (movedAway(owner)) return;
    }

    if (getProvider(state.config.provider).id === 'native-local') {

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

          full += piece;
        },
      });
    }

    if (movedAway(owner)) return;
    const memCut = extractMemory(full);
    applyMemory(memCut.mem);
    const moodCut = parseMoodBlock(memCut.clean);

    const thoughtCut = parseThoughtBlock(moodCut.clean);

    let innerThought = state.config.showThink === false ? '' : thoughtCut.thought;

    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')?.content || '';
    applyMood(moodCut.mood || guessMood(lastUser));

    let parts = replyItems(thoughtCut.clean, Number(state.config.burst) || 2);

    let thinkMs = Date.now() - t0;

    const repeats = repeatedTopics(state.messages);

    let repaired = false;

    if (parts.length && repeats.length && !parts.every((it) => it.narr)
        && hitsRepeat(parts.map((it) => it.content).join('\n'), repeats)) {
      const again = await askAgain({
        systemPrompt,
        history,
        reply: parts.map((it) => it.content).join('\n'),
        repeats,
        signal: ctrl.signal,
      });
      if (movedAway(owner)) return;
      const fixed = again ? replyItems(again, Number(state.config.burst) || 2) : [];
      if (fixed.length) {
        parts = fixed;
        repaired = true;
        thinkMs = Date.now() - t0;
      }
    }

    if (!parts.some((it) => !it.narr)) {
      const r = await askForWords({
        systemPrompt,
        history,

        narration: parts.map((it) => it.content).join('；') || '（她张了张嘴，什么都没说出来）',
        signal: ctrl.signal,
      });
      const said = r.words.map((content) => ({ content, narr: false }));

      const onlyLazy = parts.every((it) => isLazyNarration(it.content));
      parts = said.length ? [...parts, ...said] : (onlyLazy ? [] : parts);

      if (!innerThought && r.thought) innerThought = r.thought;
      repaired = true;
      if (movedAway(owner)) return;
    }

    const thoughtStuck = !!innerThought && repeats.length && hitsRepeat(innerThought, repeats);
    if (!repaired && state.config.showThink !== false && parts.length
        && (!innerThought || thoughtStuck)) {
      const extra = await askForThought({
        systemPrompt,
        history,
        reply: parts.map((it) => it.content).join('\n'),
        signal: ctrl.signal,
        avoid: thoughtStuck ? repeats : [],
      });
      if (movedAway(owner)) return;
      if (extra) {
        innerThought = extra;
        thinkMs = Date.now() - t0;
      }
    }

    state.lastThought = { ok: !!innerThought, ms: thinkMs };

    if (!parts.length) {
      hideTyping();
      showTyping();
      await sleepUntil(400, ctrl.signal);
      hideTyping();
      if (movedAway(owner)) return;
      const fb = { role: 'assistant', content: '……嗯', ts: now() };
      state.messages.push(fb);
      appendRow(fb);
      saveChat();
      return;
    }

    const totalBudget = 4200;
    let spent = 0;

    for (let i = 0; i < parts.length; i++) {
      const { content, narr } = parts[i];
      const isLast = i === parts.length - 1;

      showTyping();

      let delay = Math.min(900, Math.max(260, content.length * 42));

      if (spent + delay > totalBudget) delay = Math.max(120, totalBudget - spent);
      spent += delay;
      await sleepUntil(delay, ctrl.signal);
      hideTyping();

      if (movedAway(owner)) return;

      const msg = {
        role: 'assistant',
        content,
        ts: now(),
        mid: !isLast,
      };

      if (narr) msg.narr = true;

      if (i === 0 && innerThought) {
        msg.think = innerThought;
        msg.thinkMs = thinkMs;
      }
      state.messages.push(msg);
      appendRow(msg);
      scrollToLatest();
      buzz(8);

      if (!isLast) await sleepUntil(Math.min(420, 120 + content.length * 8), ctrl.signal);
    }

    saveChat();

    state.profile.msgCount = state.messages.length;
    pushSummary();
    saveProfile();
    updateDataInfo();
  } catch (err) {
    hideTyping();

    if (movedAway(owner)) return;
    if (err.name === 'AbortError' || ctrl.signal.aborted) {
      appendSys('（已停止）');
    } else {

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

    if (!movedAway(owner)) {

      state.profile.lastChatAt = now();
      saveProfile();

      armIdleTimer();
    }
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

const sleepUntil = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function updateDataInfo() {
  const n = state.messages.length;
  const facts = state.profile.facts?.length || 0;
  $('#dataInfo2').textContent = `${n} 条消息 · 她记得 ${facts} 件事`;
}

/** 用服务商预置填充表单 */
function applyProvider(id) {
  const p = getProvider(id);
  state.config.provider = p.id;
  if (p.id !== 'custom') {
    state.config.endpoint = p.endpoint;
    state.config.model = p.model;
    if ($('#inpEndpoint')) $('#inpEndpoint').value = p.endpoint;
  }

  const models = p.models?.length ? p.models : [state.config.model || ''];
  if (!$('#inpModel')) return;
  $('#inpModel').innerHTML = models
    .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`)
    .join('');
  $('#inpModel').value = state.config.model || models[0] || '';

  if ($('#providerHint')) $('#providerHint').textContent = p.hint || '';
  const link = $('#signupLink');
  if (link) {
    if (p.signup) {
      link.href = p.signup;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  const lockEndpoint = p.id !== 'custom' && !p.local;
  if ($('#inpEndpoint')) {
    $('#inpEndpoint').readOnly = lockEndpoint;
    $('#inpEndpoint').classList.toggle('locked', lockEndpoint);
  }

  const keyLabel = $('#inpKey')?.closest('.wx-cell')?.querySelector('label');
  if ($('#inpKey')) {
    if (p.noKey) {
      $('#inpKey').placeholder = '本地模型不需要，留空即可';
      if (keyLabel) keyLabel.textContent = 'API Key（本地不需要）';
    } else {
      $('#inpKey').placeholder = 'sk-...';
      if (keyLabel) keyLabel.textContent = 'API Key';
    }
  }

  toggleNativePanel();
}

function onProviderChange() {
  applyProvider($('#inpProvider')?.value || state.config.provider);
  saveConfig();
  $('#testResult').hidden = true;
}

function syncSettingsUI() {

  const all = availableProviders();
  const nativeP = all.filter((p) => p.native);
  const otherLocal = all.filter((p) => p.local && !p.native);
  const cloud = all.filter((p) => !p.local);
  const opt = (p) => `<option value="${p.id}">${esc(p.name)}</option>`;

  if ($('#inpProvider')) {
    $('#inpProvider').innerHTML =
      (nativeP.length ? `<optgroup label="手机本地（完全离线）">${nativeP.map(opt).join('')}</optgroup>` : '') +
      (otherLocal.length ? `<optgroup label="连电脑使用（需要电脑开着）">${otherLocal.map(opt).join('')}</optgroup>` : '') +
      `<optgroup label="云端 API（需要联网+Key）">${cloud.map(opt).join('')}</optgroup>`;
  }

  if (!state.config.provider) {
    state.config.provider = detectProvider(state.config.endpoint, state.config.model);
  }
  if (!availableProviders().some((p) => p.id === state.config.provider)) {
    state.config.provider = 'deepseek';
  }

  if ($('#inpProvider')) $('#inpProvider').value = state.config.provider;

  applyProvider(state.config.provider);

  if ($('#inpKey')) $('#inpKey').value = state.config.apiKey || '';
  if ($('#inpUserName')) $('#inpUserName').value = state.config.userName || state.profile.name || '';

  for (const [id, key] of [['#segLen2', 'maxTokens'], ['#segBurst2', 'burst'], ['#segTemp2', 'temperature'], ['#segThink2', 'thinking'], ['#segSpeak2', 'autoSpeak']]) {
    $$(`${id} button`).forEach((b) =>
      b.classList.toggle('on', Math.abs(Number(b.dataset.v) - Number(state.config[key])) < 0.01));
  }
  if ($('#setupBanner')) $('#setupBanner').hidden = !needsSetup();

  if ($('#segShowThink')) {
    const on = state.config.showThink !== false;
    $$('#segShowThink button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === on));
  }

  if ($('#thinkStatus')) {
    const t = state.lastThought;
    $('#thinkStatus').textContent = state.config.showThink === false

      ? '现在是「不显示」—— 切成「显示」她才会写'
      : !t
        ? '还没聊过：跟她说一句话就能看到'
        : t.ok
          ? `最近一轮：她写了 ✓（${(t.ms / 1000).toFixed(1)} 秒）`
          : '最近一轮：她没写 ✗ —— 已经自动补过一次了；要是补的也没有，'
            + '多半是模型不遵守格式（手机本地的小模型尤其容易）';
  }

  if ($('#styleHint')) $('#styleHint').textContent = voiceHint(voiceNow());
  updateDataInfo();
}

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
    if ($('#nativePanel')) $('#nativePanel').hidden = true;
    return;
  }
  if ($('#nativePanel')) $('#nativePanel').hidden = false;
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

  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  btn.disabled = true;
  btn.textContent = '测速中…';
  let lines = [`模型：${info.filename || info.path}`];
  const push = () => { log.textContent = lines.join('\n'); log.scrollTop = log.scrollHeight; };
  push();

  try {

    lines.push('预热中（首次要加载模型）…'); push();
    await native.localCompletion({
      systemPrompt: '你在用微信跟人闲聊。',
      messages: [{ role: 'user', content: '在吗' }],
      temperature: 0.8,
      maxTokens: 8,
    });

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
    const tokens = st.tokens || [...String(text)].length;
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

  const k = ($('#inpKey')?.value || '').trim();
  if (k) state.config.apiKey = k;
  state.config.model = $('#inpModel')?.value || state.config.model || LOCKED_MODEL;
  const ep = ($('#inpEndpoint')?.value || '').trim();
  if (ep) state.config.endpoint = ep;
  const un = ($('#inpUserName')?.value || '').trim().slice(0, 12);
  if (un) {
    state.config.userName = un;
    state.profile.name = un;
  }
  return state.config;
}

/** 「设置」（全局）：只有模型 / API Key 那一块 */
function openSettings() {

  closePanels();
  closeMenu();
  syncSettingsUI();
  $('#screen-settings').classList.add('show');
}

function openFriendSettings() {
  closeMenu();
  closePanels();
  syncSettingsUI();
  renderHerIdentity();
  updateDataInfo();
  const t = $('#friendSetTitle');
  if (t) t.textContent = `${herName()}的设置`;
  $('#screen-friend').hidden = false;
  $('#screen-friend').classList.add('show');
}

function closeFriendSettings() {
  $('#screen-friend').classList.remove('show');
  $('#screen-friend').hidden = true;
}

function openPersonaFromFriend() {
  openPersona({ fromSettings: true });
}

function openMenu() {
  closePanels();

  $('#mask').style.display = 'flex';
}

function closeMenu() {
  $('#mask').style.display = 'none';
}

async function testConnection() {
  const btn = $('#btnTest');
  const out = $('#testResult');

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

  if (which === 'fact' && Array.isArray(state.profile.bioFacts)) {
    state.profile.bioFacts = state.profile.bioFacts.filter((f) => f !== text);
  }
  saveProfile();
  renderMemoryPage();
  toast('已删掉这条', 1400);
}

function memItemHTML(text, which, dim) {

  let badge = '';
  let star = '';
  if (which === 'fact') {
    const meta = state.profile.factsMeta?.[text];
    if (meta) {
      const pct = strengthPercent(meta, now());
      const label = strengthLabel(meta, now());
      const hits = Math.round(Number(meta.hits) || 1);
      const emo = Number(meta.emo) || 0;

      const grade = Math.max(0, Math.min(3, Math.floor(pct / 25)));
      const obs = isObsession(meta);
      badge = `<span class="wx-mem-strength ${obs ? 'obs' : `s${grade}`}"`
        + ` title="记忆强度 ${pct}%，被提到 ${hits} 次${emo ? `，情绪强度 ${emo}/10` : ''}">`
        + `${label}</span>`;

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

function applyUserBio() {
  const next = applyUserBioTo(state.profile, state.config.userBio);

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

let perAvatar = '';
let perTraits = [];
let perAff = 45;
let perAffTouched = false;

function nearestAffPreset(v) {
  return AFF_PRESETS.reduce(
    (best, p) => (Math.abs(p.v - v) < Math.abs(best - v) ? p.v : best),
    AFF_PRESETS[0].v
  );
}

function suggestPerAff() {
  const rel = ($('#perRelation')?.value || '').trim();
  const base = defaultAffectionFor(rel);
  const traitAdj = suggestFromTraits(perTraits) - 45;
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
  renderChips('#chipsTraits', TRAIT_PRESETS, (v) => perTraits.includes(v));
  renderChips('#chipsScene', SCENE_PRESETS, (v) => v === ($('#perScene').value || '').trim());
  renderChips('#chipsAff', AFF_PRESETS, (v) => v === perAff);
  updateSignNote();
  updateAffNote();
}

/** 人选页里那句"再补一句你自己的"要说清是**谁**的性格（她/他跟着性别走） */
function syncTraitNoteLabel() {
  const el = $('#perTraitNoteLabel');
  if (!el) return;
  el.textContent = `再补一句你自己的（${isMale() ? '他' : '她'}的性格）`;
}

function openPersona({ fromSettings = false, asNew = false } = {}) {
  closePanels();
  closeMenu();
  const c = state.config;

  $('#perName').value = c.herName || '';
  perAvatar = c.herEmoji || CHARACTER.emoji;
  $('#perAvatarPreview').textContent = perAvatar;
  setSegOn('#segGender', isMale() ? 'm' : 'f');
  syncTraitNoteLabel();
  $('#perAge').value = c.herAge || '';
  $('#perJob').value = c.herJob || '';
  $('#perRelation').value = c.herRelation || '';
  $('#perBirthday').value = c.herBirthday || '';
  $('#perTraitNote').value = c.herTraitNote || '';
  perTraits = Array.isArray(c.herTraits) ? c.herTraits.slice(0, 4) : [];

  $('#perBio').value = c.userBio || '';
  $('#perBioPreview').hidden = true;
  $('#btnBioPreview').textContent = '看看拆成几条';
  renderBioPreview();
  $('#perScene').value = state.profile.sceneCustom ? (state.profile.sceneText || '') : '';
  perAff = affection() ?? suggestPerAff();
  perAffTouched = affection() != null;

  $('#btnClosePersona').hidden = !fromSettings && !asNew && !c.personaDone;
  $('#personaIntro').hidden = asNew ? false : !!c.personaDone;
  $('#perAvatarList').hidden = true;

  renderPersonaChips();

  const body = $('#screen-persona').querySelector('.wx-settings-body');
  if (body) body.scrollTop = 0;
  $('#screen-persona').classList.add('show');
}

function closePersona() {

  if (state.pendingNew) {
    cancelPendingNew();
    return;
  }
  $('#screen-persona').classList.remove('show');

  if (!state.messages.length) {
    ensureScene();
    bootGreeting();
    renderChat();
  }
}

const notePendingNew = (fromId, newId) => endingUI.notePendingNew(fromId, newId);
const cancelPendingNew = () => endingUI.cancelPendingNew();

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
  c.herRelation = $('#perRelation').value.trim().slice(0, 12);

  const bd = parseBirthday($('#perBirthday').value);
  c.herBirthday = bd ? `${bd.month}-${bd.day}` : '';

  c.herTraits = perTraits.slice(0, 4);
  c.herTraitNote = $('#perTraitNote').value.trim().slice(0, 40);
  c.userBio = $('#perBio').value.trim().slice(0, 600);
  c.personaDone = true;
  saveConfig();

  applyUserBio();

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

  state.nav = patchPersona(state.nav, state.nav.active, {
    name: herName(), emoji: herEmoji(),
  });
  savePersonaIndex();
  renderNav();
}

/** 「开始聊天」：存下来 + 如果是第一次，顺便把开场白发出来 */
function startPersona() {
  const firstRun = !state.messages.length;
  state.pendingNew = null;
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
  c.herRelation = '';
  c.herBirthday = '';
  c.herTraits = [];
  c.herTraitNote = '';
  c.userBio = '';
  c.personaDone = true;
  saveConfig();

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
  openPersona({ fromSettings: true });
  toast('已经回到默认的小雨', 1800);
}

/** 在全部历史里搜（薄封装，补上消息列表） */
const searchMessages = (q) => searchIn(state.messages, q);

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

  if (i < _from) {
    _from = Math.max(0, i - 50);
    resetChatRender();
    renderChat({ keepScroll: true });
  }
  requestAnimationFrame(() => {
    const box = $('#messages');
    const row = box?.querySelector(`[data-i="${i}"]`);
    if (!row) return;

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

  const setFoldN = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt || ''; };
  setFoldN('#foldNFacts', facts.length ? `${facts.length} 条` : '空的');
  setFoldN('#foldNSummary', sum.length ? `${sum.length} 条` : '暂无');
  setFoldN('#foldNHistory', `${n} 条`);
  setFoldN('#foldNFaded', faded.length ? `${faded.length} 条` : '');

  if ($('#memPreview') && !$('#memPreview').hidden) renderMemoryPreview();
}

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

  resetChatRender();

  const factsAdded = mergeFacts(state.profile, facts);
  state.profile.msgCount = state.messages.length;
  saveProfile();
  saveChat();

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

  if (!panel.hidden) {
    const fold = $('#foldHistory');
    if (fold) fold.open = true;

    panel.scrollIntoView?.({ block: 'center' });
    $('#importText').focus();
  }
}

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

    preview: her ? '#herAvatarPreview' : '#meAvatarPreview',
    pic: () => (her ? herAvatarPic() : myAvatarPic()),
    emoji: () => (her ? herEmoji() : myEmoji()),

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

  const nav = $('#avatarNavTitle');
  if (nav) nav.textContent = avatarTarget === 'me' ? '我的头像' : '她的头像';

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

  const nav = $('#navName');
  if (nav) nav.textContent = herName();

  document.title = herName();

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

  resetChatRender();
  renderChat();

  try { friendUI?.renderNav?.(); } catch {}
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
function openDownloadPage() {
  if (nativeReady) {
    toast('你正在用安卓版 ✅ 已经可以离线聊了', 2600);
    return;
  }
  window.location.href = './download';
}

function shouldSpeakOnReturn() {
  if (!state.config.autoSpeak) return false;
  if (state.profile.msgCount < 4) return false;
  const msgs = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (msgs.length < 2) return false;
  const gapH = (now() - (msgs[msgs.length - 1].ts || 0)) / 3600000;
  return gapH >= 2;
}

/** 从一句话里抠出一个能当"话题"的短句（只在降级时用） */
function pickTopic(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u.test(t)) return '';

  if (/^(睡吧|睡了|我去睡|晚安|早安|好的|好吧|行吧|行|嗯+|哦+|啊+|是吗|在吗|在么|在不在|你好|哈喽|拜拜|再见|88|先这样|回头聊|晚点聊|我忙|忙去了|出去一下|不聊了|我困了|哈哈+|嘿嘿|呵呵|笑死|6+|ok|okay|hi|hey|bye)[。！？!?~～，,、\s]*$/i.test(t)) return '';

  if (/[？?]$/.test(t)) return '';

  t = t.replace(/^(在吗|在不在|在么|你好|哈喽|hi|hey|喂)[，,。!！~～\s]*/i, '');
  t = t.replace(/[。！？!?~～，,、\s]+$/, '');
  if ([...t].length < 8) return '';
  return [...t].slice(0, 20).join('');
}

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

/** 一次会话里最多主动开口几次，免得烦人 */
const IDLE_SPEAK_LIMIT = 2;
/** 他多久没动静，她才主动开口（毫秒） */
const IDLE_MS = 4 * 60 * 1000;

let idleTimer = null;
/** 这个计时器是**冲谁**计的（他中途换好友了，这一轮就不算） */
let idleOwner = '';

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/** 每次他说话 / 她回复之后调用：重新开始计时 */
function armIdleTimer() {
  clearIdleTimer();
  if (!state.config.autoSpeak) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (state.profile.msgCount < 4) return;
  idleOwner = state.nav.active;
  idleTimer = setTimeout(tryIdleSpeak, IDLE_MS);
}

async function tryIdleSpeak() {
  idleTimer = null;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (state.generating) return;

  if (state.nav.active !== idleOwner) { armIdleTimer(); return; }
  if (!state.config.autoSpeak) return;
  if ((state.idleSpoken || 0) >= IDLE_SPEAK_LIMIT) return;

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

async function speakUp(reason) {
  if (state.generating) return false;

  if (!state.nav.active) return false;
  if (!hasKey() && !getProvider(state.config.provider)?.local) return false;

  setGenerating(true);
  const ctrl = new AbortController();
  state.abort = ctrl;

  const owner = state.nav.active;
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
        now: now(),
        showThink: state.config.showThink !== false,

        style: styleNow(),
        summary: state.profile.summary,
        herName: herName(),
        persona: personaForPrompt(),
        me: myMe(),
        mood: moodBlock(currentMood()),
        affection: affection(),
        affectionBase: state.profile.affectionBase,
      rupture: !!state.profile.rupture,
      amends: Number(state.profile.amends) || 0,
        relation: state.config.herRelation,
      }),

      narrationVaryBlock(recentNarrations(state.messages)),
      thoughtVaryBlock(recentThoughts(state.messages)),

    repeatBlock(repeatedTopics(state.messages)),
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

说 ${voiceNow().lines} 条短消息就行（他调的是这个数），别一次堆太多。
可以带一两个括号旁白（动作/神态），
它们会单独显示成一个小框，不占你说的条数 —— 但**别只有旁白**，
旁白后面一定要有话，最后一条必须是话。`,
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

    if (movedAway(owner)) return false;
    const memCut = extractMemory(full);
    applyMemory(memCut.mem);
    const moodCut = parseMoodBlock(memCut.clean);
    if (moodCut.mood) applyMood(moodCut.mood);
    const thoughtCut = parseThoughtBlock(moodCut.clean);

    let innerThought = state.config.showThink === false ? '' : thoughtCut.thought;

    let parts = replyItems(thoughtCut.clean, voiceNow().lines);

    let repaired = false;
    if (parts.length && parts.every((it) => it.narr)) {
      const r = await askForWords({
        systemPrompt,
        history,
        narration: parts.map((it) => it.content).join('；'),
        signal: ctrl.signal,
      });
      parts = [...parts, ...r.words.map((content) => ({ content, narr: false }))];

      if (!innerThought && r.thought) innerThought = r.thought;
      if (movedAway(owner)) return false;
    }
    if (!parts.length) { hideTyping(); return false; }

    hideTyping();
    for (let i = 0; i < parts.length; i++) {
      const { content, narr } = parts[i];
      const isLast = i === parts.length - 1;
      showTyping();
      await sleepUntil(Math.min(700, Math.max(240, content.length * 40)), ctrl.signal);
      hideTyping();
      if (movedAway(owner)) return false;
      const msg = { role: 'assistant', content, ts: now(), mid: !isLast };
      if (narr) msg.narr = true;

      if (i === 0 && innerThought) msg.think = innerThought;
      state.messages.push(msg);
      appendRow(msg);
      scrollToLatest();
      if (!isLast) await sleepUntil(220, ctrl.signal);
    }
    saveChat();
    said = true;
  } catch (e) {

    hideTyping();
  } finally {
    hideTyping();
    setGenerating(false);
    state.abort = null;

    if (!movedAway(owner)) {
      state.profile.lastChatAt = now();
      saveProfile();
      armIdleTimer();
    }
  }
  return said;
}

function setupDownloadEntry() {
  $('#btnDownloadBar')?.addEventListener('click', openDownloadPage);
  if (!APK_URL) $('#apkEntry')?.setAttribute('hidden', '');
}

function bootGreeting() {
  if (state.messages.length) return;
  const t = now();

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

/** 聊天页底部：输入框、旁白框、表情、发送、回到最新 */
function bindComposer() {
  const input = $('#input');
  input.addEventListener('input', () => { autoGrow(); syncSendBtn(); });
  input.addEventListener('focus', closePanels);
  input.addEventListener('keydown', (e) => {

    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (e.key === 'Enter' && !e.shiftKey && !mobile) {
      e.preventDefault();
      send();
    }
  });
  $('#btnSend').addEventListener('click', send);

  const narr = $('#narrInput');
  if (narr) {
    narr.addEventListener('input', syncSendBtn);
    narr.addEventListener('focus', closePanels);
    narr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  $('#btnEmoji').addEventListener('click', () => {
    const open = $('#emojiPanel').hidden;
    closePanels();
    $('#emojiPanel').hidden = !open;

    if (open) renderEmojiPanelForMood();
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
      renderClock();
      renderAffection();
    }
  });

  $('#messages').addEventListener('scroll', () => {
    $('#btnScrollBottom').hidden = nearBottom(160);
  });
  $('#btnScrollBottom').addEventListener('click', () => scrollToLatest(true));

  $('#messages').addEventListener('click', (e) => {

    if (e.target.closest('[data-more]')) { loadEarlierMessages(); return; }
    const box = e.target.closest('.wx-think');
    if (!box) return;
    const head = e.target.closest('.wx-think-head');
    if (!head) return;
    box.classList.toggle('open');
    scrollToLatest();
  });
}

/** 「+」面板：好感度手动调、关系快改、关系提示条、内置时钟、清空/设置入口 */
function bindPlusPanel() {
  const panel = $('#plusPanel');

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aff]');
    if (!b) return;
    const cur = affection() ?? 50;
    state.profile.affection = clampAffection(cur + Number(b.dataset.aff));

    if (state.profile.affectionBase == null) state.profile.affectionBase = state.profile.affection;
    saveProfile();
    renderAffection();
  });

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clock]');
    if (!b) return;
    shiftClock(b.dataset.clock);
    buzz(10);
  });

  $('#clockPick').addEventListener('change', (e) => {
    const t = new Date(e.target.value).getTime();
    if (Number.isFinite(t)) setClockTo(t);
  });

  $('#btnQuickRelation').addEventListener('click', () => {
    const box = $('#quickRelationChips');
    box.hidden = !box.hidden;
    if (!box.hidden) renderQuickRelation();
  });
  onChip('#quickRelationChips', quickSetRelation);

  $('#btnRelationTipApply').addEventListener('click', applyRelationTip);
  $('#btnRelationTipClose').addEventListener('click', dismissRelationTip);

  $('#btnClearChat').addEventListener('click', () => { closePanels(); clearAll(); });
  $('#btnSettings')?.addEventListener('click', () => { closePanels(); openSettings(); });
}

/** 底部菜单（···）里的动作 */
function bindMenu() {
  $('#btnMore').addEventListener('click', openMenu);

  const ACTIONS = {
    restart: restartChat,
    clearHistory: clearAll,
    forget: forgetMemory,

    settings: openFriendSettings,
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

  onSeg('#segGender', (v) => {

    state.config.herGender = v === 'm' ? 'm' : 'f';
    setSegOn('#segGender', v);
    syncTraitNoteLabel();
    renderAffection();
  });

  onChip('#chipsRelation', (v) => {
    $('#perRelation').value = v;

    if (!perAffTouched) perAff = suggestPerAff();
    renderPersonaChips();
  });
  $('#perRelation').addEventListener('input', () => {
    renderChips('#chipsRelation', RELATION_PRESETS, (v) => v === ($('#perRelation').value || '').trim());
    if (!perAffTouched) perAff = suggestPerAff();
    renderChips('#chipsAff', AFF_PRESETS, (v) => v === perAff);
    updateAffNote();
  });

  onChip('#chipsTraits', (t) => {
    if (perTraits.includes(t)) perTraits = perTraits.filter((x) => x !== t);
    else if (perTraits.length >= 4) { toast('最多挑 4 个', 1600); return; }
    else perTraits = [...perTraits, t];

    if (!perAffTouched) perAff = suggestPerAff();
    renderPersonaChips();
  });

  $('#perBirthday').addEventListener('input', updateSignNote);

  $('#perBio').addEventListener('input', renderBioPreview);
  $('#btnBioPreview').addEventListener('click', () => {
    const el = $('#perBioPreview');
    el.hidden = !el.hidden;
    $('#btnBioPreview').textContent = el.hidden ? '看看拆成几条' : '收起';
    renderBioPreview();
  });

  const syncSceneChips = () =>
    renderChips('#chipsScene', SCENE_PRESETS, (v) => v === $('#perScene').value);
  onChip('#chipsScene', (v) => { $('#perScene').value = v; syncSceneChips(); });
  $('#perScene').addEventListener('input', syncSceneChips);

  onChip('#chipsAff', (v) => {
    perAff = clampAffection(v);
    perAffTouched = true;
    renderPersonaChips();
  });
}

/** 「她记得的事」：搜索、手动增删、导入导出 */
function bindMemoryScreen() {

  $('#btnOpenMemory2')?.addEventListener('click', openMemory);
  $('#btnOpenMemory')?.addEventListener('click', openMemory);
  $('#btnCloseMemory').addEventListener('click', () => {
    $('#screen-memory').classList.remove('show');
  });
  $('#btnChangeScene').addEventListener('click', changeScene);

  const search = $('#memSearch');
  search.addEventListener('input', renderSearchResults);

  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  $('#btnMemSearchClear').addEventListener('click', clearSearch);

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
    $('#screen-settings').hidden = true;
  });
  $('#btnTest').addEventListener('click', testConnection);

  $('#inpProvider')?.addEventListener('change', onProviderChange);
  $('#inpModel')?.addEventListener('change', () => {
    state.config.model = $('#inpModel').value;
    saveConfig();
    $('#testResult').hidden = true;
  });

  $('#inpKey').addEventListener('change', () => {
    state.config.apiKey = $('#inpKey').value.trim();
    saveConfig();
    $('#setupBanner').hidden = !needsSetup();
  });

  $('#nativeModels')?.addEventListener('click', (e) => {
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

  $('#btnClearChat2').addEventListener('click', clearAll);
  $('#btnForget2')?.addEventListener('click', forgetMemory);
  $('#btnCloseFriend')?.addEventListener('click', closeFriendSettings);
  $('#btnOpenPersonaFromFriend')?.addEventListener('click', openPersonaFromFriend);
  $('#btnOpenMemory2')?.addEventListener('click', () => {
    closeFriendSettings();
    openMemory();
  });

  $('#btnDeleteFriend2')?.addEventListener('click', confirmDeleteFriend);
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

    if (!myEmoji() && !myAvatarPic()) renderAvatarPreview('me');
  });

  $$('[data-pick-avatar]').forEach((b) => {
    b.addEventListener('click', () => {
      openAvatarPanel(b.dataset.pickAvatar === 'me' ? 'me' : 'her');
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
    e.target.value = '';
  });
  $('#btnResetAvatar')?.addEventListener('click', resetAvatar);

  $('#btnCloseAvatar')?.addEventListener('click', closeAvatarPanel);

  $('#avatarPanel')?.addEventListener('click', (e) => {
    if (e.target === $('#avatarPanel')) closeAvatarPanel();
  });
}

/** 「她怎么回」那五组单选 */
function bindReplyStyle() {
  const SEGS = [
    ['#segLen2', 'maxTokens'],
    ['#segBurst2', 'burst'],
    ['#segTemp2', 'temperature'],
    ['#segThink2', 'thinking'],
    ['#segSpeak2', 'autoSpeak'],
  ];
  for (const [sel, key] of SEGS) {
    onSeg(sel, (v) => {
      state.config[key] = Number(v);
      saveConfig();
      syncSettingsUI();

      if (key === 'autoSpeak') { state.idleSpoken = 0; armIdleTimer(); }
      buzz(8);
    });
  }

  onSeg('#segShowThink', (v) => {
    state.config.showThink = v === '1';
    saveConfig();
    syncSettingsUI();

    resetChatRender();
    renderChat();
    toast(state.config.showThink ? '她会把心里话说给你看' : '她已经不写心里话了', 2000);
    buzz(8);
  });
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
  resetRecallIndex();
  resetChatRender();
  saveChat();
  ensureScene(true);
  renderChat();
  bootGreeting();
  renderChat();
  toast('已经重新开始了');
}

async function clearAll() {
  if (!confirm('清空全部聊天记录？她就不会记得这些了。')) return;
  state.messages = [];
  resetRecallIndex();
  resetChatRender();
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
    sceneId: state.profile.sceneId,
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
  applyAffectionDecay();

  const hasFriend = !!state.nav.active;
  const freshUser = hasFriend && !state.messages.length && !state.config.personaDone;

  ensureScene();
  buildEmojiPanel();

  const willSpeak = hasFriend && !freshUser && shouldSpeakOnReturn();
  if (hasFriend && !freshUser && !willSpeak) bootGreeting();
  renderChat();
  initFriendUI();
  initEndingUI();
  initRepair();
  bindEvents();
  setupDownloadEntry();
  renderAffection();
  if (freshUser) openPersona();
  closeMenu();
  closePanels();
  syncSettingsUI();

  renderNav();
  showTab('msgs');
  renderMoodStrip();

  armIdleTimer();
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (willSpeak) {
    state.idleSpoken = (state.idleSpoken || 0) + 1;
    setTimeout(async () => {
      const ok = await speakUp('return');
      if (!ok) returnFallbackGreeting();
    }, 400);
  }
  autoGrow();
  syncSendBtn();
  $('#input').placeholder = '';
  $('#navName').textContent = herName();
  renderHerIdentity();

  if (hasFriend && needsSetup()) {
    setTimeout(() => {
      appendSys('还没有填 API Key，点右上角 ··· → 设置 填一下就能聊了');
      openSettings();
    }, 500);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {

      navigator.serviceWorker.getRegistrations?.()
        .then((regs) => {
          for (const r of regs) r.unregister().catch(() => {});
        })
        .catch(() => {});

      if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
    });
  }

  nativeReadyPromise
    .then(() => {
      syncSettingsUI();
      renderNativeModelPanel();
    })
    .catch(() => {});

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

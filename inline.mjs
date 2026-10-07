/**
 * 把前端那堆模块拼成一段**可以直接 eval** 的代码。
 *
 * 为什么单独抽出来：
 *   boot.mjs（给 test-memory / test-time / test-web 用）和 test-app.mjs
 *   （它自己搭了一套 jsdom）原来**各写了一份**内联逻辑。
 *   加了新模块（zodiac / affection）之后，我只改了 boot.mjs，
 *   test-app 里那份没改，于是它 evals 到一句 `import ... from './zodiac.js'`，
 *   报了个看起来毫不相干的 "Cannot use import statement outside a module"。
 *   两份代码做同一件事，迟早会跑偏——所以合成一份。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * 去掉模块语法（内联到一个函数体里，不能再有 import/export）。
 *
 * ⚠️ 先删「再导出」整行：`export { X } from './y.js'` 和 `export { X };`
 * 如果只把开头的 export 去掉，会剩下一个**块语句** `{ X };` ——
 * 而 X 是被剥掉的导入名，于是运行时 ReferenceError。
 * （memory.js 为了把 emotion.js 的 OBSESSION_EMO 转出去就有这么一句。）
 */
const stripExports = (src) => src
  .replace(/^export\s*\{[^}]*\}\s*(?:from\s*['"][^'"]+['"])?;?[ \t]*$/gm, '')
  .replace(/^export\s+/gm, '');
// ⚠️ 这里必须能跨行匹配（几处 import 是写成多行的），所以用 [\s\S]*?。
//    注意别跟下面 APP_REPLACEMENTS 的写法搞混：那边的正则只在 app.js 上跑，
//    必须用"括号内不含花括号"的写法，否则会跨过很多条 import 一起吞掉。
const dropImports = (src) => src.replace(/^import\s+[\s\S]*?from\s*['"][^'"]+['"];?[ \t]*$/gm, '');
const inlinable = (src) => dropImports(stripExports(src));

/**
 * 挑名字时用 typeof 守卫。
 * 为什么：test-web.mjs 会拿它去跑**部署包**，而老部署包里可能没有新加的函数。
 * 直接写 futureHint 会 ReferenceError，于是整个引导崩掉，
 * 真正的"包比源码旧"这份报告反而被埋在崩溃信息下面。
 */
const pick = (names) => names
  .map((n) => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`)
  .join(', ');

/** app.js 里那几条 import 要换成对 __xxx 的解构 */
const APP_REPLACEMENTS = [
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/persona\.js['"];?/,
    'const { CHARACTER, buildSystemPrompt, memoryBlock, greeting, pickScene, sceneHint, intimacyStage, HISTORY_LIMIT, evolveScene, describeTime, SCENES, SCENES_GENERIC, findScene, futureHint, TRAIT_PRESETS } = __persona;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/zodiac\.js['"];?/,
    'const { SIGNS, signOf, parseBirthday, birthdayText, signSummary, zodiacBlock } = __zodiac;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/affection\.js['"];?/,
    'const { LEVELS, levelOf, clamp: clampAffection, affectionBlock, regardBlock, drift: affectionDrift, decayForGap, affectionPercent, affectionSummary, suggestFromTraits, traitAffectionWarning } = __affection;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/relation\.js['"];?/,
    'const { RELATIONS, RELATION_NAMES, findRelation, defaultAffectionFor, relationViewText, relationBlock, relationAffectionWarning, detectRelationSignal, relationMatches, relationTipText, relationShiftHint } = __relation;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/api\.js['"];?/,
    'const { streamChat, DEFAULT_ENDPOINT, DEFAULT_MODEL, isLocalEndpoint, upgradeModel, isDeepSeekEndpoint } = __api;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/providers\.js['"];?/,
    'const { PROVIDERS, getProvider, detectProvider, isLocalProvider } = __providers;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/recall\.js['"];?/,
    'const { buildIndex, appendToIndex, search: recallSearch, formatHits } = __recall;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/habits\.js['"];?/,
    'const { habitsBlock } = __habits;'],
  // memory.js 的 import 是跨多行的，[^}]* 匹配不到，这里用 [^{}]*
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/memory\.js['"];?/,
    'const { newMeta, touchMeta, decayFacts, isPermanent, isObsession, strengthLabel, strengthPercent, PERMANENT_HITS, OBSESSION_EMO } = __memory;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/emotion\.js['"];?/,
    'const { intensityOf, intensityLabel, OBSESSION_EMO: EMO2 } = __emotion;'],
  // 这一轮新拆出来的四个模块。都是跨多行 import，[^}]* 匹配不到，用 [^{}]*
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/format\.js['"];?/,
    'const { esc, isEmojiOnly, timeText: formatTimeText, gapText } = __format;'],
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/storage\.js['"];?/,
    'const { CFG_KEY, CHAT_KEY, PROFILE_KEY, QUOTA_BYTES, readJSON, writeJSON, fillDefaults, fixConfigShape, fixProfileShape, sanitizeAffection, storageUsed, historyBytes, writeChat, quotaWarning, writeProfile, writeConfig, decayProfileFacts, hoistManualEntries, pruneFactsMeta } = __storage;'],
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/memory-io\.js['"];?/,
    'const { BIO_MAX_POINTS, parseMemoryBlock, applyMemory: applyMemoryTo, toggleObsession: toggleObsessionIn, parseBioPoints, applyUserBio: applyUserBioTo, summarizeConversation, resetRecallIndex, recallOldMessages: recallOld, recallBlock: recallBlockOf, parseHistoryText: parseHistory, normalizeTimestamps: stampImported, mergeFacts } = __memoryIO;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/search\.js['"];?/,
    'const { SEARCH_MAX_HITS, searchMessages: searchIn, snippetOf } = __search;'],
  // config.js 只是一行地址常量。内联环境里给它一个空地址，
  // 效果就是"这个部署没配安装包"——和开源版的真实情况一致。
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/config\.js['"];?/,
    "const { APK_URL } = { APK_URL: '' };"],
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/presets\.js['"];?/,
    'const { PERSONA_PRESETS, findPreset, presetToForm } = __presets;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/me\.js['"];?/,
    'const { ME_DEFAULTS, readMe, applyMe, meSummary } = __me;'],
  [/import\s*\{[^}]*\}\s*from\s*['"]\.\/friend-ui\.js['"];?/,
    'const { createFriendUI } = __friendUI;'],
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/mood\.js['"];?/,
    'const { MOODS, MOOD_KEYS, MAX_SHOWN, moodMeta, topMoods, decayMood, blend, normalize: normalizeMood, parseMoodBlock, guessMood, moodBlock, moodText } = __mood;'],
  [/import\s*\{[^{}]*\}\s*from\s*['"]\.\/personas\.js['"];?/,
    'const { PERSONAS_KEY, DEFAULT_ID, migrate, keysFor, activeKeys, orderedList, byRecency, findPersona, addPersona, removePersona, setActive, patchPersona, noteActivity, clearUnread } = __personas;'],
];

/** 每个模块导出什么（两个测试入口用的并集，多给几个不影响） */
const EXPORTS = {
  zodiac: ['SIGNS', 'signOf', 'parseBirthday', 'birthdayText', 'signSummary', 'zodiacBlock'],
  emotion: ['intensityOf', 'isObsessive', 'intensityLabel', 'OBSESSION_EMO'],
  relationViews: ['RELATION_VIEWS'],
  profession: ['DOMAINS', 'domainOf', 'knowledgeBlock', 'userFieldBlock', 'professionBlock'],
  affection: ['LEVELS', 'levelOf', 'clamp', 'affectionBlock', 'regardBlock', 'drift',
    'decayForGap', 'DECAY_AFTER_DAYS', 'DECAY_PER_DAY', 'DECAY_MAX', 'AFFECTION_FLOOR',
    'affectionPercent', 'affectionSummary', 'suggestFromTraits', 'traitAffectionWarning'],
  relation: ['RELATIONS', 'RELATION_NAMES', 'findRelation', 'defaultAffectionFor', 'relationViewText',
    'relationBlock', 'relationAffectionWarning', 'detectRelationSignal', 'relationMatches',
    'relationTipText', 'relationShiftHint'],
  persona: ['CHARACTER', 'buildSystemPrompt', 'memoryBlock', 'greeting', 'pickScene', 'sceneHint',
    'intimacyStage', 'HISTORY_LIMIT', 'evolveScene', 'describeTime', 'SCENES', 'SCENES_GENERIC',
    'findScene', 'futureHint', 'TRAIT_PRESETS'],
  api: ['streamChat', 'DEFAULT_ENDPOINT', 'DEFAULT_MODEL', 'isLocalEndpoint', 'upgradeModel', 'isDeepSeekEndpoint'],
  providers: ['PROVIDERS', 'getProvider', 'detectProvider', 'isLocalProvider'],
  recall: ['buildIndex', 'appendToIndex', 'search', 'formatHits', 'keywords'],
  habits: ['habitsBlock', 'countActions', 'extractActions', 'groupOf'],
  memory: ['newMeta', 'touchMeta', 'decayFacts', 'retention', 'isPermanent', 'isObsession',
    'permanentReason', 'strengthLabel', 'strengthPercent', 'PERMANENT_HITS', 'OBSESSION_EMO',
    'halfLifeDays', 'FORGET_BELOW'],
  format: ['esc', 'isEmojiOnly', 'timeText', 'gapText'],
  search: ['SEARCH_MAX_HITS', 'termsOf', 'searchMessages', 'snippetOf'],
  storage: ['CFG_KEY', 'CHAT_KEY', 'PROFILE_KEY', 'QUOTA_BYTES', 'readJSON', 'writeJSON', 'fillDefaults',
    'fixConfigShape', 'fixProfileShape', 'sanitizeAffection', 'storageUsed', 'historyBytes',
    'writeChat', 'quotaWarning', 'writeProfile', 'writeConfig',
    'decayProfileFacts', 'hoistManualEntries', 'pruneFactsMeta'],
  memoryIO: ['BIO_MAX_POINTS', 'parseMemoryBlock', 'applyMemory', 'toggleObsession',
    'parseBioPoints', 'toThirdPerson', 'applyUserBio', 'summarizeConversation',
    'resetRecallIndex', 'recallOldMessages', 'recallBlock', 'parseHistoryText',
    'normalizeTimestamps', 'mergeFacts'],
  personas: ['PERSONAS_KEY', 'DEFAULT_ID', 'LEGACY_KEYS', 'keysFor', 'normalizeNav', 'orderedList',
    'findPersona', 'makeId', 'newPersona', 'addPersona', 'removePersona', 'setActive',
    'patchPersona', 'noteActivity', 'clearUnread', 'byRecency', 'migrate', 'activeKeys', 'keysOf'],
  presets: ['PERSONA_PRESETS', 'findPreset', 'presetToForm'],
  me: ['ME_DEFAULTS', 'readMe', 'meIsEmpty', 'meSignature', 'applyMe', 'meSummary'],
  friendUI: ['createFriendUI'],
  mood: ['MOODS', 'MOOD_KEYS', 'MAX_SHOWN', 'HALF_LIFE_MIN', 'FLOOR', 'moodMeta', 'decayMood',
    'blend', 'topMoods', 'parseMoodBlock', 'normalize', 'guessMood', 'moodBlock', 'moodText'],
};

/**
 * 生成可以直接 `window.eval(...)` 的源码。
 * @param {string} [dir] 从哪个目录读前端文件（默认源码目录；传部署包路径就能测打包产物）
 */
export function inlineScript(dir = '') {
  const base = dir ? path.resolve(dir) : root;
  const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');

  const src = {
    zodiac: inlinable(read('src/zodiac.js')),
    emotion: inlinable(read('src/emotion.js')),
    format: inlinable(read('src/format.js')),
    search: inlinable(read('src/search.js')),
    affection: inlinable(read('src/affection.js')),
    relationViews: inlinable(read('src/relation-views.js')),
    relation: inlinable(read('src/relation.js')),
    profession: inlinable(read('src/profession.js')),
    persona: inlinable(read('src/persona.js')),
    api: stripExports(read('src/api.js')),
    providers: stripExports(read('src/providers.js')),
    recall: stripExports(read('src/recall.js')),
    habits: stripExports(read('src/habits.js')),
    memory: inlinable(read('src/memory.js')),
    storage: inlinable(read('src/storage.js')),
    memoryIO: inlinable(read('src/memory-io.js')),
    personas: inlinable(read('src/personas.js')),
    presets: inlinable(read('src/presets.js')),
    me: inlinable(read('src/me.js')),
    friendUI: inlinable(read('src/friend-ui.js')),
    mood: inlinable(read('src/mood.js')),
  };

  let appSrc = read('src/app.js');
  for (const [re, to] of APP_REPLACEMENTS) appSrc = appSrc.replace(re, to);

  // 依赖顺序（被依赖的要先造出来，靠 IIFE 传参把用到的函数喂进去）：
  //   zodiac / emotion / format / search        ← 谁都不依赖
  //   → memory（要 emotion）→ storage（要 memory + api）
  //   → affection / relation-views / relation → profession
  //   → memory-io（要 memory + emotion + recall）
  //   → persona（要上面一大半）→ app
  return `
    (function () {
      const __zodiac = (function () { ${src.zodiac}
        return { ${pick(EXPORTS.zodiac)} };
      })();
      const __emotion = (function () { ${src.emotion}
        return { ${pick(EXPORTS.emotion)} };
      })();
      const __format = (function () { ${src.format}
        return { ${pick(EXPORTS.format)} };
      })();
      const __search = (function () { ${src.search}
        return { ${pick(EXPORTS.search)} };
      })();
      const __personas = (function () { ${src.personas}
        return { ${pick(EXPORTS.personas)} };
      })();
      const __presets = (function () { ${src.presets}
        return { ${pick(EXPORTS.presets)} };
      })();
      const __me = (function () { ${src.me}
        return { ${pick(EXPORTS.me)} };
      })();
      const __friendUI = (function () { ${src.friendUI}
        return { ${pick(EXPORTS.friendUI)} };
      })();
      const __mood = (function () { ${src.mood}
        return { ${pick(EXPORTS.mood)} };
      })();
      const __memory = (function (OBSESSION_EMO) { ${src.memory}
        return { ${pick(EXPORTS.memory)} };
      })(__emotion.OBSESSION_EMO);
      const __affection = (function () { ${src.affection}
        return { ${pick(EXPORTS.affection)} };
      })();
      const __relationViews = (function () { ${src.relationViews}
        return { ${pick(EXPORTS.relationViews)} };
      })();
      const __relation = (function (levelOf, RELATION_VIEWS) { ${src.relation}
        return { ${pick(EXPORTS.relation)} };
      })(__affection.levelOf, __relationViews.RELATION_VIEWS);
      const __profession = (function () { ${src.profession}
        return { ${pick(EXPORTS.profession)} };
      })();
      const __persona = (function (zodiacBlock, birthdayText, affectionBlock, regardBlock, relationBlock, OBSESSION_EMO, professionBlock, domainOf) { ${src.persona}
        return { ${pick(EXPORTS.persona)} };
      })(__zodiac.zodiacBlock, __zodiac.birthdayText, __affection.affectionBlock, __affection.regardBlock, __relation.relationBlock, __emotion.OBSESSION_EMO, __profession.professionBlock, __profession.domainOf);
      const __api = (function () { ${src.api}
        return { ${pick(EXPORTS.api)} };
      })();
      const __providers = (function () { ${src.providers}
        return { ${pick(EXPORTS.providers)} };
      })();
      const __recall = (function () { ${src.recall}
        return { ${pick(EXPORTS.recall)} };
      })();
      const __habits = (function () { ${src.habits}
        return { ${pick(EXPORTS.habits)} };
      })();
      const __storage = (function (newMeta, decayFacts, upgradeModel) { ${src.storage}
        return { ${pick(EXPORTS.storage)} };
      })(__memory.newMeta, __memory.decayFacts, __api.upgradeModel);
      const __memoryIO = (function (buildIndex, appendToIndex, recallSearch, formatHits, newMeta, touchMeta, intensityOf, OBSESSION_EMO) { ${src.memoryIO}
        return { ${pick(EXPORTS.memoryIO)} };
      })(__recall.buildIndex, __recall.appendToIndex, __recall.search, __recall.formatHits, __memory.newMeta, __memory.touchMeta, __emotion.intensityOf, __emotion.OBSESSION_EMO);
      (function () { ${appSrc} })();
    })();
  `;
}

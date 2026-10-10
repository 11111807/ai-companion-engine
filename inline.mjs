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

/**
 * app.js 里那几条 import 要换成对 __xxx 的解构。
 *
 * ⚠️ 这里以前是**一张手写的替换表**，它漏过一次：加了 zodiac / affection 之后
 * 只改了 boot.mjs，于是 eval 到一句 `import ... from './zodiac.js'`，
 * 报出来是 "Cannot use import statement outside a module" ——
 * 和真正的原因差着十万八千里。现在按模块名自动推导：
 * 新增模块、新增导出都不用再动这里。
 *
 * ⚠️ 正则里必须用 `[^{}]`：import 的名字列表不含花括号，**但可以跨行**
 * （app.js 里好几个 import 都写成多行）。用 `[\s\S]*?` 会从第一条
 * 一路吞到后面某条 `from '...'`，把中间的全删掉。
 */
const IMPORTS_FROM = (file) =>
  new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*['"]\\./${file}\\.js['"];?`, 'g');

/** 文件名（路径里的写法）→ IIFE 里那个变量名，不一致的才要列 */
const VAR_OF = {
  'relation-views': 'relationViews', 'memory-io': 'memoryIO',
  'friend-ui': 'friendUI', 'ending-ui': 'endingUI',
};

/** app.js 里 import 过的所有模块文件（不含 config.js，它要特殊处理） */
const APP_MODULES = [
  'persona', 'zodiac', 'affection', 'relation', 'api', 'providers', 'habits', 'memory',
  'emotion', 'format', 'storage', 'presets', 'me', 'friend-ui', 'ending-ui', 'mood',
  'personas', 'memory-io', 'search', 'narration', 'thought', 'repeat', 'voice', 'ending', 'chunk', 'repair',
];

/** 把 `import { a, b as c } from './x.js'` 换成 `const { a, b: c } = __x;` */
function rewriteImports(src) {
  let out = src;
  for (const file of APP_MODULES) {
    out = out.replace(IMPORTS_FROM(file),
      (_, names) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = __${VAR_OF[file] || file};`);
  }
  // config.js 只是一行地址常量。内联环境里给它一个空地址，
  // 效果就是"这个部署没配安装包"——和开源版的真实情况一致。
  return out.replace(IMPORTS_FROM('config'), "const { APK_URL } = { APK_URL: '' };");
}


/** 每个模块导出什么（两个测试入口用的并集，多给几个不影响） */
const EXPORTS = {
  zodiac: ['SIGNS', 'signOf', 'parseBirthday', 'birthdayText', 'signSummary', 'zodiacBlock'],
  emotion: ['intensityOf', 'isObsessive', 'intensityLabel', 'OBSESSION_EMO'],
  relationViews: ['RELATION_VIEWS'],
  profession: ['DOMAINS', 'domainOf', 'knowledgeBlock', 'userFieldBlock', 'professionBlock'],
  affection: ['LEVELS', 'levelOf', 'clamp', 'affectionBlock', 'regardBlock', 'ruptureBlock', 'ruptureShift', 'turn', 'AMEND_NEED', 'drift',
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
  narration: ['splitNarration', 'recentNarrations', 'narrationVaryBlock',
    'LAZY_ACTIONS', 'isLazyNarration', 'lazyNarrationBlock'],
  thought: ['parseThoughtBlock', 'thinkPause', 'thoughtPrompt', 'recentThoughts', 'thoughtVaryBlock'],
  repeat: ['repeatedTopics', 'repeatBlock'],
  chunk: ['stripLabel', 'splitMessages', 'replyItems', 'isLeaked'],
  repair: ['createRepair'],
  voice: ['voiceOf', 'toneOf', 'voiceBlock', 'voiceHint'],
  ending: ['detectEnding', 'DREAM_NARRATION', 'ENDING_DIALOG'],
  search: ['SEARCH_MAX_HITS', 'termsOf', 'searchMessages', 'snippetOf'],
  storage: ['CFG_KEY', 'CHAT_KEY', 'PROFILE_KEY', 'QUOTA_BYTES', 'readJSON', 'writeJSON', 'fillDefaults',
    'fixConfigShape', 'fixProfileShape', 'sanitizeAffection', 'storageUsed', 'historyBytes',
    'writeChat', 'quotaWarning', 'writeProfile', 'writeConfig',
    'decayProfileFacts', 'hoistManualEntries', 'pruneFactsMeta',
    'GLOBAL_KEY', 'GLOBAL_FIELDS', 'pickGlobal', 'readGlobal', 'writeGlobal', 'omitGlobal'],
  memoryIO: ['BIO_MAX_POINTS', 'parseMemoryBlock', 'applyMemory', 'toggleObsession',
    'parseBioPoints', 'toThirdPerson', 'applyUserBio', 'summarizeConversation',
    'resetRecallIndex', 'recallOldMessages', 'recallBlock', 'parseHistoryText',
    'normalizeTimestamps', 'mergeFacts', 'todayTimeline', 'MAX_POINT_ITEMS', 'TIMELINE_MAX'],
  personas: ['PERSONAS_KEY', 'DEFAULT_ID', 'LEGACY_KEYS', 'keysFor', 'normalizeNav', 'orderedList',
    'findPersona', 'makeId', 'newPersona', 'addPersona', 'removePersona', 'setActive',
    'patchPersona', 'noteActivity', 'clearUnread', 'byRecency', 'migrate', 'activeKeys', 'keysOf'],
  presets: ['PERSONA_PRESETS', 'findPreset', 'presetToForm'],
  me: ['ME_DEFAULTS', 'readMe', 'meIsEmpty', 'meSignature', 'applyMe', 'meSummary'],
  friendUI: ['createFriendUI'],
  endingUI: ['createEndingUI'],
  mood: ['MOODS', 'MOOD_KEYS', 'MAX_SHOWN', 'HALF_LIFE_MIN', 'FLOOR', 'moodMeta', 'decayMood',
    'blend', 'topMoods', 'parseMoodBlock', 'normalize', 'guessMood', 'moodBlock', 'moodText'],
};

/**
 * 从**原文**里扫出这个模块导出了什么。
 *
 * 为什么要有它：下面那张 EXPORTS 表得手工维护，漏一次就是运行时
 * "xxx is not a function"（这一轮就踩了：storage.js 加了 removeKeys 忘了登记）。
 * 扫出来的和表里手写的**取并集**，所以两边都漏才出事。
 *
 * 只看 `export function/const/…` 和 `export { … }` 两种形态（这个项目的全部用法）。
 */
function exportsOf(code) {
  const out = new Set();
  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    out.add(m[1]);
  }
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (t) out.add((t.split(/\s+as\s+/)[1] || t).trim());
    }
  }
  return [...out];
}

/**
 * 生成可以直接 `window.eval(...)` 的源码。
 * @param {string} [dir] 从哪个目录读前端文件（默认源码目录；传部署包路径就能测打包产物）
 */
export function inlineScript(dir = '') {
  const base = dir ? path.resolve(dir) : root;
  const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');

  // 每个模块读两遍：剥掉模块语法的进内联，原文留着扫导出（见 names）。
  const raw = {};
  const load = (key, file, strip = inlinable) => {
    raw[key] = read(`src/${file}.js`);
    return strip(raw[key]);
  };

  const src = {
    zodiac: load('zodiac', 'zodiac'),
    emotion: load('emotion', 'emotion'),
    format: load('format', 'format'),
    narration: load('narration', 'narration'),
    thought: load('thought', 'thought'),
    repeat: load('repeat', 'repeat'),
    chunk: load('chunk', 'chunk'),
    repair: load('repair', 'repair'),
    voice: load('voice', 'voice'),
    ending: load('ending', 'ending'),
    search: load('search', 'search'),
    affection: load('affection', 'affection'),
    relationViews: load('relationViews', 'relation-views'),
    relation: load('relation', 'relation'),
    profession: load('profession', 'profession'),
    persona: load('persona', 'persona'),
    api: load('api', 'api', stripExports),
    providers: load('providers', 'providers', stripExports),
    recall: load('recall', 'recall', stripExports),
    habits: load('habits', 'habits', stripExports),
    memory: load('memory', 'memory'),
    storage: load('storage', 'storage'),
    memoryIO: load('memoryIO', 'memory-io'),
    personas: load('personas', 'personas'),
    presets: load('presets', 'presets'),
    me: load('me', 'me'),
    friendUI: load('friendUI', 'friend-ui'),
    endingUI: load('endingUI', 'ending-ui'),
    mood: load('mood', 'mood'),
  };
  for (const k of Object.keys(EXPORTS)) if (!(k in raw)) delete EXPORTS[k];

  let appSrc = read('src/app.js');
  appSrc = rewriteImports(appSrc);

  /** 这个模块要往外给的名字：手写表 ∪ 源码里扫出来的 */
  const names = (key) => [...new Set([...(EXPORTS[key] || []), ...exportsOf(raw[key] || '')])];

  // 依赖顺序（被依赖的要先造出来，靠 IIFE 传参把用到的函数喂进去）：
  //   zodiac / emotion / format / search        ← 谁都不依赖
  //   → memory（要 emotion）→ storage（要 memory + api）
  //   → affection / relation-views / relation → profession
  //   → memory-io（要 memory + emotion + recall）
  //   → persona（要上面一大半）→ app
  return `
    (function () {
      const __zodiac = (function () { ${src.zodiac}
        return { ${pick(names('zodiac'))} };
      })();
      const __emotion = (function () { ${src.emotion}
        return { ${pick(names('emotion'))} };
      })();
      const __format = (function () { ${src.format}
        return { ${pick(names('format'))} };
      })();
      const __narration = (function () { ${src.narration}
        return { ${pick(names('narration'))} };
      })();
      const __thought = (function () { ${src.thought}
        return { ${pick(names('thought'))} };
      })();
      const __repeat = (function () { ${src.repeat}
        return { ${pick(names('repeat'))} };
      })();
      const __chunk = (function () { ${src.chunk}
        return { ${pick(names('chunk'))} };
      })();
      const __repair = (function () { ${src.repair}
        return { ${pick(names('repair'))} };
      })();
      const __voice = (function () { ${src.voice}
        return { ${pick(names('voice'))} };
      })();
      const __ending = (function () { ${src.ending}
        return { ${pick(names('ending'))} };
      })();
      const __search = (function () { ${src.search}
        return { ${pick(names('search'))} };
      })();
      const __personas = (function () { ${src.personas}
        return { ${pick(names('personas'))} };
      })();
      const __presets = (function () { ${src.presets}
        return { ${pick(names('presets'))} };
      })();
      const __me = (function () { ${src.me}
        return { ${pick(names('me'))} };
      })();
      const __friendUI = (function () { ${src.friendUI}
        return { ${pick(names('friendUI'))} };
      })();
      const __endingUI = (function () { ${src.endingUI}
        return { ${pick(names('endingUI'))} };
      })();
      const __mood = (function () { ${src.mood}
        return { ${pick(names('mood'))} };
      })();
      const __memory = (function (OBSESSION_EMO) { ${src.memory}
        return { ${pick(names('memory'))} };
      })(__emotion.OBSESSION_EMO);
      const __affection = (function () { ${src.affection}
        return { ${pick(names('affection'))} };
      })();
      const __relationViews = (function () { ${src.relationViews}
        return { ${pick(names('relationViews'))} };
      })();
      const __relation = (function (levelOf, RELATION_VIEWS) { ${src.relation}
        return { ${pick(names('relation'))} };
      })(__affection.levelOf, __relationViews.RELATION_VIEWS);
      const __profession = (function () { ${src.profession}
        return { ${pick(names('profession'))} };
      })();
      const __persona = (function (zodiacBlock, birthdayText, affectionBlock, regardBlock, ruptureBlock, relationBlock, OBSESSION_EMO, professionBlock, domainOf, lazyNarrationBlock, thoughtPrompt, voiceOf, voiceBlock, voiceFlowBlock) { ${src.persona}
        return { ${pick(names('persona'))} };
      })(__zodiac.zodiacBlock, __zodiac.birthdayText, __affection.affectionBlock, __affection.regardBlock, __affection.ruptureBlock, __relation.relationBlock, __emotion.OBSESSION_EMO, __profession.professionBlock, __profession.domainOf, __narration.lazyNarrationBlock, __thought.thoughtPrompt, __voice.voiceOf, __voice.voiceBlock, __voice.voiceFlowBlock);
      const __api = (function () { ${src.api}
        return { ${pick(names('api'))} };
      })();
      const __providers = (function () { ${src.providers}
        return { ${pick(names('providers'))} };
      })();
      const __recall = (function () { ${src.recall}
        return { ${pick(names('recall'))} };
      })();
      const __habits = (function () { ${src.habits}
        return { ${pick(names('habits'))} };
      })();
      const __storage = (function (newMeta, decayFacts, upgradeModel) { ${src.storage}
        return { ${pick(names('storage'))} };
      })(__memory.newMeta, __memory.decayFacts, __api.upgradeModel);
      const __memoryIO = (function (buildIndex, appendToIndex, recallSearch, formatHits, newMeta, touchMeta, intensityOf, OBSESSION_EMO) { ${src.memoryIO}
        return { ${pick(names('memoryIO'))} };
      })(__recall.buildIndex, __recall.appendToIndex, __recall.search, __recall.formatHits, __memory.newMeta, __memory.touchMeta, __emotion.intensityOf, __emotion.OBSESSION_EMO);
      (function () { ${appSrc} })();
    })();
  `;
}

/**
 * 给自己看排版用的截图工具。
 *
 * 为什么需要：jsdom 测不出排版 —— 溢出、重叠、断行、字号、按钮点不到，
 * 它一概看不见。之前那条"装安卓版"横幅就是因此白挂了好久：
 * 测试断言 hidden === true 是绿的，屏幕上却还在。
 *
 * 做法：
 *   1. 用 bootApp 在 jsdom 里把应用按场景跑起来（点开面板、发消息…）
 *   2. 把跑完的 DOM 序列化出来，**内联真实的 styles.css**
 *   3. 用 Edge 无头模式渲染成 PNG
 *
 * 用法：
 *   node shot.mjs          # 只生成 .preview/*.html
 *   然后（或直接看 shot.ps1）用 Edge 转成 png
 *
 * 浏览器路径不在这里写死 —— 见同目录的 shot.ps1（它会自己找 Edge/Chrome，
 * 也可以用 SHOT_BROWSER 环境变量指定）。
 */

import { bootApp, msg } from './boot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(root, '.preview');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

const NOW = Date.now();
const MIN = 60 * 1000;

/**
 * 把 jsdom 里的最终 DOM 存成一个自包含的 html（样式内联、去掉脚本）。
 *
 * ⚠️ 为什么要往 CSS 里钉一个固定尺寸：
 *   这台机器的 Edge（154）**不认 --window-size 控制布局视口** ——
 *   我按 360 要，它给的是 492×205。于是页面按 492 排版、截图只截到 360，
 *   右边全被切掉。第一次跑出来"用户气泡被切"就是这么来的，
 *   白白怀疑了一轮 CSS（其实 CSS 没问题）。
 *   所以这里直接把 html/body/.screen 的宽高钉死，跟浏览器窗口彻底脱钩。
 */
function dumpHtml(app, name, w, h, post) {
  const doc = app.dom.window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());

  // ⚠️ jsdom 里用 JS 设的 input.value 只是**属性对象**上的值，
  // outerHTML 序列化出来的是 HTML 的 value **attribute** —— 不搬过去的话，
  // 浏览器渲染出来显示的是 placeholder，我会把"填好的表单"看成"空的"。
  doc.querySelectorAll('input').forEach((el) => {
    if (el.value) el.setAttribute('value', el.value);
    else el.removeAttribute('value');
  });
  doc.querySelectorAll('textarea').forEach((el) => {
    el.textContent = el.value || '';
  });

  const link = doc.querySelector('link[rel="stylesheet"]');
  const style = doc.createElement('style');
  style.textContent = `/* 截图专用：把视口尺寸钉死，绕开 Edge 不认 --window-size 的问题 */
html, body { width: ${w}px !important; height: ${h}px !important; overflow: hidden !important; }
.screen { position: absolute !important; top: 0 !important; left: 0 !important;
          width: ${w}px !important; height: ${h}px !important; }
#mask, #toast { position: absolute !important; width: ${w}px !important; }
${css}`;
  if (link) link.replaceWith(style); else doc.head.appendChild(style);

  // post：给场景一个机会调整（比如把聊天滚到最新）
  if (post) {
    const s = doc.createElement('script');
    s.textContent = post;
    doc.body.appendChild(s);
  }

  const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  fs.writeFileSync(path.join(OUT, `${name}.html`), html, 'utf8');
  return `${name}.html`;
}

/** 一段像样的对话，看起来才像真的在用 */
const CHAT = [
  msg('user', '今天又加班到十点', 190),
  msg('assistant', '又加班？你们那个需求到底什么时候能定下来啊', 189),
  msg('assistant', '先吃点东西，别又饿着肚子干', 188),
  msg('user', '吃了泡面', 186),
  msg('assistant', '……泡面也算饭？', 185),
  msg('assistant', '明天别这样了，我给你点个外卖吧', 184),
  msg('user', '不用啦，你还没吃饭呢', 12),
  msg('assistant', '我这边刚忙完，正想跟你说这个', 11),
  msg('assistant', '今天特别想你', 10),
  msg('user', '我也是，明天见', 4),
  msg('assistant', '好呀，那你早点睡\n\n不许再刷手机了', 3),
];

/** 点一下某个元素（截图脚本里到处要用，抽出来省得每处写一长串） */
const tap = (app, sel) => app.$(sel).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

/** 走一遍"加好友"的完整流程，人设页直接点开始 */
function addFriend(app, presetId) {
  tap(app, '#btnAddFriend');
  tap(app, `#addFriendList [data-preset="${presetId}"]`);
  tap(app, '#btnPersonaStart');       // 预设已经填好表单了，直接开始
}

/** 人设页：填一遍，顺便展开生平的拆分预览 */
function personaSetup(app) {  app.$('#perBirthday').value = '2-25';
  app.$('#perBirthday').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.$('#chipsTraits').querySelector('[data-chip="慢热"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#chipsTraits').querySelector('[data-chip="嘴硬心软"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#chipsRelation').querySelector('[data-chip="恋人"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#perBio').value = '27 岁，在杭州做开发\n老家山东，有个妹妹\n养了只猫叫豆豆';
  app.$('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.$('#btnBioPreview').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
}

const CASES = [
  {
    name: '01-chat',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320, affection: 68, affectionBase: 60, sceneText: '晚上在宿舍，刚洗完澡，头发还没干，瘫在椅子上听歌。', sceneId: 'dorm-evening' }, config: { herRelation: '恋人', personaDone: true } },
    setup: () => {},
    post: 'document.querySelector("#messages").scrollTop = 1e6;',
  },
  {
    name: '02-plus',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320, affection: 68, affectionBase: 60 }, config: { herRelation: '恋人', personaDone: true } },
    setup: (app) => {
      app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    },
  },
  {
    name: '03-plus-relations',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320, affection: 68 }, config: { herRelation: '同事', personaDone: true } },
    setup: (app) => {
      app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      app.$('#btnQuickRelation').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    },
  },
  {
    name: '04-relation-tip',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320, affection: 62 }, config: { herRelation: '同事', personaDone: true } },
    setup: async (app) => {
      await app.send('其实我想了很久，你做我女朋友吧');
    },
  },
  {
    name: '05-memory',
    w: 390, h: 1000,
    seed: {
      chat: CHAT,
      profile: {
        msgCount: 320, affection: 68,
        facts: ['他爱人五年前离开了他', '他养了只猫叫豆豆', '老家山东，有个妹妹', '最近在准备考试'],
        factsManual: ['老家山东，有个妹妹', '最近在准备考试'],
        factsMeta: {
          '他爱人五年前离开了他': { hits: 1, lastHit: NOW - 1800 * 86400000, emo: 10 },
          '他养了只猫叫豆豆': { hits: 9, lastHit: NOW - 3600e3 },
          '老家山东，有个妹妹': { hits: 2, lastHit: NOW - 5 * 86400000, pinned: true },
          '最近在准备考试': { hits: 3, lastHit: NOW - 9 * 86400000, pinned: true },
        },
        summary: ['说好周末一起看电影', '他上周去看了演唱会'],
        faded: ['他提过想换工作'],
      },
      config: { herRelation: '恋人', personaDone: true },
    },
    setup: (app) => {
      app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      const s = app.$('#memSearch');
      s.value = '加班';
      s.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    },
  },
  {
    name: '06-persona-top',
    w: 390, h: 1000,
    seed: { config: { personaDone: false } },
    setup: personaSetup,
  },
  {
    name: '07-persona-bottom',
    w: 390, h: 1000,
    seed: { config: { personaDone: false } },
    setup: personaSetup,
    post: 'document.querySelector("#screen-persona .wx-settings-body").scrollTop = 1e6;',
  },
  {
    name: '08-settings-top',
    w: 390, h: 1000,
    seed: { profile: { msgCount: 320 }, config: { personaDone: true, apiKey: 'sk-test' } },
    setup: (app) => { app.$('#screen-settings').classList.add('show'); },
  },
  {
    name: '09-settings-bottom',
    w: 390, h: 1000,
    seed: { profile: { msgCount: 320 }, config: { personaDone: true, apiKey: 'sk-test' } },
    setup: (app) => { app.$('#screen-settings').classList.add('show'); },
    post: 'document.querySelector("#screen-settings .wx-settings-body").scrollTop = 1e6;',
  },
  {
    name: '10-affection-low',
    w: 390, h: 700,
    seed: { chat: CHAT, profile: { msgCount: 320, affection: 12 }, config: { herRelation: '陌生人', personaDone: true } },
    setup: (app) => {
      app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    },
  },
  // ---- 多好友：消息页 / 好友页 / 我 ----
  {
    name: '11-msgs',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320 }, config: { herRelation: '恋人', personaDone: true } },
    setup: (app) => {
      addFriend(app, 'linyan');
      addFriend(app, 'xiaoan');
      // 造完要切回默认好友"小雨"，不然列表看起来只有新加的人
      app.$('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      app.$$('#msgList .wx-item')[0].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      app.$('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    },
  },
  {
    name: '12-friends',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320 }, config: { herRelation: '恋人', personaDone: true } },
    setup: (app) => {
      addFriend(app, 'linyan');
      addFriend(app, 'suyi');
      app.$('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      tap(app, '.wx-tab[data-tab="friends"]');
    },
  },
  {
    name: '13-add-friend',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320 }, config: { personaDone: true } },
    setup: (app) => {
      app.$('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      tap(app, '.wx-tab[data-tab="friends"]');
      app.$('#btnAddFriend').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    },
  },
  {
    name: '14-me',
    w: 390, h: 700,
    seed: {
      chat: CHAT, profile: { msgCount: 320 },
      config: { personaDone: true, userName: '阿哲', myEmoji: '🐶', myAge: 27, myJob: '后端开发', myGender: 'm' },
    },
    setup: (app) => {
      app.$('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
      tap(app, '.wx-tab[data-tab="me"]');
    },
  },
  {
    name: '15-mood',
    w: 390, h: 844,
    seed: {
      chat: [
        ...CHAT,
        { role: 'user', content: '（她推门进来，手里拎着两杯奶茶）', ts: NOW - 60e3, narr: true },
        { role: 'assistant', content: '诶？你怎么知道我想喝这个', ts: NOW - 40e3 },
        { role: 'assistant', content: '不过你今天怎么这么晚才回来', ts: NOW - 30e3 },
      ],
      profile: { msgCount: 320, affection: 68, mood: { joy: 10, love: 15 }, moodAt: NOW - 60e3 },
      config: { herRelation: '恋人', personaDone: true },
    },
    setup: () => {},
    post: 'document.querySelector("#messages").scrollTop = 1e6;',
  },
  {
    name: '16-narration-input',
    w: 390, h: 844,
    seed: { chat: CHAT, profile: { msgCount: 320 }, config: { herRelation: '恋人', personaDone: true } },
    setup: (app) => {
      app.$('#narrInput').value = '她愣了一下，把脸转过去';
      app.$('#narrInput').dispatchEvent(new app.window.Event('input', { bubbles: true }));
    },
    post: 'document.querySelector("#messages").scrollTop = 1e6;',
  },
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/\.(html|png)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
}

const names = [];
for (const c of CASES) {
  const seed = {
    'xiaoyu.chat.v1': c.seed.chat || [],
    'xiaoyu.profile.v1': c.seed.profile || {},
    'xiaoyu.config.v1': c.seed.config || {},
  };
  const app = bootApp({ seed, reply: '好呀 那你早点睡' });
  try {
    await c.setup(app);
    await app.sleep(30);
    names.push(dumpHtml(app, c.name, c.w, c.h, c.post));
  } catch (e) {
    console.log(`  ✗ ${c.name} 失败了：${e.message}`);
  }
  // 故意不关窗口：jsdom 关掉之后挂着的微任务会对着已销毁的 document 报错
}

const sizes = CASES.map((c) => `${c.name} ${c.w}x${c.h}`).join(';');
fs.writeFileSync(path.join(OUT, 'sizes.txt'), sizes, 'utf8');
console.log(`生成了 ${names.length} 个场景 → ${OUT}`);
console.log(sizes);
console.log(names.join('  '));

// 应用里挂着主动开口的定时器（4 分钟）等一堆东西，不显式退出这个进程不会自己结束
process.exit(0);

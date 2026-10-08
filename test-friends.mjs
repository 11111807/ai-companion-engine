/**
 * 多好友：底部导航、好友列表、添加预设、每个好友各自的记忆与时钟。
 *
 * 用户这一轮要的东西（这一份盯的就是这些）：
 *   1. 底部导航：消息 / 好友 / 我
 *   2. 好友页能看到"预设好的 AI 人格"，能加新的
 *   3. 加完的好友出现在好友列表和消息页里
 *   4. 每个好友**各存各的**：记忆 / 人设 / 好感度互不干涉
 *   5. 但**内置时间是所有好友共用的**
 *   6. 我的基础资料（名字/头像/职业/性别/年龄/生日）每个好友都看得到
 *
 * 注意：不要在中途 window.close()（理由见 test-memory.mjs 顶部）
 */

import { bootApp, msg } from './boot.mjs';

/** 打开「这个好友的设置」页（聊天页 ··· → 设置）。这一轮新加的小工具。 */
function openFriendSettingsVia(app) {
  app.$('#btnMore').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#actionSheet').querySelector('[data-act="settings"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
}
import {
  keysFor, DEFAULT_ID, PERSONAS_KEY, normalizeNav, orderedList, byRecency,
  addPersona, removePersona, setActive, patchPersona, noteActivity, clearUnread, makeId,
} from './src/personas.js';
import { PERSONA_PRESETS, findPreset, presetToForm } from './src/presets.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const windows = [];

// ---------------------------------------------------------------- 1) 存储路由
console.log('\n[1] 存储路由：默认好友用老 key，新好友用自己的 ── 老存档才不会丢 ...');
{
  check('默认好友走那三个老 key',
    keysFor(DEFAULT_ID).config === 'xiaoyu.config.v1'
    && keysFor(DEFAULT_ID).chat === 'xiaoyu.chat.v1'
    && keysFor(DEFAULT_ID).profile === 'xiaoyu.profile.v1');
  check('不传 id 也算默认好友', keysFor('').config === 'xiaoyu.config.v1'
    && keysFor(null).profile === 'xiaoyu.profile.v1');
  check('其他好友有自己的命名空间',
    keysFor('p123').config === 'xiaoyu.persona.p123.config.v1'
    && keysFor('p123').chat === 'xiaoyu.persona.p123.chat.v1'
    && keysFor('p123').profile === 'xiaoyu.persona.p123.profile.v1');
  check('不同好友的 key 不会撞',
    new Set([keysFor('a').config, keysFor('b').config, keysFor(DEFAULT_ID).config]).size === 3);
}

console.log('\n[2] 索引的容错：坏数据不能让好友"消失" ...');
{
  check('没有索引 → 只有默认好友',
    orderedList(null).length === 1 && orderedList(null)[0].id === DEFAULT_ID);
  check('索引不是对象 → 同上', orderedList('坏了').length === 1);
  check('list 不是数组 → 同上', orderedList({ list: 'x' }).length === 1);

  const messy = normalizeNav({
    list: [{ id: 'a' }, { id: 'a' }, { id: '' }, null, { id: 'b' }],
    order: ['b', '不存在的人', 'a'],
    active: '不存在的人',
  });
  check('重复 id 会被去掉', messy.list.filter((p) => p.id === 'a').length === 1);
  check('空 id / null 会被丢掉', messy.list.every((p) => p.id));
  check('默认好友永远在（哪怕被人从表里删了）',
    messy.list.some((p) => p.id === DEFAULT_ID), messy.list.map((p) => p.id).join(','));
  check('order 里不存在的人会被剔掉，漏掉的会补上',
    messy.order.length === messy.list.length, messy.order.join(','));
  check('active 指向不存在的人时回落到默认好友', messy.active === DEFAULT_ID);
  check('order 决定列表顺序（第一个人是 order 的第一个）',
    orderedList({ list: [{ id: DEFAULT_ID, name: '雨' }, { id: 'x', name: 'X' }], order: ['x', DEFAULT_ID] })[0].id === 'x');
}

console.log('\n[3] 增删改 ...');
{
  let nav = normalizeNav(null);
  const r1 = addPersona(nav, { name: '林砚', emoji: '🖋️' });
  check('加了一个好友', r1.nav.list.length === 2 && !!r1.persona.id);
  check('新好友有自己的 id（不是 default）', r1.persona.id !== DEFAULT_ID);
  check('加完 order 也跟上了', r1.nav.order.includes(r1.persona.id));

  const r2 = addPersona(r1.nav, { id: 'fixed', name: 'A' });
  check('可以指定 id', r2.nav.list.some((p) => p.id === 'fixed'));
  const r3 = addPersona(r2.nav, { id: 'fixed', name: 'B' });
  check('同 id 不会加第二次（幂等）', r3.nav.list.filter((p) => p.id === 'fixed').length === 1);

  const r4 = removePersona(r3.nav, 'fixed');
  check('能删好友', !r4.nav.list.some((p) => p.id === 'fixed') && r4.removed);
  const r5 = removePersona(r4.nav, DEFAULT_ID);
  check('⭐ 默认好友删不掉（它的数据在老 key 里，删了列表就变成"看不见也删不掉"）',
    r5.removed === false && r5.nav.list.some((p) => p.id === DEFAULT_ID));

  const r6 = setActive(r3.nav, 'fixed');
  check('能切 active', r6.active === 'fixed');
  check('切到不存在的人会被忽略', setActive(r3.nav, 'nobody').active === r3.nav.active);

  const p1 = patchPersona(r3.nav, 'fixed', { name: '新名字', unread: 3 });
  check('能改名字和未读', p1.list.find((p) => p.id === 'fixed').name === '新名字'
    && p1.list.find((p) => p.id === 'fixed').unread === 3);
  check('未读不会是负数', patchPersona(r3.nav, 'fixed', { unread: -5 }).list.find((p) => p.id === 'fixed').unread === 0);

  check('makeId 不重复', makeId(['p1']) !== 'p1');

  // 摘要与未读。
  // ⚠️ 先把他切成 active —— 刚 addPersona 出来的好友还不是当前聊天对象，
  //    这时候收到消息本来就该算未读（这坑我自己踩了一次）。
  const cur = setActive(r3.nav, 'fixed');
  const n1 = noteActivity(cur, 'fixed', '你好呀', 1000);
  check('说话会更新列表摘要',
    n1.list.find((p) => p.id === 'fixed').lastText === '你好呀'
    && n1.list.find((p) => p.id === 'fixed').lastAt === 1000);
  const n2 = noteActivity(n1, 'fixed', '在吗', 2000, { markUnread: true });
  check('正在看这个人的时候不算未读', n2.list.find((p) => p.id === 'fixed').unread === 0);
  const other = setActive(n2, DEFAULT_ID);
  check('setActive 真的换人了', other.active === DEFAULT_ID);
  const n3 = noteActivity(other, 'fixed', '在吗', 2000, { markUnread: true });
  check('切走了才累加未读', n3.list.find((p) => p.id === 'fixed').unread === 1);
  check('看过之后未读清零', clearUnread(n3, 'fixed').list.find((p) => p.id === 'fixed').unread === 0);

  check('按最近说话排序', byRecency(n3)[0].id === 'fixed');
  check('没说过话的排在后面（按创建时间）',
    byRecency(normalizeNav(null))[0].id === DEFAULT_ID);
}

// ---------------------------------------------------------------- 4) 预设
console.log('\n[4] 预置人设 ...');
{
  check('预设够多（能挑出不一样的人）', PERSONA_PRESETS.length >= 8, `${PERSONA_PRESETS.length} 个`);
  check('id 不重复', new Set(PERSONA_PRESETS.map((p) => p.id)).size === PERSONA_PRESETS.length);
  const need = ['id', 'name', 'emoji', 'gender', 'age', 'job', 'relation', 'blurb', 'opening', 'place'];
  check('每个预设该有的字段都有',
    PERSONA_PRESETS.every((p) => need.every((k) => p[k] !== undefined && p[k] !== '')),
    PERSONA_PRESETS.filter((p) => need.some((k) => !p[k])).map((p) => p.id).join(',') || '都齐');

  // ⭐ 预设最容易做坏的：一堆"换了名字的同一个人"
  const traits = PERSONA_PRESETS.map((p) => (p.traits || []).join('+'));
  check('性格组合各不相同', new Set(traits).size === traits.length,
    `${new Set(traits).size} / ${traits.length} 种`);
  const jobs = PERSONA_PRESETS.map((p) => p.job);
  check('职业各不相同', new Set(jobs).size === jobs.length);
  check('开场白各不相同', new Set(PERSONA_PRESETS.map((p) => p.opening)).size === PERSONA_PRESETS.length);
  check('有男有女（不是清一色）',
    PERSONA_PRESETS.some((p) => p.gender === 'm') && PERSONA_PRESETS.some((p) => p.gender === 'f'));
  check('年龄跨度够大（19 到 45 之间）',
    Math.min(...PERSONA_PRESETS.map((p) => p.age)) <= 20
    && Math.max(...PERSONA_PRESETS.map((p) => p.age)) >= 40);
  check('找到 preset', findPreset('linyan')?.name === '林砚');
  check('找不到返回 null', findPreset('不存在') === null);
  const f = presetToForm(findPreset('linyan'));
  check('预设能转成人设页的表单值',
    f.herName === '林砚' && f.herGender === 'm' && f.herJob && f.sceneText && f.opening);
  check('性格最多带 4 个（人设页就只让选 4 个）', f.herTraits.length <= 4);
}

// ---------------------------------------------------------------- 5) 界面
console.log('\n[5] 底部导航 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 20 },
      'xiaoyu.config.v1': { personaDone: true },
    },
  });
  windows.push(app.dom.window);
  const $ = app.$;
  const tap = (sel) => $(sel).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  check('有三个主页', !!$('#screen-msgs') && !!$('#screen-friends') && !!$('#screen-me'));
  check('底部导航有三格', app.$$('.wx-tab').length === 3);
  check('分别是消息 / 好友 / 我',
    app.$$('.wx-tab').map((b) => b.dataset.tab).join(',') === 'msgs,friends,me');
  // ⭐ 这一轮改了：**每次进来都先停在消息列表**（用户要求"退出后台重新进入页面时，
  //    初始页面为消息页面，不要直接进入对话框"）。以前是"有聊天记录就进聊天页"。
  check('⭐ 有聊天记录也不再直接进聊天页（先看消息列表）', $('#screen-chat').hidden);
  check('⭐ 初始页面就是消息页', !$('#screen-msgs').hidden);
  check('消息列表里有默认好友', app.$$('#msgList .wx-item').length >= 1);
  check('底部导航可见（能切到好友/我）', !$('#tabbar').hidden);

  // 点进某个好友 → 才进聊天页
  tap('#msgList .wx-item');
  check('点消息列表里的人 → 进她的聊天页', !$('#screen-chat').hidden && $('#screen-msgs').hidden);

  tap('#btnBack');
  check('点返回 → 回消息列表', !$('#screen-msgs').hidden && $('#screen-chat').hidden);

  tap('.wx-tab[data-tab="friends"]');
  check('点「好友」→ 切到好友页', !$('#screen-friends').hidden && $('#screen-msgs').hidden);
  check('好友页第一行是「添加好友」', !!$('#friendList [data-add="new"]'));

  tap('.wx-tab[data-tab="me"]');
  check('点「我」→ 切到我', !$('#screen-me').hidden);
  check('「我」那张卡片显示我的名字', /他|我/.test($('#meCard').textContent), $('#meCard').textContent.slice(0, 24));
  check('「我」里有改资料入口', !!$('#meCard [data-me="edit"]'));
  check('「我」里有设置入口', !!$('#meCard [data-me="settings"]'));

  // 导航高亮
  check('当前那一格会高亮',
    app.$$('.wx-tab.on').length === 1 && app.$$('.wx-tab.on')[0].dataset.tab === 'me');
}

console.log('\n[6] 加好友（走预设）...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 20, facts: ['小雨记得的事'] },
      'xiaoyu.config.v1': { herName: '小雨', personaDone: true, herRelation: '恋人' },
    },
  });
  windows.push(app.dom.window);
  const $ = app.$;
  const tap = (sel) => $(sel).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  tap('#btnBack');
  tap('.wx-tab[data-tab="friends"]');
  tap('#btnAddFriend');
  check('加好友面板打开了', !$('#addFriendPanel').hidden && $('#addFriendPanel').classList.contains('show'));
  check('列出全部预设', app.$$('#addFriendList [data-preset]').length === PERSONA_PRESETS.length);
  check('有「从空白开始」', !!$('#btnAddBlank'));

  tap('#addFriendList [data-preset="linyan"]');
  check('选完预设 → 进人设页确认', $('#screen-persona').classList.contains('show'));
  check('人设页已经填好预设的名字', $('#perName').value === '林砚', $('#perName').value);
  check('职业也填好了', /后端/.test($('#perJob').value), $('#perJob').value);
  check('关系是预设的（同事）', $('#perRelation').value === '同事', $('#perRelation').value);
  check('新好友第一次进来不给返回键（要么设完要么开始）', $('#btnClosePersona').hidden === true);

  tap('#btnPersonaStart');

  const nav = JSON.parse(app.window.localStorage.getItem(PERSONAS_KEY));
  const newId = nav.list.find((p) => p.id !== DEFAULT_ID).id;
  check('索引里多了一个好友', nav.list.length === 2);
  check('默认好友还在（老数据没被顶掉）', nav.list.some((p) => p.id === DEFAULT_ID));
  check('新好友的配置存在自己的 key 里（不是覆盖老配置）',
    JSON.parse(app.window.localStorage.getItem(`xiaoyu.persona.${newId}.config.v1`)).herName === '林砚');
  check('⭐ 老配置还在原处（小雨的人设没被动）',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herName === '小雨');

  const chat = JSON.parse(app.window.localStorage.getItem(`xiaoyu.persona.${newId}.chat.v1`) || '[]');
  check('新好友用预设的开场白（不是通用问候）',
    chat.length >= 1 && chat[0].content.includes('忙完了'), (chat[0] || {}).content);
  check('⭐ 老聊天记录还在（小雨那 2 条没被清）',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length === 2);
  check('⭐ 老记忆还在', (JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1')).facts || [])
    .includes('小雨记得的事'));

  // 列表里能看到新人
  tap('#btnBack');
  check('新好友出现在消息页', app.$$('#msgList .wx-item').some((e) => e.dataset.open === newId));
  tap('.wx-tab[data-tab="friends"]');
  check('新好友出现在好友页', app.$$('#friendList .wx-item').some((e) => e.dataset.open === newId));
}

console.log('\n[7] 在好友之间切换：记忆互不干涉，时间共用 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.personas.v1': {
        version: 1,
        list: [
          { id: DEFAULT_ID, name: '小雨', emoji: '🌧️', createdAt: 1, lastAt: 5000, lastText: '小雨的话' },
          { id: 'other', name: '林砚', emoji: '🖋️', createdAt: 2, lastAt: 4000, lastText: '林砚的话' },
        ],
        order: [DEFAULT_ID, 'other'],
        active: DEFAULT_ID,
      },
      'xiaoyu.chat.v1': [msg('assistant', '小雨的开场白', 10)],
      'xiaoyu.profile.v1': { msgCount: 20, facts: ['小雨才知道的事'], affection: 70 },
      'xiaoyu.config.v1': { herName: '小雨', personaDone: true, herRelation: '恋人', clockOffset: 0 },
      'xiaoyu.persona.other.chat.v1': [msg('assistant', '林砚的开场白', 5)],
      'xiaoyu.persona.other.profile.v1': { msgCount: 3, facts: ['林砚才知道的事'], affection: 20 },
      'xiaoyu.persona.other.config.v1': { herName: '林砚', personaDone: true, herRelation: '同事' },
    },
  });
  windows.push(app.dom.window);
  const $ = app.$;
  const tap = (sel) => $(sel).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  // 先在"小雨"这边拨一下时间（这是全局的）
  tap('#btnPlus');
  app.$$('[data-clock]').find((b) => b.dataset.clock === '60')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  tap('#btnPlus');
  const offBefore = Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset);
  check('拨了 1 小时', offBefore === 3600000, String(offBefore));

  tap('#btnBack');
  tap('#msgList [data-open="other"]');

  check('切过去之后顶栏名字变了', $('#navName').textContent === '林砚', $('#navName').textContent);
  check('聊天区是这个好友的话',
    /林砚的开场白/.test($('#messages').textContent), $('#messages').textContent.slice(0, 30));
  check('⭐ 看不到另一个好友的聊天',
    !/小雨的开场白/.test($('#messages').textContent));

  tap('#btnPlus');
  check('⭐ 好感度是各人各的（她 70、他 20）',
    $('#affNum').textContent === '20', $('#affNum').textContent);
  check('关系也是各人各的', $('#affRelationName').textContent === '同事', $('#affRelationName').textContent);
  tap('#btnPlus');

  tap('#btnMore');
  tap('#actionSheet [data-act="settings"]');
  tap('#btnOpenMemory2');
  check('⭐ 记忆页只显示这个好友的记忆',
    /林砚才知道的事/.test($('#screen-memory').textContent)
    && !/小雨才知道的事/.test($('#screen-memory').textContent));
  $('#btnCloseMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  check('⭐ 内置时间是共用的（切人不会把时间拨回去）',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.persona.other.config.v1')).clockOffset || 0) === 0
    && Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset) === 3600000,
    '小雨那份还留着 1 小时');

  // 切回去，原来的东西还在
  tap('#btnBack');
  tap('#msgList [data-open="default"]');
  check('切回小雨：聊天记录还在', /小雨的开场白/.test($('#messages').textContent));
  tap('#btnPlus');
  check('切回小雨：好感度还是 70', $('#affNum').textContent === '70', $('#affNum').textContent);
  check('切回小雨：时间还是拨过的', /已经往前拨了/.test($('#clockNote').textContent));
}

console.log('\n[8] 我的资料是全局的（每个好友都看得到）...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.personas.v1': {
        version: 1,
        list: [{ id: DEFAULT_ID, name: '小雨', emoji: '🌧️', createdAt: 1 }],
        order: [DEFAULT_ID], active: DEFAULT_ID,
      },
      'xiaoyu.chat.v1': [msg('assistant', '在', 5)],
      'xiaoyu.config.v1': {
        herName: '小雨', personaDone: true,
        userName: '阿哲', myEmoji: '🐶', myAge: 27, myJob: '后端开发', myGender: 'm',
      },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  await app.send('你好');

  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('提示词里有我的名字', /阿哲/.test(sys));
  check('⭐ 聊天时她看得到我的职业（用户档案里那份）', /后端开发/.test(sys));
}

console.log('\n[9] 老数据自动迁移成"小雨"这个好友（这条最要紧，丢了就不可挽回）...');
{
  // 模拟老用户：只有那三个扁平 key，**没有任何 personas 索引**
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '我们认识三年了', 20), msg('assistant', '嗯 我记得', 19)],
      'xiaoyu.profile.v1': {
        msgCount: 500, facts: ['他养了只猫叫豆豆'], affection: 78, affectionBase: 60,
      },
      'xiaoyu.config.v1': { herName: '小雨', personaDone: true, herRelation: '恋人', herAge: 20 },
    },
  });
  windows.push(app.dom.window);
  const $ = app.$;

  const nav = JSON.parse(app.window.localStorage.getItem(PERSONAS_KEY) || 'null');
  check('⭐ 打开了应用就自动建好了好友索引', !!nav && Array.isArray(nav.list));
  check('索引里就一个人，id 是 default', nav.list.length === 1 && nav.list[0].id === DEFAULT_ID);
  check('他成了当前聊天对象', nav.active === DEFAULT_ID);

  $('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('⭐ 消息页里能看到"小雨"', app.$$('#msgList .wx-item').some(
    (e) => /小雨/.test(e.textContent)), app.$$('#msgList .wx-item').map((e) => e.textContent.trim()).join(' / '));

  app.$$('#msgList .wx-item')[0].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点进去能打开', !$('#screen-chat').hidden);
  check('⭐ 老聊天记录一条没丢', app.$$('#messages .wx-row').length === 2,
    String(app.$$('#messages .wx-row').length));
  check('⭐ 顶栏还是小雨', $('#navName').textContent === '小雨', $('#navName').textContent);

  $('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('⭐ 好感度还在（78）', $('#affNum').textContent === '78', $('#affNum').textContent);
  check('⭐ 关系还在（恋人）', $('#affRelationName').textContent === '恋人', $('#affRelationName').textContent);
  $('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  openFriendSettingsVia(app);
  $('#btnOpenMemory2').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('⭐ 记忆还在（豆豆）', /豆豆/.test($('#screen-memory').textContent));
  check('人设还在（年龄 20）',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herAge === 20);

  check('⭐ 老数据还是在原来那三个 key 里（没有搬家 = 不可能搬丢）',
    app.window.localStorage.getItem('xiaoyu.chat.v1').includes('三年')
    && app.window.localStorage.getItem('xiaoyu.profile.v1').includes('豆豆'));
  check('不会往新命名空间里乱写一份',
    !app.window.localStorage.getItem('xiaoyu.persona.default.chat.v1'));
}

// ---------------------------------------------------------------- 收尾
for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

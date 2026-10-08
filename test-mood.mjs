/**
 * 实时情绪 + 旁白输入框。
 *
 * 用户这一轮要的两条：
 *   1. 聊天框里加一个**小输入框**写旁白（环境 / 动作 / 内心），
 *      和发送消息**共用一个发送键**；可以只发动作、也可以只发消息
 *   2. 聊天框**顶部**（名字下面）加一条**实时情绪监控**：
 *      "生气 8%""开心 10% + 幸福 15%"，可以多个同时显示；
 *      AI 的表情 / 颜文字要跟情绪关联匹配
 *
 * 注意：不要在中途 window.close()（理由见 test-memory.mjs 顶部）
 */

import { bootApp, msg } from './boot.mjs';
import {
  MOODS, MOOD_KEYS, MAX_SHOWN, FLOOR, moodMeta, decayMood, blend, topMoods,
  parseMoodBlock, normalize, guessMood, moodBlock, moodText,
} from './src/mood.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const windows = [];
const mkApp = (seed = {}) => {
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 20 },
      'xiaoyu.config.v1': { personaDone: true, ...(seed.config || {}) },
      ...seed,
    },
    reply: seed.reply || '嗯',
    // 一串回复：用来测"第一次只发旁白 → 系统补一次请求"（见 [15]）
    replies: seed.replies || null,
  });
  windows.push(app.dom.window);
  return app;
};

// ---------------------------------------------------------------- 1) 情绪表
console.log('\n[1] 情绪表本身 ...');
{
  check('至少 6 种情绪（喜怒哀乐都要有）', MOODS.length >= 6, `${MOODS.length} 种`);
  check('key 不重复', new Set(MOOD_KEYS).size === MOOD_KEYS.length);
  check('每种都有中文名和 emoji',
    MOODS.every((x) => x.key && x.label && x.emoji && x.color));
  for (const want of ['开心', '生气', '难过']) {
    check(`包含「${want}」`, MOODS.some((x) => x.label === want));
  }
  check('moodMeta 能按 key 取', moodMeta('anger')?.label === '生气');
  check('取不到返回 null', moodMeta('不存在') === null);
  check('界面上一行最多显示几个是定死的', MAX_SHOWN >= 2 && MAX_SHOWN <= 4, String(MAX_SHOWN));
}

// ---------------------------------------------------------------- 2) 衰减 / 合并
console.log('\n[2] 情绪会随时间退，也会叠加 ...');
{
  // 半衰期 25 分钟：过 25 分钟应该剩一半
  const half = decayMood({ anger: 40 }, 25);
  check('25 分钟后剩一半左右', Math.abs(half.anger - 20) <= 1, String(half.anger));
  check('50 分钟后剩四分之一', Math.abs(decayMood({ anger: 40 }, 50).anger - 10) <= 1);
  check('时间没走就不衰减', decayMood({ anger: 40 }, 0).anger === 40);
  check('低于阈值的会被清掉（省得界面挂着 1%）',
    !('anger' in decayMood({ anger: 4 }, 200)), JSON.stringify(decayMood({ anger: 4 }, 200)));
  check('空值不炸', JSON.stringify(decayMood(null, 10)) === '{}' && JSON.stringify(decayMood({}, 10)) === '{}');
  check('不认识的情绪 key 会被忽略', !('rage' in decayMood({ rage: 90 }, 0)));

  // 叠加：不是覆盖
  const merged = blend({ joy: 20 }, { anger: 30 }, 0);
  check('⭐ 新情绪并进来，旧的没被冲掉（人也会又气又舍不得）',
    merged.anger === 30 && merged.joy === 20, JSON.stringify(merged));
  check('同一种取较大值', blend({ anger: 30 }, { anger: 10 }, 0).anger === 30);
  check('大的能盖过小的', blend({ anger: 10 }, { anger: 40 }, 0).anger === 40);
  check('合并前先按时间衰减',
    Math.abs(blend({ joy: 40 }, { anger: 10 }, 25).joy - 20) <= 1,
    JSON.stringify(blend({ joy: 40 }, { anger: 10 }, 25)));
  check('上限是夹紧的（模型偶尔标 100，太夸张）', blend({}, { anger: 100 }, 0).anger <= 95);
  check('0 和负数不记',
    !('anger' in blend({}, { anger: 0 }, 0)) && !('sad' in blend({}, { sad: -5 }, 0)));
}

console.log('\n[3] 按强度排序 / 取前几个 ...');
{
  const top = topMoods({ joy: 10, love: 15, anger: 8, sad: 2 });
  check('按百分比从高到低', top.map((x) => x.value).join(',') === '15,10,8', top.map((x) => x.value).join(','));
  check('带上了中文名和颜色', top[0].label === '心动' && !!top[0].color);
  check('最多只给 MAX_SHOWN 个', topMoods({ joy: 1, love: 2, anger: 3, sad: 4, shy: 5 }).length === MAX_SHOWN);
  check('没情绪就是空数组', topMoods(null).length === 0 && topMoods({}).length === 0);
  check('一行文字好读', moodText({ anger: 8, sad: 5 }) === '生气 8%　难过 5%', moodText({ anger: 8, sad: 5 }));
}

// ---------------------------------------------------------------- 4) 解析
console.log('\n[4] 从她的回复里解析情绪块 ...');
{
  const r = parseMoodBlock('在呀\n\n[[情绪]]{"anger":8,"sad":3}');
  check('摘掉了 [[情绪]] 标记', r.clean === '在呀', JSON.stringify(r.clean));
  check('解析出两种情绪', r.mood.anger === 8 && r.mood.sad === 3);
  check('⭐ 绝不能让 [[情绪]] 出现在气泡里', !r.clean.includes('情绪'));

  const bad = parseMoodBlock('好\n[[情绪]]{"anger":8');
  check('JSON 坏了也要把标记擦干净', bad.mood === null && !bad.clean.includes('情绪'),
    JSON.stringify(bad.clean));
  check('没有标记时原样返回', parseMoodBlock('普通一句').clean === '普通一句');
  check('不认识的 key 会被丢掉',
    JSON.stringify(parseMoodBlock('x\n[[情绪]]{"anger":8,"rage":90}').mood) === '{"anger":8}');
  check('全都是不认识的 key → 当没有', parseMoodBlock('x\n[[情绪]]{"rage":90}').mood === null);
  check('normalize 对 null 安全', normalize(null) === null);
}

console.log('\n[5] 模型不配合时的本地兜底 ...');
{
  check('骂人的话 → 生气', guessMood('你给我滚开')?.anger > 0);
  check('说想她 → 心动', guessMood('我好想你')?.love > 0);
  check('提别人 → 吃醋', guessMood('那个女生是谁')?.jealous > 0);
  check('哈哈 → 开心', guessMood('哈哈哈哈')?.joy > 0);
  check('⭐ 中性的话不猜（宁可不标也不要瞎标）',
    guessMood('今天天气不错') === null && guessMood('我在写代码') === null);
  check('空输入不炸', guessMood('') === null && guessMood(null) === null);
}

// ---------------------------------------------------------------- 6) 提示词
console.log('\n[6] 情绪进提示词（含"表情要跟情绪对上"）...');
{
  check('没情绪就不输出这一段（免得每轮演一遍"平静"）', moodBlock(null) === '' && moodBlock({}) === '');
  const b = moodBlock({ anger: 8, joy: 10 });
  check('写清了此刻的心情和百分比', /生气 8%/.test(b) && /开心 10%/.test(b));
  check('⭐ 明确和好感度切开（别把它说成"我对你的感觉"）',
    /别把它说成"我对你的感觉"/.test(b) && /那是好感度/.test(b));
  check('⭐ 要求表情和颜文字跟情绪匹配', /表情和颜文字必须跟情绪对上/.test(b));
  check('生气时不让她发可爱表情', /不要发表情和颜文字/.test(b));
  check('开心时给了具体的表情', /😄/.test(b));
  check('要求别报数字、别念百分比', /别报数字、别念百分比/.test(b));
  check('要求情绪会变、别卡在同一个上', /别一直卡在同一个情绪上/.test(b));
  check('心情不好时不许硬卖萌', /不要硬卖萌/.test(b));
}

// ---------------------------------------------------------------- 7) 界面：情绪条
console.log('\n[7] 聊天页顶部的实时情绪条 ...');
{
  const app = mkApp();
  const $ = app.$;
  check('聊天页有情绪条那一条', !!$('#moodStrip'));
  check('名字在情绪条**上面**（情绪条在顶栏下面）', (() => {
    const nav = $('#navName').closest('header');
    return nav && nav.nextElementSibling?.id === 'moodStrip';
  })());

  // 没情绪时整条收起来
  check('没有情绪时整条藏起来（不留空白）', $('#moodStrip').hidden === true);

  // 造一份有情绪的档案
  const { app: app2, $: $2 } = (() => {
    const a = mkApp({
      'xiaoyu.profile.v1': {
        msgCount: 20,
        mood: { joy: 10, love: 15 },
        moodAt: Date.now(),
      },
    });
    return { app: a, $: a.$ };
  })();
  check('有情绪时显示出来', $2('#moodStrip').hidden === false);
  check('⭐ 显示了两种情绪 + 百分比',
    /开心/.test($2('#moodStrip').textContent) && /10%/.test($2('#moodStrip').textContent)
    && /心动/.test($2('#moodStrip').textContent) && /15%/.test($2('#moodStrip').textContent),
    $2('#moodStrip').textContent.trim());
  check('按强度排（心动 15% 在开心 10% 前面）',
    $2('#moodStrip').textContent.indexOf('心动') < $2('#moodStrip').textContent.indexOf('开心'));
  check('每种情绪带一个自己的颜色条', app2.$$('#moodStrip .wx-mood-chip i').length >= 2);

  // 情绪会随时间退：把 moodAt 往前拨两小时
  const a3 = mkApp({
    'xiaoyu.profile.v1': { msgCount: 20, mood: { anger: 90 }, moodAt: Date.now() - 3 * 3600e3 },
  });
  check('⭐ 过了几小时，情绪已经退掉了（不会再显示 90%）',
    a3.$('#moodStrip').innerHTML === '' || !/90%/.test(a3.$('#moodStrip').textContent),
    a3.$('#moodStrip').textContent.trim() || '(空了)');
}

// ---------------------------------------------------------------- 8) 界面：旁白框
console.log('\n[8] 旁白输入框 ...');
{
  const app = mkApp();
  const $ = app.$;
  const nar = $('#narrInput');
  check('聊天框里有旁白输入框', !!nar);
  check('占位提示说了它是干嘛的', /旁白/.test(nar.placeholder) && /环境/.test(nar.placeholder));
  check('旁白框和消息框是两个独立输入', nar !== $('#input'));
  check('旁白框不挡页面（在输入栏里，不是浮层）',
    !!nar.closest('.wx-toolbar') && $('#screen-chat').contains(nar));

  // 只填旁白 → 发送键出现，并且标成"发旁白"
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  };
  type(nar, '她推门进来，手里拎着两杯奶茶');
  check('⭐ 只填旁白时发送键也要出现（共用同一个键）', $('#btnSend').hidden === false);
  check('发送键会标明"这是发旁白"', /旁白/.test($('#btnSend').textContent), $('#btnSend').textContent);

  type(nar, '');
  check('清空后发送键又收起来', $('#btnSend').hidden === true);

  type($('#input'), '你好');
  check('填消息时发送键也出现', $('#btnSend').hidden === false);
  check('这时发送键写的是"发送"', $('#btnSend').textContent === '发送', $('#btnSend').textContent);
  type($('#input'), '');
}

console.log('\n[9] 旁白真的能发出去，而且和消息分开 ...');
{
  const app = mkApp();
  const $ = app.$;
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  };

  // ① 只发旁白
  type($('#narrInput'), '窗外开始下雨了');
  $('#btnSend').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await app.sleep(80);

  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const last = saved[saved.length - 1];
  check('⭐ 旁白存成了单独一条（带 narr 标记）', last.narr === true, JSON.stringify(last).slice(0, 60));
  check('旁白内容对', last.content === '窗外开始下雨了');
  check('旁白框发完就清空', $('#narrInput').value === '');
  check('⭐ 界面上旁白是一种单独的气泡（有 narr 类）',
    !!$('#messages .wx-bubble.narr'), $('#messages').innerHTML.slice(-120));
  // 用户明确要求：**她的旁白在左、我的在右**（不带 AI 括号）
  check('⭐ 我的旁白靠右（.narr.out）', !!$('#messages .wx-row.narr.out'));
  check('旁白是"我写的"那一侧，不是她说的',
    $('#messages .wx-row.narr.out .wx-bubble.narr')?.textContent === '窗外开始下雨了',
    $('#messages .wx-row.narr')?.textContent);

  // ② 进模型的上下文时要包起来
  const req = app.lastRequest();
  const ctx = req.messages.filter((m) => m.role === 'user');
  check('⭐ 旁白进上下文时套上了（　），模型能分清这不是台词',
    ctx.some((m) => m.content === '（窗外开始下雨了）'), ctx.map((m) => m.content).join(' | '));

  // ③ 只发消息（旁白留空）
  // 用手动点击（和上面"只发旁白"完全对称），但**先等上一轮她说完**再点 ——
  // 她还在打字时 state.generating 是 true，这时点发送会被直接吞掉。
  type($('#narrInput'), '');
  for (let i = 0; i < 100 && ($('#input').disabled || $('#btnSend').hidden); i++) await app.sleep(50);
  type($('#input'), '今天好累');
  check('旁白清空后发送键写回"发送"', $('#btnSend').textContent === '发送', $('#btnSend').textContent);
  check('发送键露出来了', $('#btnSend').hidden === false);
  $('#btnSend').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await app.sleep(120);
  const saved2 = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const mine = saved2.filter((m) => m.role === 'user' && !m.narr);
  check('⭐ 只填消息时发的是消息（旁白空着不算）', mine.at(-1)?.content === '今天好累',
    `${mine.at(-1)?.content} ｜ 全部：${saved2.map((m) => (m.narr ? `旁白:${m.content}` : m.content)).join(' / ')}`);
  check('旁白那条还在（没被顶掉）', saved2.some((m) => m.narr), String(saved2.length));

  // ④ **两个都填 → 一起发**（用户要求："我还需要有旁白和对话一起发送"）
  for (let i = 0; i < 100 && ($('#input').disabled || $('#btnSend').hidden); i++) await app.sleep(50);
  const before4 = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  type($('#narrInput'), '她把奶茶推到你面前');
  type($('#input'), '这杯给你');
  $('#btnSend').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await app.sleep(150);

  const saved4 = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const added = saved4.slice(before4);
  check('⭐ 两个框都填 → 一次发出两条（先旁白后消息）', added.length >= 2,
    added.map((m) => (m.narr ? `旁白:${m.content}` : m.content)).join(' / '));
  check('第一条是旁白', added[0]?.narr === true && added[0].content === '她把奶茶推到你面前',
    JSON.stringify(added[0] || {}).slice(0, 60));
  check('第二条是消息', added[1]?.narr !== true && added[1].content === '这杯给你',
    JSON.stringify(added[1] || {}).slice(0, 60));
  check('两个输入框都清空了', $('#narrInput').value === '' && $('#input').value === '');
  check('⭐ 进上下文时旁白在前、台词在后（读起来是"（动作）台词"）', (() => {
    const ctx = app.lastRequest().messages.filter((m) => m.role === 'user');
    const i = ctx.findIndex((m) => m.content === '（她把奶茶推到你面前）');
    return i >= 0 && ctx[i + 1]?.content === '这杯给你';
  })());
}

// ---------------------------------------------------------------- 10) 情绪联动
console.log('\n[10] 她回复带情绪块时会更新情绪条 ...');
{
  const app = mkApp({ reply: '哼\n\n[[情绪]]{"anger":40,"sad":10}' });
  const $ = app.$;
  await app.send('你今天怎么不理我');

  const prof = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('⭐ 情绪被记进了档案', prof.mood && prof.mood.anger >= 35, JSON.stringify(prof.mood));
  check('同时记了两种（可以多个同时显示）', prof.mood.sad >= 8, JSON.stringify(prof.mood));
  check('记了时间戳（衰减要用）', typeof prof.moodAt === 'number');
  check('⭐ [[情绪]] 没有漏进聊天气泡',
    !/\[\[情绪\]\]/.test($('#messages').textContent), $('#messages').textContent.slice(-60));
  check('情绪条显示出来了', $('#moodStrip').hidden === false);
  check('显示的是生气', /生气/.test($('#moodStrip').textContent), $('#moodStrip').textContent.trim());

  // 情绪要进提示词（她下一轮知道自己什么心情）
  // ⚠️ 这一轮的请求是在**她说出情绪之前**发出去的，所以里面没有这一段 ——
  //    得再发一轮才看得到（情绪是她回复时带回来的，下一轮才起作用）。
  await app.send('那你现在心情怎么样');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('⭐ 情绪进了下一轮的提示词（她知道自己什么心情）',
    /【你此刻的心情】/.test(sys), (sys.match(/【你此刻的心情】.{0,40}/) || [''])[0]);
  check('提示词里也有"表情要跟情绪对上"', /表情和颜文字必须跟情绪对上/.test(sys));
}

console.log('\n[11] 情绪不跟人走：每个好友各是各的 ...');
{
  const app = mkApp({
    'xiaoyu.personas.v1': {
      version: 1,
      list: [
        { id: 'default', name: '小雨', createdAt: 1 },
        { id: 'other', name: '林砚', createdAt: 2 },
      ],
      order: ['default', 'other'],
      active: 'default',
    },
    'xiaoyu.profile.v1': { msgCount: 20, mood: { joy: 60 }, moodAt: Date.now() },
    'xiaoyu.persona.other.profile.v1': { msgCount: 3, mood: { anger: 50 }, moodAt: Date.now() },
    'xiaoyu.persona.other.config.v1': { herName: '林砚', personaDone: true },
  });
  const $ = app.$;
  check('小雨的情绪是开心', /开心/.test($('#moodStrip').textContent), $('#moodStrip').textContent.trim());
  $('#btnBack').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$$('#msgList .wx-item').find((e) => e.dataset.open === 'other')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('⭐ 切到另一个好友，情绪条换成他自己的（生气）',
    /生气/.test($('#moodStrip').textContent) && !/开心/.test($('#moodStrip').textContent),
    $('#moodStrip').textContent.trim());
}

// ---------------------------------------------------------------- 12) 表情面板
console.log('\n[12] 表情面板跟着情绪排 ...');
{
  const app = mkApp({
    'xiaoyu.profile.v1': { msgCount: 20, mood: { anger: 60 }, moodAt: Date.now() },
  });
  const $ = app.$;
  $('#btnEmoji').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const btns = app.$$('#emojiGrid button').map((b) => b.textContent);
  check('面板打开了', btns.length > 10, `${btns.length} 个表情`);
  check('⭐ 生气的表情排到了最前面', ['😤', '💢', '🙄', '😒'].includes(btns[0]), btns.slice(0, 4).join(' '));
  check('别的表情还在（只是排后面）', btns.includes('😊') || btns.includes('😂'));
  check('没有重复', new Set(btns).size === btns.length);
}

// ---------------------------------------------------------------- 13) 她的旁白
console.log('\n[13] 她写的（）旁白 → 单独一个框，画在她那一侧 ...');
{
  const app = mkApp({ reply: '（夹了口菜）好吃吗？\n你也尝尝' });
  const $ = app.$;
  const before = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  await app.send('这道菜怎么样');

  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const hers = saved.slice(before).filter((m) => m.role === 'assistant');

  check('⭐ 她的旁白单独存成了一条（assistant + narr）',
    hers[0]?.narr === true, JSON.stringify(hers.map((m) => (m.narr ? `旁白:${m.content}` : m.content))));
  check('旁白里是括号里那句话，不带括号', hers[0]?.content === '夹了口菜', hers[0]?.content);
  check('⭐ 她的台词里不再混着括号',
    hers.filter((m) => !m.narr).every((m) => !/[（(]/.test(m.content)),
    hers.filter((m) => !m.narr).map((m) => m.content).join(' / '));
  check('旁白不占连发条数（三个框：旁白 + 两句台词）', hers.length === 3, String(hers.length));

  check('⭐ 界面上她的旁白在左边（.wx-row.narr.in）', !!$('#messages .wx-row.narr.in'));
  check('旁白框里就是那句话（灰色虚线小框，没头像）', (() => {
    const box = $('#messages .wx-row.narr.in');
    return box.querySelector('.wx-bubble.narr')?.textContent === '夹了口菜'
      && !box.querySelector('.wx-avatar');
  })(), $('#messages .wx-row.narr.in')?.textContent);
  check('她说的话仍然是左边那个普通气泡',
    app.$$('#messages .wx-row.in:not(.narr) .wx-bubble').at(-1)?.textContent === '你也尝尝',
    app.$$('#messages .wx-row.in:not(.narr) .wx-bubble').map((b) => b.textContent).join(' / '));

  // 再发一轮：她的旁白回到上下文里时要包上（　），她才知道那是舞台说明
  await app.send('那你多吃点');
  const ctx = app.lastRequest().messages.filter((m) => m.role === 'assistant');
  check('⭐ 她的旁白进上下文时也套上了（　）', ctx.some((m) => m.content === '（夹了口菜）'),
    ctx.map((m) => m.content).join(' | '));

  // 她刚写过的旁白要被列回提示词里（"更灵动、别复读同一个动作"靠这个）
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('⭐ 提示词里列出了她最近写过的旁白',
    /【你最近写过的旁白】/.test(sys) && /- （夹了口菜）/.test(sys)
    && /别原样再来一遍/.test(sys),
    (sys.match(/【你最近写过的旁白】[\s\S]{0,60}/) || [''])[0].replace(/\n/g, ' / '));
  check('同一句旁白重复出现也只列一条（去重）',
    (sys.match(/- （夹了口菜）/g) || []).length === 1);
  check('并且要求换个动作或角度', /换个\*\*动作或角度\*\*/.test(sys));
}

console.log('\n[14] 她只发一个动作、一个字都不说 —— 渲染层兜得住，但提示词禁止这么干 ...');
{
  // ⚠️ 这一节测的是**渲染层**：模型万一真的只回了"（举起手里的奶茶）"，
  //    界面也得把它画成一个正常的左侧旁白框，不能崩、不能多出空气泡。
  //    —— 但"只发旁白"本身是**用户明确不喜欢的行为**（"不要总是只说旁白，
  //    然后没有对话，需要我再说一句才能有下文"），所以提示词那边是禁止的。
  const app = mkApp({ reply: '（举起手里的奶茶）' });
  const $ = app.$;
  const before = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  await app.send('在干嘛');

  const hers = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
    .slice(before).filter((m) => m.role === 'assistant');
  check('存下来只有一条，而且标着 narr', hers.length === 1 && hers[0].narr === true,
    JSON.stringify(hers));
  check('界面上就是左边一个旁白框', (() => {
    const box = $('#messages .wx-row.narr.in');
    return box?.querySelector('.wx-bubble.narr')?.textContent === '举起手里的奶茶';
  })(), $('#messages').textContent.slice(-40));
  check('没有凭空多出一个空气泡',
    app.$$('#messages .wx-row').length === 3 + 1, String(app.$$('#messages .wx-row').length));

  // 提示词那边：明确禁止"只发旁白"，而且要求最后一条是话
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('⭐ 提示词禁止"旁白是这一轮唯一的内容"',
    /旁白不能是这一轮唯一的内容/.test(sys) && /那不叫聊天/.test(sys));
  check('⭐ 要求一轮里最后一条必须是话（不能拿旁白收尾）',
    /最后一条必须是话/.test(sys) && /不能拿旁白收尾/.test(sys));
  check('⭐ 要求留得下话头（别说完就停住让他再问一句）',
    /留得下话头/.test(sys) && /聊天就断了/.test(sys));
  check('旧的"也可以只发一个旁白、一个字都不说"已经删掉',
    !/一个字都不说/.test(sys));
}

// ---------------------------------------------------------------- 15) 兜底：只发旁白
console.log('\n[15] 她只发了一个动作就没了 → 自动把欠的那句话要回来 ...');
{
  // 用户实测：他问"几点了"，她回"（抬头看墙上的钟）"就没了，他还得再问一遍。
  // 提示词那边加了【他在等你的回答】，但"这一轮白聊了"不能只靠提示词兜 ——
  // 这里测的是代码里的那一层：整轮只有旁白时，自动再要一次"只要台词"。
  const app = mkApp({ replies: ['（抬头看墙上的钟）', '快九点半了，你怎么还不睡'] });
  const $ = app.$;
  const before = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  await app.send('几点了');

  const hers = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
    .slice(before).filter((m) => m.role === 'assistant');

  check('⭐ 补了一次请求（她说的话被要回来了）', app.requests.length === 2,
    String(app.requests.length));
  check('⭐ 界面上先旁白、后台词（动作 + 回答）',
    hers.length === 2 && hers[0].narr === true && hers[1].content === '快九点半了，你怎么还不睡',
    JSON.stringify(hers));
  check('补回来的那句不带 narr 标记（是台词）', hers[1]?.narr !== true);
  check('补的话没有重复那个动作', !/[（(]/.test(hers[1]?.content || ''), hers[1]?.content);
  check('⭐ 他不用再问第二遍（"几点了"只出现一次）', (() => {
    const all = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
    return all.filter((m) => m.content === '几点了').length === 1;
  })(), JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
    .map((m) => (m.narr ? `旁白:${m.content}` : m.content)).join(' / '));
  check('她的话紧跟在后面（旁白 + 回答，中间没有他插话）', (() => {
    const all = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
    return all.at(-1).content === '快九点半了，你怎么还不睡' && all.at(-2).narr === true;
  })());

  const ask = JSON.stringify(app.lastRequest().messages);
  check('⭐ 补的请求里带着"你只发了动作，他还在等"这句纠正',
    /只发了一个动作/.test(ask) && /在等你的回答/.test(ask));
  check('补的请求把它刚才那个动作也带上了（上下文接得上）',
    /抬头看墙上的钟/.test(ask));
  check('补的请求压得很短（maxTokens 140，不浪费）',
    app.lastRequest().max_tokens === 140, String(app.lastRequest().max_tokens));
}

console.log('\n[16] 兜底的兜底：补回来还是旁白就不再纠缠 ...');
{
  // 一轮最多补一次 —— 不能因为模型不配合就无限重试
  const app = mkApp({ replies: ['（又看了一眼钟）', '（把手举到一半又放下）'] });
  const before = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  await app.send('几点了');

  const hers = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
    .slice(before).filter((m) => m.role === 'assistant');
  check('⭐ 只补一次，不循环', app.requests.length === 2, String(app.requests.length));
  check('补回来的还是旁白就认了（没有硬塞一句假回答）',
    hers.length === 1 && hers[0].narr === true, JSON.stringify(hers));
  check('界面没崩、旁白正常显示',
    app.$('#messages .wx-row.narr.in .wx-bubble.narr')?.textContent === '又看了一眼钟');
}

console.log('\n[17] 正常回复不会多花一次请求 ...');
{
  // ⚠️ 回复里要**带上思考块**：她没写内心的话，代码会补一次"只要内心"的请求
  //    （见 app.js 的 askForThought）—— 那是刻意的兜底，所以这里用"完整"的回复
  //    来验证"该发一次就只发一次"。
  const app = mkApp({ replies: ['[[思考]]他今天听着挺累的\n\n好呀', '（这条不该被用到）'] });
  await app.send('今天好累');
  check('⭐ 她正常回话时只有一次请求（兜底不额外收费）', app.requests.length === 1,
    String(app.requests.length));
  check('回的就是那句正常的话',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).at(-1).content === '好呀');
}

// ---------------------------------------------------------------- 收尾
for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

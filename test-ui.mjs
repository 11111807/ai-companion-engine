/**
 * 界面这一轮的六条需求（用户原话在每节注释里）。
 *
 * 为什么单独一个文件：这里几乎全是"点一下、看界面变成什么样"的流程
 * （弹窗要连点两轮、删好友之后要看到空状态、折叠块要能展开……），
 * test-app.mjs 是自建 DOM 的单实例，塞不下这些多实例场景；
 * 用 boot.mjs 的话每个用例一个干净的 app，反而好写也好读。
 *
 * 注意：不要在中途 window.close()（理由见 test-memory.mjs 顶部）
 */

import { bootApp, msg } from './boot.mjs';

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
      'xiaoyu.chat.v1': seed.chat || [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 20, ...(seed.profile || {}) },
      'xiaoyu.config.v1': { personaDone: true, ...(seed.config || {}) },
      ...seed,
    },
    reply: seed.reply || '嗯',
    replies: seed.replies || null,
  });
  windows.push(app.dom.window);
  return app;
};

const tap = (app, sel) => app.$(sel).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
const type = (app, sel, v) => {
  const el = app.$(sel);
  el.value = v;
  el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
};

// ---------------------------------------------------------------- 1) 启动页
console.log('\n[1] 退出后台再进来：先停在消息列表（不直接进对话框）...');
{
  const app = mkApp();
  const $ = app.$;
  check('⭐ 初始页面是消息页', !$('#screen-msgs').hidden);
  check('⭐ 没有直接进聊天页', $('#screen-chat').hidden);
  check('底部导航可见', !$('#tabbar').hidden);
  check('消息列表里能看到她', app.$$('#msgList .wx-item').length >= 1);

  tap(app, '#msgList .wx-item');
  check('点进去才进聊天页', !$('#screen-chat').hidden && $('#screen-msgs').hidden);
  check('聊天页里导航栏藏起来（微信那样）', $('#tabbar').hidden);

  // 模拟"退到后台再回来"：重新加载一次
  const app2 = mkApp();
  check('⭐ 再打开一次还是消息页', !app2.$('#screen-msgs').hidden && app2.$('#screen-chat').hidden);
}

// ---------------------------------------------------------------- 2) 返回按钮
console.log('\n[2] 每个界面都要有返回按钮（用户："头像上传界面没有返回按钮"）...');
{
  const app = mkApp();
  const $ = app.$;

  // 所有 overlay 页都得有一个能点的返回/关闭键
  const overlays = ['#screen-me-edit', '#addFriendPanel', '#screen-memory',
    '#screen-persona', '#screen-settings', '#screen-friend', '#avatarPanel'];
  for (const sel of overlays) {
    const el = $(sel);
    check(`${sel} 存在`, !!el);
    const back = el?.querySelector('.wx-back');
    check(`${sel} 里有关闭/返回键`, !!back, back?.id || '（没有）');
  }

  // 头像面板：走一遍真实入口（我 → 我的资料 → 换头像），再点返回
  tap(app, '.wx-tab[data-tab="me"]');
  tap(app, '#meCard [data-me="edit"]');
  check('我的资料页打开了', $('#screen-me-edit').classList.contains('show'));
  tap(app, '#btnPickMeAvatar');
  check('头像面板打开了', $('#avatarPanel').hidden === false);
  check('⭐ 头像面板有返回键', !!$('#btnCloseAvatar'));
  tap(app, '#btnCloseAvatar');
  check('⭐ 点返回能关掉头像面板', $('#avatarPanel').hidden === true);

  // 其它几个键也点一遍，确认不是摆设
  tap(app, '#btnCloseMe');
  check('「我的资料」的返回键能关掉', !$('#screen-me-edit').classList.contains('show'));
}

// ---------------------------------------------------------------- 3) 性格那句
console.log('\n[3] 人设页：补的那句要说清是"她/他"的性格 ...');
{
  const app = mkApp({ config: { personaDone: false } });
  const $ = app.$;
  const label = () => $('#perTraitNoteLabel').textContent;
  check('⭐ 默认写的是"她的性格"', /她的性格/.test(label()), label());
  tap(app, '#segGender button[data-v="m"]');
  check('⭐ 切成男之后写"他的性格"', /他的性格/.test(label()), label());
  tap(app, '#segGender button[data-v="f"]');
  check('切回女又变回来', /她的性格/.test(label()), label());
}

// ---------------------------------------------------------------- 4) 内心想法
console.log('\n[4] 她的"内心想法"：折叠气泡 + 全局开关 ...');
{
  const app = mkApp({
    replies: ['[[思考]]他怎么突然问这个…是不是今天出事了\n\n（把手机翻过来扣在桌上）\n\n没事呀，你说'],
  });
  const $ = app.$;
  tap(app, '#msgList .wx-item');
  await app.send('今天有点事想跟你说');

  check('⭐ 摘出来的标记没漏进气泡', !/\[\[思考\]\]/.test($('#messages').textContent),
    $('#messages').textContent.slice(-40));
  check('⭐ 界面上多了一个折叠块', !!$('#messages .wx-think'));
  check('默认是收起的（不抢台词的视觉重心）', !$('#messages .wx-think').classList.contains('open'));
  check('块里就是那句心里话',
    /他怎么突然问这个/.test($('#messages .wx-think-body')?.textContent || ''),
    $('#messages .wx-think-body')?.textContent);
  check('收起时看不见内容（CSS 上是 display:none）',
    app.window.getComputedStyle($('.wx-think-body')).display === 'none');
  // 用户要的"思考 1s/2s"——显示真实耗时（含读消息的停顿 + 生成）
  check('⭐ 标题里带真实耗时（"思考 1.2 秒"这个样子）',
    /^💭 思考 \d+\.\d 秒$/.test($('#messages .wx-think-head').textContent.trim()),
    $('#messages .wx-think-head').textContent.trim());
  check('耗时也存进了消息里（重画之后还在）',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
      .find((m) => m.think)?.thinkMs) > 0);
  // 设置页里的诊断：让"模型没写"和"功能坏了"分得清
  tap(app, '.wx-tab[data-tab="me"]');
  tap(app, '#meCard [data-me="settings"]');
  check('⭐ 设置页显示"最近一轮她写没写思考"',
    /她写了 ✓/.test($('#thinkStatus').textContent), $('#thinkStatus').textContent);
  tap(app, '#btnCloseSettings');
  tap(app, '.wx-tab[data-tab="msgs"]');
  tap(app, '#msgList .wx-item');
  // 用户要的顺序：思考 → 旁白 → 台词（心里怎么想 → 手上怎么做 → 嘴上怎么说）
  check('⭐ 顺序是 思考 → 旁白 → 台词', (() => {
    const nodes = [...$('#messages').children];
    const isRow = (n) => /wx-row/.test(n.className);
    const iThink = nodes.findIndex((n) => n.classList.contains('wx-think'));
    // 从思考块往后找（前面还有历史消息，不能从 0 开始数）
    const iNarr = nodes.findIndex((n, i) => i > iThink && isRow(n) && n.classList.contains('narr'));
    const iTalk = nodes.findIndex((n, i) => i > iNarr && isRow(n)
      && !n.classList.contains('narr') && n.classList.contains('in'));
    return iThink >= 0 && iNarr > iThink && iTalk > iNarr;
  })(), [...$('#messages').children].map((n) => n.className).join(' | '));
  check('旁白那条还是旁白（没被思考块吃掉）',
    /把手机翻过来扣在桌上/.test($('#messages .wx-row.narr')?.textContent || ''));

  tap(app, '.wx-think-head');
  check('⭐ 点一下展开', $('#messages .wx-think').classList.contains('open'));
  check('展开后看得见', app.window.getComputedStyle($('.wx-think-body')).display !== 'none');
  tap(app, '.wx-think-head');
  check('再点一下收起', !$('#messages .wx-think').classList.contains('open'));

  // 全局设置里的开关
  tap(app, '#screen-persona .wx-back');   // 关掉人设页（没打开也不碍事）
  tap(app, '.wx-tab[data-tab="me"]');
  tap(app, '#meCard [data-me="settings"]');
  check('全局设置页打开了', $('#screen-settings').classList.contains('show'));
  check('⭐ 设置里有"显示她的内心想法"这一组', !!$('#segShowThink'));
  check('默认选中"显示"',
    $('#segShowThink button[data-v="1"]').classList.contains('on'));

  tap(app, '#segShowThink button[data-v="0"]');
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('⭐ 关掉之后配置里是 false', cfg.showThink === false, String(cfg.showThink));
  check('⭐ 已经画出来的那块也消失了', !$('#messages .wx-think'));

  // 关掉时提示词里连要求都不加（省 token）
  tap(app, '#btnCloseSettings');
  tap(app, '.wx-tab[data-tab="msgs"]');
  tap(app, '#msgList .wx-item');
  await app.send('那我们聊点别的');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('⭐ 关掉后提示词里不再要求她写内心话', !/\[\[思考\]\]/.test(sys));
  check('但情绪块的要求还在（那是另一件事，不该跟着一起关）',
    /\[\[情绪\]\]/.test(sys) && /【每一轮都要写：你的情绪】/.test(sys));
}

// ---------------------------------------------------------------- 5) 停顿
console.log('\n[5] 难的问题要多想一下（但不能久等）...');
{
  const app = mkApp({ replies: ['嗯'] });
  const $ = app.$;
  tap(app, '#msgList .wx-item');

  type(app, '#input', '你觉得我该不该辞掉现在这份工作，去另一个城市重新开始');
  tap(app, '#btnSend');
  await app.sleep(60);
  check('⭐ 先出现"对方正在输入…"（她在读、在想）',
    /正在输入/.test($('#navSub').textContent || ''), $('#navSub').textContent);
  for (let i = 0; i < 200 && $('#input').disabled; i++) await app.sleep(30);
  check('想完之后照常回话',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).at(-1).role === 'assistant');
}

// ---------------------------------------------------------------- 6) 终局弹窗
console.log('\n[6] 旁白里写"一起老去/都死了" → 先问要不要忘记一切 ...');
{
  const app = mkApp({ replies: ['嗯'] });
  const $ = app.$;
  tap(app, '#msgList .wx-item');

  const sendNarr = async () => {
    // ⚠️ 上一轮她的回复还在"打字"（state.generating 是 true），这时点发送会被直接吞掉
    for (let i = 0; i < 300 && $('#input').disabled; i++) await app.sleep(30);
    type(app, '#narrInput', '很多年后，我们一起老去，最后都离开了这个世界');
    tap(app, '#btnSend');
    await app.sleep(60);
  };

  // —— 第一轮：选"否"
  await sendNarr();
  check('⭐ 弹窗出现了', $('#confirmMask').hidden === false);
  check('问的是"是否忘记你们的一切"', /是否忘记你们的一切/.test($('#confirmTitle').textContent),
    $('#confirmTitle').textContent);
  check('两个按钮是"是"和"否"',
    $('#confirmYes').textContent === '是' && $('#confirmNo').textContent === '否',
    `${$('#confirmYes').textContent} / ${$('#confirmNo').textContent}`);
  // 配色：是=灰、否=绿（危险的那个不能像推荐选项）
  const cs = (el) => app.window.getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
  const yes = cs($('#confirmYes'));
  const no = cs($('#confirmNo'));
  check('⭐ "是"是灰色（三个通道差不多、且不是纯白）',
    Math.abs(yes[0] - yes[1]) < 12 && Math.abs(yes[1] - yes[2]) < 12 && yes[0] < 250,
    `rgb(${yes.join(',')})`);
  check('⭐ "否"是绿色（绿通道明显最高）',
    no[1] > no[0] + 40 && no[1] > no[2] + 40, `rgb(${no.join(',')})`);

  tap(app, '#confirmNo');
  await app.sleep(80);
  check('选"否"→ 弹窗关掉', $('#confirmMask').hidden === true);
  const afterNo = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  check('⭐ 他写的那条旁白照常发出去', afterNo.some((m) => /一起老去/.test(m.content)));
  check('⭐ 并且补了一句"你们都睡着了，做了一个好梦"',
    afterNo.some((m) => /你们都睡着了，做了一个好梦/.test(m.content)),
    afterNo.slice(-2).map((m) => m.content).join(' | '));
  check('补的那句是旁白（不是台词）', afterNo.at(-1).narr === true);
  check('好友还在（没删）',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.personas.v1')).list.length === 1);

  // —— 第二轮：选"是"，再选"我还没想好"
  await sendNarr();
  tap(app, '#confirmYes');
  await app.sleep(60);
  check('⭐ 第一轮选"是"→ 再确认一次',
    /再确认一次/.test($('#confirmTitle').textContent), $('#confirmTitle').textContent);
  check('第二轮的按钮是"是"/"我还没想好"',
    $('#confirmYes').textContent === '是' && $('#confirmNo').textContent === '我还没想好',
    `${$('#confirmYes').textContent} / ${$('#confirmNo').textContent}`);
  tap(app, '#confirmNo');
  await app.sleep(80);
  check('⭐ 选"我还没想好"→ 不删档',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.personas.v1')).list.length === 1);
  check('同样补了那句做梦的旁白',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
      .some((m) => /你们都睡着了/.test(m.content)));

  // —— 第三轮：两遍都选"是" → 删档 = 删好友
  await sendNarr();
  tap(app, '#confirmYes');
  await app.sleep(60);
  check('第二遍确认出现了', /再确认一次/.test($('#confirmTitle').textContent));
  tap(app, '#confirmYes');
  await app.sleep(120);

  const nav = JSON.parse(app.window.localStorage.getItem('xiaoyu.personas.v1'));
  check('⭐ 好友被删掉了（不是只清空记录）', nav.list.length === 0, JSON.stringify(nav.list));
  check('⭐ 她的聊天存档也真删了（不是留着）',
    app.window.localStorage.getItem('xiaoyu.chat.v1') === null);
  check('⭐ 回到消息页', !$('#screen-msgs').hidden && $('#screen-chat').hidden);
  check('⭐ 消息页写着"请添加一个好友"', /请添加一个好友/.test($('#msgList').textContent),
    $('#msgList').textContent.trim().slice(0, 30));
  check('消息页给了添加入口', !!$('#msgList [data-add="new"]'));
  tap(app, '.wx-tab[data-tab="friends"]');
  check('⭐ 好友页也写着"请添加一个好友"', /请添加一个好友/.test($('#friendList').textContent),
    $('#friendList').textContent.trim().slice(0, 30));

  // 一个好友都没有时不能再往聊天页里钻
  tap(app, '.wx-tab[data-tab="msgs"]');
  check('没有好友时也稳（没崩、还在消息页）',
    !$('#screen-msgs').hidden && app.errors.length === 0, app.errors.slice(0, 1).join(''));
}

console.log('\n[7] 删掉一个还有别的 → 切到别人，不停在空页面 ...');
{
  const app = mkApp({
    'xiaoyu.personas.v1': {
      version: 1,
      list: [{ id: 'default', name: '小雨', createdAt: 1 }, { id: 'other', name: '林砚', createdAt: 2 }],
      order: ['default', 'other'],
      active: 'default',
    },
    'xiaoyu.persona.other.config.v1': { herName: '林砚', personaDone: true },
    'xiaoyu.persona.other.chat.v1': [msg('assistant', '忙完了\n\n今天怎么样', 5)],
    'xiaoyu.persona.other.profile.v1': { msgCount: 3 },
  });
  const $ = app.$;
  tap(app, '#msgList .wx-item[data-open="default"]');
  type(app, '#narrInput', '（我们一起老去，很多年后都死了）');
  tap(app, '#btnSend');
  await app.sleep(60);
  tap(app, '#confirmYes');
  await app.sleep(60);
  tap(app, '#confirmYes');
  await app.sleep(120);

  const nav = JSON.parse(app.window.localStorage.getItem('xiaoyu.personas.v1'));
  check('⭐ 只剩另一个好友', nav.list.length === 1 && nav.list[0].id === 'other', JSON.stringify(nav.list));
  check('⭐ 自动切到了剩下那个（active 指向他）', nav.active === 'other', nav.active);
  check('⭐ 停在消息列表（不是空聊天页）', !$('#screen-msgs').hidden && $('#screen-chat').hidden);
  check('消息列表里还有林砚', /林砚/.test($('#msgList').textContent));
  check('默认好友的老存档被删了',
    app.window.localStorage.getItem('xiaoyu.chat.v1') === null);
  check('另一个好友的存档没被误删',
    app.window.localStorage.getItem('xiaoyu.persona.other.chat.v1') !== null);
}

// ---------------------------------------------------------------- 8) 输入框能用
console.log('\n[8] 输入框一定要能点、能输入（用户："下面的文字框点击不了了，输入法也弹不出来"）...');
{
  // 根因：autoGrow() 用 scrollHeight 量高度，而**隐藏元素的 scrollHeight 是 0** ——
  // 这一轮"启动页 = 消息列表"之后，聊天页一开始是 hidden 的，
  // init 里那次 autoGrow 就把 textarea 设成了 0 高：框还在（外层有 min-height），
  // 但点上去没反应、手机上输入法也弹不出来。旁边的旁白框是 <input>、高度写死，
  // 所以它还能正常输入 —— 正好是用户描述的那个"一个能用一个不能用"。
  const app = mkApp();
  const $ = app.$;
  const h = () => $('#input').style.height;

  check('⭐ 启动时（聊天页还藏着）输入框高度不是 0', h() !== '0px' && h() !== '', h());
  check('⭐ 输入框没有被禁用', $('#input').disabled === false);
  check('输入框不是只读', $('#input').readOnly === false);

  tap(app, '#msgList .wx-item');
  check('⭐ 进聊天页后高度也不是 0', h() !== '0px', h());
  check('能聚焦（手机上就是"弹得出输入法"）', (() => {
    $('#input').focus();
    return app.window.document.activeElement === $('#input');
  })());
  check('旁白框也能聚焦', (() => {
    $('#narrInput').focus();
    return app.window.document.activeElement === $('#narrInput');
  })());

  // 发一轮之后必须解锁（生成中会临时 disable，收尾一定要还回来）
  await app.send('你好呀');
  check('⭐ 她说完之后输入框恢复可用（没卡在"生成中"）',
    $('#input').disabled === false);
  check('发送键也不再被"生成中"藏着',
    $('#btnSend').hidden === true || $('#input').value.trim() === '');

  // 终局弹窗取消之后，输入框照样能用（防"弹窗把界面卡住"）
  type(app, '#narrInput', '很多年后我们一起老去，最后都离开了这个世界');
  tap(app, '#btnSend');
  await app.sleep(60);
  check('终局弹窗确实弹出来了', $('#confirmMask').hidden === false);
  tap(app, '#confirmMask');       // 点空白处 = 取消
  await app.sleep(60);
  check('点空白能取消弹窗', $('#confirmMask').hidden === true);
  for (let i = 0; i < 300 && $('#input').disabled; i++) await app.sleep(30);
  check('⭐ 取消之后输入框仍然可用', $('#input').disabled === false);
}

// ---------------------------------------------------------------- 收尾
for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

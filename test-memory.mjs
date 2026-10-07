/**
 * 「她真的记得」的端到端测试
 *
 * 覆盖用户反馈的问题："还是没有读取之前的记录，哪怕记录导入，他也不认"
 *
 * 场景：
 *   1. 全新用户 → 普通开场白，不该硬编"我记得你…"
 *   2. 隔了很久再打开 → 她主动接上上次的话题（不是又来一句"在干嘛呢"）
 *   3. 刚聊完就重开 → 不该多嘴打招呼
 *   4. 导入记录 → 记录真的进了存储/界面/请求体，且能原样预览
 *   5. 存储占用可见
 *
 * 注意：不要在中途 window.close()。jsdom 关掉窗口后，
 * 之前那次 eval 里挂着的微任务还会跑，会对着已销毁的 document 报错，
 * 看起来像是后面那个场景崩了，很难查。
 */

import { bootApp, msg } from './boot.mjs';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const HOUR = 60;
const windows = [];

// ---------------------------------------------------------------- 1) 全新用户
console.log('\n[1] 全新用户 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  // 全新用户会先被「开始之前」拦住，设完才发开场白（见 test-persona.mjs）
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const s = app.shown();
  check('有开场白', s.length >= 1, s.join(' / '));
  check('开场白不含"上次你说"（没记录不该装记得）', !s.join('').includes('上次你说'), s.join(' / '));
}

// ---------------------------------------------------------------- 2) 隔久了再打开
console.log('\n[2] 隔了 5 小时再打开：她主动开口 ...');
{
  const history = [
    msg('assistant', '在干嘛呢', 6 * HOUR),
    msg('user', '我们那个萤火虫项目下周要上线，压力好大', 5 * HOUR),
    msg('assistant', '那你别熬太狠了', 5 * HOUR - 1),
  ];
  const app = bootApp({
    seed: { 'xiaoyu.chat.v1': history, 'xiaoyu.profile.v1': { msgCount: 20 } },
    reply: '诶 你回来啦',
  });
  windows.push(app.dom.window);
  await app.sleep(2500);            // 等 speakUp（异步 + 打字节奏）跑完

  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const fresh = saved.slice(history.length);
  const all = fresh.map((m) => m.content).join(' / ');

  check('她主动开口了（有新的消息）', fresh.length > 0,
    `${history.length} 条 → ${saved.length} 条`);
  check('新消息都是她说的', fresh.length > 0 && fresh.every((m) => m.role === 'assistant'));
  // —— 这次修复的重点 ——
  check('不再机械套用"上次你说{他的话}"', !/上次你说/.test(all), all);
  check('不再出现"你说…后来呢"这种硬接', !/你说[\s\S]{0,20}后来/.test(all), all);
}

// ---------------------------------------------------------------- 2.5) 用户举的例子：最后一句是"睡吧"
console.log('\n[2.5] 他最后一句是"睡吧"（用户反馈的那个例子）...');
{
  // 没配 Key → speakUp 走不了 → 退回兜底开场白。
  // 兜底**故意不套用他的话**，因为"睡吧"只是结束语，不是一件事。
  const history = [
    msg('assistant', '早点睡吧', 6 * HOUR),
    msg('user', '睡吧', 5 * HOUR),
  ];
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': history,
      'xiaoyu.profile.v1': { msgCount: 20 },
      'xiaoyu.config.v1': {
        apiKey: '', provider: 'deepseek', model: 'deepseek-flash',
        endpoint: 'https://api.deepseek.com/chat/completions', autoSpeak: true,
      },
    },
  });
  windows.push(app.dom.window);
  await app.sleep(1200);

  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const fresh = saved.slice(history.length).map((m) => m.content).join(' / ');
  check('没 Key 也能有个得体的兜底开场白', fresh.length > 0, fresh || '(什么都没说)');
  check('**没有**把"睡吧"硬接成话题',
    !/上次你说/.test(fresh) && !/睡吧[\s\S]{0,10}后来/.test(fresh), fresh);
  check('兜底说的是通用招呼（不套用他的话）',
    /回来啦|在忙吗|冒泡|最近/.test(fresh), fresh);
}

// ---------------------------------------------------------------- 3) 刚聊完不该硬打招呼
console.log('\n[3] 刚聊完 10 分钟就重开 ...');
{
  const history = [
    msg('user', '我们那个萤火虫项目下周要上线', 12),
    msg('assistant', '那你别熬太狠了', 10),
  ];
  const app = bootApp({ seed: { 'xiaoyu.chat.v1': history } });
  windows.push(app.dom.window);
  check('没有多嘴打招呼', app.shown().length === 2, app.shown().join(' / '));
  check('记录还是原来那 2 条',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length === 2);
}

// ---------------------------------------------------------------- 3.5) 纯表情/寒暄不该被当话题
console.log('\n[3.5] 上次只说了句"在吗" ...');
{
  const history = [
    msg('user', '在吗', 5 * HOUR),
    msg('assistant', '在', 5 * HOUR - 1),
  ];
  const app = bootApp({ seed: { 'xiaoyu.chat.v1': history } });
  windows.push(app.dom.window);
  const all = app.shown().join(' / ');
  check('不会拿"在吗"当话题硬编开场白', !/上次你说在吗/.test(all), all);
}

// ---------------------------------------------------------------- 4) 导入记录
console.log('\n[4] 导入记录 → 她该记住并提起 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  const HISTORY = `她记得关于你的事：在一家叫北极星的公司做后端开发；老家在齐齐哈尔

[7/14 22:13] 阿哲：今天又加班到十点，烦死了
[7/14 22:14] 小雨：啊……十点
[7/14 22:15] 阿哲：我们那个萤火虫项目下周要上线
[7/14 22:16] 小雨：那你别熬太狠了
`;

  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnShowImport').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#importText').value = HISTORY;
  app.$('#segImport').querySelector('[data-v="replace"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnDoImport').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const res = app.$('#importResult').textContent || '';
  check('导入成功', /导入成功/.test(res), res.split('\n')[0]);
  check('提示里说了她一共记得多少条', /她现在一共记得 \d+ 条对话/.test(res));
  check('提示里让她去看预览自查', /点上面的「看看」/.test(res));

  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  check('导入的消息进了存储', saved.some((m) => String(m.content).includes('萤火虫项目')));
  check('导入的消息在聊天区显示出来了',
    app.shown().some((t) => t.includes('萤火虫项目')), app.shown().length + ' 条');

  const prof = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('导入的"她记得的事"进了 profile', prof.facts.some((f) => f.includes('北极星')),
    (prof.facts || []).join(' / '));

  // 记忆预览
  app.$('#btnShowRecap').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const pv = app.$('#memPreview');
  check('记忆预览能打开', !pv.hidden);
  const txt = pv.textContent || '';
  check('预览里有【你们不是第一次聊天】', /【你们不是第一次聊天】/.test(txt));
  check('预览里有导入的事实（北极星）', /北极星/.test(txt),
    (txt.split('\n').find((l) => l.includes('北极星')) || '').trim());
  check('预览里有【现在的时间】', /【现在的时间】/.test(txt));
  check('预览里列出了最近的对话', /这次会带上最近 \d+ 条/.test(txt) && /萤火虫/.test(txt));
  check('再点一下能收起', (() => {
    app.$('#btnShowRecap').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    return app.$('#memPreview').hidden;
  })());

  // 发一句话，确认导入的内容真的发给了模型
  await app.send('你还记得我昨天说什么了吗');
  const req = app.lastRequest();
  const sys = req.messages.find((m) => m.role === 'system').content;
  const hist = req.messages.filter((m) => m.role !== 'system');
  check('导入的内容出现在请求历史里', hist.some((m) => String(m.content).includes('萤火虫项目')));
  check('system 里有记忆块', /【你们不是第一次聊天】/.test(sys));
  check('system 里有导入的事实', /北极星/.test(sys));
  check('记忆块排在人格规则前面',
    sys.indexOf('【你们不是第一次聊天】') < sys.indexOf('【必须遵守】'));
  check('system 告诉她不能装不认识', /绝对不能说"啊？你说过吗/.test(sys));
  check('system 里没有会压制记忆的"不要复述"', !/不要复述他说过的话/.test(sys));

  check('记忆块在 system 的前 1/3（位置越靠前越管用）',
    sys.indexOf('【你们不是第一次聊天】') < sys.length / 3,
    `第 ${sys.indexOf('【你们不是第一次聊天】')} 字 / 共 ${sys.length} 字`);
  check('要求他问"还记得吗"时必须说出具体内容', /"还记得吗"/.test(sys));
  check('要求每隔几轮主动提起以前的事', /每隔几轮，主动提一次以前的事/.test(sys));
  check('要求开口前先过一遍记忆', /开口之前先把上面这些在脑子里过一遍/.test(sys));
}

// ---------------------------------------------------------------- 5) 手动加的记忆也会进
console.log('\n[5] 手动加一条 → 下一轮她就读到 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#inpNewFact').value = '他在齐齐哈尔长大';
  app.$('#btnAddFact').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnCloseMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  await app.send('在么');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('手动加的记忆进了下一轮提示词', /齐齐哈尔/.test(sys));
  check('记忆块出现了', /【你们不是第一次聊天】/.test(sys));
}

// ---------------------------------------------------------------- 6) 存储占用可见
console.log('\n[6] 存储占用可见 ...');
{
  const big = [];
  for (let i = 0; i < 40; i++) {
    big.push(msg('user', `第${i}条 ` + 'x'.repeat(200), 600 - i));
    big.push(msg('assistant', `回${i} ` + 'y'.repeat(200), 600 - i));
  }
  const app = bootApp({ seed: { 'xiaoyu.chat.v1': big } });
  windows.push(app.dom.window);
  const n = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1')).length;
  // 80 条原有 + 她主动开口的 3 条
  check('大记录也能正常加载', n >= 80, `${n} 条`);

  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('记忆页显示存储占用百分比', /存储 \d+%/.test(app.$('#memStats').textContent),
    app.$('#memStats').textContent);
}

// ---------------------------------------------------------------- 7) 要点压缩不丢信息
console.log('\n[7] 要点压缩不丢信息 ...');
{
  // 造 15 轮，他每轮说一件不同的事（"今天我做了第N道菜"）。
  // 旧代码每轮只取 6 条 user 消息来压，一轮聊得久就会丢掉七成内容 ——
  // 这正是"天天说自己做饭，她后来还问'你做过饭吗'"的根源之一。
  const history = [];
  for (let i = 0; i < 15; i++) {
    history.push(msg('user', `今天我做了第${i}道菜，还挺成功的`, 300 - i * 2));
    history.push(msg('assistant', '哇 好吃吗', 300 - i * 2 - 1));
  }
  const app = bootApp({
    seed: { 'xiaoyu.chat.v1': history },
    reply: '你今天又做菜啦，什么菜',
  });
  windows.push(app.dom.window);

  await app.send('在吗');

  const p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  const text = (p.summary || []).join(' ');
  const hits = (text.match(/第\d+道菜/g) || []).length;
  check('要点里保留了 6 条以上的信息（旧代码写死只取 6 条）',
    hits > 6, `保留了 ${hits} 条`);
  check('要点带日期，回忆时有先后顺序',
    /^\d+\/\d+ \d+:\d+ 那次聊到/.test(p.summary[0] || ''),
    (p.summary[0] || '').slice(0, 36));
  check('寒暄没被当成要点塞进去（"在吗"这类要过滤掉）',
    !/「[^」]*在吗/.test(text), text.slice(0, 60));
}

// ---------------------------------------------------------------- 8) 她会主动开口
console.log('\n[8] 她会主动开口 ...');
{
  // 模拟：聊到一半他去忙了，35 分钟后切回前台
  const history = [
    msg('user', '我们那个萤火虫项目下周要上线', 36),
    msg('assistant', '那你别熬太狠了', 35),
  ];
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': history,
      'xiaoyu.profile.v1': { msgCount: 10 },
      // 名字改过之后，她主动开口时用的也必须是新名字
      'xiaoyu.config.v1': { herName: '阿雨' },
    },
    reply: '对了，你那个萤火虫项目后来怎么样了',
  });
  windows.push(app.dom.window);

  const before = app.shown().length;

  // jsdom 里 document.hidden 是只读的，得改写才能模拟"切回前台"
  Object.defineProperty(app.window.document, 'hidden', { value: false, configurable: true });
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  await app.sleep(3500);

  const after = app.shown();
  const tail = after.slice(-2).join(' / ');
  check('切回前台后她主动开口了',
    after.length > before, `${before} 条 → ${after.length} 条`);
  check('主动说的内容接着上文（不是干等）',
    /萤火虫项目/.test(tail), tail);
  check('主动说的话已经存进记录',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'))
      .some((m) => m.role === 'assistant' && /萤火虫项目/.test(m.content)));

  // 用户反馈：改了名字她自我介绍还说"沈雨"。
  // 主动开口走的是另一条提示词（speakUp），也得带上新名字。
  {
    const sys = app.lastRequest()?.messages.find((m) => m.role === 'system')?.content || '';
    check('主动开口时提示词里也是新名字', /你叫阿雨/.test(sys),
      (sys.match(/你叫[^\n]{0,12}/) || [''])[0] || '(没抓到提示词)');
    check('主动开口时提示词里没有旧本名「沈雨」', !/沈雨/.test(sys));
  }

  // 设置开关
  app.$('#screen-settings').classList.add('show');
  check('设置里有「主动找你说话」开关', !!app.$('#segSpeak'));
  check('默认是开的', (() => {
    const on = app.$$('#segSpeak button').find((b) => b.classList.contains('on'));
    return !!on && on.dataset.v === '1';
  })(), app.$$('#segSpeak button').find((b) => b.classList.contains('on'))?.textContent);

  check('可以关掉，并会写进配置', (() => {
    app.$$('#segSpeak button')[1].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1') || '{}');
    const off = Number(cfg.autoSpeak) === 0;
    app.$$('#segSpeak button')[0].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    return off;
  })());
}

// ---------------------------------------------------------------- 9) 关键词检索记忆
console.log('\n[9] 从很久以前翻出相关的话 ...');
{
  const history = [];
  const push = (role, content, minAgo) => history.push(msg(role, content, minAgo));
  // 很久以前说过做饭（这条会被挤出"最近 200 条"的窗口）
  push('user', '我今天自己做饭，煮了个番茄鸡蛋面', 60 * 24 * 3);
  push('assistant', '听起来不错', 60 * 24 * 3 - 1);
  // 中间夹 120 轮无关寒暄，把上面那条挤出上下文窗口
  for (let i = 0; i < 120; i++) {
    push('user', `随便聊聊第${i}条 今天天气还行`, 60 * 24 * 2 - i * 9);
    push('assistant', '嗯嗯', 60 * 24 * 2 - i * 9 - 1);
  }

  const app = bootApp({
    seed: { 'xiaoyu.chat.v1': history, 'xiaoyu.profile.v1': { msgCount: 300 } },
    reply: '你以前不是说自己做饭吗',
  });
  windows.push(app.dom.window);

  await app.send('我今晚又做饭了，你说我做得好不好吃');

  const req = app.lastRequest();
  const sys = req.messages.find((m) => m.role === 'system').content;
  const hist = req.messages.filter((m) => m.role !== 'system');

  check('那条做饭的旧记录确实被挤出了上下文窗口',
    !hist.some((m) => String(m.content).includes('番茄鸡蛋面')),
    `上下文带了 ${hist.length} 条`);
  check('但检索把它翻回来了', /【很久以前你们说过的】/.test(sys));
  check('翻回来的正是那条做饭的记录', /番茄鸡蛋面/.test(sys),
    ((sys.match(/【很久以前你们说过的】[\s\S]{0,150}/) || [''])[0]).split('\n').slice(0, 3).join(' / '));
  check('明确告诉她这些是她记得的', /这些是很早的对话，你记得/.test(sys));
  //（用户反馈：她会说"你以前也这么说过，而且出现过很多次"，像在核对记录）
  check('禁止宣告"你以前也这么说过"', /绝对不要说"你以前也这么说过"/.test(sys));
  check('禁止提"次数"', /尤其不要提"次数"/.test(sys));
  check('检索块不算太大（别把 prompt 撑爆）',
    ((sys.match(/【很久以前你们说过的】[\s\S]*?(?=\n\n)/) || [''])[0]).length < 700,
    `${((sys.match(/【很久以前你们说过的】[\s\S]*?(?=\n\n)/) || [''])[0]).length} 字`);
}

// ---------------------------------------------------------------- 10) 相处习惯进了提示词
console.log('\n[10] 反复做过的动作 → 她该习惯了 ...');
{
  // 他反复"（抱住）"，她每次都"（愣住）/（没躲）"——用户反馈的生硬场景
  const history = [];
  for (let i = 0; i < 5; i++) {
    history.push(msg('user', '（抱住）', 60 - i * 2));
    history.push(msg('assistant', i % 2 ? '（没躲）' : '（愣住）…你干嘛', 60 - i * 2 - 1));
  }
  const app = bootApp({
    seed: { 'xiaoyu.chat.v1': history, 'xiaoyu.profile.v1': { msgCount: 30 } },
    reply: '（反手抱住）今天怎么这么黏人',
  });
  windows.push(app.dom.window);

  await app.send('（抱住）');

  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('提示词里有【你们的相处习惯】', /【你们的相处习惯】/.test(sys));
  // 历史里 5 次 + 刚发出去的这 1 次 = 6 次 → 够格算"经常"
  // 但只写模糊程度，不写具体次数（写"6 次"她会念出来，很生硬）
  check('写了他做过的动作', /- 「抱住」：经常/.test(sys),
    (sys.match(/- 「抱[^\n]*/) || [''])[0]);
  check('但不报具体次数', !/6 次|\d+ 次/.test(sys),
    (sys.match(/- 「抱[^\n]*/) || [''])[0]);
  check('要求她不要把次数说出口', /不要把"次数"/.test(sys));
  check('明确要求别再给"第一次"的反应',
    /不要再给"（愣住）""（没躲）""（脸红）"/.test(sys));
  check('要求熟悉之后要自然甚至主动', /反手抱住/.test(sys));
}

// ---------------------------------------------------------------- 11) 内置时钟
console.log('\n[11] 内置时钟可以往前拨 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [
        msg('user', '我去看个电影', 30),
        msg('assistant', '好呀 看什么', 29),
      ],
      'xiaoyu.profile.v1': { msgCount: 20 },
    },
  });
  windows.push(app.dom.window);
  await app.sleep(600);

  check('「+」面板里有时间显示', !!app.$('#clockNow'));
  check('有时长按钮（至少 5 个）', app.$$('[data-clock]').length >= 5,
    app.$$('[data-clock]').map((b) => b.textContent.trim()).join(' / '));
  check('初始没有偏移',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset || 0) === 0);

  // 点「+2 小时」——模拟"去看场两小时的电影"
  const btn = app.$$('[data-clock]').find((b) => b.dataset.clock === '120');
  btn.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const after = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('点 +2 小时后偏移 = 2 小时', Number(after.clockOffset) === 120 * 60000,
    String(after.clockOffset));
  check('时钟显示跟着变了', /\d+\/\d+ 周. \d{2}:\d{2}/.test(app.$('#clockNow').textContent),
    app.$('#clockNow').textContent);

  // 之后发的消息用的是拨过之后的时间
  await app.send('看完了');
  const saved = JSON.parse(app.window.localStorage.getItem('xiaoyu.chat.v1'));
  const lastUser = [...saved].reverse().find((m) => m.role === 'user' && m.content === '看完了');
  check('新消息的时间戳用的是虚拟时间（+2 小时后）',
    !!lastUser && lastUser.ts > Date.now() + 60 * 60000,
    lastUser ? new Date(lastUser.ts).toLocaleString('zh-CN') : '没找到');

  // 回到现在
  app.$$('[data-clock]').find((b) => b.dataset.clock === 'reset')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('「回到现在」把偏移清零',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset || 0) === 0);
}

// ---------------------------------------------------------------- 12) 记忆曲线在真实流程里生效
console.log('\n[12] 反复提到的事记得更牢 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [
        msg('user', '我今天又做饭了', 60),
        msg('assistant', '好呀', 59),
      ],
      'xiaoyu.profile.v1': { msgCount: 20 },
    },
    reply: '[[记忆]]{"facts":["他每天下班自己做饭"]}',
  });
  windows.push(app.dom.window);

  const KEY = '他每天下班自己做饭';

  await app.send('我今天做饭了');
  let p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('第一次记住，复习次数 = 1', Number(p.factsMeta?.[KEY]?.hits) === 1,
    String(p.factsMeta?.[KEY]?.hits));

  await app.send('我又做饭了');
  p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('再次提到算一次复习，次数 = 2', Number(p.factsMeta?.[KEY]?.hits) === 2,
    String(p.factsMeta?.[KEY]?.hits));
  check('没有重复存成两条', p.facts.filter((f) => f.includes('做饭')).length === 1,
    p.facts.join(' | '));

  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('记忆页显示记忆强度标签',
    app.$$('#memFacts .wx-mem-strength').length > 0,
    app.$$('#memFacts .wx-mem-strength').map((e) => e.textContent).join(' / '));
  // 曾经 pct = 100 时算出 s4，而 CSS 只定义了 s0~s3 ——
  // 最牢的那几条反而顶着一个没样式的灰标签
  {
    const bad = app.$$('#memFacts .wx-mem-strength')
      .map((e) => [...e.classList].find((c) => /^s\d$/.test(c)))
      .filter((c) => !['s0', 's1', 's2', 's3'].includes(c));
    check('强度标签的档位都在 s0~s3 里（别算出 s4 这种没样式的）',
      bad.length === 0, bad.join(', ') || '全部合法');
  }
  check('统计里说了有几件「很牢」', /件很牢/.test(app.$('#memStats').textContent),
    app.$('#memStats').textContent);

  // 手动加的 → 永久
  app.$('#inpNewFact').value = '他老家在齐齐哈尔';
  app.$('#btnAddFact').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('手动加的记忆被标成"钉住"（永久）',
    p.factsMeta?.['他老家在齐齐哈尔']?.pinned === true);
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
for (const w of windows) { try { w.close(); } catch {} }
process.exit(fail ? 1 : 0);

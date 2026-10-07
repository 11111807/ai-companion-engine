/**
 * 时间观念 + 场景连续性测试
 *
 * 针对用户反馈的两个具体问题：
 *   「前一天晚上在家，后一天早上就应该在家醒来，而不是跑到别的地方并且丢失记忆」
 *   「应该给她加入时间观念」
 *
 * 这里不依赖浏览器，直接跑 persona.js 的纯函数。
 */

import {
  SCENES,
  evolveScene,
  describeTime,
  sceneHint,
  pickScene,
  buildSystemPrompt,
  greeting,
  futureHint,
} from './src/persona.js';
import { bootApp, msg } from './boot.mjs';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** 造一个本地时间戳：2026-03-10（周二）的 hh:mm */
const at = (day, h, m = 0) => new Date(2026, 2, day, h, m, 0, 0).getTime();

const sceneById = (id) => SCENES.find((s) => s.id === id);
const windows = [];   // 收尾时统一关掉，免得 jsdom 挂着进程不退

console.log('\n[1] 场景表结构 ...');
check('场景数量够多（不会总是那几句）', SCENES.length >= 15, `${SCENES.length} 个`);
check('每个场景都有 id / place / hours / text',
  SCENES.every((s) => s.id && s.place && Array.isArray(s.hours) && s.hours.length === 2 && s.text));
check('宿舍和家都覆盖了全天 24 小时（跨天醒来必定还是同一地点）', (() => {
  for (const place of ['dorm', 'home']) {
    const own = SCENES.filter((s) => s.place === place);
    for (let h = 0; h < 24; h++) {
      if (!own.some((s) => s.hours[0] <= h && h < s.hours[1])) return false;
    }
  }
  return true;
})(), Object.entries(SCENES.reduce((a, s) => ((a[s.place] = (a[s.place] || 0) + 1), a), {}))
  .map(([k, v]) => `${k}:${v}`).join(' '));
check('每个地点至少 3 个时段（不然一演变就得换地方）',
  Object.values(SCENES.reduce((a, s) => ((a[s.place] = (a[s.place] || 0) + 1), a), {})).every((n) => n >= 3));
check('场景 id 不重复', new Set(SCENES.map((s) => s.id)).size === SCENES.length);

console.log('\n[2] 短时间内接着聊：不许换地方 ...');
{
  const prev = 'dorm-evening';
  const r = evolveScene(prev, at(10, 19, 0), at(10, 19, 30)); // 隔 30 分钟
  check('半小时后场景不变', r.scene.id === prev, r.scene.id);
  check('半小时后标记为未变化', r.changed === false);
}
{
  // 19:00 聊完，21:00 又来找她 —— 还没到 3 小时，仍然是同一个场景
  const r = evolveScene('dorm-evening', at(10, 19, 0), at(10, 21, 0));
  check('2 小时后仍然是原来那个场景', r.scene.id === 'dorm-evening', r.scene.id);
}
{
  const r = evolveScene('dorm-evening', at(10, 19, 0), at(10, 22, 30));
  check('间隔小时数算得对', Math.abs(r.gapHours - 3.5) < 0.01, String(r.gapHours));
}

console.log('\n[3] 用户反馈的原场景：晚上在家 → 第二天早上还在家 ...');
{
  // 3/10 周二 23:30 在家聊完，3/11 周三 08:00 再来
  const r = evolveScene('home-late', at(10, 23, 30), at(11, 8, 0));
  check('第二天早上仍然在「家」这个地点', r.scene.place === 'home', `${r.scene.id} (${r.scene.place})`);
  check('场景变成"早上在家"而不是深夜', sceneById(r.scene.id).hours[0] <= 8 && 8 < sceneById(r.scene.id).hours[1],
    r.scene.id);
  check('确实发生了变化（不是卡住不动）', r.changed === true);
  check('地点没有跳到宿舍/图书馆', r.scene.place !== 'dorm' && r.scene.place !== 'library');
}

{
  // 反向：晚上在宿舍 → 第二天早上还在宿舍
  const r = evolveScene('dorm-night', at(10, 23, 0), at(11, 7, 30));
  check('宿舍睡前 → 宿舍醒来（同地点）', r.scene.place === 'dorm', r.scene.id);
}

{
  // 中午在图书馆 → 下午还在图书馆
  const r = evolveScene('library-day', at(10, 12, 30), at(10, 15, 0));
  const lib = SCENES.filter((s) => s.place === 'library').map((s) => s.id);
  check('图书馆的中午场景存在（前提检查）', lib.includes('library-day'), lib.join(','));
  check('图书馆 → 下午仍在图书馆', r.scene.place === 'library', `${r.scene.id} (${r.scene.place})`);
}
{
  // 每个地点：按它自己的场景往后推 6 小时，只要该地点还有合适场景就不能跑掉
  let worst = '';
  const ok = SCENES.every((s) => {
    const r = evolveScene(s.id, at(10, s.hours[0], 5), at(10, s.hours[0] + 6, 0));
    const h = s.hours[0] + 6;
    const own = SCENES.filter((x) => x.place === s.place && x.hours[0] <= h % 24 && h % 24 < x.hours[1]);
    if (own.length && r.scene.place !== s.place) { worst = `${s.id} → ${r.scene.id}`; return false; }
    return true;
  });
  check('同地点有合适场景时绝不会跳走', ok, worst || '全部通过');
}

console.log('\n[4] 没有历史时也能选出一个合理场景 ...');
{
  for (const h of [1, 7, 12, 15, 19, 23]) {
    const r = evolveScene(null, null, at(10, h, 0));
    const ok = r.scene && r.scene.hours[0] <= h && h < r.scene.hours[1];
    check(`第 ${h} 点没历史时选出符合时段的场景`, ok, r.scene.id);
  }
}
{
  const s = pickScene(new Date(2026, 2, 10, 15, 0));
  check('pickScene 也只在合适时段里选', s.hours[0] <= 15 && 15 < s.hours[1], s.id);
}
{
  // 凌晨 3 点：必须有场景能覆盖，不能返回 undefined
  const r = evolveScene('dorm-night', at(10, 23, 0), at(11, 3, 0));
  check('凌晨 3 点也有场景可用', !!r.scene?.text, r.scene?.id);
}

console.log('\n[5] 时间描述 ...');
{
  const t = describeTime(at(10, 8, 5));
  check('包含日期', /2026年3月10日/.test(t), t.split('\n')[0]);
  check('包含星期', /周二/.test(t), t.split('\n')[0]);
  check('包含时段（早上）', /早上/.test(t));
  check('包含具体时刻', /8:05/.test(t), t.split('\n')[0]);
}
{
  check('深夜能识别', /深夜/.test(describeTime(at(10, 2, 0))));
  check('晚上能识别', /晚上/.test(describeTime(at(10, 20, 0))));
  check('中午能识别', /中午/.test(describeTime(at(10, 13, 0))));
}
{
  // 跨天：要说清楚"上次聊天是昨天/几天前"
  const t = describeTime(at(11, 8, 0), at(10, 23, 0));
  check('跨天时说明距上次多久', /上次|昨天|小时|天/.test(t), t.split('\n').slice(1).join(' / '));
}
{
  const t = describeTime(at(10, 20, 0), at(10, 19, 50));
  check('刚聊完不乱标"很久以前"', !/天前/.test(t));
}

console.log('\n[6] 系统提示词 ...');
{
  const sys = buildSystemPrompt(
    { name: '阿哲', facts: ['在做开发', '养了只橘猫'], lastMood: '累' },
    {
      scene: sceneById('dorm-evening'),
      timeText: describeTime(at(10, 20, 0), at(10, 19, 50)),
      summary: ['上次聊到他加班', '他说周末要去看猫'],
    },
  );
  check('有【现在的时间】', /【现在的时间】/.test(sys));
  check('时间块里是真实日期', /2026年3月10日/.test(sys));
  check('有场景块', /【你现在在哪】/.test(sys) && /宿舍/.test(sys));
  check('场景块声明优先于生活底色', /以这里为准/.test(sys));
  check('禁止凭空换地点', /不要凭空跳到无关的地方/.test(sys));
  check('换地点要有过渡', /换地点必须有合理过渡/.test(sys));
  check('要求接着前面的话聊，不许当第一次听', /不要当成第一次听/.test(sys));
  check('有记忆块且带上了他',
    /【你们不是第一次聊天】/.test(sys) && /你记得关于他的事/.test(sys) && /橘猫/.test(sys));
  check('记忆块里有长期要点',
    /你们之前聊过的事/.test(sys) && /上次聊到他加班/.test(sys));
  check('长期要点逐条列出', /- 上次聊到他加班[\s\S]*- 他说周末要去看猫/.test(sys));
  check('把记忆说成"你的记忆"而不是资料', /下面这些是\*\*你的记忆\*\*，不是给你的资料/.test(sys));
  check('记忆块排在人格规则前面', sys.indexOf('【你们不是第一次聊天】') < sys.indexOf('【必须遵守】'));
  check('要求不能说"你说过吗"', /绝对不能说"啊？你说过吗/.test(sys));
  check('要求每隔几轮主动提前面的事', /每隔几轮，主动提一次以前的事/.test(sys));
  check('反顺从规则还在', /【别当应声虫】/.test(sys));
  check('明确禁止自称 AI / 语言模型', /绝对不要说"作为一个 AI/.test(sys));
  check('生活底色里说明了宿舍不是唯一住处', /周末.*回家/.test(sys));

  // ---- 人格调温：以前她太冷了（通篇是"不要…"，没有一条正向的"要…"）----
  check('有正向的"热情"设定，不只是禁令',
    /【你对他挺上心的】/.test(sys) && /大部分时候你是暖的/.test(sys));
  check('明确规定了冷热比例，防止一直冷',
    /【冷和热的比例】/.test(sys) && /不要连着三条都冷/.test(sys));
  check('同意/不同意给了比例（既不应声虫也不杠精）',
    /【同意和不同意】/.test(sys) && /七成顺着聊/.test(sys));
  check('"想你/喜欢你"不再一律冷淡回应',
    /不要每次都用同一种反应/.test(sys) && /我也想你/.test(sys));
  check('热情设定没把反顺从规则冲掉',
    /不要为了让他高兴就一味附和/.test(sys) && /不要每次都顺着他/.test(sys));
  check('要求主动找话说、主动带话题',
    /你会主动找话说/.test(sys) && /主动带话题/.test(sys));

  // ---- 括号旁白：这一轮**故意反转**了 ----
  //
  // 历史：最早一律禁止 → 后来改成"可以写，但后面必须跟真话"（因为模型偷偷写）
  // → 现在**又禁止了**，因为用户要自己写旁白（聊天框里有个独立的旁白输入框），
  //   AI 再写括号就会和他写的撞在一起，而且括号在界面上要单独占一个气泡。
  // 所以这几条断言跟着反转，别以为是回归。
  check('明确禁止她写括号旁白（改成用户自己写了）',
    /【绝对不要写括号旁白】/.test(sys) && /不要用（　）写动作、心理、环境/.test(sys));
  check('解释了为什么（会和他写的撞在一起 / 要占一个气泡）',
    /撞在一起/.test(sys) && /单独占一个气泡/.test(sys));
  check('要求她把"心里想的"用说的话表达出来',
    /只输出你真正要说的话/.test(sys) && /你今天有点奇怪诶/.test(sys));
  check('旧的"可以写括号"那套已经删干净',
    !/【括号里的旁白】/.test(sys) && !/后面必须跟着你真正要说的话/.test(sys)
    && !/【旁白要跟着熟悉度变】/.test(sys));

  // ---- 他会发"旁白"进来（环境 / 动作 / 内心）----
  check('告诉她旁白是什么（不带气泡底色、是场景说明）',
    /他那边可能会发"旁白"进来/.test(sys) && /场景说明/.test(sys));
  check('要求把旁白当成当场发生的事自然接住',
    /当成\*\*当场发生的事\*\*自然接住/.test(sys));
  check('给了旁白的例子（推门进来 / 外面下雨）',
    /她推门进来，手里拎着两杯奶茶/.test(sys) && /外面开始下雨了/.test(sys));
  check('要求别对旁白过度反应（喝口水不用评论半天）',
    /别对旁白\*\*过度反应\*\*/.test(sys) && /不用评论半天/.test(sys));

  // ---- 主动开口 ----
  check('明确要求她也会主动起话头',
    /【你也会主动开口】/.test(sys) && /你也可以起头/.test(sys));
  check('给出了主动开口的具体方式',
    /接着上文/.test(sys) && /起新话题/.test(sys) && /说自己的事/.test(sys));
  check('要求他很久没动静时她先开口',
    /他很久没动静时，你也会先开口/.test(sys));

  // ---- 情绪要有明显起伏（之前她一直是同一个温度）----
  check('有"情绪是有起伏的"设定', /【你的情绪是有起伏的】/.test(sys));
  check('开心/生气/难过各有具体表现',
    /- \*\*开心\*\*/.test(sys) && /- \*\*生气 \/ 不爽\*\*/.test(sys) && /- \*\*委屈 \/ 难过\*\*/.test(sys));
  check('给了情绪落到字面上的规则（句长/标点/连发条数）',
    /【情绪怎么落在字面上】/.test(sys) && /句子变长/.test(sys) && /句子变短/.test(sys));
  check('要求开心要明显表露，别憋着', /明显地表露出来/.test(sys));
  check('要求生气也要让他看得出来', /让他看出来/.test(sys) && /你认真的/.test(sys));
  check('允许情绪突然切换（上一秒笑下一秒低落）',
    /上一秒还在笑，下一秒可能因为他一句话低落下来/.test(sys));
  check('但没有演成作精（不上纲上线、要给台阶）',
    /【但是别演成作精】/.test(sys) && /不要上纲上线/.test(sys) && /生一会儿气就该给台阶/.test(sys));
  check('限制情绪大起大落的次数（避免反复无常）',
    /一次对话里情绪最多大起大落一次/.test(sys));

  // ---- 活泼 / 篇幅 / 多讲自己（反馈"还是有点冷、语句太短"）----
  check('要求活泼、会开玩笑', /【活泼一点】/.test(sys) && /会开玩笑/.test(sys));
  check('给了开玩笑的具体方向（损他 / 自嘲 / 夸张）',
    /可以损他/.test(sys) && /可以自嘲/.test(sys) && /也可以夸张/.test(sys));
  check('要求多讲自己的想法，不能只接话',
    /【多说说你自己】/.test(sys) && /回应他 1 句 \+ 讲你自己/.test(sys));
  check('给了"接一句自己的经历"的具体例子', /我上周也熬到两点/.test(sys));
  check('要求不要每句都提问（别像采访）', /不要每句都在问他问题/.test(sys));
  check('放宽了单条篇幅（不再限死 20 字）',
    /25～40 字/.test(sys) && !/一般不超过 20 个字/.test(sys));

  // ---- 旁白随熟悉度演变：同上，那一整段在这一轮删掉了 ----
  check('旧的"旁白随熟悉度变"那一整段已经删干净（她不再写括号了）',
    !/【旁白要跟着熟悉度变】/.test(sys) && !/用手就不要再用/.test(sys));

  // ---- 心情好时语气词要软 ----
  check('心情好时语气词要软（嗯→嗯呢 / 好→好呀）',
    /"嗯" → "嗯呢"/.test(sys) && /"好" → "好呀"/.test(sys));
  check('列了常用的几组', /"行" → "行啊"/.test(sys) && /"知道了" → "知道啦"/.test(sys));
  check('说明干巴巴的"嗯/好/行"什么时候才用',
    /只在心情一般、或者在闹别扭的时候用/.test(sys));
  check('但也别无差别卖萌（心情不好还"好呀~"就假了）',
    /别无差别卖萌/.test(sys) && /语气词是情绪的\*\*结果\*\*/.test(sys));

  // ---- 时间逻辑：别把"明天"当成"马上" ----
  check('时间块要求分清过去/现在/将来',
    /别把时间的先后搞错/.test(sys) && /过去、现在，还是将来/.test(sys));
  check('点了用户举的那个例子（晚上十点说明天下午）',
    /晚上十点.*明天下午送你去学校/.test(sys));
  check('明确说未来十几个小时的事不用急',
    /那是\*\*十几个小时、甚至几天之后\*\*的事/.test(sys));
  check('只有"马上""十分钟后"才需要立刻行动',
    /只有"马上""十分钟后""现在就得走"这种，才需要立刻行动/.test(sys));
  check('拿不准就先问，别脑补紧张感', /别自己脑补出紧张感/.test(sys));
  check('连发条数提到 2-3 条', /通常 2-3 条/.test(sys));

  // 关键：要的是"长短错落"，不是"每句都变长"
  check('明确要求长短错落（不是一味拉长）',
    /长短要错落/.test(sys) && /短句可以很短/.test(sys) && /两种都要有/.test(sys));
  check('说清了"全短显得冷、全长像写作文"',
    /显得又冷又单调/.test(sys) && /像写作文/.test(sys));
  check('给了真人发微信的节奏例子',
    /闹钟响三次我全按掉了/.test(sys));
  check('输出格式里也强调了几条要长短搭配',
    /这几条要长短搭配/.test(sys));
}
{
  // 冷热失衡的自查：正向表述不能少到被禁令淹没，否则模型又会演成爱答不理
  const sys = buildSystemPrompt(
    { name: '阿哲', facts: ['每天下班自己做饭'] },
    { scene: sceneById('dorm-evening'), timeText: describeTime(at(10, 20, 0)) },
  );
  const positive = (sys.match(/你会|你可以|要接话|主动|愿意/g) || []).length;
  const negative = (sys.match(/不要|别 |不许|绝对不/g) || []).length;
  check('正向表述不至于被禁令淹没',
    positive >= 6 && positive / (positive + negative) > 0.10,
    `正向 ${positive} 条 / 禁令 ${negative} 条`);
}
{
  // 全新用户：不该硬塞一段"她记得你…"的空话
  const sys = buildSystemPrompt({}, {});
  check('没有任何记忆时不输出记忆块', !/【你们不是第一次聊天】/.test(sys));
}
{
  // 没有场景/时间时也不能崩
  const sys = buildSystemPrompt({}, {});
  check('缺场景/时间时也能生成提示词', typeof sys === 'string' && sys.length > 200);
}
{
  const hint = sceneHint(null);
  check('sceneHint 对空场景返回空串', hint === '');
}

console.log('\n[7] 开场白跟着时间走 ...');
{
  const g = greeting(at(10, 8, 0));
  check('早上有"早"', /早/.test(g), g.replace(/\n/g, ' '));
}

// ---------------------------------------------------------------- [8] 未来时间
console.log('\n[8] 未来的时间要算清楚（用户反馈的例子）...');
{
  // 2026-11-01（周日）22:00 —— 就是用户描述的场景
  const t = new Date(2026, 10, 1, 22, 0, 0, 0).getTime();

  const h1 = futureHint('明天下午送你去学校', t);
  check('「明天下午」算出了还剩多久', /大约 1[0-9] 个小时之后/.test(h1),
    (h1.split('\n')[1] || '').trim());
  check('明确说"现在还早，不用着急"', /完全不用着急/.test(h1));
  check('明确禁止说"快出发""要迟到了"', /"快出发""要迟到了"/.test(h1));

  const h2 = futureHint('后天晚上一起吃饭', t);
  check('「后天晚上」算出约 2 天', /大约 2 天之后/.test(h2), (h2.split('\n')[1] || '').trim());

  const h3 = futureHint('明天早上八点开会', t);
  check('「明天早上」算出约 10 小时', /大约 1[01] 个小时之后/.test(h3),
    (h3.split('\n')[1] || '').trim());

  check('「十分钟后走」不提示（那是真该急的）', futureHint('十分钟后走', t) === '');
  check('没有时间词就不提示', futureHint('我去看个电影', t) === '');
  check('「今晚」（白天说）能算出来',
    /个小时之后/.test(futureHint('今天晚上一起吃饭', new Date(2026, 10, 1, 8, 0).getTime())));
  check('时间已经过了就不提示（深夜说"今晚"）',
    futureHint('今天晚上一起吃饭', new Date(2026, 10, 2, 23, 30).getTime()) === '');
  check('空输入不炸', futureHint('', t) === '' && futureHint(null, t) === '');
}

console.log('\n[9] 时间旋钮：直接改年月日时分（用户反馈"按钮延迟高、不方便"）...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 20 },
    },
  });
  windows.push(app.dom.window);
  const $ = app.$;
  const openPlus = () => $('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  check('「+」里有日期时间选择器', !!$('#clockPick'));
  check('选择器是 datetime-local（手机上点开就是系统滚轮，年月日时分都能改）',
    $('#clockPick').type === 'datetime-local', $('#clockPick').type);
  check('精确到分钟', $('#clockPick').step === '60', $('#clockPick').step);

  openPlus();
  check('打开面板就把当前时间填进选择器', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test($('#clockPick').value),
    $('#clockPick').value);

  const clickClock = (v) => app.$$('#clockPick ~ * [data-clock], [data-clock]')
    .find((b) => b.dataset.clock === String(v))
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  // ⭐ 关键回归：改时间**不能重画整个聊天区**（那正是"延迟过高"的根因）。
  // 这里数一下气泡节点有没有被换掉：renderChat 会重建 DOM，节点引用就变了。
  openPlus();
  const bubbleBefore = $('#messages .wx-row');
  clickClock(60);
  const bubbleAfter = $('#messages .wx-row');
  check('时间跳了之后聊天区没有被重画（同一个 DOM 节点）',
    !!bubbleBefore && bubbleBefore === bubbleAfter);

  check('拨完之后偏移量存下来了',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset) === 3600000,
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset);
  check('时钟显示跟着走了', $('#clockNow').textContent !== '—', $('#clockNow').textContent);
  check('说明里告诉他"已经往前拨了"', /已经往前拨了/.test($('#clockNote').textContent),
    $('#clockNote').textContent.trim().slice(0, 30));
  check('选择器里的时间也同步跳了',
    new Date($('#clockPick').value).getTime() > Date.now() + 3000000,
    $('#clockPick').value);

  // 直接选一个具体日期时间（模拟用户拨滚轮）
  openPlus();
  const target = new Date(2027, 4, 20, 14, 30, 0, 0);
  $('#clockPick').value = `${target.getFullYear()}-05-20T14:30`;
  $('#clockPick').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  const off = Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset);
  check('选到哪天就是哪天（年月日时分都算准了）',
    Math.abs(off - (target.getTime() - Date.now())) < 60000, String(Math.round(off / 60000)));

  // 回到现在
  openPlus();
  $('[data-clock="reset"]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('「回到现在」把偏移清零',
    Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).clockOffset) === 0);
  check('清零后说明回到默认文案', !/已经往前拨了/.test($('#clockNote').textContent),
    $('#clockNote').textContent.trim().slice(0, 30));

  // 时间分隔条的文字要跟着改（不然跳一天之后还写着"3 小时前"）
  check('时间分隔条带上了时间戳（不然没法只改文字）',
    app.$$('#messages .wx-time').every((el) => el.dataset.ts));
}

for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

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
  periodOf,
  sceneTimeClash,
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
  check('⭐ 不再要求她"每隔几轮主动提旧事"（那是"第二段跑题"的来源）',
    !/每隔几轮，主动提一次以前的事/.test(sys)
    && /是"该记得"，不是"该常提"/.test(sys));
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

  // ---- 括号旁白：这一轮**又反转**了 ----
  //
  // 历史：最早一律禁止 → 改成"可以写，但后面必须跟真话" → 又禁止（因为用户
  //   要自己写旁白，怕两边撞车）→ **现在放开**。
  // 为什么这次是放开而不是再禁一遍：禁了两轮，模型照写（"（夹了口菜）"），
  //   而它写的内容本身是对的 —— 错的是把旁白和台词塞进同一个气泡。
  //   现在（见 src/narration.js）旁白会被拆成单独一条、画在**她那一侧**，
  //   所以"她会写括号"从麻烦变成了要的行为。
  check('不再禁止她写括号旁白（改成拆成单独的气泡）',
    !/【绝对不要写括号旁白】/.test(sys) && /【动作、神态、心里想的，写在（）里】/.test(sys));
  check('告诉她括号会**单独显示**（所以放心写）',
    /单独显示成一个小方框/.test(sys) && /和你说的话分开显示/.test(sys));
  check('要求括号里只写动作/神态/环境/心里话，台词写在括号外',
    /不要放你要说的话/.test(sys) && /台词一律写在括号外面/.test(sys));
  check('限制频率：一轮一到两个，别整段都是括号',
    /一到两个就够/.test(sys) && /别整段都是括号/.test(sys));
  check('旧的"禁止 / 你会和他撞车"那套已经删干净',
    !/一个字都不要写/.test(sys) && !/撞在一起/.test(sys)
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
  check('给了情绪落到字面上的规则（语气/标点）',
    /【情绪怎么落在字面上】/.test(sys) && /语气变亮/.test(sys) && /句子变短/.test(sys));
  check('⭐ 情绪只改语气，不能改话量（"开心也不许把话量翻倍"）',
    /情绪是在【这一轮说多少】那个范围里起伏的/.test(sys) && /开心也不许把话量翻倍/.test(sys));
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
    /【多说说你自己】/.test(sys) && /要有一句是\*\*你自己的想法、感受或经历\*\*/.test(sys)
    && /具体说几句看上面【这一轮说多少】/.test(sys));
  check('给了"接一句自己的经历"的具体例子', /我上周也熬到两点/.test(sys));
  check('要求不要每句都提问（别像采访）', /不要每句都在问他问题/.test(sys));
  check('⭐ 篇幅不再写死"每次至少一条 25～40 字"（那条是"每次都长"的根因）',
    !/25～40 字/.test(sys) && !/一般不超过 20 个字/.test(sys));
  check('⭐ 篇幅改由【这一轮说多少】那块说了算',
    /【这一轮说多少】/.test(sys) && /字数是\*\*台词\*\*的字数/.test(sys));

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
  // 条数/字数现在由「她怎么回」那三个设置算出来（见 src/voice.js）：
  // 这一节的 sys 没传 style，所以走默认（250 / 3 条 / 1.0）→ 正常档 = 2 条。
  check('⭐ 条数跟着设置走（默认＝正常档 2 条，不再写死"2-3 条"）',
    /通常 2 条，别超过这个数/.test(sys) && !/通常 2-3 条/.test(sys));
  check('⭐ 字数也跟着设置走（默认＝约 150 字）',
    /一共 \*\*150 字左右\*\*/.test(sys) && /每条大约 75 字/.test(sys));
  check('⭐ 明说"好感度和性格都不会改这几个数字"',
    /好感度和性格都不会改上面的数字/.test(sys)
    && /好感度高 ≠ 话变长/.test(sys) && /性格活泼 ≠ 话变长/.test(sys));
  check('⭐ 明说"不是每一轮都要说满"',
    /不是每一轮都要说满/.test(sys) && /绝对不许为了凑字数硬加内容/.test(sys));
  check('⭐ 性格那一段也指回了话量那块（三个属性各管一件事）',
    /性格改不了话的长度/.test(sys) && /只看【这一轮说多少】那一块/.test(sys));

  // 关键：要的是"长短错落"，不是"每句都变长"
  check('明确要求长短错落（不是一味拉长）',
    /长短要错落/.test(sys) && /短句可以很短/.test(sys) && /别为了错落就硬拉长/.test(sys));
  check('说清了"长短搭配指的是节奏，不是凑一条长句出来"',
    /指的是\*\*节奏\*\*/.test(sys) && /不是让你每次凑一条长句出来/.test(sys));
  check('给了真人发微信的节奏例子',
    /闹钟响三次我全按掉了/.test(sys));
  check('输出格式里也强调了几条要长短搭配',
    /这几条要长短搭配/.test(sys));

  // ---- 这一轮：说话要连贯 + 性格别走极端（用户两条反馈）----
  //
  // 原话：「讲话可以更连贯一点，温柔标签不代表沉默寡言……各个性格维度再试着平衡一下」
  //      「不要总是只说旁白，然后没有对话，需要我再说一句才能有下文」
  check('新增【性格是配比，不是音量键】（性格只改语气，不改话量）',
    /【性格是配比，不是音量键】/.test(sys) && /你怎么说/.test(sys) && /你说多少/.test(sys));
  // ⚠️「温柔是语气，不是音量」那句在人设的**性格标签**里（TRAIT_LINES），
  //    只有选了"温柔"才出现 —— 所以它在 test-persona.mjs 那一段里断言。
  check('⭐ 把六个"容易被演成话少"的标签逐个拆开',
    /温柔 →/.test(sys) && /内向 →/.test(sys) && /慢热 →/.test(sys)
    && /理性 →/.test(sys) && /稳重 →/.test(sys) && /独立 →/.test(sys));
  check('点破那六个标签的坑（会演成话少、冷淡、只会嗯哦好）',
    /话少、冷淡、只会嗯哦好/.test(sys));
  check('反向也管住：活泼/黏人不是每句都要炸',
    /也不是每句都要炸/.test(sys) && /允许有安静的时候/.test(sys));
  check('新增【把话说连贯】（连发 ≠ 三句断片）',
    /【把话说连贯】/.test(sys) && /连发 ≠ 三句断片/.test(sys));
  check('⭐ 禁止连着甩三条互不相干的短句',
    /不许\*\*连着甩三条各自独立的短句/.test(sys) && /那是断片，不是说话/.test(sys));
  check('禁止把一句话硬切成三段凑条数', /把一句话拆成三段/.test(sys));
  check('要求至少有一条把话说完整（发生了什么 + 什么感受）',
    /至少要有一条把话说完整/.test(sys) && /发生了什么 \+ 你什么感受/.test(sys));
  check('给了连贯和不连贯的对照例子',
    /连贯的长这样/.test(sys) && /不连贯（别这样）：嗯 \/ 好累 \/ 今天好烦/.test(sys));
  check('⭐ 要求留得下话头，别说完就停住',
    /留得下话头/.test(sys) && /聊天就断了/.test(sys));
  check('⭐ 旁白不能是这一轮唯一的内容（最后一条必须是话）',
    /旁白不能是这一轮唯一的内容/.test(sys) && /最后一条必须是话/.test(sys)
    && /不能拿旁白收尾/.test(sys));
  // ⭐ 用户特意要求：思考和情绪**不能绑在一起** ——
  //   "思考指的是讲下一句话时的内心想法，而不是有情绪才有思考"
  check('⭐ 内心和情绪是**分开的两块**（没有捆成"两块都要带"）',
    /【每一轮都要写：你的内心】/.test(sys) && /【每一轮都要写：你的情绪】/.test(sys));
  check('⭐ 内心那段明确"和情绪无关、每一轮都要有"',
    /和情绪是两件事/.test(sys) && /每一轮都要有/.test(sys));
  check('⭐ 情绪那段明确"平淡也要写（{}）"',
    /心情平淡也要写/.test(sys) && /\[\[情绪\]\]\{\}/.test(sys));
  check('情绪块终于有格式要求了（以前只有本地兜底在猜）',
    /\[\[情绪\]\]\{"anger":8,"joy":3\}/.test(sys));
  check('说明旁白是配菜（没有它聊天也照样进行）',
    /旁白是配菜/.test(sys) && /没有它，聊天也要照样进行下去/.test(sys));

  // ---- 他问的事必须回答（用户实测的坑："几点了" → 只回"（抬头看墙上的钟）"）----
  check('新增【他在等你的回答】（别拿动作糊弄过去）',
    /【他在等你的回答】/.test(sys) && /别拿动作糊弄过去/.test(sys));
  check('⭐ 点了"他问几点，只回一个看钟的动作"这个真实例子',
    /（抬头看墙上的钟）/.test(sys) && /等于\*\*没回答\*\*/.test(sys));
  check('给了正确示范（先动作、话里带着答案）',
    /（抬头看了一眼墙上的钟）/.test(sys) && /快九点半了，你还不睡？/.test(sys));
  check('⭐ 按"他会怎么问"分了七类',
    /问时间/.test(sys) && /问你现在的状态/.test(sys) && /问你的事/.test(sys)
    && /问你的判断/.test(sys) && /让你做件事/.test(sys) && /问你心情/.test(sys)
    && /一次问了两件事/.test(sys));
  check('问时间要去看【现在的时间】那块再说出来',
    /看提示词最后那块【现在的时间】/.test(sys) && /把时间\*\*说出来\*\*/.test(sys));
  check('⭐ 要求发之前自检"他问的那件事我回答了吗"',
    /发之前自检一遍/.test(sys) && /我在台词里回答了吗/.test(sys));
  check('点名"只回一个表情就完了"也算没回答', /只回一个表情/.test(sys));

  // ---- 旁白要更灵动、动作更丰富 ----
  check('⭐ 要求动作具体、用眼前的东西（别只有笑/愣住）',
    /动作要具体，而且要用到眼前的东西/.test(sys) && /把手机翻过来扣在桌上/.test(sys));
  check('列了场景里能用的道具（被子/耳机/地铁扶手…）',
    /被子、耳机、外卖盒、食堂的盘子、地铁扶手、伞、杯子/.test(sys));
  check('点名不许反复用"笑/愣住/脸红/心跳快"',
    /别老用"笑 \/ 愣住 \/ 脸红 \/ 心跳快"那几个词/.test(sys));
  check('⭐ 动作要跟着情绪走（开心轻快 / 生气重 / 难过变小）',
    /动作还要\*\*跟着情绪走\*\*/.test(sys) && /原地蹦了两下/.test(sys)
    && /把杯子往桌上一放/.test(sys) && /把脸埋进胳膊里/.test(sys));

  // ---- 旁白要"画龙点睛"（用户："不止是简单描述，而是画龙点睛身临其境的感觉"）----
  check('⭐ 要求旁白"画龙点睛"（不是交代一下）',
    /旁白要"画龙点睛"/.test(sys) && /让这一句台词落到一个具体画面上/.test(sys));
  check('⭐ 要求动作接得上他刚说的那句话',
    /动作要接得上他刚说的那句话/.test(sys) && /他在问时间 → 你看钟/.test(sys));
  check('给了可操作标准："这句话能不能拍出来"',
    /这句话能不能拍出来/.test(sys) && /能看见谁在动/.test(sys));
  check('新增【别写"空动作"】块', /【别写"空动作"】/.test(sys));
  check('⭐ 空动作块里点名了"顿住"这种（他实测遇到的）',
    /（顿住）/.test(sys) && /等于白写/.test(sys));
  check('空动作块里给了正例（抬头看了一眼墙上的钟 / 摸手机）',
    /（抬头看了一眼墙上的钟）/.test(sys) && /把床头柜上的手机摸过来/.test(sys));
  check('还给了"心虚/害羞"那一档的动作方向',
    /心虚\/害羞 → 躲开视线/.test(sys) && /低头去拽衣角/.test(sys));
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

  // ⚠️ 内置时钟现在是**全局**的（世界的时间，不是某个好友的属性）——
  //    以前存在每个好友的 config 里，换个好友时间就回到现实了。
  const clockOff = () => Number(JSON.parse(app.window.localStorage.getItem('xiaoyu.global.v1') || '{}').clockOffset) || 0;
  check('拨完之后偏移量存进**全局**那一份（所有好友共用同一个"现在"）',
    clockOff() === 3600000, String(clockOff()));
  check('好友自己的 config 里不再存时间（一处存比散在 N 个好友里干净）',
    !('clockOffset' in JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1') || '{}')));
  check('时钟显示跟着走了', $('#clockNow').textContent !== '—', $('#clockNow').textContent);
  check('说明里写的是**累计**偏移（用户误会过"我拨一小时怎么显示加了 2 天"）',
    /累计/.test($('#clockNote').textContent) && /比现实快/.test($('#clockNote').textContent),
    $('#clockNote').textContent.trim().slice(0, 30));
  check('选择器里的时间也同步跳了',
    new Date($('#clockPick').value).getTime() > Date.now() + 3000000,
    $('#clockPick').value);

  // 直接选一个具体日期时间（模拟用户拨滚轮）
  openPlus();
  const target = new Date(2027, 4, 20, 14, 30, 0, 0);
  $('#clockPick').value = `${target.getFullYear()}-05-20T14:30`;
  $('#clockPick').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  const off = clockOff();
  check('选到哪天就是哪天（年月日时分都算准了）',
    Math.abs(off - (target.getTime() - Date.now())) < 60000, String(Math.round(off / 60000)));

  // 回到现在
  openPlus();
  $('[data-clock="reset"]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('「回到现在」把偏移清零', clockOff() === 0, String(clockOff()));
  check('清零后说明回到默认文案', !/累计/.test($('#clockNote').textContent),
    $('#clockNote').textContent.trim().slice(0, 30));

  // 时间分隔条的文字要跟着改（不然跳一天之后还写着"3 小时前"）
  check('时间分隔条带上了时间戳（不然没法只改文字）',
    app.$$('#messages .wx-time').every((el) => el.dataset.ts));
}

// ---------------------------------------------------------------- [10] 时间感知
console.log('\n[10] 时间感知：他问"几点了"，她得说对（含场景和时间打架的情况）...');
{
  // 用户实测：把内置时间拨到"早上八点多"，她回的还是"快十一点了"。
  // 两个原因都要堵住：
  //   1. 提示词从来没要求过"他问时间就照实念"，模型就凭感觉估了一个数
  //   2. 场景描述里写着"晚上"（人设页写死的初始环境不随时间演变），
  //      模型挑了个自洽的说法 —— 时间是"晚上"，于是"快十一点了"
  check('periodOf 分时段', periodOf(at(10, 8, 0)) === '早上' && periodOf(at(10, 14, 0)) === '下午'
    && periodOf(at(10, 20, 0)) === '晚上' && periodOf(at(10, 23, 30)) === '深夜');

  const t = at(10, 8, 20);
  const txt = describeTime(t);
  check('时间描述里有"现在是几点"', /现在是 2026年3月10日 周二，早上8:20/.test(txt), txt.split('\n')[0]);
  check('⭐ 还给了一句"可以照抄"的口语答案', /现在早上8点20/.test(txt), txt.split('\n')[1]);

  // 用户自己在人设页写的初始环境：会带时间词，而它**不随时间演变**（sceneCustom）
  const eveningScene = { id: 'dorm-evening', text: '晚上在宿舍，刚洗完澡，头发还没干，瘫在椅子上听歌。' };
  const clash = sceneTimeClash(eveningScene.text, t);
  check('⭐ 场景写"晚上"、时间却是早上 → 判定为冲突', /写着"晚上"/.test(clash) && /其实是早上/.test(clash),
    clash.split('\n')[0]);
  check('校正里点明了"你还在同一个地方"', /同一个地方/.test(clash));
  // ⚠️ 这条断言原来是"点名不许说'快十一点了'"——**那条反例本身闯了祸**：
  //    模型把它当成了答案照抄（用户把时钟拨到早上九点，她张口就是"十一点了"）。
  //    所以现在反过来钉：校正里**不许**出现具体的时间词。
  check('⭐ 校正里不许出现具体时间词（负面例子会被当成答案照抄）',
    !/十一点/.test(clash), clash.slice(0, 60));
  check('校正里给了正面做法：照【现在的时间】说、别从聊天记录推断',
    /照【现在的时间】说/.test(clash) && /别从聊天记录里推断/.test(clash));
  check('对得上就不啰嗦（"早上"的场景 + 早上）',
    sceneTimeClash('你刚醒，赖在床上不想起', t) === '');
  check('场景里没有时间词就不管', sceneTimeClash('你在图书馆，摊着书', t) === '');
  check('⭐ 不传时间戳就不判定（老调用点不该因此多出随机提示）',
    sceneTimeClash(eveningScene.text, undefined) === '');

  const sys = buildSystemPrompt({ name: '阿哲' }, {
    scene: eveningScene, timeText: describeTime(t), now: t,
  });
  check('⭐ 时间块是"唯一权威"，而且比聊天记录更硬',
    /【现在的时间】（\*\*唯一权威\*\*，比聊天记录和场景描述都硬）/.test(sys)
    && /这是你唯一的时间来源/.test(sys));
  // ⚠️ 这条**反过来了**：原来钉的是"时间块要在最前面"，结果那正是缓存杀手 ——
  //    时间是分钟级变化的，它排在人设和记忆前面，等于每轮都把后面上万 token 的
  //    前缀缓存废掉（DeepSeek 的缓存按"从第一个 token 起逐字节相同"算）。
  //    现在钉的是反面：时间必须在**易变段**里（【此刻的情况】之后）。
  // 用 lastIndexOf：提示词别处会**引用**这个名字（"看提示词最后那块【现在的时间】"），
  // indexOf 命中的是那句引用。
  const atTime = sys.lastIndexOf('【现在的时间】');
  const atHere = sys.indexOf('【此刻的情况】');
  check('⭐ 时间块在易变段里（不在稳定前缀里）—— 这是省钱的那条线',
    atTime > atHere && atHere > 0,
    `此刻段在第 ${atHere} 字 / 时间块在第 ${atTime} 字`);
  check('⭐ 稳定前缀够长（人设 + 记忆 + 规则都在里面）',
    atHere > sys.length * 0.6,
    `稳定前缀 ${atHere} 字 / 全文 ${sys.length} 字`);
  check('⭐ 明说"哪怕上一轮刚说过另一个时间"（用户实测：拨了时间她还在沿用旧的）',
    /哪怕上一轮你刚说过另一个时间/.test(sys));
  check('⭐ 明确要求"他问时间就照实说"', /他问时间就照实说/.test(sys) && /照着上面那一行念/.test(sys));
  check('⭐ 明确禁止自己估一个数、也禁止沿用上一轮说过的',
    /绝对不许自己估一个数/.test(sys) && /不要沿用上一轮说过的那个时间/.test(sys));
  check('要求她此刻的状态和时间对得上（早上八点不该瘫在椅子上听歌）',
    /早上八点该是刚醒/.test(sys) && /不该"瘫在椅子上听歌"/.test(sys));
  check('⭐ 冲突时把校正写进了提示词', /现在其实是早上/.test(sys));
  check('要求场景里提到的时间一律以时间为准',
    /以这里为准/.test(sys) && /场景只说明你在\*\*哪儿\*\*/.test(sys));

  // 端到端：真的通过 app 走一遍（虚拟时钟 → 提示词）
  const offset = t - Date.now();
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': {
        msgCount: 20,
        sceneId: 'dorm-evening',
        sceneText: '晚上在宿舍，刚洗完澡，头发还没干，瘫在椅子上听歌。',
        sceneAt: t - 3600000,
        sceneCustom: true,     // 人设页写死的初始环境：不随时间演变（就是踩坑那种）
      },
      'xiaoyu.config.v1': { personaDone: true, clockOffset: offset, herRelation: '恋人' },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  await app.send('几点了');

  const sent = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('⭐ 端到端：拨到早上八点后，提示词里真的是早上八点',
    /早上8:20/.test(sent), (sent.match(/现在是 [^\n]*/) || [''])[0]);
  check('⭐ 端到端：场景和时间打架时，校正也进了这一轮的提示词',
    /现在其实是早上/.test(sent));
  check('端到端：可抄的那句答案也在', /现在早上8点20/.test(sent));
}

for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

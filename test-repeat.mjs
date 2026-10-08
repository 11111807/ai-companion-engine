/**
 * 「她最近老在说同一件事」的测试。
 *
 * 针对用户需求：
 *   "她的第二段话总是反复强调与当前环境事情无关的事情，比如现在正在做某些事情，
 *    但是她的回答总是在第二段反复强调明天要早起，这样显得比较出戏。"
 *   补充："反复强调事情不止是在对话里，在思考内容也有所体现。"
 *
 * 这个模块只做一件事：从她最近几轮的话**和内心**里，找出反复出现的片段，
 * 交给提示词让她这轮别再提。纯函数，不碰 DOM。
 */

import { repeatedTopics, repeatBlock } from './src/repeat.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const line = (content, extra = {}) => ({ role: 'assistant', content, ...extra });
const said = (content) => ({ role: 'user', content });

// ---------------------------------------------------------------- 1) 抓得住
console.log('\n[1] 跨轮反复提到的事要被抓出来 ...');
{
  const msgs = [
    said('在干嘛'),
    line('在赶作业呢'),
    said('哦'),
    line('你明天要早起吧，早点睡', { think: '明天要早起，我是不是也该睡了' }),
    said('嗯'),
    line('那我先睡了，明天要早起', { think: '明天要早起啊' }),
  ];
  const t = repeatedTopics(msgs);
  check('⭐ 抓到了「明天要早起」（用户举的那个例子）',
    t.some((x) => x.text === '明天要早起'), JSON.stringify(t));
  check('记着它出现在几轮里', t.find((x) => x.text === '明天要早起')?.hits === 2,
    String(t.find((x) => x.text === '明天要早起')?.hits));
  check('只列一条（它的半截兄弟不重复列）',
    t.filter((x) => x.text.includes('明天要早起') || '明天要早起'.includes(x.text)).length === 1,
    JSON.stringify(t.map((x) => x.text)));
}

// ---------------------------------------------------------------- 2) 内心也算
console.log('\n[2] 内心独白里反复想的同一件事，同样算 ...');
{
  // 台词每轮都不一样，但**心里**一直在惦记同一件事
  const msgs = [
    said('a'),
    line('好呀', { think: '明天要早起，不能聊太晚' }),
    said('b'),
    line('嗯嗯', { think: '明天要早起啊，得睡了' }),
  ];
  const t = repeatedTopics(msgs);
  check('⭐ 只有内心重复也能抓到（用户特意补过这一条）',
    t.some((x) => x.text === '明天要早起'), JSON.stringify(t));
}

// ---------------------------------------------------------------- 3) 别误报
console.log('\n[3] 不该报的别报 ...');
{
  check('只有一轮 → 不算"反复"',
    repeatedTopics([said('a'), line('明天要早起')]).length === 0);
  check('同一轮里说两遍 → 也不算（那只是同一次表达里的重复）',
    repeatedTopics([line('明天要早起'), line('明天要早起啊')]).length === 0);
  check('⭐ 旁白不算（旁白有自己的防复读）',
    repeatedTopics([
      line('明天要早起', { narr: true }),
      said('x'),
      line('明天要早起', { narr: true }),
    ]).length === 0);
  check('零散虚词不算（"我觉得"这类不进结果）',
    repeatedTopics([
      said('a'), line('我觉得还行吧'),
      said('b'), line('我觉得不太行'),
    ]).every((x) => x.text !== '我觉得'));
  check('空值不炸',
    repeatedTopics(null).length === 0 && repeatedTopics([]).length === 0
    && repeatedTopics(undefined).length === 0);
  check('消息里有空内容也不炸',
    repeatedTopics([line(''), { role: 'assistant' }, null, said('a')]).length === 0);
}

// ---------------------------------------------------------------- 4) 上限与排序
console.log('\n[4] 出现轮数多的排前面，最多列几条 ...');
{
  const msgs = [];
  for (let i = 0; i < 4; i++) {
    msgs.push(said(`第${i}句`));
    msgs.push(line('明天要早起，得睡了'));
  }
  for (let i = 0; i < 2; i++) {
    msgs.push(said(`再${i}句`));
    msgs.push(line('那个项目怎么样了'));
  }
  const t = repeatedTopics(msgs);
  check('出现 4 轮的那条排在出现 2 轮的前面',
    t.length >= 2 && t[0].hits >= t[1].hits, JSON.stringify(t));
  check('最多 3 条（别把提示词撑爆）', t.length <= 3, String(t.length));
  check('可以限制看最近几轮',
    repeatedTopics(msgs, { rounds: 2 }).length <= 3);
}

// ---------------------------------------------------------------- 5) 提示词
console.log('\n[5] 进提示词的那一段 ...');
{
  check('什么都没抓到 → 空串（新用户不塞一段空的进去）',
    repeatBlock([]) === '' && repeatBlock(null) === '' && repeatBlock() === '');
  const block = repeatBlock(repeatedTopics([
    said('a'), line('你明天要早起吧', { think: '明天要早起' }),
    said('b'), line('早点睡，明天要早起', { think: '明天要早起啊' }),
  ]));
  check('列了原文', block.includes('明天要早起'));
  check('⭐ 明说"话里别提、心里也别再想了"（用户补的那一条）',
    /话里别提、心里也别再想了/.test(block));
  check('⭐ 说明白了"凑不出第二条就只发一条"（第二段跑题的根子）',
    /凑不出第二条就\*\*只发一条\*\*/.test(block));
  check('也允许她忽略误报',
    /碰巧重复的零碎词/.test(block));
  check('字符串数组也收（测试里好写）',
    repeatBlock(['明天要早起']).includes('明天要早起'));
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

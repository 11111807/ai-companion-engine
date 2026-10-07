/**
 * 「相处习惯」的测试
 *
 * 针对用户反馈：他说了很多次"（抱住）"，她心情好的时候还回"（愣住）""（没躲）"，
 * 非常生硬。应该随熟悉度演变，甚至主动一点（"（反手抱住）"）。
 */

import { extractActions, groupOf, countActions, habitsBlock } from './src/habits.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });

// ---------------------------------------------------------------- 1) 抽动作
console.log('\n[1] 从他的话里抽括号动作 ...');
{
  check('中文括号', extractActions('（抱住）').join() === '抱住');
  check('英文括号也认', extractActions('(摸摸头)').join() === '摸摸头');
  check('一句话里多个', extractActions('（抱住）（蹭了蹭）').length === 2);
  check('没括号就是空的', extractActions('今天好累').length === 0);
  check('空输入不炸', extractActions('').length === 0 && extractActions(null).length === 0);
  check('太长的括号不当动作（那多半是旁白句子，不是动作）',
    extractActions('（他今天怎么突然说这个我有点搞不懂他到底想干嘛）').length === 0);
  check('但短动作能正常抽出来', extractActions('（愣住）').join() === '愣住');
}

// ---------------------------------------------------------------- 2) 同义归类
console.log('\n[2] 同义动作归到一组 ...');
{
  const g = (s) => groupOf(s);
  check('抱住 / 抱抱 / 抱紧 / 搂住 都归到「抱住」',
    g('抱住') === '抱住' && g('抱抱') === '抱住' && g('抱紧') === '抱住' && g('搂住') === '抱住',
    ['抱住', '抱抱', '抱紧', '搂住'].map((x) => `${x}→${g(x)}`).join(' '));
  check('摸头 / 摸摸头 / 揉头 归到「摸头」',
    g('摸头') === '摸头' && g('摸摸头') === '摸头' && g('揉头') === '摸头');
  check('亲亲 / 亲一下 / 吻 归到「亲亲」',
    g('亲亲') === '亲亲' && g('吻') === '亲亲');
  check('没见过的动作保留原词（去掉时态字）', g('敲了下桌子') === '敲下桌子', g('敲了下桌子'));
}

// ---------------------------------------------------------------- 3) 统计
console.log('\n[3] 统计他做过哪些动作 ...');
{
  const msgs = [
    u('（抱住）'),
    a('（愣住）…你干嘛'),
    u('今天好累'),
    u('（抱抱）'),
    u('（摸摸头）'),
    u('（抱住）'),
  ];
  const c = countActions(msgs);
  check('「抱住」统计到 3 次（抱住+抱抱+抱住）', c.get('抱住') === 3, `实际 ${c.get('抱住')}`);
  check('「摸头」统计到 1 次', c.get('摸头') === 1, `实际 ${c.get('摸头')}`);
  check('**只统计他做的动作**，不统计她的旁白', !c.has('愣住'), [...c.keys()].join(','));
}

// ---------------------------------------------------------------- 4) 生成给模型的段落
console.log('\n[4] 生成「相处习惯」段落 ...');
{
  // 只做过一次 → 还不算习惯
  const once = [u('（抱住）'), a('（愣住）')];
  check('只做过一次时不输出（还不算习惯）', habitsBlock(once) === '');

  // 做过多次 → 输出
  const many = [];
  for (let i = 0; i < 6; i++) {
    many.push(u('（抱住）'));
    many.push(a('（愣住）…你干嘛'));
  }
  many.push(u('（摸摸头）'));
  many.push(a('嗯'));

  const block = habitsBlock(many);
  check('做过很多次就输出习惯段', block.length > 0);
  // 次数故意用模糊词 —— 精确数字容易被当成台词念出来
  //（用户反馈："你以前也这么说过，而且出现过很多次"，很生硬）
  check('次数用模糊表述，不写具体数字', /「抱住」：经常/.test(block),
    (block.match(/- 「抱[^\n]*/) || [''])[0]);
  check('明确说这是背景知识、不是台词',
    /上面这些是\*\*背景知识，不是台词\*\*/.test(block));
  check('明确禁止把"次数"说出口', /不要把"次数""你老是这样"/.test(block));
  check('次数少的排在后面', (() => {
    const i6 = block.indexOf('抱住');
    const i1 = block.indexOf('摸头');
    return i6 >= 0 && (i1 < 0 || i6 < i1);
  })());
  check('明确要求别再给「第一次」的反应',
    /不要再给"（愣住）""（没躲）""（脸红）"/.test(block));
  check('点名了那几个生硬的词', /愣住/.test(block) && /没躲/.test(block));
  check('给了"熟悉之后"的样子', /往他怀里靠了靠/.test(block) && /反手抱住/.test(block));
  check('要求结合心情（心情好更黏 / 生气可以冷）',
    /心情好的时候更黏/.test(block) && /生着气.*冷淡/.test(block));
  check('要求别每次都说同一句', /换个说法|换一个说法/.test(block));
}

// ---------------------------------------------------------------- 5) 用户举的例子
console.log('\n[5] 用户举的例子：他反复说「（抱住）」 ...');
{
  const msgs = [
    u('（抱住）'), a('（愣住）…你干嘛'),
    u('（抱住）'), a('（没躲）'),
    u('（抱住）'), a('（没躲）'),
    u('（抱住）'), a('（愣住）'),
    u('（抱住）'), a('（没躲）'),
  ];
  const c = countActions(msgs);
  check('统计出「抱住」5 次', c.get('抱住') === 5, `${c.get('抱住')} 次`);

  const block = habitsBlock(msgs);
  check('提示词里标出了这个动作（用模糊次数）', /「抱住」：经常/.test(block),
    (block.match(/- 「抱[^\n]*/) || [''])[0]);
  check('并且要求她别再愣住 / 没躲', /不要再给[\s\S]{0,30}愣住/.test(block), '');
  check('没把精确次数"5 次"写进去（免得被复述）', !/5 次/.test(block), '');
}

// ---------------------------------------------------------------- 6) 边界
console.log('\n[6] 边界情况 ...');
{
  check('空历史返回空串', habitsBlock([]) === '');
  check('全是寒暄没有动作时返回空串', habitsBlock([u('在吗'), a('在'), u('嗯')]) === '');
  check('她的动作不算进"他的习惯"',
    habitsBlock([a('（抱住）'), a('（抱住）'), a('（抱住）')]) === '');
  check('minCount 可调', (() => {
    const msgs = [u('（抱住）'), u('（抱住）')];
    return habitsBlock(msgs, { minCount: 3 }) === '' && habitsBlock(msgs, { minCount: 2 }).length > 0;
  })());
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

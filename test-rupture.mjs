/**
 * 破裂与修复（分手/绝交 → 道歉 → 和好）的测试。
 *
 * 用户的两条需求（原话）：
 *   "故意说话让她伤心，并提出绝交/分手，她的情绪监测显示 50% 伤心，
 *    但好感度变化并不明显，而且立马提出和好也会立马答应，人类管这个叫'舔狗'。
 *    我希望和好是一个需要过程的，道歉，送礼，安慰等等。"
 *   "我犯下错误导致分手，可以让好感度增长变的更慢。"
 *
 * 另外还测"负面情绪与拒绝"那条：她要会说"不"，被逼时更犟而不是妥协。
 */

import { turn, drift, ruptureShift, ruptureBlock, AMEND_NEED, levelOf } from './src/affection.js';
import { buildSystemPrompt } from './src/persona.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

/** 连着说几句话，返回每一步的 profile */
const run = (start, lines) => {
  let p = { affection: 80, rupture: false, amends: 0, scar: 0, ...start };
  const out = [];
  for (const t of lines) { const r = turn(p, t); p = { ...p, ...r }; out.push({ t, ...r }); }
  return out;
};

// ---------------------------------------------------------------- 1) 破裂要有代价
console.log('\n[1] 说分手要**明显**掉好感度（原来只扣 3，聊十句就回来了）...');
{
  const before = 80;
  const after = turn({ affection: before }, '我们分手吧').affection;
  check('⭐ 一句分手砸掉一大截（≥20 点）', before - after >= 20, `${before} → ${Math.round(after)}`);
  check('而且进入破裂状态', turn({ affection: before }, '我们分手吧').rupture === true);
  check('普通拌嘴只扣一点点（跟分手不是一个量级）',
    before - turn({ affection: before }, '你真讨厌').affection < 8);
}

// ---------------------------------------------------------------- 2) 破裂期不升温
console.log('\n[2] 没修好之前，聊再多也不升温 ...');
{
  const p = { affection: 55, rupture: true };
  check('⭐ 破裂期说甜话也不涨', turn(p, '我想你了').affection === 55);
  check('⭐ 破裂期普通聊天也不涨', turn(p, '今天天气不错').affection === 55);
  check('（对照）没破裂时普通聊天会缓慢升温', drift(50, '今天天气不错') > 50);
}

// ---------------------------------------------------------------- 3) 和好要过程
console.log('\n[3] 和好需要过程：道歉 + 送礼 + 安慰，一次不够 ...');
{
  const steps = run({ affection: 60 }, [
    '我们分手吧',
    '对不起我错了',      // 道歉 +2
    '我给你买了个礼物',   // 送礼 +3
    '我陪你聊会儿吧',     // 安慰 +2 → 够了
  ]);
  check('⭐ 光道歉一次不能和好', steps[1].rupture === true && steps[1].event === 'amend',
    `amends=${steps[1].amends}`);
  check('⭐ 攒够诚意（' + AMEND_NEED + '）才修好', steps[3].event === 'heal' && !steps[3].rupture,
    `amends=${steps[3].amends}`);
  check('⭐ 修好也只是"缓过来"，不是回到从前（那 −25 不全额返还）',
    steps[3].affection < 80, `分手前 80 → 和好后 ${Math.round(steps[3].affection)}`);
  check('中途又在提分手 → 诚意清零（等于把道歉全推翻）',
    run({ affection: 60 }, ['我们分手吧', '对不起', '我们分手吧'])[2].amends === 0);
}

// ---------------------------------------------------------------- 4) 疤痕
console.log('\n[4] 犯过错的关系，升温更慢（用户："增长变的更慢"）...');
{
  const clean = drift(50, '今天天气不错', { scar: 0 });
  const hurt = drift(50, '今天天气不错', { scar: 1 });
  const hurt2 = drift(50, '今天天气不错', { scar: 2 });
  check('⭐ 有一道疤 → 升温明显变慢', hurt < clean && hurt > 50,
    `干净 ${clean.toFixed(2)} / 一道疤 ${hurt.toFixed(2)}`);
  check('疤越多越慢', hurt2 < hurt, `两道疤 ${hurt2.toFixed(2)}`);
  check('分手会留下疤', run({ affection: 70 }, ['我们分手吧'])[0].scar === 1);
  check('疤最多 3 道（不会无限慢）',
    run({ affection: 70, scar: 3 }, ['我们分手吧'])[0].scar === 3);
}

// ---------------------------------------------------------------- 5) 别误伤
console.log('\n[5] 别把"否认"和"聊电影"当成分手 ...');
{
  const safe = ['我不会跟你分手', '别说什么分手', '我们不可能分手的', '谁要跟你分手啊',
    '今天结束了工作', '这部电影的结局分手了', '这个项目到此为止了',
    '我们滚去睡觉吧', '我快累死了好烦'];
  for (const t of safe) {
    const r = turn({ affection: 70 }, t);
    check(`不误伤：${t}`, r.affection >= 69.9 && !r.rupture, String(Math.round(r.affection)));
  }
  const real = ['我们分手吧', '那绝交吧', '我拉黑你了', '我们结束了'];
  for (const t of real) check(`真分手认得出：${t}`, turn({ affection: 70 }, t).rupture === true);
}

// ---------------------------------------------------------------- 6) 提示词
console.log('\n[6] 闹翻之后她的态度（提示词）...');
{
  const broke = buildSystemPrompt({ name: '阿哲' }, {
    affection: 40, relation: '恋人', herName: '小雨', rupture: true, amends: 0,
  });
  check('⭐ 闹翻时注入【你们刚闹翻了】', /【你们刚闹翻了】/.test(broke));
  check('⭐ 明说"不要马上原谅他"', /不要\*\*马上原谅\*\*/.test(broke) || /马上原谅/.test(broke));
  check('⭐ 点名"哄两句就好了"就是舔狗',
    /舔狗/.test(broke) && /绝对不要\*\*因为他哄了两句/.test(broke));
  check('并且压过其他关于温柔的要求', /压过\*\*前面所有关于"温柔"/.test(broke));
  check('没有闹翻时不注入', !/【你们刚闹翻了】/.test(buildSystemPrompt({}, { affection: 60 })));

  const warm = ruptureBlock(4);
  check('诚意攒到一半时，她的态度会松一点（但还端着）',
    /你已经有点动摇了/.test(warm) && /别让他看出来/.test(warm));
}

// ---------------------------------------------------------------- 7) 拒绝与负面情绪
console.log('\n[7] 她会说"不"，被逼时更犟不是妥协 ...');
{
  const sys = buildSystemPrompt({ name: '阿哲' }, {
    affection: 60, relation: '朋友', herName: '小雨',
  });
  check('⭐ 有【你也有说"不"的权利】', /【你也有说"不"的权利】/.test(sys));
  check('⭐ 被强迫时"绝对不要妥协"、越逼越犟', /被强迫的时候绝对不要妥协/.test(sys)
    && /你会\*\*更犟\*\*/.test(sys));
  check('但也不能总是拒绝（十次里一两次）', /十次里拒一两次/.test(sys));
  check('⭐ 拒绝能力跟好感度挂钩',
    /好感度会改这个/.test(sys) && /好感度高\*\*时你更容易心软/.test(sys)
    && /好感度低\*\*时你更客气、更设防/.test(sys));
  check('⭐ 情绪块要求"别总是正向"（负面情绪该高就高）',
    /别总是正向/.test(sys) && /sad 和 anger 都拉到 50 以上/.test(sys)
    && /他逼你做不想做的事 → anger \+ anxious/.test(sys));
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

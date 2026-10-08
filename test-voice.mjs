/**
 * 「她怎么回」那三个设置（回复长度 / 连发条数 / 活泼程度）的测试。
 *
 * 针对用户需求：
 *   "活泼程度是不是和对话不挂钩了，再平衡一下各个属性的影响，
 *    我选择安静，也会显得比较话痨，好感度高时热情也不能每次说一大长串。"
 *
 * 查出来的事实是**真的不挂钩**：三个设置里没有一个是进提示词的
 * （长度只当 max_tokens、条数只在切分时生效、活泼程度只当 temperature）。
 * 所以这个文件盯的就是"它们现在进提示词了，而且是可解释地进"。
 */

import { voiceOf, toneOf, voiceBlock, voiceHint, voiceFlowBlock } from './src/voice.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

// ---------------------------------------------------------------- 1) 档位
console.log('\n[1] 活泼程度 → 劲头档位 ...');
{
  check('设置里的三个值各归各档',
    toneOf(0.7).key === 'quiet' && toneOf(1.0).key === 'normal' && toneOf(1.3).key === 'lively',
    [0.7, 1.0, 1.3].map((v) => toneOf(v).key).join(' / '));
  check('档位名字是给人看的（安静 / 正常 / 很跳）',
    toneOf(0.7).label === '安静' && toneOf(1.3).label === '很跳');
  check('不传 / NaN / 字符串都退回"正常"（老配置不会炸）',
    toneOf().key === 'normal' && toneOf(NaN).key === 'normal'
    && toneOf(undefined).key === 'normal' && toneOf('1.3').key === 'lively');
  check('极端值也归到两头，不会返回空',
    toneOf(0).key === 'quiet' && toneOf(99).key === 'lively');
}

// ---------------------------------------------------------------- 2) 条数
console.log('\n[2] 条数：他调的那个是硬上限，劲头档位是基准 ...');
{
  check('安静 + 话痨(3 条) → 还是 1 条（用户点名的"选安静也话痨"）',
    voiceOf({ temperature: 0.7, burst: 3, maxTokens: 250 }).lines === 1);
  check('正常 + 正常(2 条) → 2 条', voiceOf({ temperature: 1.0, burst: 2 }).lines === 2);
  check('很跳 + 话痨(3 条) → 3 条', voiceOf({ temperature: 1.3, burst: 3 }).lines === 3);
  check('很跳但他只让发一条 → 1 条（他的设置优先）',
    voiceOf({ temperature: 1.3, burst: 1 }).lines === 1);
  check('正常 + 他只让发一条 → 1 条', voiceOf({ temperature: 1.0, burst: 1 }).lines === 1);
  check('条数坏值兜得住（0 / 负数 / 小数 / 空）',
    voiceOf({ burst: 0 }).lines === 1 && voiceOf({ burst: -5 }).lines === 1
    && voiceOf({ burst: 2.6 }).lines === 2 && voiceOf({ burst: null }).lines === 1);
  check('不传设置 → 适中 / 2 条 / 正常（和以前的默认一致）', voiceOf().lines === 2);
}

// ---------------------------------------------------------------- 3) 字数
console.log('\n[3] 字数：长度设置 × 劲头系数 ...');
{
  const at = (o) => voiceOf(o).total;
  check('适中(250) + 正常 → 150 字', at({ maxTokens: 250, temperature: 1 }) === 150, String(at({ maxTokens: 250, temperature: 1 })));
  check('⭐ 同一长度下，"安静"比"正常"明显短（这才是"挂钩"）',
    at({ maxTokens: 250, temperature: 0.7 }) === 90
    && at({ maxTokens: 250, temperature: 0.7 }) < at({ maxTokens: 250, temperature: 1 }),
    `${at({ maxTokens: 250, temperature: 0.7 })} < ${at({ maxTokens: 250, temperature: 1 })}`);
  check('同一长度下，"很跳"比"正常"长一点（但不夸张）',
    at({ maxTokens: 250, temperature: 1.3 }) === 175, String(at({ maxTokens: 250, temperature: 1.3 })));
  check('很短(120) + 安静 → 45 字（真的能调出"话少"）',
    at({ maxTokens: 120, temperature: 0.7 }) === 45, String(at({ maxTokens: 120, temperature: 0.7 })));
  check('长一点(500) + 很跳 → 345 字',
    at({ maxTokens: 500, temperature: 1.3 }) === 345, String(at({ maxTokens: 500, temperature: 1.3 })));
  check('三档长度都单调（越长设置说得越多）',
    at({ maxTokens: 120, temperature: 1 }) < at({ maxTokens: 250, temperature: 1 })
    && at({ maxTokens: 250, temperature: 1 }) < at({ maxTokens: 500, temperature: 1 }));
  check('字数坏值兜得住（0 / 负数 / NaN 都有下限，不会变成 0 字）',
    at({ maxTokens: 0 }) >= 10 && at({ maxTokens: -100 }) >= 10 && at({ maxTokens: NaN }) === 150);
  check('每条的估算是总数除条数',
    voiceOf({ maxTokens: 250, temperature: 1 }).per === 75
    && voiceOf({ maxTokens: 250, temperature: 0.7 }).per === 90);
}

// ---------------------------------------------------------------- 4) 给用户看的一行
console.log('\n[4] 设置页上那行提示（让他看得见"挂钩"） ...');
{
  const hint = voiceHint(voiceOf({ temperature: 0.7, maxTokens: 250, burst: 3 }));
  check('⭐ 一行说清：档位 · 几条 · 约多少字', hint === '安静 · 1 条 · 约 90 字', hint);
  check('换个设置这行就变',
    voiceHint(voiceOf({ temperature: 1.3, maxTokens: 500, burst: 3 })) === '很跳 · 3 条 · 约 345 字');
}

// ---------------------------------------------------------------- 5) 提示词
console.log('\n[5] 进提示词的那一段 ...');
{
  const v = voiceOf({ temperature: 0.7, maxTokens: 250, burst: 3 });
  const block = voiceBlock(v);
  check('把这一轮的字数和条数写成硬要求',
    block.includes('90 字') && /就发 \*\*1 条\*\*/.test(block), block.split('\n')[1]);
  check('多条的写法会说清每条多少字',
    /每条大约 75 字/.test(voiceBlock(voiceOf({ temperature: 1, maxTokens: 250, burst: 2 }))));
  check('⭐ 明确"好感度和性格都不改这些数字"（用户："好感度高也不能每次一大长串"）',
    /好感度和性格都不会改上面的数字/.test(block)
    && /好感度高 ≠ 话变长/.test(block) && /性格活泼 ≠ 话变长/.test(block));
  check('⭐ 明确"不是每一轮都要说满"（旧提示词是"每轮至少一条 25~40 字"）',
    /不是每一轮都要说满/.test(block) && /绝对不许为了凑字数硬加内容/.test(block));
  check('字数是台词的，不许拿旁白凑', /旁白（（）里）和"内心"不算/.test(block));
  check('说了说完就停（防反复补充）', /说完了就停/.test(block));
  check('三档都带自己的语气说明',
    /安静：话不多/.test(voiceBlock(voiceOf({ temperature: 0.7 })))
    && /正常的微信节奏/.test(voiceBlock(voiceOf({ temperature: 1 })))
    && /话多、语气跳/.test(voiceBlock(voiceOf({ temperature: 1.3 }))));
  check('⭐ "安静"不许退化成"嗯哦好"（和"温柔≠沉默"那条一致）',
    /安静不是敷衍/.test(block));
  check('空值不炸', typeof voiceBlock(voiceOf({})) === 'string' && voiceBlock(voiceOf({})).length > 50);

  // 用户实测"选了很短 + 安静，依旧话太长" → 光写"大约多少字"不够，
  // 得写成硬上限，并且给一个数得出来的反面例子（模型对例子最敏感）。
  check('⭐ 写成**硬上限**，不是"大约"（用户："依旧话太长"）',
    /最多不超过 60 字/.test(voiceBlock(voiceOf({ temperature: 0.7, maxTokens: 120 })))
    && /这是硬限制，不是建议/.test(block)
    && !/是大概的量，不是任务/.test(block));
  check('⭐ 给了"太长"的反面例子，并且数得出来',
    /反面例子/.test(block) && /八十多个字/.test(block));
  check('⭐ 明说"第二条不许跑题，凑不出来就只发一条"（第二段跑题的根子）',
    /第二条不许跑题/.test(block) && /凑不出来就只发一条/.test(block));
}

// ---------------------------------------------------------------- 6) 组织方式
console.log('\n[6] 连发的规矩只在真的连发时讲 ...');
{
  // 旧提示词里"你一次会发 2-3 条""至少要有一条把话说完整"是**每轮都在念**的，
  // 所以哪怕调成"安静 + 一条"，提示词还在催她凑第二条 ——
  // 这就是"第二段硬塞一句不相干的话"的来源。
  const one = voiceFlowBlock(voiceOf({ temperature: 0.7, maxTokens: 120, burst: 2 }));
  const many = voiceFlowBlock(voiceOf({ temperature: 1, maxTokens: 250, burst: 2 }));

  check('⭐ 一条的档位不再讲"连发"', /【这一条怎么说】/.test(one) && !/连发/.test(one));
  check('一条的档位明确"不要为了有第二条硬凑"', /不要为了"有第二条"硬凑/.test(one));
  check('一条的档位也报字数上限', /45 字以内/.test(one), one.split('\n')[2]);
  check('多条的档位才讲连发和连贯',
    /【把话说连贯】/.test(many) && /连发 ≠ 三句断片/.test(many));
  check('⭐ 多条时也明说"第 2 条不许跑题"', /第 2 条不许跑题/.test(many));
  check('空值不炸', typeof voiceFlowBlock(voiceOf({})) === 'string');
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

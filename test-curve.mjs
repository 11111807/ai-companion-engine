/**
 * 记忆曲线（艾宾浩斯遗忘曲线）的测试
 *
 * 针对用户需求："反复提到的、重要的深刻的事情永久记住；
 * 稍微不那么重要的，可以适当遗忘"。
 */

import {
  halfLifeDays, retention, isPermanent, newMeta, touchMeta, decayFacts,
  strengthLabel, strengthPercent, PERMANENT_HITS, FORGET_BELOW,
} from './src/memory.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const DAY = 86400000;
const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------- 1) 半衰期
console.log('\n[1] 复习次数越多，忘得越慢 ...');
{
  const hl = [1, 2, 3, 4, 5, 6, 7].map((h) => halfLifeDays(h));
  check('半衰期随复习次数递增', hl.every((v, i) => i === 0 || v >= hl[i - 1]), hl.join(' / ') + ' 天');
  check('第 1 次记住 ≈ 1 天忘一半', halfLifeDays(1) === 1, `${halfLifeDays(1)} 天`);
  check('复习到 3 次 ≈ 7 天', halfLifeDays(3) === 7, `${halfLifeDays(3)} 天`);
  check('复习到 5 次 ≈ 35 天', halfLifeDays(5) === 35, `${halfLifeDays(5)} 天`);
  check('复习 7 次以上就很牢了', halfLifeDays(7) >= 180, `${halfLifeDays(7)} 天`);
}

// ---------------------------------------------------------------- 2) 保留度
console.log('\n[2] 保留度随时间下降 ...');
{
  const m1 = newMeta(T0);                      // 只记过 1 次
  check('刚记住时是 100%', retention(m1, T0) === 1);
  check('1 天后剩一半左右',
    Math.abs(retention(m1, T0 + DAY) - 0.5) < 0.02,
    (retention(m1, T0 + DAY) * 100).toFixed(0) + '%');
  check('越久越低', retention(m1, T0 + 5 * DAY) < retention(m1, T0 + 2 * DAY));

  // 复习过的：同样过 5 天，剩得多
  let m5 = newMeta(T0);
  for (let i = 0; i < 4; i++) m5 = touchMeta(m5, T0);   // 复习到 5 次
  check('复习过的衰减明显更慢',
    retention(m5, T0 + 5 * DAY) > retention(m1, T0 + 5 * DAY) * 3,
    `复习 5 次 ${(retention(m5, T0 + 5 * DAY) * 100).toFixed(0)}% vs 只记 1 次 ${(retention(m1, T0 + 5 * DAY) * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------- 3) 永久记忆
console.log('\n[3] 永久记忆 ...');
{
  let m = newMeta(T0);
  for (let i = 0; i < PERMANENT_HITS; i++) m = touchMeta(m, T0);
  check(`复习到 ${PERMANENT_HITS} 次就是永久`, isPermanent(m), `hits=${m.hits}`);
  check('永久记忆放一年也还是 100%', retention(m, T0 + 365 * DAY) === 1);

  const pinned = newMeta(T0, { pinned: true });
  check('手动加的（钉住的）也是永久', isPermanent(pinned));
  check('钉住的放一年也 100%', retention(pinned, T0 + 365 * DAY) === 1);
}

// ---------------------------------------------------------------- 4) 淘汰
console.log('\n[4] 该忘的忘掉，该留的留下 ...');
{
  // 「他每天下班自己做饭」——反复提到，复习到永久
  let cooking = newMeta(T0);
  for (let i = 0; i < 6; i++) cooking = touchMeta(cooking, T0);
  // 「他今天中午吃了拉面」——只提过一次
  const ramen = newMeta(T0);

  const facts = ['他每天下班自己做饭', '他今天中午吃了拉面'];
  const meta = { '他每天下班自己做饭': cooking, '他今天中午吃了拉面': ramen };

  // 过 10 天
  const r = decayFacts(facts, meta, T0 + 10 * DAY);
  check('天天做饭的习惯留下了（复习够了）',
    r.kept.includes('他每天下班自己做饭'), r.kept.join(' | '));
  check('只提过一次的拉面被淡忘',
    r.forgotten.includes('他今天中午吃了拉面'), r.forgotten.join(' | '));

  // 只过 1 天：都还在
  const r2 = decayFacts(facts, meta, T0 + DAY);
  check('才过 1 天，什么都还没忘', r2.forgotten.length === 0);
}

// ---------------------------------------------------------------- 5) 一次别忘太多
console.log('\n[5] 一次不会忘掉一大片 ...');
{
  const facts = [];
  const meta = {};
  for (let i = 0; i < 20; i++) {
    const f = `久远的小事${i}`;
    facts.push(f);
    meta[f] = newMeta(T0);           // 全都一年没提过
  }
  const r = decayFacts(facts, meta, T0 + 365 * DAY);
  check('一次最多忘 3 条（防止一口气清空）', r.forgotten.length <= 3, `忘了 ${r.forgotten.length} 条`);
  check('也没全留下（确实在遗忘）', r.forgotten.length > 0, `忘了 ${r.forgotten.length} 条`);
}

// ---------------------------------------------------------------- 6) 新记忆默认活着
console.log('\n[6] 边界情况 ...');
{
  const r = decayFacts(['刚记的事'], {}, T0);
  check('没有元数据的新记忆当成刚记住，不会被淘汰',
    r.kept.includes('刚记的事') && r.forgotten.length === 0);
  check('空列表不炸', decayFacts([], {}, T0).kept.length === 0);
  check('空列表 + 空 meta 不炸', decayFacts([], null, T0).forgotten.length === 0);

  // 时间倒流（用户把内置时钟往回拨）也不该崩
  const m = newMeta(T0 + 10 * DAY);
  check('时间倒流时保留度仍是 100%（不会算成负数）', retention(m, T0) >= 1);
}

// ---------------------------------------------------------------- 7) 强度标签
console.log('\n[7] 给人看的强度 ...');
{
  const fresh = newMeta(T0);
  check('刚记住 → 清楚', strengthLabel(fresh, T0) === '清楚', strengthLabel(fresh, T0));
  check('百分比 100', strengthPercent(fresh, T0) === 100);

  const old = newMeta(T0);
  const later = T0 + 6 * DAY;        // 半衰期 1 天 → 忘得差不多了
  check('很久没提 → 快忘了 / 基本忘了',
    /忘了/.test(strengthLabel(old, later)), strengthLabel(old, later));
  check('百分比很低', strengthPercent(old, later) < FORGET_BELOW * 100,
    strengthPercent(old, later) + '%');

  let perm = newMeta(T0);
  for (let i = 0; i < PERMANENT_HITS; i++) perm = touchMeta(perm, T0);
  check('永久的 → 很牢', strengthLabel(perm, T0 + 999 * DAY) === '很牢');
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

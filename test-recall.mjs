/**
 * 关键词检索式记忆的测试
 *
 * 这是"她能想起很久以前的事"的关键：最近 200 条本来就在上下文里，
 * 200 条之外只能靠检索捞回来。用假数据验证捞得准、不乱捞。
 */

import { keywords, buildIndex, appendToIndex, search, formatHits, MAX_INDEXED } from './src/recall.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

// ---------------------------------------------------------------- 1) 切词
console.log('\n[1] 中文关键词提取 ...');
{
  const kw = keywords('我今天做饭把锅烧糊了');
  check('切得出"做饭"（2-gram）', kw.has('做饭'));
  check('切得出"烧糊"', kw.has('烧糊'));
  check('切得出"做饭把"（3-gram）', kw.has('做饭把'));
  check('高频词"今天"被停用词过滤掉', !kw.has('今天'), [...kw].slice(0, 8).join(','));
}
{
  const kw = keywords('我在用 DeepSeek 和 Qwen3 测试');
  check('英文/数字按词切', kw.has('deepseek') && kw.has('qwen3'));
}
{
  check('空输入不炸', keywords('').size === 0 && keywords(null).size === 0);
  check('纯标点不炸', keywords('！！！。。。').size === 0);
}

// ---------------------------------------------------------------- 2) 构造历史
console.log('\n[2] 检索能不能捞到相关的 ...');
{
  const msgs = [];
  const push = (role, content, min) => msgs.push({ role, content, ts: 1_700_000_000_000 + min * 60000 });
  // 一条很久以前、但很关键的记录
  push('user', '我今天自己做饭，煮了个番茄鸡蛋面', 5);
  push('assistant', '听起来不错', 6);
  // 一条带稀有词的
  push('user', '我们那个萤火虫项目下周要上线', 40);
  push('assistant', '那你别熬太狠了', 41);
  // 一堆无关的寒暄，把上面两条推到很后面
  for (let i = 0; i < 30; i++) {
    push('user', `在吗 今天天气还行 ${i}`, 100 + i * 2);
    push('assistant', '嗯嗯', 101 + i * 2);
  }

  const idx = buildIndex(msgs);
  const recentStart = msgs.length - 10;   // 模拟"最近 10 条已经在上下文里"

  const hits1 = search(idx, '你以前是不是经常做饭', { excludeFrom: recentStart });
  check('问"做饭"能捞到很久以前那条做饭的记录',
    hits1.some((h) => msgs[h.index].content.includes('番茄鸡蛋面')),
    hits1.map((h) => msgs[h.index].content.slice(0, 14)).join(' | '));
  check('捞出来的都是更早的（不含最近的 10 条）',
    hits1.every((h) => h.index < recentStart));

  const hits2 = search(idx, '萤火虫项目怎么样了', { excludeFrom: recentStart });
  check('问"萤火虫项目"能捞到对应那条',
    hits2.some((h) => msgs[h.index].content.includes('萤火虫')),
    hits2.map((h) => msgs[h.index].content.slice(0, 14)).join(' | '));

  const hits3 = search(idx, '你养的那只猫叫什么来着', { excludeFrom: recentStart });
  check('问一件根本没聊过的事，就什么都不捞（不瞎凑）',
    hits3.length === 0, `${hits3.length} 条`);
}

// ---------------------------------------------------------------- 3) 稀有词权重更高
console.log('\n[3] IDF：稀有词更值钱 ...');
{
  const msgs = [];
  // "做饭" 出现 1 次，"今天" 出现 20 次
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: 'user', content: `今天上班好累 ${i}`, ts: 1_700_000_000_000 + i * 1000 });
  }
  msgs.push({ role: 'user', content: '今天我自己做饭了', ts: 1_700_000_100_000 });
  const idx = buildIndex(msgs);

  const hits = search(idx, '今天做饭', { excludeFrom: 999, limit: 3 });
  check('同时候选里有"今天"和"做饭"，优先命中含"做饭"那条',
    hits.length > 0 && msgs[hits[0].index].content.includes('做饭'),
    hits.map((h) => `${msgs[h.index].content}(${h.score.toFixed(1)})`).join(' | '));
}

// ---------------------------------------------------------------- 4) 增量索引
console.log('\n[4] 增量追加 ...');
{
  const msgs = [
    { role: 'user', content: '我今天做饭了', ts: 1 },
    { role: 'assistant', content: '嗯', ts: 2 },
  ];
  const idx = buildIndex(msgs);
  msgs.push({ role: 'user', content: '晚上去跑步了', ts: 3 });
  appendToIndex(idx, msgs, 2);

  const hits = search(idx, '你晚上跑步吗', { excludeFrom: 999 });
  check('增量加进去的消息也能被检索到',
    hits.some((h) => msgs[h.index].content.includes('跑步')),
    hits.map((h) => msgs[h.index].content).join(' | '));
}

// ---------------------------------------------------------------- 5) 输出格式
console.log('\n[5] 拼给模型看的文字 ...');
{
  const msgs = [
    { role: 'user', content: '我今天自己做饭了，做的番茄鸡蛋面', ts: new Date(2026, 2, 10, 20, 0).getTime() },
    { role: 'assistant', content: '听起来不错诶', ts: new Date(2026, 2, 10, 20, 1).getTime() },
  ];
  const idx = buildIndex(msgs);
  const hits = search(idx, '做饭', { excludeFrom: 999 });
  const text = formatHits(msgs, hits);
  check('带上了日期和"谁说"', /- 3\/10 (他|你)说：/.test(text), text.split('\n')[0]);
  check('内容是正序（早的在前）', (() => {
    const lines = text.split('\n').filter(Boolean);
    return lines.length < 2 || lines[0].includes('他');
  })(), text);
  check('空结果返回空串', formatHits(msgs, []) === '');
}

// ---------------------------------------------------------------- 6) 极端情况
console.log('\n[6] 极端情况 ...');
{
  check('空历史不炸', search(buildIndex([]), '做饭').length === 0);
  check('查空字符串不炸', search(buildIndex([{ role: 'user', content: '做饭' }]), '').length === 0);
  check('超长历史会被裁到 MAX_INDEXED 以内', (() => {
    const big = [];
    for (let i = 0; i < MAX_INDEXED + 500; i++) big.push({ role: 'user', content: `消息${i}`, ts: i });
    const idx = buildIndex(big);
    return idx.n <= MAX_INDEXED;
  })());
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

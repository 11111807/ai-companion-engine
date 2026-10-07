/**
 * 拆出来的独立模块的**结构测试**。
 *
 * 为什么单独一个文件：把 app.js 里的存储层、记忆系统、搜索、格式化、
 * 旁白拆分拆成了独立模块，目标是"纯搬运、行为不变"。行为面由原来那 1000 多项测试兜着
 *（它们全都经过 app.js 走完整链路），这个文件只补两件它们测不到的事：
 *
 *   1. 每个模块能**单独**被 import（不依赖 app.js，也不依赖 DOM）
 *       —— 这是"真的解耦了"的唯一硬证据；只经过 app.js 的话，
 *          模块里偷偷用了全局 state 也发现不了
 *   2. 每个模块该导出的东西都还在（防止下次重构悄悄改掉对外接口）
 *
 * 顺带把几个纯函数的行为定住（它们已经从 app.js 搬走了，
 * 之前没有直接的单元测试盯着）。
 */

import * as format from './src/format.js';
import * as search from './src/search.js';
import * as storage from './src/storage.js';
import * as memoryIO from './src/memory-io.js';
import * as narration from './src/narration.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

/** 模块是不是真的不依赖 DOM —— node 里没有 document，能 import 就说明没有 */
const hasDom = () => typeof document !== 'undefined' || typeof localStorage !== 'undefined';

// ---------------------------------------------------------------- 0) 解耦
console.log('\n[0] 每个模块都能脱离 app.js 和浏览器单独加载 ...');
{
  check('这个测试跑在 node 里（没有 document / localStorage）', !hasDom());
  for (const [name, mod] of Object.entries({ format, search, storage, memoryIO, narration })) {
    check(`${name}.js 能单独 import`, !!mod && Object.keys(mod).length > 0,
      `${Object.keys(mod).length} 个导出`);
  }
}

// ---------------------------------------------------------------- 1) format.js
console.log('\n[1] format.js —— 文本格式化 ...');
{
  check('转义了 & < > " \'',
    format.esc('<a href="x">&\'</a>') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    format.esc('<a href="x">&\'</a>'));
  check('数字/空值不炸', format.esc(0) === '0' && format.esc(null) === 'null');

  check('纯表情认得出', format.isEmojiOnly('🌧️') && format.isEmojiOnly('😀😀'));
  check('带文字就不算纯表情', !format.isEmojiOnly('你好'));
  check('太长的不算（防误判）', !format.isEmojiOnly('😀'.repeat(9)));
  check('空的不算', !format.isEmojiOnly('   '));

  const now = new Date(2026, 2, 10, 20, 5).getTime();
  const at = (day, h, m) => new Date(2026, 2, day, h, m).getTime();
  check('今天只显示时分', format.timeText(at(10, 9, 30), now) === '09:30',
    format.timeText(at(10, 9, 30), now));
  check('昨天带"昨天"', format.timeText(at(9, 9, 30), now) === '昨天 09:30');
  check('前天带"前天"', format.timeText(at(8, 9, 30), now) === '前天 09:30');
  check('更早显示日期', format.timeText(at(1, 9, 30), now) === '3月1日 09:30',
    format.timeText(at(1, 9, 30), now));

  check('时长：分钟', format.gapText(23 * 60 * 1000) === '23 分钟');
  check('时长：小时', format.gapText(5 * 3600 * 1000) === '5 个小时');
  check('时长：天', format.gapText(3 * 86400 * 1000) === '3 天');
  check('时长：不到一分钟也算 1 分钟（不显示 0）', format.gapText(1000) === '1 分钟');
}

// ---------------------------------------------------------------- 2) search.js
console.log('\n[2] search.js —— 搜聊天记录（纯子串，不是模糊匹配）...');
{
  const msgs = [
    { role: 'user', content: '我养了只猫' },
    { role: 'assistant', content: '猫咪叫什么' },
    { role: 'system', content: '猫不该被搜到' },
    { role: 'user', content: '今天加班' },
  ];
  check('搜"猫"命中两条（system 不算）', search.searchMessages(msgs, '猫').length === 2);
  check('命中下标是原数组下标', search.searchMessages(msgs, '猫')[0].i === 1);
  check('从后往前找（新的排前面）',
    search.searchMessages(msgs, '猫')[0].i > search.searchMessages(msgs, '猫')[1].i);
  check('多词是 and（都要出现）',
    search.searchMessages(msgs, '猫 名字').length === 0
    && search.searchMessages(msgs, '猫 什么').length === 1);
  check('空查询返回空', search.searchMessages(msgs, '') .length === 0);
  check('大小写不敏感',
    search.searchMessages([{ role: 'user', content: 'Hello' }], 'hello').length === 1);
  check('词表会拆空格并转小写',
    JSON.stringify(search.termsOf(' 猫  Name ')) === JSON.stringify(['猫', 'name']),
    JSON.stringify(search.termsOf(' 猫  Name ')));

  const long = '前面垫一些字'.repeat(6) + '命中点' + '后面也垫一些字'.repeat(6);
  const snip = search.snippetOf(long, ['命中点'], 40);
  check('片段里有命中的词', snip.includes('命中点'), snip);
  check('片段不超过上限（含省略号）', snip.length <= 42, String(snip.length));
  check('两边都截断时有省略号', snip.startsWith('…') && snip.endsWith('…'));
  check('短文本原样返回', search.snippetOf('很短', ['短'], 40) === '很短');
  check('命中列表上限是 40', search.SEARCH_MAX_HITS === 40);
}

// ---------------------------------------------------------------- 3) storage.js
console.log('\n[3] storage.js —— 存储层（不碰 DOM，靠注入的对象）...');
{
  check('三个 key 都在',
    storage.CFG_KEY === 'xiaoyu.config.v1' && storage.CHAT_KEY === 'xiaoyu.chat.v1'
    && storage.PROFILE_KEY === 'xiaoyu.profile.v1');
  check('配额常量是 5MB', storage.QUOTA_BYTES === 5 * 1024 * 1024);

  check('好感度：数字原样保留（**不能取整**，每句只涨 0.4）',
    storage.sanitizeAffection(62.4) === 62.4, String(storage.sanitizeAffection(62.4)));
  check('好感度：没设过是 null（不是 0）',
    storage.sanitizeAffection(null) === null && storage.sanitizeAffection(undefined) === null
    && storage.sanitizeAffection('') === null);
  check('好感度：超范围会夹紧',
    storage.sanitizeAffection(140) === 100 && storage.sanitizeAffection(-5) === 0);
  check('好感度：乱填变 null', storage.sanitizeAffection('abc') === null);

  // ⭐ 回归：fillDefaults 是按类型覆盖的，把 affection 写进默认表会把 62 冲成 null
  const p = { msgCount: 60, affection: 62, affectionBase: 40 };
  storage.fixProfileShape(p, [1, 2, 3]);
  check('⭐ fixProfileShape 不会把设过的好感度冲掉', p.affection === 62 && p.affectionBase === 40,
    `${p.affection} / ${p.affectionBase}`);
  check('顺手补齐了缺的字段',
    Array.isArray(p.facts) && Array.isArray(p.summary) && p.factsMeta && Array.isArray(p.faded));
  check('msgCount 按传进来的消息数补', storage.fixProfileShape({}, [1, 2]).msgCount === 2);

  const cfg = { model: 'deepseek-chat', provider: 'deepseek' };
  let upgraded = false;
  storage.fixConfigShape(cfg, () => { upgraded = true; });
  check('老模型名会被升级（不然一开口就报 API 错）', cfg.model !== 'deepseek-chat', cfg.model);
  check('升级后会通知调用方落盘', upgraded);
  check('性别只认 m/f', storage.fixConfigShape({ herGender: 'x' }).herGender === 'f');

  // 记忆整理：手动条目要活着、死掉的元数据要清掉
  const prof = {
    facts: ['手动那条', '自动那条'],
    factsManual: ['手动那条'],
    factsMeta: { 手动那条: { hits: 1, lastHit: 0 }, 已经删掉的: { hits: 1, lastHit: 0 } },
    summary: [],
  };
  storage.hoistManualEntries(prof, Date.now());
  check('手动条目被标成 pinned（永久记忆）', prof.factsMeta['手动那条'].pinned === true);
  check('手动条目排在最前面', prof.facts[0] === '手动那条');
  storage.pruneFactsMeta(prof);
  check('已经不在表里的元数据被清掉', !prof.factsMeta['已经删掉的']);
  check('还活着的元数据留着', !!prof.factsMeta['手动那条']);
}

// ---------------------------------------------------------------- 4) memory-io.js
console.log('\n[4] memory-io.js —— 记忆读写 / 检索 / 导入 ...');
{
  // 解析隐藏的记忆块
  const ok = memoryIO.parseMemoryBlock('在呀\n\n[[记忆]]{"facts":["他养了只猫"]}');
  check('摘掉了 [[记忆]] 标记', ok.clean === '在呀', JSON.stringify(ok.clean));
  check('解析出了 facts', ok.mem?.facts?.[0] === '他养了只猫');
  const bad = memoryIO.parseMemoryBlock('在呀\n[[记忆]]{"facts":[坏掉的 json}');
  check('JSON 坏掉时标记也要擦干净（不能让她说出口）',
    bad.mem === null && !bad.clean.includes('记忆'), JSON.stringify(bad.clean));
  check('没有标记时原样返回', memoryIO.parseMemoryBlock('普通一句').clean === '普通一句');

  // 写入 + 情绪强度
  const prof = { facts: [], factsMeta: {} };
  const t = Date.now();
  const r1 = memoryIO.applyMemory({ facts: ['他在杭州上班', '他妈妈去世了'] }, prof, t);
  check('两条都写进去了', prof.facts.length === 2 && r1.added === 2);
  check('生离死别被本地检测认成执念（emo ≥ 7）',
    Number(prof.factsMeta['他妈妈去世了'].emo) >= 7, String(prof.factsMeta['他妈妈去世了']?.emo));
  // ⚠️ 别拿"他养了只猫"当"没有情绪"的例子：emotion.js 的 TIERS 里有「喜欢」这一档，
  // "养" 不算但 "喜欢/想你" 算 —— 换个真的中性的说法。
  check('普通事实没有情绪强度', Number(prof.factsMeta['他在杭州上班']?.emo || 0) === 0,
    String(prof.factsMeta['他在杭州上班']?.emo ?? '(没记)'));
  check('普通事实也会被记下来（只是没有情绪强度）', !!prof.factsMeta['他在杭州上班']);

  const r2 = memoryIO.applyMemory({ facts: ['他在杭州上班'] }, prof, t);
  check('重复提到算一次「复习」而不是新增', r2.reviewed === 1 && r2.added === 0 && prof.facts.length === 2);
  check('复习后强度涨了', Number(prof.factsMeta['他在杭州上班'].hits) >= 2,
    String(prof.factsMeta['他在杭州上班'].hits));
  check('模型标的 heavy 也认',
    memoryIO.applyMemory({ facts: ['他喜欢下雨'], heavy: ['他喜欢下雨'] }, prof, t)
      && Number(prof.factsMeta['他喜欢下雨'].emo) >= 7);
  check('mood 也会记下来', memoryIO.applyMemory({ mood: '累' }, prof, t) && prof.lastMood === '累');

  // 手动标执念
  check('手动标成执念', memoryIO.toggleObsession(prof, '他在杭州上班', t) === true
    && Number(prof.factsMeta['他在杭州上班'].emo) >= 7);
  check('再点一下取消', memoryIO.toggleObsession(prof, '他在杭州上班', t) === false
    && Number(prof.factsMeta['他在杭州上班'].emo) === 0);

  // 生平
  check('第一人称改第三人称', memoryIO.toThirdPerson('我今年27岁') === '他今年27岁',
    memoryIO.toThirdPerson('我今年27岁'));
  check('不把"我们"改成"他们"', memoryIO.toThirdPerson('我们去过') === '我们去过',
    memoryIO.toThirdPerson('我们去过'));
  const bio = memoryIO.parseBioPoints('我 27 岁，在杭州做开发\n老家山东；有个妹妹。养了只猫');
  check('生平按换行/分号/句号切成条', bio.length === 4, JSON.stringify(bio));
  check('切成的是第三人称', bio[0].startsWith('他'), bio[0]);
  check('太长会截断', memoryIO.parseBioPoints('一'.repeat(80)).every((s) => s.length <= 40));
  const bp = { facts: [], factsManual: [], factsMeta: {} };
  const added = memoryIO.applyUserBio(bp, '我在杭州做开发\n养了只猫');
  check('生平要点进了永久记忆那一档', bp.factsManual.length === 2 && added.length === 2);
  check('记下了"哪些是生平来的"（方便改生平只撤这几条）',
    JSON.stringify(bp.bioFacts) === JSON.stringify(added));
  const nothing = memoryIO.applyUserBio(bp, '');
  check('清空生平会撤掉上次那几条，且不碰别的',
    bp.factsManual.length === 0 && nothing.length === 0);
  bp.facts = ['聊天中学到的'];
  memoryIO.applyUserBio(bp, '我在杭州做开发');
  check('⭐ 改生平不碰聊天中学到的记忆', bp.facts.includes('聊天中学到的'), JSON.stringify(bp.facts));

  // 要点压缩
  const mk = (role, content, i) => ({ role, content, ts: t + i * 60000 });
  const many = Array.from({ length: 20 }, (_, i) => mk(i % 2 ? 'assistant' : 'user', `第${i}条说了一件具体的事`, i));
  check('不够 10 条新的就不压', memoryIO.summarizeConversation(many.slice(0, 5), { since: 0 }) === null);
  const one = memoryIO.summarizeConversation(many, { since: 0 });
  check('够 10 条就压出一条', !!one && one.line.includes('那次聊到'), one?.line);
  check('压完记录指针往前挪（下次不会重复压）', one.pointer === 20 - 6, String(one.pointer));
  check('只留 6 条不进压缩', many.length - one.pointer === 6);

  // 检索
  // ⚠️ 查询词至少要两个字：recall.js 切的是 2-gram / 3-gram，
  // 单个汉字（比如"猫"）根本切不出关键词，那是它设计如此，不是 bug。
  const hist = Array.from({ length: 60 }, (_, i) => mk('user', i === 3 ? '我养了一只猫叫豆豆' : `随便聊聊第${i}条`, i));
  const hit = memoryIO.recallOldMessages(hist, '豆豆', { excludeRecent: 10 });
  check('很久以前的记录能被翻出来', hit.count >= 1 && hit.text.includes('豆豆'), hit.text.slice(0, 40));
  check('标记了"很久以前你们说过的"', memoryIO.recallBlock(hist, '豆豆', 10).includes('【很久以前你们说过的】'));
  check('⭐ 明确禁止她说"你以前也这么说过"',
    memoryIO.recallBlock(hist, '豆豆', 10).includes('你以前也这么说过'));
  check('⭐ 明确禁止她报"次数"',
    memoryIO.recallBlock(hist, '豆豆', 10).includes('不要提"次数"'));
  check('记录太少就不翻（免得硬凑）',
    memoryIO.recallOldMessages(hist.slice(0, 10), '豆豆', {}).count === 0);

  // 导入
  const parsed = memoryIO.parseHistoryText([
    '# 导出',
    '她记得关于你的事：养了只猫；老家山东',
    '---',
    '[7/14 22:13] 阿哲：今天好累',
    '小雨：怎么啦',
    '小雨：那你早点睡',
  ].join('\n'), ['小雨', 'AI']);
  check('解析出两条消息（连发的合并成一条）', parsed.messages.length === 2, String(parsed.messages.length));
  check('认得出谁是她', parsed.messages[1].role === 'assistant');
  check('连发被合并成一条', parsed.messages[1].content.includes('\n'));
  check('顺带读出了"她记得关于你的事"', parsed.facts.length === 2, JSON.stringify(parsed.facts));
  const stamped = memoryIO.normalizeTimestamps(parsed.messages, t);
  check('时间戳排到当前时间之前（不会显示成"未来"）',
    stamped.every((m) => m.ts <= t), String(stamped[0].ts - t));
  check('内部字段 _t 被清掉', stamped.every((m) => !('_t' in m)));

  const into = { facts: ['养了只猫'] };
  check('导入时跳过已有的记忆，只加新的',
    memoryIO.mergeFacts(into, ['养了只猫', '老家山东']) === 1 && into.facts.length === 2);
}

// ---------------------------------------------------------------- 6) narration.js
console.log('\n[6] narration.js —— 她的（）旁白要拆成单独一条 ...');
{
  const one = narration.splitNarration('（夹了口菜）好吃吗？');
  check('旁白被单独拆出来（内容不带括号）',
    one.length === 2 && one[0].narr === true && one[0].text === '夹了口菜', JSON.stringify(one));
  check('剩下的台词原样留着', one[1].narr === false && one[1].text === '好吃吗？');

  const mid = narration.splitNarration('我没事（笑）真的');
  check('⭐ 夹在句子中间也拆，而且顺序不变（台词 / 旁白 / 台词）',
    mid.map((s) => `${s.narr ? '旁白' : '台词'}:${s.text}`).join(' | ')
      === '台词:我没事 | 旁白:笑 | 台词:真的', JSON.stringify(mid));

  check('只发一个动作、一个字都不说也行',
    narration.splitNarration('（举起手里的奶茶）').length === 1
    && narration.splitNarration('（举起手里的奶茶）')[0].narr === true);
  check('半角括号里的中文也算旁白',
    narration.splitNarration('(愣了一下)你呢').length === 2);
  check('⭐ 半角括号里的英文 / 颜文字不算旁白（那是台词的一部分）',
    narration.splitNarration('这个 bug (fix) 了').length === 1
    && narration.splitNarration('好耶 (๑•̀ㅂ•́)و').length === 1);
  check('不算旁白时，括号原样留在台词里（一个字都不丢）',
    narration.splitNarration('看这个 (lol) 好笑')[0].text.includes('(lol)'),
    JSON.stringify(narration.splitNarration('看这个 (lol) 好笑')));
  check('空括号不会造出一个空旁白条',
    narration.splitNarration('喂（）在吗').every((s) => s.text.trim() && !s.narr),
    JSON.stringify(narration.splitNarration('喂（）在吗')));
  check('⭐ 不跨行配对（免得把好几条消息都吃进一个括号里）',
    narration.splitNarration('（他愣住了\n这句话很长）。').length === 1,
    JSON.stringify(narration.splitNarration('（他愣住了\n这句话很长）。')));
  check('多条旁白各成一条', narration.splitNarration('（笑）（叹气）你怎么了').length === 3);
  check('⭐「（空行）」「(换行)」是分段标记，不当旁白（要留给拆分逻辑还原）',
    narration.splitNarration('甲（空行）乙').every((s) => !s.narr)
    && narration.splitNarration('甲(换行)乙').every((s) => !s.narr),
    JSON.stringify(narration.splitNarration('甲（空行）乙')));
  check('空值不炸', narration.splitNarration('').length === 0 && narration.splitNarration(null).length === 0);
}

// ---------------------------------------------------------------- 7) 别写重样
console.log('\n[7] narration.js —— 把"最近写过的旁白"捞回去提醒她别重复 ...');
{
  const m = (role, content, narr) => ({ role, content, narr });
  const msgs = [
    m('assistant', '笑', true),
    m('user', '抱住', true),          // 我写的，不算
    m('assistant', '在呀'),           // 台词，不算
    m('assistant', '把手机扣在桌上', true),
    m('assistant', '笑', true),       // 重复 → 只留一条
  ];
  const recent = narration.recentNarrations(msgs);
  check('⭐ 只收"她写的旁白"（我的旁白和台词都不算）',
    JSON.stringify(recent) === JSON.stringify(['笑', '把手机扣在桌上']), JSON.stringify(recent));
  check('⭐ 重复的只留一条', recent.filter((s) => s === '笑').length === 1);

  const many = Array.from({ length: 30 }, (_, i) => m('assistant', `动作${i}`, true));
  check('只取最近 max 条', narration.recentNarrations(many, { max: 5 }).length === 5,
    String(narration.recentNarrations(many, { max: 5 }).length));
  check('recentN 之外的不看', narration.recentNarrations(many, { recentN: 3 }).length === 3);
  check('空历史不炸', narration.recentNarrations([]).length === 0
    && narration.recentNarrations(null).length === 0);

  check('一条都没有时**不输出**那段提示词（别塞空块）',
    narration.narrationVaryBlock([]) === '' && narration.narrationVaryBlock(null) === '');
  const block = narration.narrationVaryBlock(recent);
  check('有内容时列成"- （…）"', /- （笑）/.test(block) && /- （把手机扣在桌上）/.test(block));
  check('⭐ 明确要求换一个动作/角度', /换个\*\*动作或角度\*\*/.test(block) || /换个/.test(block));
  check('说明"同一批动作连着用会显得机械"', /连着用会显得机械/.test(block));
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);process.exit(fail ? 1 : 0);

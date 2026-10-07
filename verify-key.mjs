/**
 * 用真实 Key 跑一遍完整验证
 * 用法: node verify-key.mjs sk-xxx
 */

import { streamChat } from './src/api.js';
import { buildSystemPrompt, randomStateHint, intimacyStage } from './src/persona.js';

const apiKey = process.argv[2];
if (!apiKey) { console.error('用法: node verify-key.mjs sk-xxx'); process.exit(1); }

const ok = (t) => `\x1b[32m${t}\x1b[0m`;
const bad = (t) => `\x1b[31m${t}\x1b[0m`;

console.log('='.repeat(60));
console.log('  第一步：验证 Key 是否可用');
console.log('='.repeat(60));

let balanceInfo = null;
try {
  const r = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const t = await r.text();
  if (r.ok) {
    balanceInfo = JSON.parse(t);
    console.log(ok('  ✅ Key 有效'));
    console.log(`     余额可用: ${balanceInfo.is_available}`);
    for (const b of balanceInfo.balance_infos || []) {
      console.log(`     ${b.currency}: 总额 ${b.total_balance} / 赠送 ${b.granted_balance} / 充值 ${b.topped_up_balance}`);
    }
  } else {
    console.log(bad(`  ❌ 查询余额失败 HTTP ${r.status}: ${t.slice(0, 200)}`));
  }
} catch (e) {
  console.log(bad(`  ❌ 网络错误: ${e.message}`));
}

console.log('');
console.log('='.repeat(60));
console.log('  第二步：真实对话（看她像不像真人）');
console.log('='.repeat(60));

const SCENARIOS = [
  {
    title: '场景 1 · 抱怨加班（测会不会说教/给建议）',
    profile: { name: '阿哲', facts: ['在互联网公司做开发'], lastMood: '累' },
    lines: ['今天又加班到十点，烦死了', '你说我是不是该辞职啊'],
  },
  {
    title: '场景 2 · 问技术问题（测会不会装懂）',
    profile: { name: '阿哲', facts: [] },
    lines: ['帮我看看这个报错：TypeError: Cannot read properties of undefined', '你怎么什么都不会啊'],
  },
  {
    title: '场景 3 · 日常闲聊（测有没有自己的生活）',
    profile: { name: '阿哲', facts: [] },
    lines: ['在干嘛', '今天吃什么了'],
  },
  {
    title: '场景 4 · 情绪低落（测共情，别变心理咨询师）',
    profile: { name: '阿哲', facts: [] },
    lines: ['最近很没意思，什么都不想做'],
  },
];

const badPatterns = [
  [/\b作为一个?\s*(AI|人工智能|语言模型|助手)/i, 'AI 自称'],
  [/我是(一个)?(AI|人工智能|语言模型)/i, 'AI 自称'],
  [/(首先|其次|总之|综上|建议你|你可以试试|以下几点|希望能帮到你)/, '助手腔/说教'],
  [/^\s*\d+[.、)]\s/m, '列条目'],
  [/^#{1,6}\s/m, 'Markdown 标题'],
  [/\*\*[^*]+\*\*/, 'Markdown 加粗'],
];

let totalBad = 0, totalMsgs = 0, overLong = 0, markerCount = 0;
const allReplies = [];

for (const sc of SCENARIOS) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${sc.title}`);
  console.log('─'.repeat(60));
  console.log(`  （她记得：${sc.profile.facts.join('、') || '没什么'}）`);

  const systemPrompt = [
    buildSystemPrompt(sc.profile),
    intimacyStage(40),
    randomStateHint(),
    `【记忆】如果这次对话里出现了关于他的新信息，在回复最后另起一行加上：
[[记忆]]{"name":"","facts":[],"mood":""}
这一行不会显示给他。没有新信息就不要输出这行。`,
  ].join('\n\n');

  const messages = [];
  for (const line of sc.lines) {
    console.log(`\n  👤 他：${line}`);
    messages.push({ role: 'user', content: line });

    let raw = '';
    const t0 = Date.now();
    try {
      const r = await streamChat({
        apiKey, systemPrompt, messages,
        temperature: 1.0, maxTokens: 250,
      });
      raw = r.text;
    } catch (e) {
      console.log(bad(`  ❌ 请求失败：${e.message}`));
      break;
    }
    const ms = Date.now() - t0;

    const clean = raw.replace(/\[\[记忆\]\][\s\S]*$/, '').trim();

    // 检查模型有没有把"空行"当文字输出（应用会自动还原，但最好别出现）
    const hasMarker = /(?:【|\[|\()\s*空\s*行\s*(?:】|\]|\))/.test(clean);
    const normalized = clean
      .replace(/^[ \t]*(?:【|\[|\()?\s*空\s*行\s*(?:】|\]|\))?[ \t]*$/gm, '')
      .replace(/(?:【|\[|\()\s*空\s*行\s*(?:】|\]|\))/g, '\n\n')
      .replace(/\\n/g, '\n')
      .trim();

    const parts = normalized.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
    totalMsgs += parts.length;
    if (hasMarker) markerCount++;

    console.log(`  🌧️ 她（${parts.length} 条连发 · ${ms}ms）：`);
    parts.forEach((p) => {
      const len = [...p].length;
      if (len > 40) overLong++;
      console.log(`      ${p}${len > 40 ? `   ← ${len}字，偏长` : ''}`);
    });
    if (hasMarker) console.log(`      ℹ️  模型输出了"空行"字面标记（应用已自动还原）`);

    const found = badPatterns.filter(([re]) => re.test(clean)).map(([, n]) => n);
    if (found.length) {
      console.log(bad(`      ⚠️  ${found.join('、')}`));
      totalBad += found.length;
    }

    const mem = raw.match(/\[\[记忆\]\]\s*(\{[\s\S]*?\})/);
    if (mem) console.log(`      🧠 记忆更新：${mem[1]}`);

    allReplies.push(clean);
    messages.push({ role: 'assistant', content: clean });
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('  自动检测结论');
console.log('='.repeat(60));
console.log(`  连发总条数: ${totalMsgs}`);
console.log(`  超过 40 字的长消息: ${overLong}`);
console.log(`  出现"空行"字面标记: ${markerCount} 次 ${markerCount === 0 ? '(很好，提示词生效)' : '(应用会自动还原，但提示词还需加强)'}`);
if (totalBad === 0) console.log(ok('  ✅ 没有检测到 AI 腔 / 说教 / 列条目'));
else console.log(bad(`  ⚠️  检测到 ${totalBad} 处机械化问题`));

console.log(`
  机器测不出来的部分，需要你看上面的原文自己判断：
   1. 她像真人还是像客服？
   2. 场景 1 有没有忍住不给建议？
   3. 场景 2 有没有老实说"不懂"？
   4. 场景 3/4 有没有讲自己的生活（室友/作业/猫/奶茶）？
   5. 连发条数和长度像不像微信？
`);

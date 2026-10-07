/**
 * 场景一致性实测：连续多轮，看她的地点/时间会不会乱跳
 * 用法: node verify-scene.mjs sk-xxx
 */

import { streamChat } from './src/api.js';
import { buildSystemPrompt, pickScene, sceneHint, intimacyStage } from './src/persona.js';

const apiKey = process.argv[2];
if (!apiKey) { console.error('用法: node verify-scene.mjs sk-xxx'); process.exit(1); }

const scene = pickScene();
console.log('='.repeat(62));
console.log('  场景一致性实测');
console.log('='.repeat(62));
console.log(`  本次固定场景：${scene.text}`);
console.log('  （下面连续问 8 轮，看地点/时间会不会变）\n');

const systemPrompt = [
  buildSystemPrompt({ name: '阿哲', facts: [] }, { scene, summary: [] }),
  intimacyStage(40),
  `【记忆】如果这次对话里出现了关于他的新信息，在回复最后另起一行加上：
[[记忆]]{"name":"","facts":[],"mood":""}
这一行不会显示给他。没有新信息就不要输出这行。`,
].join('\n\n');

// 故意混入容易让她"换场景"的问题
const questions = [
  '在干嘛呢',
  '今天天气不错啊',
  '你吃了吗',
  '你现在在哪儿啊',          // 直接问地点
  '我有点累，想找人说说话',
  '你那边吵不吵',
  '你现在在图书馆吗',        // 诱导她换场景
  '那你晚上准备干嘛',
];

const messages = [];
const answers = [];

for (const q of questions) {
  console.log(`  👤 他：${q}`);
  messages.push({ role: 'user', content: q });

  let raw = '';
  try {
    const r = await streamChat({ apiKey, systemPrompt, messages, temperature: 1.0, maxTokens: 200 });
    raw = r.text;
  } catch (e) {
    console.log(`  ❌ ${e.message}\n`);
    break;
  }
  const clean = raw.replace(/\[\[记忆\]\][\s\S]*$/, '').trim();
  const parts = clean.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  parts.forEach((p) => console.log(`  🌧️  ${p}`));
  console.log('');

  answers.push({ q, text: parts.join(' ') });
  messages.push({ role: 'assistant', content: clean });
}

// 分析：她提到过哪些地点
const PLACES = ['宿舍', '寝室', '图书馆', '教室', '食堂', '家', '床上', '被子里', '书桌', '教室', '路上', '外面', '操场'];
const mentioned = new Set();
for (const a of answers) {
  for (const p of PLACES) if (a.text.includes(p)) mentioned.add(p);
}

console.log('='.repeat(62));
console.log('  分析');
console.log('='.repeat(62));
console.log(`  固定场景：${scene.text}`);
console.log(`  她提到过的地点：${[...mentioned].join('、') || '（没提）'}`);

const scenePlaces = PLACES.filter((p) => scene.text.includes(p));
const conflicts = [...mentioned].filter((m) => !scenePlaces.includes(m));
if (conflicts.length) {
  console.log(`  ⚠️  可能冲突的地点：${conflicts.join('、')}`);
  console.log('      （有些可能只是顺口提到，需要你看上下文判断）');
} else {
  console.log('  ✅ 没有出现和固定场景冲突的地点');
}

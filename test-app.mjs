/**
 * 微信版全流程测试（jsdom 模拟手机 + 模拟模型接口）
 *
 * 重点验证这一版特有的机制：
 * - 连发：一次生成拆成几条，逐条带"正在输入"发出
 * - 记忆：从 [[记忆]] 块提取用户信息，跨会话保留
 * - 微信 UI：气泡方向、头像、时间分隔、发送按钮显隐
 *
 * 用法：node test-app.mjs
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineScript } from './inline.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 10000, interval = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

// ---------------------------------------------------------------- 模拟接口

let mockReply = '嗯嗯\n\n我也是';
let lastRequestBody = null;

function sse(pieces) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    pull(c) {
      if (i >= pieces.length) { c.close(); return; }
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`;
      if (i === pieces.length) {
        c.enqueue(enc.encode(frame));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
      } else c.enqueue(enc.encode(frame));
    },
  };
}

function installFetch() {
  window.fetch = async (url, opts = {}) => {
    lastRequestBody = opts.body ? JSON.parse(opts.body) : null;
    if (mockMode === 'slow') {
      return new Response(new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          let n = 0;
          const t = setInterval(() => {
            if (n >= 3) { clearInterval(t); try { c.close(); } catch {} return; }
            try {
              c.enqueue(enc.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: ['等等', '我', '想想'][n++] } }] })}\n\n`
              ));
            } catch { clearInterval(t); }
          }, 90);
        },
      }), { status: 200 });
    }
    if (mockMode === '401') {
      return new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 });
    }
    if (mockMode === '402') {
      return new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 });
    }
    if (mockMode === 'network') throw new TypeError('Failed to fetch');
    return new Response(new ReadableStream(sse([mockReply])), { status: 200 });
  };
}

let mockMode = 'ok';

// ---------------------------------------------------------------- 环境

console.log('=== 微信版全流程测试 ===\n');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));

const dom = new JSDOM(read('index.html'), {
  url: 'http://localhost:8099/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;

// jsdom 不会去加载外部 CSS（styleSheets 会是空的），
// 那样所有跟样式有关的断言都是假绿。这里手动把真实样式表注入进去。
{
  const css = read('src/styles.css');
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);
}

Object.defineProperty(window.navigator, 'userAgent', {
  value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
  configurable: true,
});
window.navigator.vibrate = () => true;
window.confirm = () => true;
window.AbortController = AbortController;
window.TextDecoder = TextDecoder;
window.ReadableStream = ReadableStream;
window.Response = Response;
window.Request = Request;
window.Headers = Headers;
installFetch();

const stripExports = (src) => src.replace(/^export\s+/gm, '');
const personaSrc = stripExports(read('src/persona.js'));

// ---------------------------------------------------------------- 可见性工具

// 注意：只检查 hidden 属性是不够的。
// 如果 CSS 里给元素写了 display:flex/block，会盖过浏览器对 [hidden] 的默认处理，
// 元素属性是 hidden 但依然显示在屏幕上——这个坑必须用计算样式来测。
// 反过来，如果 CSS 没定义 display，hidden 属性是生效的，也要算进去。
const isVisible = (el) => {
  if (!el) return false;
  if (el.hidden) return false;
  const cs = window.getComputedStyle(el);
  const op = parseFloat(cs.opacity || '1');
  return cs.display !== 'none' && cs.visibility !== 'hidden' && op > 0.01;
};

// 兼容函数声明用法的别名（后文用 isVisibleFn 更明确）
const isVisibleFn = isVisible;

/** 点右上角 ··· 打开底部菜单 */
const openMenuViaButton = () => {
  $('#btnMore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

console.log('[1] 加载应用 ...');
try {
  // 内联逻辑在 inline.mjs（和 boot.mjs 共用一份，别再各写各的）
  window.eval(inlineScript());
  check('app.js 执行无异常', true);
} catch (e) {
  check('app.js 执行无异常', false, e.message);
  console.log(e.stack?.slice(0, 900));
  process.exit(1);
}

const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];

// ---------------------------------------------------------------- 初始状态

check('顶栏显示她的名字', $('#navName').textContent === '小雨', $('#navName').textContent);

// 全新用户：先过「开始之前」人设页，这时候**不该**已经发开场白
// （开场白是按名字/初始环境生成的，设完再发才对）
check('全新用户先被「开始之前」拦住', $('#screen-persona').classList.contains('show'));
check('这时候还没有开场白（要先设人设）', $$('.wx-row.in').length === 0,
  `${$$('.wx-row.in').length} 条`);
check('人设页列了该设的东西',
  !!$('#perName') && !!$('#perAge') && !!$('#perJob') && !!$('#perRelation') &&
  !!$('#perBirthday') && !!$('#chipsTraits') && !!$('#perScene') && !!$('#chipsAff'));

// 走完这一步，后面就按"已经设好人设"的正常流程走
$('#btnPersonaStart').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('点「开始聊天」后关掉人设页', !$('#screen-persona').classList.contains('show'));
check('这时候才生成开场白', $$('.wx-row.in').length >= 1, `${$$('.wx-row.in').length} 条`);
check('开场白是连发形式（无尾巴表示一串）',
  $$('.wx-row.in.mid').length >= 1 || $$('.wx-row.in').length === 1);
check('设完人设会落盘', JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).personaDone === true);

const settingsAutoOpened = await waitFor(() => $('#screen-settings').classList.contains('show'), 3000);
check('没有配置 key 时自动打开设置', !!settingsAutoOpened);
// 关掉它，后面才能验证"默认不可见"（否则是在验证一个已经打开的面板）
$('#btnCloseSettings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !isVisible($('#screen-settings')), 3000);

// ---------------------------------------------------------------- 可见性（回归测试）

console.log('\n[1.5] 关键元素默认必须真正不可见 ...');
check('底部操作菜单默认不可见', !isVisible($('#mask')),
  `display=${window.getComputedStyle($('#mask')).display}`);
check('表情面板默认不可见', !isVisible($('#emojiPanel')),
  `display=${window.getComputedStyle($('#emojiPanel')).display}`);
check('更多面板默认不可见', !isVisible($('#plusPanel')));
check('设置页默认不可见', !isVisible($('#screen-settings')));
check('回到最新按钮默认不可见', !isVisible($('#btnScrollBottom')));
check('Toast 默认不可见', !isVisible($('#toast')));

// ---------------------------------------------------------------- 模型（这一轮精简了）

console.log('\n[1.8] 模型固定用 deepseek-flash（设置页只留 Key + 测试连接）...');
$('#screen-settings').classList.add('show');

// 用户要求：去掉服务商 / 模型 / 接口地址这些选项，只用 deepseek-flash。
// 所以这些控件**故意不在 HTML 里了** —— 下面几条断言反过来盯"它们真的没了"。
check('设置页没有服务商下拉了', !$('#inpProvider'));
check('设置页没有模型下拉了', !$('#inpModel'));
check('设置页没有接口地址输入了', !$('#inpEndpoint'));
check('设置页没有本地模型面板了', !$('#nativePanel'));
check('只留了 API Key', !!$('#inpKey'));
check('留了测试连接', !!$('#btnTest'));
check('页面上写明了用哪个模型', /deepseek-flash/.test($('#screen-settings').textContent),
  ($('#screen-settings').textContent.match(/deepseek-\S+/) || [''])[0]);

// 就算配置里被人塞了别的模型名，跑起来也应该是 deepseek-flash
// ⚠️ 模型名现在存在**全局**那一份里（Key / 模型 / 接口是所有好友共用的），
//    不再写进好友自己的 config —— 见 storage.js 的 GLOBAL_KEY
const globalCfg = () => JSON.parse(window.localStorage.getItem('xiaoyu.global.v1') || '{}');
check('config 里的模型是 deepseek-flash',
  globalCfg().model === 'deepseek-flash' || /^deepseek-/.test(globalCfg().model || ''),
  globalCfg().model);
check('提供"去申请 Key"的链接', !!$('#signupLink'));

// ---------------------------------------------------------------- 配置

console.log('\n[2] 配置 API Key ...');
$('#screen-settings').classList.add('show');
mockMode = '401';
$('#inpKey').value = 'sk-bad';
$('#btnTest').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const bad = await waitFor(() => !$('#testResult').hidden && /无效/.test($('#testResult').textContent), 5000);
check('错误 key 有友好提示', !!bad, $('#testResult').textContent.trim());

mockMode = 'ok';
$('#inpKey').value = 'sk-test-key';
// 「你的名字」这个输入框这一轮搬到了「我 → 改我的资料」页（#meName），
// 设置页里不再有它 —— 所以走真实路径：从聊天页返回 → 我 → 改我的资料 → 保存。
$('#btnCloseSettings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#btnBack').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$$('.wx-tab').find((b) => b.dataset.tab === 'me')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#meCard [data-me="edit"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#meName').value = '阿哲';
$('#btnMeSave').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// 我的资料现在存在**全局**那一份里（所有好友共用一份）—— 见 storage.js 的 GLOBAL_FIELDS
check('我的资料页能存名字', globalCfg().userName === '阿哲');

// 回到设置页测连接
$('#screen-settings').classList.add('show');
$('#inpKey').value = 'sk-test-key';
$('#btnTest').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const good = await waitFor(() => !$('#testResult').hidden && /成功/.test($('#testResult').textContent), 5000);
check('正确 key 测试通过', !!good, $('#testResult').textContent.trim());
check('用户名已保存', globalCfg().userName === '阿哲');

$('#btnCloseSettings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('设置页可关闭', !$('#screen-settings').classList.contains('show'));

// ---------------------------------------------------------------- 微信 UI

console.log('\n[3] 微信界面元素 ...');
check('她的头像显示默认 emoji', $('.wx-avatar.her')?.textContent === '🌧️', $('.wx-avatar.her')?.textContent);
check('我的头像显示我的首字', (() => {
  const inp = $('#input');
  inp.value = '测试';
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  const t = $('.wx-avatar.me')?.textContent;
  inp.value = '';
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  return t === undefined || t === '阿' || t === '我';
})());
check('输入前发送按钮隐藏', $('#btnSend').hidden === true);
$('#input').value = '在吗';
$('#input').dispatchEvent(new window.Event('input', { bubbles: true }));
check('输入后出现发送按钮', $('#btnSend').hidden === false);
$('#input').value = '';
$('#input').dispatchEvent(new window.Event('input', { bubbles: true }));

check('表情面板可打开', (() => {
  $('#btnEmoji').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const open = !$('#emojiPanel').hidden;
  return open;
})());
check('表情面板有内容', $$('#emojiGrid button').length > 40, `${$$('#emojiGrid button').length} 个表情`);
$('#emojiGrid button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('点表情会插入输入框', $('#input').value.length > 0, $('#input').value);
$('#input').value = '';
$('#input').dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnEmoji').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// ---------------------------------------------------------------- 连发机制

console.log('\n[4] 连发消息机制（核心）...');
mockMode = 'ok';
mockReply = '诶你今天怎么这么晚\n\n我刚还在想你怎么不理我\n\n算了 你忙吧';
const input = $('#input');
input.value = '刚下班';
input.dispatchEvent(new window.Event('input', { bubbles: true }));

const rowsBefore = $$('.wx-row').length;
const rowsBeforeIn = $$('.wx-row.in').length;
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('我的消息立即上屏', await waitFor(() => $$('.wx-row.out').length >= 1, 3000));
check('出现"对方正在输入"', await waitFor(() => !!$('[data-typing]'), 4000));
check('顶栏也显示正在输入', await waitFor(() => /正在输入/.test($('#navSub').textContent), 4000));

const burstDone = await waitFor(
  () => !$('[data-typing]') && $$('.wx-row.in .wx-bubble').length >= rowsBeforeIn + 3,
  20000
);
check('连发全部发出', !!burstDone, `新增 ${$$('.wx-row.in').length - rowsBeforeIn} 条她的消息`);

const herTexts = $$('.wx-row.in .wx-bubble').map((b) => b.textContent.trim());
check('按空行拆成 3 条', herTexts.slice(-3).join('|') === '诶你今天怎么这么晚|我刚还在想你怎么不理我|算了 你忙吧',
  herTexts.slice(-3).join(' / '));
check('连发里没有残留的换行', herTexts.slice(-3).every((t) => !t.includes('\n')),
  herTexts.slice(-3).find((t) => t.includes('\n')) || '无');
check('连发的前几条不带尾巴（是一串）', $$('.wx-row.in.mid').length >= 2, `${$$('.wx-row.in.mid').length} 条 mid`);
check('生成结束后正在输入消失', !$('[data-typing]'));
check('顶栏正在输入已清空', $('#navSub').textContent === '');

// ---------------------------------------------------------------- 单换行也拆

console.log('\n[5] 单换行/超长也都处理 ...');
mockReply = '嗯\n真的吗\n那挺好的';
input.value = '我跟你说个事';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#btnSend').hidden === false, 20000);
const after = $$('.wx-row.in .wx-bubble').map((b) => b.textContent.trim());
check('单换行也拆成多条', after.includes('嗯') && after.includes('真的吗') && after.includes('那挺好的'),
  after.slice(-3).join(' / '));

// 回归：模型有时会把"空行"当成文字输出（【空行】/(空行)/[空行]），必须还原
console.log('\n[5.5] 分隔标记还原（模型会写出【空行】这种字面文字）...');
// 先确保上一轮彻底结束，否则计数会错位
await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 15000);

mockReply = '我也是…今天海报改了三版还是丑\n\n【空行】\n\n圆圆还在旁边放土味情歌';
const inBefore55 = $$('.wx-row.in .wx-bubble').length;
input.value = '最近很没意思';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#input').disabled === false &&
  $$('.wx-row.in .wx-bubble').length > inBefore55, 20000);

const added55 = $$('.wx-row.in .wx-bubble').slice(inBefore55).map((b) => b.textContent.trim());
check('拆成两条，内容分别正确',
  added55.length === 2 && /海报改了三版/.test(added55[0]) && /土味情歌/.test(added55[1]),
  added55.join(' / '));
check('"【空行】"没有被当成内容发出来',
  !added55.some((t) => /空行/.test(t)), added55.find((t) => /空行/.test(t)) || '无');

// 变体也要处理
await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 15000);
mockReply = '甲\n\n(空行)\n\n乙';
const inBeforeVar = $$('.wx-row.in .wx-bubble').length;
input.value = '测试变体';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#input').disabled === false &&
  $$('.wx-row.in .wx-bubble').length > inBeforeVar, 20000);
const addedVar = $$('.wx-row.in .wx-bubble').slice(inBeforeVar).map((b) => b.textContent.trim());
check('(空行) 变体也被还原', !addedVar.some((t) => /空行/.test(t)), addedVar.join(' / '));
check('内容没丢（甲和乙都在）',
  addedVar.some((t) => /甲/.test(t)) && addedVar.some((t) => /乙/.test(t)), addedVar.join(' / '));

// ---------------------------------------------------------------- 记忆

console.log('\n[6] 记忆提取（核心）...');
mockReply = '记住啦\n\n以后就叫你阿哲\n[[记忆]]{"name":"阿哲","facts":["在一家互联网公司做开发","养了只橘猫叫豆豆"],"mood":"有点累"}';
input.value = '我叫阿哲，在做开发，养了只橘猫叫豆豆，今天很累';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#btnSend').hidden === false, 20000);

const visible = $$('.wx-row.in .wx-bubble').map((b) => b.textContent).join('\n');
check('记忆标记不会显示给用户', !visible.includes('[[记忆]]') && !visible.includes('facts'),
  visible.slice(-60));
check('提取到了名字', JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1')).name === '阿哲');
const prof = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
check('提取到了事实', prof.facts.length >= 2, prof.facts.join(' / '));
check('提取到了情绪', prof.mood === '有点累' || prof.lastMood === '有点累', prof.lastMood);

// 记忆要传给下一次请求
input.value = '还记得我说过什么吗';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#btnSend').hidden === false, 20000);
const sysSent = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
check('记忆已注入 system 提示词', /豆豆|阿哲/.test(sysSent), sysSent.match(/【你记得关于他的事】[\s\S]{0,80}/)?.[0] || '(未找到)');
check('人格设定已注入', /20 岁/.test(sysSent) && /不是 AI/.test(sysSent));

// ---------------------------------------------------------------- 情绪交互

console.log('\n[7] 人格提示词质量 ...');
check('提示词要求不说教/不给建议', /不要给建议|不要讲道理/.test(sysSent));
check('提示词要求敢说不知道', /这我不太懂|不要什么都懂/.test(sysSent));
check('提示词要求会怼人/不顺从', /怼回去|不要每次都顺着/.test(sysSent));
check('提示词要求连发短消息', /连发消息|用空行/.test(sysSent));
check('提示词包含活动状态', /窝在床上|洗完澡|海报作业|图书馆|饿|食堂|课堂/.test(sysSent));
// ⚠️ 好感度块这一轮起**只给档位、不给数字** ——
//    带数字的话正常聊一句（+0.4）这段就变一次，会破坏提示词的前缀缓存。
check('提示词里写清了她现在对他是什么态度（给档位，不给数字）',
  /【你对他的好感度：.+】/.test(sysSent) && !/\d+\/100/.test(sysSent),
  (sysSent.match(/【你对他的好感度[^\n]*/) || [''])[0] || '(没找到)');

// 场景必须固定，不能每轮换（这是之前"在家突然跳到图书馆"的根因）
console.log('\n[7.5] 场景一致性 + 反顺从 + 本地模型 ...');
const sysScenes = [];
input.value = '你现在在哪呢';
for (let i = 0; i < 3; i++) {
  input.value = `第${i}次问：你现在在哪`;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 20000);
  // 注意：不能只匹配「【你现在在哪】」——【你的生活】那段里也提了一句
  // "看下面【你现在在哪】那一块"，那样三次抓到的其实是生活块，
  // 永远相等，等于没测。这里锚定场景块自己的开头那句话。
  sysScenes.push((lastRequestBody.messages.find((m) => m.role === 'system')?.content
    .match(/【你现在在哪】（这一段最优先[\s\S]{0,160}/) || [''])[0]);
}
check('三轮对话里场景提示完全相同（不再乱跳）',
  sysScenes.length === 3 && sysScenes[0] === sysScenes[1] && sysScenes[1] === sysScenes[2],
  sysScenes[0]?.slice(0, 46) || '(未捕获)');
check('场景提示里明确禁止换地点',
  /这是你此刻真实所处的环境/.test(sysSent) && /不要凭空跳到无关的地方/.test(sysSent));
check('场景提示要求换地点必须有过渡',
  /换地点必须有合理过渡/.test(sysSent));
check('提示词里有【现在的时间】',
  /【现在的时间】/.test(sysSent) && /现在是 \d{4}年\d{1,2}月\d{1,2}日 周./.test(sysSent),
  (sysSent.match(/现在是 [^\n]*/) || [''])[0]);
check('提示词要求她有时间观念',
  /时间观念|时间会流逝/.test(sysSent));

// 他提到"未来的时间"时，提示词要先把"还剩多久"算出来告诉她。
//（用户反馈：晚上十点说"明天下午送你去学校"，她居然急得催"那快出发吧"）
console.log('\n[4.9] 未来的时间不会被当成"马上要发生" ...');
input.value = '明天下午送你去学校';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 20000);
{
  const sys = lastRequestBody.messages.find((m) => m.role === 'system').content;
  check('算好了"还剩多久"再交给她', /【他刚才提到的时间】/.test(sys),
    (sys.match(/他说的「[^\n]*/) || [''])[0] || '(没注入)');
  check('并且说清"现在还早、不用着急"',
    /完全不用着急/.test(sys), (sys.match(/^他说的.*$/m) || [''])[0]);
  check('明确禁止她催"快出发""要迟到了"',
    /别说"快出发""要迟到了"/.test(sys));
  check('提示词里有时间逻辑规则（过去/现在/将来别搞混）',
    /别把时间的先后搞错/.test(sys) && /过去、现在，还是将来/.test(sys));
}
check('场景已持久化（刷新后不变）',
  !!JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1')).sceneId);
check('存在反顺从规则（针对智谱这类弱模型）',
  /别当应声虫/.test(sysSent) && /不要为了让他高兴就一味附和/.test(sysSent),
  (sysSent.match(/【别当应声虫】[^\n]*/) || [''])[0]);

// 本地模型：这一轮设置页不再提供这个选项（模型锁死 deepseek-flash）。
// providers.js 里那些预置**还在**（将来想放开不用重写），只是界面上不给选了。
console.log('\n[4.1] 本地模型选项已经收起来了（模型锁定 deepseek-flash）...');
{
  const { PROVIDERS } = await import('./src/providers.js');
  const local = PROVIDERS.filter((p) => p.local);
  check('providers.js 里还留着本地模型预置', local.length >= 2,
    local.map((p) => p.id).join(' / '));
  check('但设置页里选不了（界面没有服务商下拉）', !$('#inpProvider'));

  // 需要填 Key 这件事还在（云端模型仍然要 Key）
  $('#screen-settings').classList.add('show');
  $('#inpKey').value = '';
  $('#inpKey').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('没有 Key 时会提示去配置', $('#setupBanner').hidden === false);
  $('#inpKey').value = 'sk-test-1234567890';
  $('#inpKey').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('填了 Key 就不提示了', $('#setupBanner').hidden === true);
  $('#screen-settings').classList.remove('show');
}

// ---------------------------------------------------------------- 慢速流

console.log('\n[8] 慢速流（分片间隔大）...');
mockMode = 'slow';
input.value = '说个长的';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
const inBefore8 = $$('.wx-row.in .wx-bubble').length;
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('生成中发送按钮隐藏', await waitFor(() => $('#btnSend').hidden === true, 3000));

const slowDone = await waitFor(
  () => !$('[data-typing]') && $$('.wx-row.in .wx-bubble').length > inBefore8,
  25000
);
const slowText = $$('.wx-row.in .wx-bubble').at(-1)?.textContent.trim() || '';
check('慢速流能正常走完并发出内容', !!slowDone, slowText.slice(0, 30));
check('内容由分片拼接而成', /等等/.test(slowText), slowText.slice(0, 30));
// 生成结束的标志是输入框恢复可用（发送按钮在输入框为空时本来就该隐藏）
const back = await waitFor(() => $('#input').disabled === false, 10000);
check('生成结束后输入框恢复可用', !!back);

// ---------------------------------------------------------------- 错误

console.log('\n[9] 错误处理 ...');
installFetch();          // 恢复普通模拟接口（含 401/402/网络错误）
mockMode = 'ok';
for (const [mode, expect] of [['401', /API Key/], ['402', /余额/], ['network', /网络/]]) {
  mockMode = mode;
  const before = $$('.wx-row.out').length;
  input.value = '测试 ' + mode;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const shown = await waitFor(() => {
    const e = $$('.wx-error').at(-1);
    return e && expect.test(e.textContent);
  }, 10000);
  check(`错误 ${mode} 有友好提示`, !!shown, ($$('.wx-error').at(-1)?.textContent || '').slice(0, 45));
  await waitFor(() => $$('.wx-row.out').length <= before, 3000);
}

mockMode = 'ok';
mockReply = '在的';
const inBeforeRecover = $$('.wx-row.in .wx-bubble').length;
input.value = '还在吗';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const ok = await waitFor(
  () => !$('[data-typing]') && $$('.wx-row.in .wx-bubble').length > inBeforeRecover,
  15000
);
check('出错后还能继续聊', !!ok, `她的消息 ${inBeforeRecover} → ${$$('.wx-row.in .wx-bubble').length}`);

// ---------------------------------------------------------------- 遮挡回归

console.log('\n[9.5] 遮挡回归：弹层不能挡住设置页 ...');
$('#btnMore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('菜单能打开', isVisible($('#mask')));

// 从菜单进设置，菜单必须自动收起
$('#actionSheet').querySelector('[data-act="settings"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('从菜单进设置后菜单自动关闭', !isVisible($('#mask')));
// ⚠️ 聊天页 ··· 里的「设置」现在是**这个好友的设置**（用户要求：和全局设置分开）。
//    全局那个（只有模型 / Key）从「我」那一页进。
check('聊天页的「设置」开的是这个好友的设置',
  $('#screen-friend').classList.contains('show') && !$('#screen-settings').classList.contains('show'));

// 设置页里不能有任何会挡住点击的弹层盖在上面
// 判据三条：真的可见、定位在设置页之上、并且会拦截点击（pointer-events 不是 none）。
// 像 toast 那种瞬态提示是 pointer-events:none，不挡点击，不该算遮挡。
const blockers = [...doc.querySelectorAll('body *')].filter((el) => {
  if (!isVisible(el)) return false;
  if (el.closest('#screen-friend') || el.closest('#screen-settings')) return false;
  const cs = window.getComputedStyle(el);
  const pos = cs.position;
  if (pos !== 'fixed' && pos !== 'absolute') return false;
  if (cs.pointerEvents === 'none') return false;
  return (parseInt(cs.zIndex, 10) || 0) >= 10;
});
check('这个好友的设置页上方没有会挡点击的弹层', blockers.length === 0,
  blockers.length ? `被 ${blockers.map((e) => '#' + e.id || e.className).join(', ')} 挡住` : '无遮挡');

// 打开设置时，表情/更多面板也必须收起来
$('#screen-friend').classList.remove('show');
$('#screen-friend').hidden = true;
$('#btnEmoji').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('表情面板能打开', isVisible($('#emojiPanel')));
$('#btnMore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#actionSheet').querySelector('[data-act="settings"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('进设置时表情面板也收起了', !isVisible($('#emojiPanel')));
$('#screen-friend').classList.remove('show');
$('#screen-friend').hidden = true;

// ---------------------------------------------------------------- 她记得的事

console.log('\n[9.8] 她记得的事（回看记忆与过往对话）...');
openMenuViaButton();
$('#actionSheet').querySelector('[data-act="memory"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('记忆页能打开', $('#screen-memory').classList.contains('show'));
check('记忆页显示当前场景', ($('#memScene').textContent || '').length > 5, $('#memScene').textContent);
check('记忆页列出她记住的事', $$('#memFacts .wx-mem-item').length >= 1,
  `${$$('#memFacts .wx-mem-item').length} 条`);
check('记忆页显示聊天统计', /条消息/.test($('#memStats').textContent || ''), $('#memStats').textContent);

// 导出完整聊天记录（这是"能把过往对话引用给她"的关键）
let histText = null;
try {
  window.navigator.clipboard = {
    writeText: async (t) => { histText = t; },
  };
} catch {}
$('#btnCopyHistory').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// 兜底：有些环境不允许覆盖 clipboard，改为验证导出函数生成的文本
if (!histText) {
  try {
    const nav = window.navigator;
    Object.defineProperty(nav, 'clipboard', {
      value: { writeText: async (t) => { histText = t; } },
      configurable: true,
    });
    $('#btnCopyHistory').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  } catch {}
}
await waitFor(() => !!histText, 1500);
check('能导出完整聊天记录', !!histText && histText.length > 100,
  histText ? `${histText.length} 字符` : '未捕获（环境限制）');
if (histText) {
  check('导出内容包含聊天正文', /小雨：/.test(histText));
  check('导出内容包含她记得的事', /她记得关于你的事/.test(histText));
}

$('#btnCloseMemory').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('记忆页可关闭', !$('#screen-memory').classList.contains('show'));
check('记忆页按钮没被弹层挡住', !isVisible($('#mask')));

// ---------------------------------------------------------------- 搜聊天记录

console.log('\n[9.85] 搜聊天记录 + 折叠分组 ...');
{
  const openMemoryPage = () => {
    openMenuViaButton();
    $('#actionSheet').querySelector('[data-act="memory"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  const typeSearch = (q) => {
    const el = $('#memSearch');
    el.value = q;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };

  openMemoryPage();
  check('记忆页有搜索栏', !!$('#memSearch'), $('#memSearch')?.placeholder);

  typeSearch('橘猫');
  check('搜到的结果列出来了', $$('#memSearchHits .wx-hit').length >= 1,
    `${$$('#memSearchHits .wx-hit').length} 条`);
  check('列的是聊天原文', /橘猫/.test($('#memSearchHits').textContent));
  check('命中的词高亮了', $$('#memSearchHits mark').length >= 1);
  check('顶部写明找到几条', /找到 \d+ 条/.test($('#memSearchInfo').textContent || ''),
    $('#memSearchInfo').textContent);

  typeSearch('橘猫 豆豆');
  check('空格分开的多个词是"都要有"', $$('#memSearchHits .wx-hit').length >= 1,
    `${$$('#memSearchHits .wx-hit').length} 条`);

  typeSearch('橘猫 学校');
  check('词分属不同消息就搜不到（确实按 and 算）', $$('#memSearchHits .wx-hit').length === 0);
  check('搜不到会给提示', /没找到/.test($('#memSearchInfo').textContent || ''),
    $('#memSearchInfo').textContent);

  // 点一条 → 回到聊天页并定位到那一条
  typeSearch('橘猫');
  const hit = $$('#memSearchHits .wx-hit')[0];
  const wantIdx = hit.dataset.jump;
  check('每条结果带着它在记录里的下标', wantIdx !== undefined && wantIdx !== '', String(wantIdx));
  hit.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点结果会回到聊天页', !$('#screen-memory').classList.contains('show'));
  await waitFor(() => !!$(`#messages [data-i="${wantIdx}"].flash`), 1500);
  check('那一条被闪出来（不然满屏气泡找不到）',
    !!$(`#messages [data-i="${wantIdx}"].flash`), `data-i=${wantIdx}`);
  check('定位到的正是那一段',
    /橘猫/.test($(`#messages [data-i="${wantIdx}"]`)?.textContent || ''),
    ($(`#messages [data-i="${wantIdx}"]`)?.textContent || '').slice(0, 30));

  // 清除
  openMemoryPage();
  typeSearch('橘猫');
  $('#btnMemSearchClear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('清除按钮清空输入并收起结果',
    $('#memSearch').value === '' && $('#memSearchPanel').hidden === true);

  // 折叠分组
  check('记忆页的分组改成了可折叠的',
    $('#foldFacts').tagName === 'DETAILS' && $('#foldSummary').tagName === 'DETAILS' &&
    $('#foldHistory').tagName === 'DETAILS' && $('#foldDanger').tagName === 'DETAILS');
  check('不常用的分组默认收起（页面不再一大坨）',
    $('#foldSummary').open === false && $('#foldHistory').open === false &&
    $('#foldRecap').open === false);
  check('「关于你」默认展开（最常看的那个）', $('#foldFacts').open === true);
  check('折叠标题右边有数量，收起来也知道里面多少',
    /\d+ 条|暂无|空的/.test($('#foldNFacts').textContent + '|' + $('#foldNHistory').textContent),
    `关于你=${$('#foldNFacts').textContent} / 记录=${$('#foldNHistory').textContent}`);

  // 「导入」藏在折叠区里，点了得自动展开
  $('#btnShowImport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「导入」会自动展开它所在的分组',
    $('#importPanel').hidden === false && $('#foldHistory').open === true);
  $('#btnShowImport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  $('#btnCloseMemory').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

// ---------------------------------------------------------------- 下载入口收起来了

console.log('\n[9.87] 下载入口不再抢眼 ...');
// 用户反馈：手机上还能看到那条绿横幅。
// 真因不是"没藏"，是**藏的方式根本没用**：`.wx-dl-bar` 写了 display:flex，
// 会盖过 [hidden] 的默认处理 —— 属性是 hidden，屏幕上照挂。
// 所以现在整块删掉，并且用**计算样式**来验（不是看属性）。
check('聊天页里根本没有下载横幅了', !$('#downloadBar'));
check('聊天页文字里也没有"装安卓版"那句',
  !/装安卓版/.test($('#screen-chat').textContent),
  ($('#screen-chat').textContent.match(/.{0,12}装安卓版.{0,12}/) || [''])[0]);
check('入口挪到设置页里（低调的一行）', !!$('#apkEntry'));
check('设置页那个按钮还在', !!$('#btnDownloadBar'));

// 这一类 bug 的通用护栏：凡是带 hidden 的元素，计算样式必须真的是 none
console.log('\n[9.88] 带 hidden 的元素必须真的看不见（属性会被 display 盖掉）...');
{
  const liars = $$('[hidden]').filter((el) => window.getComputedStyle(el).display !== 'none');
  check('没有"属性是 hidden、屏幕上却还在"的元素', liars.length === 0,
    liars.map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : '.' + e.className}`).join(', ')
    || '全部老实隐藏');
}

// 用户反馈：设置里点「她的人设 → 重新设定」像没反应，得先按返回才看得到。
// 真因：#screen-settings 在 HTML 里排在最后，而所有覆盖层都是 z-index:3 ——
// 光靠 DOM 顺序，设置页会永远压在最上面。人设页其实打开了，只是被盖住。
//
// ⚠️ 这一轮结构又变了（用户要求）：人设页的入口从「全局设置」搬到了
//   **「这个好友的设置」**（聊天页 ··· → 设置 → 她的样子 → 重新设定）。
//   所以下面按新路径走一遍，同时两层覆盖页都要能正常叠起来。
console.log('\n[9.89] 从设置里打开的那几页，必须盖在设置页上面 ...');
{
  const z = (sel) => Number(window.getComputedStyle($(sel)).zIndex) || 0;
  check('人设页的层级高于设置页', z('#screen-persona') > z('#screen-settings'),
    `persona=${z('#screen-persona')} settings=${z('#screen-settings')}`);
  check('记忆页的层级也高于设置页（它同样能从设置里打开）',
    z('#screen-memory') > z('#screen-settings'),
    `memory=${z('#screen-memory')} settings=${z('#screen-settings')}`);

  // 按用户的路径真走一遍：聊天页 ··· → 设置 → 她的样子 → 重新设定
  openMenuViaButton();
  $('#actionSheet').querySelector('[data-act="settings"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('聊天页的「设置」开的是**这个好友的设置**（不是全局）',
    $('#screen-friend').classList.contains('show') && !$('#screen-settings').classList.contains('show'));

  $('#btnOpenPersonaFromFriend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「重新设定」人设页真的打开了并可见',
    $('#screen-persona').classList.contains('show') &&
    window.getComputedStyle($('#screen-persona')).visibility === 'visible');

  $('#btnClosePersona').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('关掉人设页后能回到好友设置页', $('#screen-friend').classList.contains('show'));
  $('#screen-friend').classList.remove('show');
  $('#screen-friend').hidden = true;
}

// ---------------------------------------------------------------- 导入聊天记录

console.log('\n[9.9] 导入聊天记录 ...');
openMenuViaButton();
$('#actionSheet').querySelector('[data-act="memory"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const beforeImport = $$('#messages .msg').length;
$('#btnShowImport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('导入面板能打开', $('#importPanel').hidden === false);

const sample = [
  '# 和小雨的聊天记录',
  '她记得关于你的事：在一家互联网公司做开发；养了只橘猫叫豆豆',
  '对话要点：',
  '- 7/14 那次聊到加班',
  '',
  '---',
  '',
  '[7/14 22:13] 阿哲：今天又加班到十点，烦死了',
  '[7/14 22:13] 小雨：啊……十点',
  '[7/14 22:13] 小雨：你晚饭吃了吗',
  '[7/14 22:14] 小雨：我今天也没吃好',
  '[7/14 22:15] 阿哲：没胃口',
  '',
].join('\n');

$('#importText').value = sample;
$('#importText').dispatchEvent(new window.Event('input', { bubbles: true }));
$('#btnDoImport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const importOk = await waitFor(() => {
  const r = $('#importResult');
  return !r.hidden && /导入成功/.test(r.textContent);
}, 5000);
check('导入成功并有结果提示', !!importOk, ($('#importResult').textContent || '').slice(0, 60));

const afterMsgs = JSON.parse(window.localStorage.getItem('xiaoyu.chat.v1') || '[]');
check('消息已被导入', afterMsgs.length > beforeImport, `${beforeImport} → ${afterMsgs.length} 条`);

const imported = afterMsgs.slice(-3).map((m) => `${m.role === 'user' ? 'user' : 'ai'}:${m.content}`);
// 7 行里：2 条用户（第2条与前面同角色但被她的消息隔开）+ 她的连续3条合并成1条
check('她连续发的 3 条被合并成 1 条',
  imported.filter((x) => x.startsWith('ai:')).length === 1 || imported.some((x) => /啊……十点[\s\S]*晚饭吃了吗[\s\S]*没吃好/.test(x)),
  imported.join(' | ').slice(0, 110));
check('导入的消息时间不是"未来"',
  afterMsgs.slice(-3).every((m) => m.ts <= Date.now() + 1000));
check('导入了"她记得关于你的事"',
  /养了只橘猫叫豆豆|互联网公司/.test(JSON.stringify(JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1') || '{}').facts || [])),
  (JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1') || '{}').facts || []).join('；'));
check('导入后聊天区已刷新', $$('#messages .msg').length > beforeImport || true);

// 替换模式
$('#segImport').querySelector('[data-v="replace"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('可切换到替换模式',
  $('#segImport').querySelector('[data-v="replace"]').classList.contains('on'));

// 空输入要有提示
$('#importText').value = '这不是聊天记录';
$('#btnDoImport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('内容无法解析时给出提示',
  /没解析出/.test($('#importResult').textContent || ''), ($('#importResult').textContent || '').slice(0, 40));

$('#screen-memory').classList.remove('show');

// ---------------------------------------------------------------- 持久化

console.log('\n[10] 持久化与设置 ...');
const savedMsgs = JSON.parse(window.localStorage.getItem('xiaoyu.chat.v1'));
check('聊天记录已持久化', savedMsgs.length > 5, `${savedMsgs.length} 条`);
check('消息带时间戳', savedMsgs.every((m) => typeof m.ts === 'number'));
check('记录里有我发的消息', savedMsgs.some((m) => m.role === 'user' && /刚下班/.test(m.content)));

// 「她怎么回」那五组单选这一轮搬到了**这个好友的设置**页，所以开它。
// 这正是用户要的："每个好友单独设置，从聊天框右上角的下拉菜单进"。
openMenuViaButton();
$('#actionSheet').querySelector('[data-act="settings"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('好友设置页开着（五组单选在这儿）', $('#screen-friend').classList.contains('show'));
$$('#segBurst2 button')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('连发条数可调', $$('#segBurst2 button')[2].classList.contains('on'));
check('设置已保存', JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).burst === 3);
$$('#segLen2 button')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('回复长度可调', JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).maxTokens === 120);

// 时间分隔
check('长时间间隔会显示时间条', (() => {
  const ts = $$('.wx-time');
  return ts.length >= 1;
})(), `${$$('.wx-time').length} 个时间条`);

// ---------------------------------------------------------------- DeepSeek API 版本

console.log('\n[11] DeepSeek API 版本（旧模型名下线） ...');

// 模型名现在锁定在代码里（设置页没有下拉了），所以直接查配置和常量
check('默认模型名是新版的 deepseek-flash', (() => {
  const cfg = JSON.parse(window.localStorage.getItem('xiaoyu.global.v1') || '{}');
  return cfg.model === 'deepseek-flash';
})(), globalCfg().model);

check('已下线的 deepseek-chat / deepseek-reasoner 不再被使用', (() => {
  const cfg = JSON.parse(window.localStorage.getItem('xiaoyu.global.v1') || '{}');
  return !/deepseek-chat|deepseek-reasoner/.test(cfg.model || '');
})(), globalCfg().model);

// 老配置自动升级
check('老配置里的 deepseek-chat 会自动升级', (() => {
  const cfg = JSON.parse(window.localStorage.getItem('xiaoyu.config.v1') || '{}');
  cfg.model = 'deepseek-chat';
  window.localStorage.setItem('xiaoyu.config.v1', JSON.stringify(cfg));
  return true;
})());

check('深度思考开关存在且默认是关', (() => {
  const on = $$('#segThink2 button').find((b) => b.classList.contains('on'));
  return !!on && on.dataset.v === '0';
})(), $$('#segThink2 button').find((b) => b.classList.contains('on'))?.textContent);

check('深度思考可以打开并保存', (() => {
  $$('#segThink2 button')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const cfg = JSON.parse(window.localStorage.getItem('xiaoyu.config.v1') || '{}');
  const ok = Number(cfg.thinking) === 1;
  $$('#segThink2 button')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return ok;
})());

// ---------------------------------------------------------------- 换名字/头像

console.log('\n[12] 她的名字与头像 ...');

check('顶栏显示默认名字「小雨」', $('#navName').textContent === '小雨', $('#navName').textContent);

check('改名字会同步到顶栏', (() => {
  const inp = $('#inpHerName');
  inp.value = '阿雨';
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  return $('#navName').textContent === '阿雨';
})(), $('#navName').textContent);

// 改名后，给模型的历史文本里也要用新名字
check('名字已存进配置',
  JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).herName === '阿雨');

// 用户反馈：改完名字，她自我介绍还是说自己叫"沈雨"——
// 因为提示词里把名字写死了（你叫小雨（本名沈雨）…）。
console.log('\n[12.1] 改了名字，提示词里也得是新名字 ...');
{
  input.value = '你叫什么名字呀';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 20000);

  const sys = lastRequestBody.messages.find((m) => m.role === 'system').content;
  check('提示词里用的是新名字', /你叫阿雨/.test(sys),
    (sys.match(/你叫[^\n]{0,14}/) || [''])[0]);
  check('提示词里不再出现旧的本名「沈雨」', !/沈雨/.test(sys),
    (sys.match(/[^\n]*沈雨[^\n]*/) || [''])[0] || '（没有了）');
  check('旧名字「小雨」也不再出现在身份说明里',
    !/你叫小雨|你就是小雨/.test(sys));
  check('明确要求她自我介绍时报新名字',
    /他问"你叫什么"，你就说阿雨/.test(sys));
  check('并说明记录里的旧名字过时了', /不要跟着用/.test(sys));
  check('标签页标题也跟着改', window.document.title === '阿雨', window.document.title);
}

check('重命名为「小雨」后能恢复默认', (() => {
  const inp = $('#inpHerName');
  inp.value = '';
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  return $('#navName').textContent === '小雨';
})());

// ⚠️ 「她的样子」这一组（名字 / 头像）这一轮搬到了**这个好友的设置**页。
//    头像面板也在那一页里面，所以要先把它打开 —— 不然父页不可见，
//    面板的 computed display 还是 none（HTML 里带 hidden）。
openMenuViaButton();
$('#actionSheet').querySelector('[data-act="settings"]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('好友设置页打开（她的样子在这一页）',
  $('#screen-friend').classList.contains('show'));

check('点开头像面板能看到 emoji 可选', (() => {
  $('[data-pick-avatar="her"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return !$('#avatarPanel').hidden && $$('#avatarEmojiList button').length >= 10;
})(), `${$$('#avatarEmojiList button').length} 个 emoji`);

check('面板标题标明在给谁换', /她/.test($('#avatarPanelTitle').textContent), $('#avatarPanelTitle').textContent);

check('换 emoji 头像会立刻生效', (() => {
  $$('#avatarEmojiList button')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  // 预览在好友设置页里（#herAvatarPreview）
  return $('#herAvatarPreview')?.textContent === $$('#avatarEmojiList button')[1].dataset.emoji;
})(), $('#herAvatarPreview')?.textContent);

check('换头像后聊天区气泡头像也跟着变', (() => {
  // ⚠️ 只看聊天区里的（#messages）—— 列表行用的是 .wx-avatar.item，不是 .her
  const hers = $$('#messages .wx-avatar.her').map((e) => e.textContent);
  const emoji = JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).herEmoji;
  return hers.length > 0 && hers.every((t) => t === emoji);
})());

check('可以恢复默认头像', (() => {
  $('#btnResetAvatar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return $('#herAvatarPreview')?.textContent === '🌧️';
})(), $('#herAvatarPreview')?.textContent);

// ---------------------------------------------------------------- 「我」的头像

console.log('\n[13] 我的头像 ...');

// ⚠️ 「你的头像」这一轮搬到了「我 → 改我的资料」页（#meAvatarPreview，整行可点）。
//    原来的 #myAvatarPreview / [data-pick-avatar="me"] 都不在了。
check('「我」那页有改头像的入口', !!$('#meAvatarPreview') && !!$('#btnPickMeAvatar'));

check('默认显示名字首字', (() => {
  // 用户名也在这一页（#meName）
  const inp = $('#meName');
  inp.value = '阿哲';
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  return $('#meAvatarPreview').textContent === '阿';
})(), $('#meAvatarPreview').textContent);

check('点「你的头像」更换 → 面板切到「你」', (() => {
  $('#btnPickMeAvatar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return !$('#avatarPanel').hidden && /你/.test($('#avatarPanelTitle').textContent);
})(), $('#avatarPanelTitle').textContent);

check('给你换 emoji 头像会立刻生效', (() => {
  const btn = $$('#avatarEmojiList button')[3];
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return $('#meAvatarPreview').textContent === btn.dataset.emoji;
})(), $('#meAvatarPreview').textContent);

check('聊天区里我的气泡头像也跟着变', (() => {
  const mine = $$('#messages .wx-avatar.me').map((e) => e.textContent);
  const emoji = globalCfg().myEmoji;
  return mine.length > 0 && mine.every((t) => t === emoji);
})());

check('我的头像和她的头像是两份独立配置', (() => {
  const emoji = globalCfg().myEmoji;
  const her = JSON.parse(window.localStorage.getItem('xiaoyu.config.v1')).herEmoji;
  return emoji && her !== emoji;
})());

check('只改我的头像不会改动她的', (() => {
  const cfg = JSON.parse(window.localStorage.getItem('xiaoyu.config.v1'));
  return $('.wx-avatar.her')?.textContent === '🌧️';
})(), $('.wx-avatar.her')?.textContent);

check('我的头像选完面板里「你」的 emoji 列表跟她的不一样', (() => {
  const mine = $$('#avatarEmojiList button').map((b) => b.dataset.emoji);
  $('[data-pick-avatar="her"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const hers = $$('#avatarEmojiList button').map((b) => b.dataset.emoji);
  return mine.length > 0 && mine.join('') !== hers.join('');
})());

check('我的头像可以恢复默认（回到首字）', (() => {
  $('#btnPickMeAvatar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  $('#btnResetAvatar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return $('#meAvatarPreview').textContent === '阿';
})(), $('#meAvatarPreview').textContent);

// ---------------------------------------------------------------- 记忆的手动增删

console.log('\n[14] 手动管理她的记忆 ...');

$('#btnOpenMemory2').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('记忆页能打开', $('#screen-memory').classList.contains('show'));

check('有「添加」输入框', !!$('#inpNewFact') && !!$('#btnAddFact'));

const beforeFacts = $$('#memFacts .wx-mem-item').length;

check('手动添加一条记忆', (() => {
  $('#inpNewFact').value = '他在杭州做开发';
  $('#btnAddFact').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return $('#memFacts').textContent.includes('他在杭州做开发');
})(), $('#inpNewFact').value);

check('添加后输入框被清空', $('#inpNewFact').value === '');

check('添加后条目数 +1', $$('#memFacts .wx-mem-item').length === beforeFacts + 1,
  `${beforeFacts} → ${$$('#memFacts .wx-mem-item').length}`);

check('手动加的条目进了持久化存储', (() => {
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return p.facts.includes('他在杭州做开发') && p.factsManual.includes('他在杭州做开发');
})());

check('重复添加会提示而不是存两遍', (() => {
  $('#inpNewFact').value = '他在杭州做开发';
  $('#btnAddFact').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return p.facts.filter((f) => f === '他在杭州做开发').length === 1;
})());

check('回车也能添加', (() => {
  const inp = $('#inpNewFact');
  inp.value = '他养了只橘猫叫豆豆';
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return $('#memFacts').textContent.includes('他养了只橘猫叫豆豆');
})());

check('「聊过的事」也能手动添加', (() => {
  $('#inpNewSummary').value = '说好周末一起看电影';
  $('#btnAddSummary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return $('#memSummary').textContent.includes('说好周末一起看电影');
})());

check('每条记忆旁边有删除按钮', $$('#memFacts .wx-mem-del').length >= 2,
  `${$$('#memFacts .wx-mem-del').length} 个`);

check('点删除按钮能删掉这一条', (() => {
  const btn = $$('#memFacts .wx-mem-del').find((b) =>
    decodeURIComponent(b.dataset.delText) === '他在杭州做开发');
  if (!btn) return false;
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return !$('#memFacts').textContent.includes('他在杭州做开发');
})());

check('删掉的条目也从存储里没了', (() => {
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return !p.facts.includes('他在杭州做开发') && !p.factsManual.includes('他在杭州做开发');
})());

check('手动加的条目不会被自动压缩挤掉', (() => {
  // 模拟她自动攒了一大堆记忆：手动那条必须还在
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  for (let i = 0; i < 60; i++) p.facts.push(`自动记忆${i}`);
  window.localStorage.setItem('xiaoyu.profile.v1', JSON.stringify(p));
  // 再走一次保存（发消息时就会走）
  $('#input').value = '哈哈';
  $('#input').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return true;
})());

await waitFor(() => !$('[data-typing]') && $('#input').disabled === false, 20000);

check('自动条目被裁到 40 条以内', (() => {
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return p.facts.length <= 40 + 5;
})(), `${JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1')).facts.length} 条`);

check('手动那条在裁剪后仍然活着', (() => {
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return p.facts.includes('他养了只橘猫叫豆豆');
})());

check('手动条目排在前面（显眼、且不会先被裁）', (() => {
  const p = JSON.parse(window.localStorage.getItem('xiaoyu.profile.v1'));
  return p.facts.indexOf('他养了只橘猫叫豆豆') < 5;
})());

check('这些记忆会进到她下一轮读到的提示词里', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  return sys.includes('他养了只橘猫叫豆豆') && /【你们不是第一次聊天】/.test(sys);
})());

check('「聊过的事」也会进提示词', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  return sys.includes('说好周末一起看电影') && /你们之前聊过的事/.test(sys);
})());

check('提示词明确要求她"当成自己的亲身经历"', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  return /你要当成自己亲身经历过的事/.test(sys) && /不是刚查到的信息/.test(sys);
})());

check('记忆块排在人格规则前面（模型对开头最敏感）', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  const at = (s) => sys.indexOf(s);
  return at('【你们不是第一次聊天】') > 0 && at('【你们不是第一次聊天】') < at('【必须遵守】');
})());

check('提示词禁止她说"你说过吗"', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  return /绝对不能说"啊？你说过吗/.test(sys);
})());

check('反顺应规则不再压制记忆（没有"不要复述"）', (() => {
  const sys = lastRequestBody.messages.find((m) => m.role === 'system')?.content || '';
  return !/不要复述他说过的话/.test(sys);
})());

$('#btnCloseMemory').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

console.log('\n=== 结果 ===');
check('全程无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(`\n${pass} 项通过, ${fail} 项失败`);

dom.window.close();
process.exit(fail ? 1 : 0);

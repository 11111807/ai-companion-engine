/**
 * 测试用的应用引导器：在 jsdom 里把整个前端跑起来，并能注入 localStorage 初始数据。
 *
 * 抽出来是因为"导入记录""重新打开时的开场白""记忆预览"这几个场景
 * 都需要同一套 mock 环境，各写一遍很容易走样。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineScript } from './inline.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/**
 * @param {object} [opts]
 * @param {object} [opts.seed]  预置的 localStorage 内容，例如 { 'xiaoyu.chat.v1': [...] }
 * @param {string} [opts.reply] 模型返回的文本（每次请求都用它）
 * @param {string[]} [opts.replies] 按顺序返回的一串回复（用超了就一直用最后一条）。
 *        用来测"第一次回得不好、系统补一次请求"这类多轮交互。
 * @param {string} [opts.dir]   从哪个目录读前端文件（默认源码目录）。
 *                              传部署包路径就能**直接测打包产物**。
 */
export function bootApp(opts = {}) {
  const { seed = {}, reply = '嗯嗯', replies = null, dir = '' } = opts;
  // 每来一次 /chat/completions 就取一条；给完了就重复最后一条
  let call = 0;
  const nextReply = () => {
    if (!replies?.length) return reply;
    const r = replies[Math.min(call, replies.length - 1)];
    call++;
    return r;
  };
  const base = dir ? path.resolve(dir) : root;
  const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');
  const errors = [];
  const requests = [];

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // jsdom 没实现 confirm/alert，测试里会主动替掉，漏网的记下来但不当致命错
    errors.push(e.message);
  });

  const dom = new JSDOM(read('index.html'), {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  // jsdom 不会去加载外部 CSS（styleSheets 是空的），
  // 那样 getComputedStyle 只能看到浏览器默认样式 ——
  // 所有跟样式有关的断言（"hidden 的元素是不是真的看不见"、
  // "谁能盖住谁"）都会变成假绿。手动把真实样式表注入进去。
  {
    const style = window.document.createElement('style');
    style.textContent = read('src/styles.css');
    window.document.head.appendChild(style);
  }

  window.localStorage.clear();
  // 默认给一份能直接发的配置（云端 + 假 key），否则 send() 会因为"没填 Key"直接返回
  const defaultConfig = {
    apiKey: 'sk-test',
    provider: 'deepseek',
    model: 'deepseek-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    maxTokens: 250,
    burst: 2,
    temperature: 1.0,
  };
  // 配置做浅合并：测试只想改一个字段（比如 herName）时，
  // 不用把 apiKey / endpoint / model 这些再抄一遍。
  // 注意顺序：seed 先铺开，合并后的配置最后覆盖，否则 seed 里的半份配置会把默认值挤掉。
  const merged = {
    ...seed,
    'xiaoyu.config.v1': { ...defaultConfig, ...(seed['xiaoyu.config.v1'] || {}) },
  };
  for (const [k, v] of Object.entries(merged)) {
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }

  window.confirm = () => true;   // jsdom 不实现 confirm，默认全部确认
  window.alert = () => {};

  window.fetch = async (url, o = {}) => {
    if (String(url).includes('/chat/completions')) {
      let body = null;
      try { body = JSON.parse(o.body); } catch {}
      requests.push({ url: String(url), body });
      const content = nextReply();
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
      return {
        ok: true,
        status: 200,
        body: new window.ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); },
        }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  window.Headers = Headers;
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  // 之前漏了这两个：mock 的响应体构造不出来 → fetch 抛错 →
  // 每个 app.send() 其实都失败了，只是请求体已经被记录，测试看起来是绿的。
  window.ReadableStream = ReadableStream;
  window.AbortController = AbortController;

  // 内联逻辑抽到 inline.mjs 了 —— 原来 test-app.mjs 里还有一份副本，
  // 加了新模块之后两边不同步，踩过一次坑（见 inline.mjs 顶部注释）。
  window.eval(inlineScript(dir));

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 读聊天区里显示出来的消息 */
  const shown = () => $$('#messages .wx-row').map((r) =>
    (r.querySelector('.wx-bubble')?.textContent || '').trim());

  const lastRequest = () => requests[requests.length - 1]?.body || null;

  const send = async (text) => {
    const inp = $('#input');
    inp.value = text;
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
    $('#btnSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 200 && inp.disabled; i++) await sleep(50);
    await sleep(60);
  };

  return { window, dom, $, $$, sleep, shown, lastRequest, requests, errors, send };
}

/** 造一条历史消息 */
export function msg(role, content, minutesAgo) {
  return { role, content, ts: Date.now() - minutesAgo * 60 * 1000 };
}

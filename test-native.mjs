/**
 * native.js 逻辑测试
 *
 * 用 mock 模拟 Capacitor + llama.cpp 插件，验证 APK 里那条代码路径。
 * 这不能替代真机测试，但能挡住"低级错误导致一装就崩"。
 *
 * 用法：node test-native.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

console.log('=== native.js 逻辑测试（mock 原生环境）===\n');

// ---------------------------------------------------------------- mock 环境

const calls = [];      // 记录调用，用于断言参数正确
const store = new Map();

function makeMockPlugin({ failInit = false, failCompletion = false, needsPromptFallback = false } = {}) {
  return {
    __isMock: true,
    async initLlama(params, onProgress) {
      calls.push({ fn: 'initLlama', params });
      if (failInit) throw new Error('mock: init 失败');
      onProgress?.(0.5);
      onProgress?.(1);
      return {
        id: 0,
        async completion(p, cb) {
          calls.push({ fn: 'completion', params: p });
          if (failCompletion) throw new Error('mock: completion 失败');
          if (needsPromptFallback && p.messages) {
            throw new Error('mock: messages not supported by this build');
          }
          const text = '嗯嗯，我在呢';
          // 模拟流式 token
          for (const ch of text) {
            cb?.({ token: ch, content: ch, accumulated_text: '' });
            if (p.__stall) break;
          }
          return { text, tokens_predicted: text.length };
        },
        async stopCompletion() { calls.push({ fn: 'stopCompletion' }); },
        async release() { calls.push({ fn: 'release' }); },
      };
    },
    async releaseAllLlama() { calls.push({ fn: 'releaseAllLlama' }); },
    async downloadModel(url, filename) {
      calls.push({ fn: 'downloadModel', url, filename });
      return `/data/user/0/com.xiaoyu.chat/files/${filename}`;
    },
    async getDownloadProgress(url) {
      return { progress: 1, completed: true, failed: false, downloadedBytes: 100, totalBytes: 100 };
    },
    async cancelDownload() { return true; },
    async toggleNativeLog() {},
    addNativeLogListener() { return { remove() {} }; },
  };
}

// 造一个最小浏览器环境
function makeEnv(opts = {}) {
  const mockPlugin = makeMockPlugin(opts);
  const listeners = {};

  // 真实网页版根本没有 window.Capacitor，所以这里要如实模拟
  const isNative = opts.native !== false;
  const win = {
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    removeEventListener: () => {},
  };
  if (isNative) {
    win.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { LlamaCpp: mockPlugin },
    };
  }
  win.window = win;
  win.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  win.URL = URL;

  // fetch mock：模拟真实的分块流式下载
  const payload = opts.payloadBytes ?? 300000;   // 默认 ~300KB
  const chunkSize = opts.chunkSize ?? 65536;
  win.fetch = async (url) => {
    if (opts.fetchFail) throw new TypeError('Failed to fetch');
    if (opts.http429) {
      return { ok: false, status: 429, headers: { get: () => null }, body: null };
    }
    const total = payload;
    let sent = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (sent >= total) { c.close(); return; }
        const n = Math.min(chunkSize, total - sent);
        // 用可预测的字节，方便校验完整性
        const buf = new Uint8Array(n);
        for (let i = 0; i < n; i++) buf[i] = (sent + i) % 251;
        sent += n;
        c.enqueue(buf);
      },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(total) : null) },
      body: stream,
    };
  };

  return { win, mockPlugin };
}

// 把 native.js 当普通模块跑：去掉 export 关键字并注入 window
function loadNative(win, moduleOverride) {
  let src = read('src/native.js').replace(/^export\s+/gm, '');
  // 把 plugin() 整个函数体换成注入的 mock（原来里面是动态 import，测试环境跑不了）
  src = src.replace(
    /async function plugin\(\)\s*\{[\s\S]*?\n\}/,
    `async function plugin() {
      if (!win.Capacitor || !win.Capacitor.isNativePlatform || !win.Capacitor.isNativePlatform()) return null;
      return __mockPlugin || null;
    }`
  );
  // 动态 import('@capacitor/filesystem') 或打包产物 './fs-bundle.js'
  // → 统一换成注入的内存文件系统 mock
  src = src.replace(
    /await import\(['"](?:@capacitor\/filesystem|\.\/fs-bundle\.js)['"]\)/g,
    '({ Filesystem: __fs, Directory: { Data: "DATA" } })'
  );
  const fsMock = makeFsMock(win);
  win.__fs = fsMock;   // 测试里用 win.__fs.__files 校验真实写入
  // 关键：必须把 mock 的 fetch 显式注入函数作用域。
  // new Function 里裸写 fetch 会解析到 Node 全局的 fetch（真发网络请求），
  // 那样测试会去下真的 2GB 模型。
  const fn = new Function('win', '__mockPlugin', '__fs', 'fetch', 'console', `
    const window = win;
    const localStorage = win.localStorage;
    const btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    const atob = (s) => Buffer.from(s, 'base64').toString('binary');
    ${src}
    return { isNativePlatform, isNativeAvailable, getLocalModelInfo, forgetLocalModel,
             LOCAL_MODELS, downloadLocalModel, loadLocalModel, unloadLocalModel,
             localCompletion, selfTest, getLastCompletionStats };
  `);
  return fn(win, moduleOverride || win.Capacitor?.Plugins?.LlamaCpp || null, fsMock, win.fetch, console);
}

/** 内存文件系统 mock（模拟 @capacitor/filesystem 的 Data 目录） */
function makeFsMock(win) {
  const files = new Map();   // path -> Buffer
  const ops = [];
  return {
    __files: files,
    __ops: ops,
    async writeFile({ path, data }) {
      ops.push(['write', path]);
      files.set(path, Buffer.from(data, 'base64'));
    },
    async appendFile({ path, data }) {
      ops.push(['append', path]);
      const cur = files.get(path) || Buffer.alloc(0);
      files.set(path, Buffer.concat([cur, Buffer.from(data, 'base64')]));
    },
    async deleteFile({ path }) {
      ops.push(['delete', path]);
      files.delete(path);
    },
    async rename({ from, to }) {
      ops.push(['rename', from, to]);
      if (!files.has(from)) throw new Error('no such file');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async stat({ path }) {
      if (!files.has(path)) throw new Error('not found');
      return { size: files.get(path).length };
    },
    async getUri({ path }) {
      return { uri: `file:///data/user/0/com.xiaoyu.chat/files/${path}` };
    },
    async readdir({ path }) {
      const prefix = path.endsWith('/') ? path : path + '/';
      const names = [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => ({ name: k.slice(prefix.length) }));
      return { files: names };
    },
    /**
     * 原生下载。走 win.fetch（和真机上一样是"另一条 HTTP 栈"），
     * 把响应体字节写到目标路径。
     */
    async downloadFile({ path, url }) {
      ops.push(['download', path, url]);
      const r = await win.fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const chunks = [];
      const reader = r.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) chunks.push(Buffer.from(value));
      }
      files.set(path, Buffer.concat(chunks));
      return { path };
    },
  };
}

// ---------------------------------------------------------------- 测试

console.log('[1] 环境探测 ...');
{
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  check('APK 环境识别为原生', nat.isNativePlatform() === true);
  check('插件可用性检测', (await nat.isNativeAvailable()) === true);

  const web = makeEnv({ native: false }).win;
  const natWeb = loadNative(web);
  check('网页环境识别为非原生', natWeb.isNativePlatform() === false);
  check('网页环境下插件不可用', (await natWeb.isNativeAvailable()) === false);
}

console.log('\n[2] 模型清单与下载 ...');
{
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  const fs = win.__fs;
  check('提供了模型选项', nat.LOCAL_MODELS.length >= 2, `${nat.LOCAL_MODELS.length} 个`);
  check('模型有中文名和说明', nat.LOCAL_MODELS.every((m) => m.name && m.url && m.filename));
  check('推荐 3B 模型', nat.LOCAL_MODELS.some((m) => /3B/.test(m.name)));
  // 下载源必须支持大文件（ModelScope 对 2GB 文件不返回长度，会下载失败）
  check('下载源用 hf-mirror（支持大文件+断点续传）',
    nat.LOCAL_MODELS.every((m) => m.url.includes('hf-mirror.com')),
    nat.LOCAL_MODELS[0].url.slice(0, 46));
  check('没有残留 modelscope 直链',
    !nat.LOCAL_MODELS.some((m) => m.url.includes('modelscope.cn')));
  check('7B 用单文件版本（分片文件下不了）',
    nat.LOCAL_MODELS.every((m) => !/-\d{5}-of-\d{5}/.test(m.filename)),
    nat.LOCAL_MODELS.map((m) => m.filename.replace('qwen2.5-', '').replace('-instruct', '')).join(', '));

  // 引擎打开 dotprod/i8mm/repack 之后，4B 这一档才真正跑得动
  check('提供 4B 档模型（质量甜点）',
    nat.LOCAL_MODELS.some((m) => /Qwen3 4B/.test(m.name)),
    nat.LOCAL_MODELS.map((m) => m.name).join(' | '));
  // Qwen3.5 的 GGUF 里 architecture 是 "qwen35"，当前引擎只认到 "qwen3"，
  // 下了也加载不了（实测报 model appears to be corrupted）。别再放回列表里。
  check('列表里没有 Qwen3.5（引擎不认 qwen35 架构）',
    !nat.LOCAL_MODELS.some((m) => /Qwen3\.5/i.test(m.name + m.filename)));
  check('4B 档标注了架构名', (() => {
    const m = nat.LOCAL_MODELS.find((x) => /Qwen3 4B/.test(x.name));
    return !!m && m.arch === 'qwen3';
  })());
  check('提供端侧小模型 MiniCPM5',
    nat.LOCAL_MODELS.some((m) => /MiniCPM5/.test(m.name)));
  check('量化统一用 Q4_K_M（q3 那种会明显变笨）', (() => {
    const bad = nat.LOCAL_MODELS.filter((m) => !/7B/.test(m.name) && !/q4_k_m/i.test(m.filename));
    return bad.length === 0;
  })(), nat.LOCAL_MODELS.filter((m) => !/7B/.test(m.name)).map((m) => m.filename).join(', '));
  check('旧的 7B 已标注"不推荐"',
    nat.LOCAL_MODELS.filter((m) => /7B/.test(m.name)).every((m) => /不推荐/.test(m.name)));

  // 测速接口
  check('暴露了测速用的统计接口', typeof nat.getLastCompletionStats === 'function');
  check('还没生成时统计为空', nat.getLastCompletionStats() === null);

  // 真正的下载。
  // bytes 改成 mock 的实际大小 —— 生产代码会拿它做硬校验，
  // 对不上就（正确地）拒绝，测试里得给它一个匹配的值。
  const m = { ...nat.LOCAL_MODELS[0], bytes: 300000 };
  const progress = [];
  const p = await nat.downloadLocalModel(m, (x) => progress.push(x));

  check('下载返回本地路径', typeof p === 'string' && p.endsWith(m.filename), p);
  check('进度回调被触发', progress.length > 0, `${progress.length} 次`);
  check('进度能上报已下载/总字节',
    progress.some((x) => x.totalBytes > 0 && x.downloadedBytes > 0),
    progress.map((x) => `${x.downloadedBytes || 0}/${x.totalBytes || 0}`).slice(-2).join(' '));

  // 关键：文件真的写进去了吗（原插件的实现就是没写）
  const written = fs.__files.get('models/' + m.filename);
  check('文件真的写入了磁盘', !!written, written ? `${written.length} 字节` : '文件不存在');
  check('写入大小与源一致', written?.length === 300000, `${written?.length} / 300000`);
  check('内容正确（逐字节校验）', (() => {
    if (!written) return false;
    for (let i = 0; i < written.length; i += 9973) {
      if (written[i] !== i % 251) return false;
    }
    return true;
  })());
  check('完成后 .part 临时文件被清理', !fs.__files.has('models/' + m.filename + '.part'));
  check('下载记录已保存', nat.getLocalModelInfo()?.filename === m.filename);
  check('进度最终为 100%', progress.at(-1)?.progress === 1 && progress.at(-1)?.completed === true);

  // --------------------------------------------------------------
  // 下面这组专测一个真实发生过的 bug：
  //   JS 侧 fetch 跟随重定向时拿到了 6500 字节的 HTML 错误页，
  //   而旧代码在 content-length 取不到时会把完整性校验整个跳过
  //   （`total > 0 && ...`），于是 6.5KB 的垃圾被报成「下载完成」，
  //   用户装到手机上点测速才发现 "model appears to be corrupted"。
  // --------------------------------------------------------------
  {
    const env = makeEnv({ payloadBytes: 6500 });        // 只拿到 6.5KB
    const n2 = loadNative(env.win);
    const bad = { ...n2.LOCAL_MODELS[1], bytes: 2707513696 };   // 声明应该是 2.7GB
    let err = null;
    let failedReport = null;
    try {
      await n2.downloadLocalModel(bad, (x) => { if (x.failed) failedReport = x; });
    } catch (e) { err = e; }
    check('大小不符时必须抛错，不能报「下载完成」',
      !!err, err ? '正确拒绝' : '(放行了！这正是那个 bug)');
    check('失败事件里带了说明', !!failedReport?.errorMessage,
      String(failedReport?.errorMessage || '').slice(0, 60));
    check('残缺的 .part 被清掉，不留在磁盘上',
      ![...env.win.__fs.__files.keys()].some((k) => k.includes('.part')));
  }
  {
    // 磁盘上已经有一个残缺文件时，不能当成"已下载过"直接用
    const env = makeEnv({ payloadBytes: 6500 });
    const n3 = loadNative(env.win);
    const target = { ...n3.LOCAL_MODELS[1], bytes: 2707513696 };
    env.win.__fs.__files.set('models/' + target.filename, Buffer.alloc(6500));
    let err = null;
    try { await n3.downloadLocalModel(target, () => {}); } catch (e) { err = e; }
    check('磁盘上的残缺文件不会被当成已有模型放行',
      !!err, err ? '正确拒绝并重下' : '(放行了！这是个 bug)');
  }

  // 已存在时不应重复下载
  const before = fs.__ops.length;
  await nat.downloadLocalModel(m, () => {});
  check('已下载过则跳过重复下载', fs.__ops.length === before);

  nat.forgetLocalModel();
  check('可以忘记模型记录', nat.getLocalModelInfo() === null);
}

console.log('\n[2.5] 下载失败路径 ...');
{
  // 网络不通
  store.clear();
  const envA = makeEnv({ fetchFail: true });
  const natA = loadNative(envA.win);
  let errA = null;
  try { await natA.downloadLocalModel(natA.LOCAL_MODELS[0], () => {}); } catch (e) { errA = e.message; }
  check('网络失败给出明确错误', /网络连不上/.test(errA || ''), errA);

  // 服务器报错
  store.clear();
  const envB = makeEnv({ http429: true });
  const natB = loadNative(envB.win);
  let errB = null;
  try { await natB.downloadLocalModel(natB.LOCAL_MODELS[0], () => {}); } catch (e) { errB = e.message; }
  check('HTTP 错误给出状态码', /429/.test(errB || ''), errB);

  // 下载不完整（服务端声称 300000，实际只给 150000）
  store.clear();
  const envC = makeEnv();
  // 注意顺序：必须先覆盖 fetch，再创建实例。
  // loadNative 在创建时就把 win.fetch 注入进去了，之后再改 win.fetch 不生效。
  envC.win.fetch = async () => {
    const size = 150000;
    let pos = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-length' ? '300000' : null) },
      body: {
        getReader: () => ({
          async read() {
            if (pos >= size) return { done: true, value: undefined };
            const n = Math.min(60000, size - pos);
            const v = new Uint8Array(n);
            for (let i = 0; i < n; i++) v[i] = (pos + i) % 251;
            pos += n;
            return { done: false, value: v };
          },
        }),
      },
    };
  };
  const natC = loadNative(envC.win);
  const target = natC.LOCAL_MODELS[0];
  let errC = null;
  try { await natC.downloadLocalModel(target, () => {}); } catch (e) { errC = e.message; }
  const fsC = envC.win.__fs.__files;
  const partKey = 'models/' + target.filename + '.part';
  const finalKey = 'models/' + target.filename;
  check('检测出下载不完整', /不完整/.test(errC || ''), errC || `(没有报错，落盘 ${fsC.get(finalKey)?.length ?? 0} 字节)`);
  check('不完整时不留下正式文件', !fsC.has(finalKey), `正式文件 ${fsC.get(finalKey)?.length ?? 0} 字节`);
  check('不完整时清掉 .part', !fsC.has(partKey));
}

console.log('\n[3] 模型加载 ...');
{
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  // 先写一条"已下载"的记录
  store.set('xiaoyu.localModel', JSON.stringify({ id: 'x', name: 'T', path: '/x/m.gguf', filename: 'm.gguf' }));

  const c = await nat.loadLocalModel();
  check('加载成功', !!c);
  const initCall = calls.find((x) => x.fn === 'initLlama');
  const ip = initCall?.params || {};
  check('传给 initLlama 的 model 是文件路径', ip.model === '/x/m.gguf', ip.model);
  check('明确不是 asset 模型', ip.is_model_asset === false);
  check('设置了上下文大小', ip.n_ctx > 0, `n_ctx=${ip.n_ctx}`);

  // 原生 apply_params_from_jsobject 只认这几个名字，传错会被静默忽略
  const NATIVE_KEYS = ['n_ctx', 'n_batch', 'n_gpu_layers', 'use_mmap', 'use_mlock', 'embedding'];
  const passedKeys = Object.keys(ip).filter((k) => !['model', 'is_model_asset', 'pooling_type', 'lora', 'lora_list'].includes(k));
  const unknown = passedKeys.filter((k) => !NATIVE_KEYS.includes(k));
  check('没有传原生不认识的参数（会被忽略）', unknown.length === 0,
    unknown.length ? `多余: ${unknown.join(', ')}` : passedKeys.join(', '));
  check('n_gpu_layers 已显式设置', 'n_gpu_layers' in ip, `= ${ip.n_gpu_layers}（该插件为纯 CPU 构建）`);

  const c2 = await nat.loadLocalModel();
  check('重复加载会复用（不重复 initLlama）',
    calls.filter((x) => x.fn === 'initLlama').length === 1);
}

console.log('\n[4] 推理与流式 ...');
{
  calls.length = 0;
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  store.set('xiaoyu.localModel', JSON.stringify({ id: 'x', name: 'T', path: '/x/m.gguf', filename: 'qwen2.5-3b.gguf' }));

  const deltas = [];
  const out = await nat.localCompletion({
    systemPrompt: '你是小雨',
    messages: [{ role: 'user', content: '在吗' }],
    temperature: 1.0,
    maxTokens: 100,
    onDelta: (d) => deltas.push(d),
  });
  check('推理返回文本', out === '嗯嗯，我在呢', out);
  check('流式回调被触发', deltas.length > 0, `${deltas.length} 个分片`);

  const comp = calls.find((x) => x.fn === 'completion');
  check('传了 messages（让插件套用模型模板）', Array.isArray(comp?.params?.messages), `${comp?.params?.messages?.length} 条`);
  check('system 提示词在 messages 里', comp?.params?.messages?.[0]?.role === 'system');
  check('用户消息在 messages 里', comp?.params?.messages?.[1]?.content === '在吗');
  check('指定了 chatml 模板（避免模板选错导致乱码）',
    comp?.params?.chat_template === 'chatml', String(comp?.params?.chat_template));
  check('传了 max_tokens 等价参数', comp?.params?.n_predict === 100, `n_predict=${comp?.params?.n_predict}`);
  check('传了 temperature', typeof comp?.params?.temperature === 'number');
  check('传了停止符（防止把模板串进回复）', Array.isArray(comp?.params?.stop) && comp.params.stop.length > 0,
    (comp?.params?.stop || []).join(' '));
}

console.log('\n[5] 兼容回退（插件不支持 messages 时） ...');
{
  calls.length = 0;
  store.clear();
  const { win } = makeEnv({ needsPromptFallback: true });
  const nat = loadNative(win);
  store.set('xiaoyu.localModel', JSON.stringify({ id: 'x', name: 'T', path: '/x/m.gguf', filename: 'm.gguf' }));

  const out = await nat.localCompletion({
    systemPrompt: '你是小雨',
    messages: [{ role: 'user', content: '在吗' }],
  });
  check('回退后仍能拿到结果', out === '嗯嗯，我在呢', out);
  const comps = calls.filter((x) => x.fn === 'completion');
  check('触发了两次调用（先 messages 后 prompt 回退）', comps.length === 2, `${comps.length} 次`);
  check('回退用了手拼 prompt', typeof comps[1]?.params?.prompt === 'string' && comps[1].params.prompt.includes('<|im_start|>'),
    (comps[1]?.params?.prompt || '').slice(0, 40));
}

console.log('\n[6] 未下载模型时的行为 ...');
{
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  let err = null;
  try { await nat.localCompletion({ messages: [{ role: 'user', content: 'hi' }] }); }
  catch (e) { err = e.message; }
  check('给出明确提示而不是崩溃', /还没有下载本地模型/.test(err || ''), err);
}

console.log('\n[7] 自检 ...');
{
  calls.length = 0;
  store.clear();
  const { win } = makeEnv();
  const nat = loadNative(win);
  store.set('xiaoyu.localModel', JSON.stringify({ id: 'x', name: '3B', path: '/x/m.gguf', filename: 'm.gguf' }));

  const lines = [];
  const results = await nat.selfTest((l) => lines.push(l));
  check('自检返回结果集', Array.isArray(results) && results.length > 0, `${results.length} 项`);
  check('逐项输出到回调', lines.length === results.length);
  check('全部通过', results.every((r) => r.ok),
    results.filter((r) => !r.ok).map((r) => r.name).join(',') || '无失败项');
  check('包含推理测试', results.some((r) => /推理/.test(r.name)));
}

console.log('\n[8] 失败路径 ...');
{
  store.clear();
  const { win } = makeEnv({ failInit: true });
  const nat = loadNative(win);
  store.set('xiaoyu.localModel', JSON.stringify({ id: 'x', name: 'T', path: '/x/m.gguf', filename: 'm.gguf' }));

  const lines = [];
  const results = await nat.selfTest((l) => lines.push(l));
  const failed = results.find((r) => !r.ok);
  check('加载失败被自检捕获', !!failed, failed?.detail);
  check('失败时不继续往下跑（提前返回）', results.length < 6, `${results.length} 项后停止`);
}

console.log('\n=== 结果 ===');
console.log(`\n${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

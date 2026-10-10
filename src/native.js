/** 是否运行在 APK（Capacitor 原生环境）里 */
export function isNativePlatform() {
  try {
    if (typeof window === 'undefined' || !window.Capacitor) return false;
    const cap = window.Capacitor;

    if (typeof cap.isNativePlatform === 'function') {
      return !!cap.isNativePlatform();
    }

    if (typeof cap.getPlatform === 'function') {
      return cap.getPlatform() !== 'web';
    }
    return false;
  } catch {
    return false;
  }
}

let modPromise = null;
async function plugin() {
  if (!isNativePlatform()) return null;
  if (!modPromise) {

    modPromise = import('./llama-bundle.js');
  }
  return await modPromise;
}

export async function isNativeAvailable() {
  const m = await plugin();
  return !!m;
}

const DL_KEY = 'xiaoyu.localModel';

/** 读取已下载模型的记录 */
export function getLocalModelInfo() {
  try {
    return JSON.parse(localStorage.getItem(DL_KEY) || 'null');
  } catch {
    return null;
  }
}

function setLocalModelInfo(info) {
  try { localStorage.setItem(DL_KEY, JSON.stringify(info)); } catch {}
}

export function forgetLocalModel() {
  try { localStorage.removeItem(DL_KEY); } catch {}
}

/** 本地模型列表（推荐几个体积/质量平衡的） */

const HF_BASE = 'https://hf-mirror.com';

export const LOCAL_MODELS = [
  {
    id: 'minicpm5-2b-q4',
    name: 'MiniCPM5 2B（小又快）',
    size: '约 1.45GB',
    note: '端侧专用，中文好、速度快、发热小。手机吃不消 4B 时的稳妥选择。',
    url: `${HF_BASE}/openbmb/MiniCPM5-2B-GGUF/resolve/main/MiniCPM5-2B-Q4_K_M.gguf`,
    filename: 'MiniCPM5-2B-Q4_K_M.gguf',
    bytes: 1561318368,
  },
  {
    id: 'qwen3-4b-q4',
    name: 'Qwen3 4B（最像人 · 推荐）',
    size: '约 2.38GB',
    note: '陪聊"真人感"最好的一档。新引擎已开 i8mm 加速，这个才跑得动。',

    url: `${HF_BASE}/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`,
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    bytes: 2497280256,
    arch: 'qwen3',
  },
  {
    id: 'qwen2.5-1.5b-q4',
    name: 'Qwen2.5 1.5B（最小）',
    size: '约 1.0GB',
    note: '省电、秒回，但"真人感"弱，容易说套话。',
    url: `${HF_BASE}/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`,
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320736,
  },
  {
    id: 'qwen2.5-3b-q4',
    name: 'Qwen2.5 3B（旧版 · 对照用）',
    size: '约 1.96GB',
    note: '之前推荐的。可以拿来跟上面两个对比。',
    url: `${HF_BASE}/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf`,
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    bytes: 2104932768,
  },
  {
    id: 'qwen2.5-7b-q3',
    name: 'Qwen2.5 7B（旧版，不推荐）',
    size: '约 3.55GB',
    note: 'q3 量化太狠，7B 压到 q3 反而比 4B-q4 更笨，还慢、还烫。留着只是因为你手机上可能已经有这个文件。',

    url: `${HF_BASE}/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q3_k_m.gguf`,
    filename: 'qwen2.5-7b-instruct-q3_k_m.gguf',
    bytes: 3808391072,
  },
];

function sizeOk(model, size) {
  if (!size) return false;
  if (model.bytes) return size === model.bytes;
  return size > 10 * 1024 * 1024;
}

function explainLoadError(raw, info = {}) {
  const name = info.filename || info.path || '这个模型';
  if (/corrupted|incompatible|unsupported|architecture|arch/i.test(raw)) {
    return `这个模型你的 App 加载不了：${name}\n`
      + '多半是它的架构比引擎新（比如 Qwen3.5 用的是 "qwen35"，当前引擎只认到 "qwen3"），'
      + '不是文件坏了。\n换一个模型就行 —— 推荐 Qwen3 4B 或 MiniCPM5 2B。\n\n'
      + `原始错误：${raw}`;
  }
  if (/no such file|not found|ENOENT/i.test(raw)) {
    return `模型文件不见了：${name}\n重新下载一个吧。\n\n原始错误：${raw}`;
  }
  if (/memory|alloc|oom/i.test(raw)) {
    return `内存不够，加载不了 ${name}。\n换小一号的模型（比如 MiniCPM5 2B），或者先关掉别的 App。\n\n原始错误：${raw}`;
  }
  return `加载模型失败：${raw}`;
}

/** 上一次生成的统计（供测速用） */
let lastStats = null;

/** 拿上一次本地生成的统计：{ tokens, ms, chars } */
export function getLastCompletionStats() {
  return lastStats;
}

async function ensureFile(data, dir, name) {
  const { Filesystem, Directory } = await import('./fs-bundle.js');
  await Filesystem.writeFile({
    path: `${dir}${name}`,
    data,
    directory: Directory.Data,
    recursive: true,
  });
}

async function appendChunk(data, dir, name) {
  const { Filesystem } = await import('./fs-bundle.js');
  await Filesystem.appendFile({ path: `${dir}${name}`, data });
}

async function renameFile(dir, from, to) {
  const { Filesystem, Directory } = await import('./fs-bundle.js');
  try {
    await Filesystem.rename({ from: `${dir}${from}`, to: `${dir}${to}`, directory: Directory.Data });
  } catch {

  }
}

async function deleteFile(dir, name) {
  try {
    const { Filesystem, Directory } = await import('./fs-bundle.js');
    await Filesystem.deleteFile({ path: `${dir}${name}`, directory: Directory.Data });
  } catch {}
}

async function fileExists(name, dir) {
  try {
    const { Filesystem, Directory } = await import('./fs-bundle.js');
    const st = await Filesystem.stat({ path: `${dir}${name}`, directory: Directory.Data });
    return st?.size || 0;
  } catch {
    return 0;
  }
}

export async function downloadLocalModel(model, onProgress) {
  if (!isNativePlatform()) throw new Error('当前不是 APK 环境，无法下载本地模型');

  const { Filesystem, Directory } = await import('./fs-bundle.js');
  const dir = 'models/';
  const report = (o) => onProgress?.(o);

  if (!model.force) {
    const existSize = await fileExists(model.filename, dir);
    if (sizeOk(model, existSize)) {
      const { uri } = await Filesystem.getUri({ path: `${dir}${model.filename}`, directory: Directory.Data }).catch(() => ({ uri: '' }));
      const path = uri ? decodeURIComponent(uri.replace('file://', '')) : '';
      setLocalModelInfo({ ...model, path, downloadedAt: Date.now(), size: existSize });
      report({ progress: 1, completed: true, failed: false, downloadedBytes: existSize, totalBytes: existSize });
      return path;
    }
  }

  report({ progress: 0, completed: false, failed: false, downloadedBytes: 0, totalBytes: model.bytes || 0 });

  if (typeof Filesystem.downloadFile === 'function') {
    return downloadViaNative(Filesystem, Directory, dir, model, report);
  }
  return downloadViaFetch(Filesystem, Directory, dir, model, report);
}

async function downloadViaNative(Filesystem, Directory, dir, model, report) {
  const partName = model.filename + '.part';
  const total = Number(model.bytes) || 0;

  await deleteFile(dir, partName);

  const t0 = Date.now();

  const timer = setInterval(async () => {
    const cur = await fileExists(partName, dir);
    report({
      progress: total ? Math.min(0.999, cur / total) : 0,
      completed: false,
      failed: false,
      downloadedBytes: cur,
      totalBytes: total,
      speedBytesPerSec: cur / Math.max(1, (Date.now() - t0) / 1000),
    });
  }, 800);

  try {
    await Filesystem.downloadFile({
      url: model.url,
      path: `${dir}${partName}`,
      directory: Directory.Data,
      recursive: true,
    });
  } catch (e) {
    clearInterval(timer);
    await deleteFile(dir, partName);
    const raw = String(e?.message || e);

    const msg = /fail|network|timeout|unable|refused|reset|connect|unreachable/i.test(raw)
      ? `网络连不上（${raw}）`
      : raw;
    report({ progress: 0, completed: false, failed: true, errorMessage: msg, totalBytes: total });
    throw new Error(`下载失败：${msg}`);
  }
  clearInterval(timer);

  const onDisk = await fileExists(partName, dir);
  if (!sizeOk(model, onDisk)) {
    await deleteFile(dir, partName);
    const want = total ? `${total} 字节` : '至少 10MB';
    const msg = `下载不完整：只下到 ${onDisk} 字节，应该是 ${want}。请重试。`;
    report({ progress: 0, completed: false, failed: true, errorMessage: msg, downloadedBytes: onDisk, totalBytes: total });
    throw new Error(msg);
  }

  await renameFile(dir, partName, model.filename);

  const { uri } = await Filesystem.getUri({ path: `${dir}${model.filename}`, directory: Directory.Data });
  const path = decodeURIComponent(uri.replace('file://', ''));
  report({ progress: 1, completed: true, failed: false, downloadedBytes: onDisk, totalBytes: total || onDisk });
  setLocalModelInfo({ ...model, path, downloadedAt: Date.now(), fileSize: onDisk });
  return path;
}

/** 兜底：原生下载不可用时，退回手写流式下载（同样带硬校验） */
async function downloadViaFetch(Filesystem, Directory, dir, model, report) {
  let resp;
  try {
    resp = await fetch(model.url, { redirect: 'follow' });
  } catch (e) {
    report({ progress: 0, completed: false, failed: true, errorMessage: `网络连不上：${e.message}` });
    throw new Error(`下载失败：网络连不上（${e.message}）`);
  }
  if (!resp.ok) {
    report({ progress: 0, completed: false, failed: true, errorMessage: `HTTP ${resp.status}` });
    throw new Error(`下载失败：服务器返回 ${resp.status}`);
  }

  const total = Number(resp.headers.get('content-length') || model.bytes || 0);
  const reader = resp.body.getReader();

  const partName = model.filename + '.part';
  await deleteFile(dir, partName);

  let received = 0;
  let first = true;
  let lastTick = 0;

  const FLUSH_SIZE = 1024 * 1024;
  let pending = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pendingBytes) return;
    let bin = '';
    for (const part of pending) {
      for (let i = 0; i < part.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      }
    }
    pending = [];
    pendingBytes = 0;
    const b64 = btoa(bin);
    if (first) {
      await ensureFile(b64, dir, partName);
      first = false;
    } else {
      await appendChunk(b64, dir, partName);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.length) continue;

      pending.push(value);
      pendingBytes += value.length;
      received += value.length;

      if (pendingBytes >= FLUSH_SIZE) await flush();

      const now = Date.now();
      if (now - lastTick > 400) {
        lastTick = now;
        report({
          progress: total ? received / total : 0,
          completed: false,
          failed: false,
          downloadedBytes: received,
          totalBytes: total,
        });
      }
    }
    await flush();
  } catch (e) {
    report({ progress: 0, completed: false, failed: true, errorMessage: e.message,
             downloadedBytes: received, totalBytes: total });
    await deleteFile(dir, partName);
    throw new Error(`下载中断：${e.message}`);
  }

  const onDisk = await fileExists(partName, dir);
  const mismatch = onDisk !== received || !sizeOk(model, onDisk);
  if (mismatch) {
    await deleteFile(dir, partName);
    report({ progress: total ? received / total : 0, completed: false, failed: true,
             errorMessage: '文件不完整', downloadedBytes: received, totalBytes: total });
    throw new Error(`下载不完整（磁盘 ${onDisk} 字节 / 已接收 ${received} 字节 / 应为 ${total || model.bytes || '?'}），请重试`);
  }

  await renameFile(dir, partName, model.filename);

  const { uri } = await Filesystem.getUri({ path: `${dir}${model.filename}`, directory: Directory.Data });
  const path = decodeURIComponent(uri.replace('file://', ''));
  report({ progress: 1, completed: true, failed: false, downloadedBytes: onDisk, totalBytes: total || onDisk });
  setLocalModelInfo({ ...model, path, downloadedAt: Date.now(), fileSize: onDisk });
  return path;
}

export async function cancelLocalModelDownload() {

  return false;
}

export async function scanLocalModels() {
  if (!isNativePlatform()) return [];
  const { Filesystem, Directory } = await import('./fs-bundle.js');
  const found = [];

  for (const dir of ['models/', '']) {
    try {
      const res = await Filesystem.readdir({ path: dir || '/', directory: Directory.Data });
      for (const f of res?.files || []) {
        const name = typeof f === 'string' ? f : f.name;
        if (!name || !name.toLowerCase().endsWith('.gguf')) continue;
        let size = 0;
        try {
          const st = await Filesystem.stat({ path: `${dir}${name}`, directory: Directory.Data });
          size = st?.size || 0;
        } catch {}
        found.push({ name, dir, size });
      }
    } catch {

    }
  }
  return found;
}

/** 把扫描到的模型登记为当前使用的模型 */
export async function adoptLocalModel(entry) {
  const { Filesystem, Directory } = await import('./fs-bundle.js');
  const { uri } = await Filesystem.getUri({ path: `${entry.dir}${entry.name}`, directory: Directory.Data });
  const path = decodeURIComponent(uri.replace('file://', ''));
  const preset = LOCAL_MODELS.find((m) => m.filename === entry.name);
  const info = {
    id: preset?.id || 'scanned',
    name: preset?.name || entry.name.replace(/\.gguf$/i, ''),
    size: entry.size ? `约 ${(entry.size / 1024 / 1024 / 1024).toFixed(2)}GB` : (preset?.size || ''),
    note: preset?.note || '从手机里扫描到的模型',
    url: preset?.url || '',
    filename: entry.name,
    path,
    downloadedAt: Date.now(),
    fileSize: entry.size,
  };
  setLocalModelInfo(info);
  return info;
}

let ctx = null;
let ctxModelPath = null;
let loading = null;

/** 加载（或复用）本地模型 */
export async function loadLocalModel(onProgress) {
  const info = getLocalModelInfo();
  if (!info?.path) throw new Error('还没有下载本地模型');
  if (ctx && ctxModelPath === info.path) return ctx;
  if (loading) return loading;

  loading = (async () => {
    const m = await plugin();
    if (!m) throw new Error('当前不是 APK 环境');

    if (ctx) {
      try { await m.releaseAllLlama(); } catch {}
      ctx = null;
    }

    const isBig = /7b|8b/i.test(info.filename);
    try {
      ctx = await m.initLlama(
        {
          model: info.path,
          is_model_asset: false,
          n_ctx: isBig ? 2048 : 4096,
          n_batch: 512,
          n_gpu_layers: 0,
          use_mlock: false,
          use_mmap: true,
        },
        (progress) => onProgress?.(progress)
      );
    } catch (e) {
      throw new Error(explainLoadError(String(e?.message || e), info));
    }
    ctxModelPath = info.path;
    return ctx;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function unloadLocalModel() {
  const m = await plugin();
  if (!m) return;
  try { await m.releaseAllLlama(); } catch {}
  ctx = null;
  ctxModelPath = null;
}

export async function localCompletion({ systemPrompt, messages, temperature, maxTokens, signal, onDelta }) {
  const c = await loadLocalModel();
  if (!c) throw new Error('本地模型没加载成功');

  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  for (const msg of messages) {
    fullMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content),
    });
  }

  let aborted = false;
  const onAbort = () => { aborted = true; };
  if (signal) {
    if (signal.aborted) aborted = true;
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const genParams = {
    messages: fullMessages,

    chat_template: 'chatml',
    temperature: Number(temperature) || 1.0,
    top_p: 0.92,
    top_k: 40,
    n_predict: Number(maxTokens) || 250,
    repeat_penalty: 1.12,
    stop: ['<|im_end|>', '<|im_start|>'],
  };

  let full = '';
  const handleToken = (data) => {
    if (aborted) return;
    const piece = data?.token ?? data?.content ?? '';
    if (!piece) return;
    full += piece;
    onDelta?.(piece);
    if (aborted) { try { c.stopCompletion(); } catch {} }
  };

  let result = null;
  const tGen = Date.now();
  try {
    result = await c.completion(genParams, handleToken);
  } catch (e) {

    const msg = String(e?.message || e);
    if (/messages|template|chat_template|unsupported|not a function/i.test(msg)) {
      let prompt = '';
      if (systemPrompt) prompt += `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
      for (const m of messages) {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        prompt += `<|im_start|>${role}\n${m.content}<|im_end|>\n`;
      }
      prompt += `<|im_start|>assistant\n`;
      full = '';
      result = await c.completion({ ...genParams, messages: undefined, prompt }, handleToken);
    } else if (aborted) {
      return full;
    } else {
      throw new Error(`本地推理出错：${msg}`);
    }
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }

  const fromResult = String(result?.text ?? result?.content ?? '').trim();
  const text = fromResult || full;

  lastStats = {
    tokens: Number(result?.tokens_predicted) || null,
    ms: Date.now() - tGen,
    chars: [...text].length,
  };

  return text;
}

export async function selfTest(onStep = () => {}) {
  const results = [];
  const step = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    onStep(`${ok ? '✅' : '❌'} ${name}${detail ? '：' + detail : ''}`);
    return ok;
  };

  if (!isNativePlatform()) {
    step('运行环境', false, '当前不是 APK，是网页版');
    return results;
  }
  step('运行环境', true, 'APK 原生环境');

  let m = null;
  try {
    m = await plugin();
    step('llama.cpp 插件', !!m, m ? '已加载' : '加载失败');
  } catch (e) {
    step('llama.cpp 插件', false, e.message);
    return results;
  }
  if (!m) return results;

  const fns = ['initLlama', 'releaseAllLlama', 'downloadModel', 'getDownloadProgress'];
  const missing = fns.filter((f) => typeof m[f] !== 'function');
  step('插件接口完整', missing.length === 0, missing.length ? `缺少 ${missing.join(', ')}` : fns.length + ' 个方法可用');

  const info = getLocalModelInfo();
  if (!info?.path) {
    step('本地模型', false, '还没下载，去上面的列表里选一个');
    return results;
  }
  step('本地模型', true, `${info.name} → ${info.path}`);

  let logHandle = null;
  const nativeLog = [];
  try {
    await m.toggleNativeLog?.(true);
    logHandle = m.addNativeLogListener?.((level, text) => {
      const line = `[${level}] ${text}`;
      nativeLog.push(line);
      if (nativeLog.length <= 40) onStep('   · ' + line.slice(0, 160));
    });
  } catch {}

  const stopLog = () => {
    try { logHandle?.remove?.(); } catch {}
    try { m.toggleNativeLog?.(false); } catch {}
  };

  const t0 = Date.now();
  try {
    await loadLocalModel();
    step('模型加载', true, `成功，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    const tail = nativeLog.slice(-3).join(' | ');
    step('模型加载', false,
      String(e?.message || e).slice(0, 100) + (tail ? ` 〔原生日志：${tail.slice(0, 120)}〕` : ''));
    stopLog();
    return results;
  }

  try {
    const t1 = Date.now();
    const out = await localCompletion({
      systemPrompt: '你只需回答"好"。',
      messages: [{ role: 'user', content: '在吗' }],
      temperature: 0.3,
      maxTokens: 12,
    });
    const ms = Date.now() - t1;
    const text = String(out || '').trim();

    const speed = text.length > 0 && ms > 0 ? `，约 ${(text.length / (ms / 1000)).toFixed(1)} 字/秒` : '';
    step('推理测试', text.length > 0,
      text ? `输出「${text.slice(0, 20)}」耗时 ${ms}ms${speed}` : '没有输出');
  } catch (e) {
    step('推理测试', false, String(e?.message || e).slice(0, 120));
  } finally {
    stopLog();
  }

  return results;
}

/** 收集原生日志（出问题时看这个） */
export async function startNativeLog(cb) {
  const m = await plugin();
  if (!m?.addNativeLogListener) return null;
  try {
    await m.toggleNativeLog?.(true);
    return m.addNativeLogListener((level, text) => cb?.(level, text));
  } catch {
    return null;
  }
}

export function exposeTestHooks() {
  if (typeof window === 'undefined') return;
  window.__xiaoyu = {
    ready: () => nativeReadySafe(),
    models: () => LOCAL_MODELS,
    hasPlugin: async () => !!(await plugin()),
    scan: () => scanLocalModels(),
    adopt: (name) => {
      const found = { name, dir: name.includes('/') ? '' : 'models/' };
      return adoptLocalModel(found);
    },
    adoptEntry: (entry) => adoptLocalModel(entry),
    current: () => getLocalModelInfo(),
    stats: () => getLastCompletionStats(),
    test: (cb) => selfTest(cb),
    unload: () => unloadLocalModel(),
  };
  return true;
}

function nativeReadySafe() {
  try {
    return isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * 原生本地推理（APK 专用）
 *
 * 这个模块只在 Capacitor APK 里有意义：通过 llama-cpp-pro 插件调用
 * 手机本地的 llama.cpp，完全离线、零 token 消耗。
 *
 * 在网页版里 isNativeAvailable() 返回 false，相关功能自动隐藏。
 */

// ---------------------------------------------------------------- 环境探测

/** 是否运行在 APK（Capacitor 原生环境）里 */
export function isNativePlatform() {
  try {
    if (typeof window === 'undefined' || !window.Capacitor) return false;
    const cap = window.Capacitor;
    // 只信 isNativePlatform()。
    // 注意：绝对不要读 window.Capacitor.Plugins —— 它是个惰性代理，
    // 在真机上访问会触发原生桥接，实测会直接把 WebView 卡死，
    // 导致下面这个 Promise 永远不结束、UI 停在"未配置"状态。
    if (typeof cap.isNativePlatform === 'function') {
      return !!cap.isNativePlatform();
    }
    // 老版本兜底：有 getPlatform 也能判断
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
    // 走到这里说明是原生环境，插件加载失败就是真失败——直接抛出，
    // 不要静默返回 null，否则自检只会显示"插件失败"而看不到原因。
    modPromise = import('./llama-bundle.js');
  }
  return await modPromise;
}

export async function isNativeAvailable() {
  const m = await plugin();
  return !!m;
}

// ---------------------------------------------------------------- 模型下载

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
// 下载源用 hf-mirror（HuggingFace 国内镜像）：
// 实测它给大文件返回正确的 Content-Length 且支持断点续传；
// ModelScope 的直链对 2GB 文件不返回长度，下载容易失败。
const HF_BASE = 'https://hf-mirror.com';

/**
 * 本地模型列表。
 *
 * 量化一律选 Q4_K_M —— 这是质量/速度的最佳平衡点。
 * ⚠️ 别用 q3 之类的低比特量化：7B 压到 q3 会比 2B 的 q4 还笨，而且更慢。
 *
 * 新引擎（已打开 dotprod/i8mm/repack）之后，4B 这个档位才真正跑得动，
 * 这也是"最像人"和"跑得动"的交叉点。
 */
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
    // ⚠️ 注意是 Qwen3，不是 Qwen3.5。
    // Qwen3.5 的 GGUF 里 architecture 写的是 "qwen35"，
    // 而当前引擎只认 "qwen3" —— 下了也加载不了（实测报 corrupted）。
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
    // 7B 的 q4_k_m/q5 都是分片文件（-00001-of-00002），单文件下载器处理不了，
    // 所以当年只能用 q3_k_m 这个单文件版本。
    url: `${HF_BASE}/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q3_k_m.gguf`,
    filename: 'qwen2.5-7b-instruct-q3_k_m.gguf',
    bytes: 3808391072,
  },
];

/**
 * 下载后的大小校验。
 *
 * `bytes` 是预先用 curl 核实过的精确值（不是按 MB 约算）。
 * 这一步专门用来挡住两种坑：
 *   1. 重定向出错、拿到一个几 KB 的 HTML 错误页
 *   2. 中途断流，留下一个"看着完整其实残缺"的文件
 * 没有 bytes 的条目退回按 10MB 下限判断（模型不可能这么小）。
 */
function sizeOk(model, size) {
  if (!size) return false;
  if (model.bytes) return size === model.bytes;
  return size > 10 * 1024 * 1024;
}

/**
 * 把「模型加载失败」翻译成人能看懂的话。
 *
 * 实测最容易撞上的两种情况：
 *   1. **架构比引擎新** —— 比如 Qwen3.5 的 GGUF 里 architecture 字段是
 *      "qwen35"，而当前 llama.cpp 只认到 "qwen3"，于是报 corrupted。
 *      这种情况下文件其实是**好的**，换模型就行，别浪费时间重下。
 *   2. **文件真残缺** —— 下载中途断了（见 downloadLocalModel 的硬校验）。
 */
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


/**
 * 从网络下载模型，存到应用私有目录。
 *
 * 为什么不用插件的 downloadModel：它的原生实现只建目录 + 返回一个路径，
 * 并没有下载任何字节（源码注释自认是 placeholder），进度查询也是空的。
 * 而且它硬编码到 /storage/emulated/0/Android/data/ai.annadata.llamacpp/，
 * 那是插件作者的包名，我们的应用无权访问。
 *
 * 所以这里用 fetch 流式下载 + Capacitor Filesystem 写盘。
 * 注意：fetch 的响应体不支持随机 seek，所以中途失败只能重下。
 */
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
    // 不支持 rename 时，退化成"就用地 part 名"（加载时仍能读）
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

/**
 * 下载模型到自己手机里
 * @param {object} model LOCAL_MODELS 里的一项
 * @param {(p:{progress:number,completed:boolean,failed:boolean,errorMessage?:string,downloadedBytes?:number,totalBytes?:number})=>void} onProgress
 */
export async function downloadLocalModel(model, onProgress) {
  if (!isNativePlatform()) throw new Error('当前不是 APK 环境，无法下载本地模型');

  const { Filesystem, Directory } = await import('./fs-bundle.js');
  const dir = 'models/';
  const report = (o) => onProgress?.(o);

  // 已经下载过就直接用 —— 但**必须是大小对得上的文件**。
  // 以前这里只判断 size > 0，于是一个 6.5KB 的坏文件会被当成已有模型直接用。
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

/**
 * 用 Capacitor 的原生下载拉模型（Filesystem.downloadFile）。
 *
 * 为什么不再用手写 fetch + appendFile：
 * 实测 JS 侧的 fetch 会走 CapacitorHttp，跟随重定向时**拿到一个 6500 字节的
 * HTML 错误页**而不是 LFS 上的真文件（同一 URL 用电脑 curl 拿到的是 2707513696 字节）。
 * 而旧代码在 content-length 取不到时会把完整性校验整个跳过
 * （`total > 0 && ...`），于是 6.5KB 的垃圾被报成「下载完成」，
 * 用户装上去测速才发现 "model appears to be corrupted"。
 *
 * 原生下载走 Android 自己的 HTTP 栈，重定向和大文件都正常。
 * 实测：手机上一次跑通，约 6.5 MB/s。
 */
async function downloadViaNative(Filesystem, Directory, dir, model, report) {
  const partName = model.filename + '.part';
  const total = Number(model.bytes) || 0;

  await deleteFile(dir, partName);

  const t0 = Date.now();
  // 这个插件的流式回调在 Android 上不可靠（实测回调次数为 0），
  // 所以进度靠轮询 .part 的实际大小，不依赖回调。
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
    // 原生抛的是英文（Failed to fetch / timeout / ECONNRESET…），翻译一下
    const msg = /fail|network|timeout|unable|refused|reset|connect|unreachable/i.test(raw)
      ? `网络连不上（${raw}）`
      : raw;
    report({ progress: 0, completed: false, failed: true, errorMessage: msg, totalBytes: total });
    throw new Error(`下载失败：${msg}`);
  }
  clearInterval(timer);

  // 硬校验：磁盘上的字节数必须和预先核实的一致
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

  // 先下到 .part，完成后才改名成正式文件。
  const partName = model.filename + '.part';
  await deleteFile(dir, partName);

  let received = 0;
  let first = true;
  let lastTick = 0;

  // 累积到 1MB 再落盘一次。每个分片都写盘的话，2GB 模型要写几万次，手机会卡死。
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

  // 校验完整性 —— 用磁盘上的真实大小，而且**不管有没有 total 都要查**。
  // 旧代码是 `total > 0 && received < total * 0.99`，两个漏洞：
  //   1. total 拿不到（重定向后丢头）就直接跳过校验
  //   2. 1% 容差对 2.7GB 文件是 27MB，足够让 GGUF 加载失败
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
  // 流式下载没有原生句柄可取消；UI 侧通过刷新/关闭页面中断
  return false;
}

/**
 * 扫描应用目录里已有的 .gguf 文件。
 * 用在两种情况：模型是别人（比如通过 adb）帮放进来的，
 * 或者之前下载记录丢了但文件还在。
 */
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
      // 目录不存在就跳过
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

// ---------------------------------------------------------------- 加载与推理

let ctx = null;          // 已加载的 LlamaContext
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

    // 换模型时先释放旧的
    if (ctx) {
      try { await m.releaseAllLlama(); } catch {}
      ctx = null;
    }

    // 大模型给大一点的上下文；手机内存有限，别设太夸张。
    //
    // 参数名必须和原生的 apply_params_from_jsobject 对齐，它只读这几个：
    //   n_ctx / n_batch / n_gpu_layers / use_mmap / use_mlock / embedding
    // 传别的名字会被静默忽略（比如 n_threads —— 原生不读，别传）。
    //
    // 注意：这个插件版本编译时只启用了 CPU 后端
    // （CMake 里 -DLM_GGML_USE_CPU，.so 里没有 OpenCL 符号），
    // 所以 n_gpu_layers 实际不生效，推理跑在 CPU 上。
    // 保留这个字段是为了以后换 GPU 版插件时不用改代码。
    const isBig = /7b|8b/i.test(info.filename);
    try {
      ctx = await m.initLlama(
        {
          model: info.path,
          is_model_asset: false,
          n_ctx: isBig ? 2048 : 4096,
          n_batch: 512,
          n_gpu_layers: 0,     // 当前插件无 GPU 后端，显式写 0 以免误导
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

/**
 * 用本地模型生成回复
 *
 * 优先把 messages 交给插件，让它按模型自带的对话模板格式化——
 * 手拼 ChatML 在不同模型上容易出格式问题，插件自己处理更可靠。
 * 万一插件不支持，再退回手拼。
 *
 * @returns {Promise<string>} 完整回复文本
 */
export async function localCompletion({ systemPrompt, messages, temperature, maxTokens, signal, onDelta }) {
  const c = await loadLocalModel();
  if (!c) throw new Error('本地模型没加载成功');

  // 组装成 OpenAI 风格的 messages
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
    // 明确指定 ChatML 模板：Qwen 系列就是 <|im_start|>role\ncontent<|im_end|> 这套。
    // 不指定的话会走"默认模板"，模板选错会让模型输出乱码。
    // 原生库的模板表里确认有 chatml。
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

  // 注意：这个插件在 Android 上**不会**触发流式回调（实测回调次数为 0），
  // 结果是通过 completion() 的返回值给的：{ text, content, tokens_predicted }。
  // 所以必须从返回值取，只靠回调累积会永远拿到空字符串。
  let result = null;
  const tGen = Date.now();
  try {
    result = await c.completion(genParams, handleToken);
  } catch (e) {
    // 插件不支持 messages 时退回手拼 ChatML
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

  // 优先用返回值；万一是流式版本、回调有内容而返回值为空，就用回调累积的
  const fromResult = String(result?.text ?? result?.content ?? '').trim();
  const text = fromResult || full;

  // 记下统计供测速用。tokens_predicted 是原生给的精确值，比按字数估准得多。
  lastStats = {
    tokens: Number(result?.tokens_predicted) || null,
    ms: Date.now() - tGen,
    chars: [...text].length,
  };

  return text;
}

// ---------------------------------------------------------------- 自检

/**
 * 逐项自检，用来定位"到底哪一环坏了"。
 * 装好 APK 后先在设置里点这个，比对着"闪退"猜要快得多。
 * @param {(line:string)=>void} onStep
 */
export async function selfTest(onStep = () => {}) {
  const results = [];
  const step = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    onStep(`${ok ? '✅' : '❌'} ${name}${detail ? '：' + detail : ''}`);
    return ok;
  };

  // 1) 是否在 APK 里
  if (!isNativePlatform()) {
    step('运行环境', false, '当前不是 APK，是网页版');
    return results;
  }
  step('运行环境', true, 'APK 原生环境');

  // 2) 插件能否加载
  let m = null;
  try {
    m = await plugin();
    step('llama.cpp 插件', !!m, m ? '已加载' : '加载失败');
  } catch (e) {
    step('llama.cpp 插件', false, e.message);
    return results;
  }
  if (!m) return results;

  // 3) 哪些原生方法真的存在
  const fns = ['initLlama', 'releaseAllLlama', 'downloadModel', 'getDownloadProgress'];
  const missing = fns.filter((f) => typeof m[f] !== 'function');
  step('插件接口完整', missing.length === 0, missing.length ? `缺少 ${missing.join(', ')}` : fns.length + ' 个方法可用');

  // 4) 模型文件
  const info = getLocalModelInfo();
  if (!info?.path) {
    step('本地模型', false, '还没下载，去上面的列表里选一个');
    return results;
  }
  step('本地模型', true, `${info.name} → ${info.path}`);

  // 开原生日志：加载失败时能拿到 C++ 层的真实报错
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

  // 5) 真正加载进内存（这步最容易失败：内存不足、文件损坏）
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

  // 6) 真跑一次推理（最短输出）
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
    // 顺便给出速度参考，方便判断能不能接受
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

/**
 * 测试钩子：把关键能力挂到 window 上，供自动化/远程调试调用。
 * 只暴露只读查询和"跑自检"这类安全操作，不暴露删数据之类的。
 */
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

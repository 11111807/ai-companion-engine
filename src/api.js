/**
 * 与云端大模型对话（纯浏览器端，无服务器）
 *
 * 支持 DeepSeek 兼容的 OpenAI 格式接口，流式返回。
 * API Key 只存在本机浏览器，直接发给模型服务商，不经过任何中间服务器。
 */

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/**
 * DeepSeek 官方现在的模型名是 deepseek-flash / deepseek-v4-pro。
 * 旧的 deepseek-chat、deepseek-reasoner 已经下线，继续用会直接报错。
 */
export const DEFAULT_MODEL = 'deepseek-flash';

/** 已经下线的老模型名 → 新模型名（老用户的配置要自动升级，否则一聊就报错） */
export const LEGACY_MODELS = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-coder': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
  'deepseek-v3': 'deepseek-flash',
  'deepseek-v3.1': 'deepseek-flash',
  'deepseek-v3.2': 'deepseek-flash',
  'deepseek-r1': 'deepseek-v4-pro',
};

/** 把可能过期的模型名换成现在能用的 */
export function upgradeModel(model) {
  if (!model) return DEFAULT_MODEL;
  return LEGACY_MODELS[String(model).trim().toLowerCase()] || model;
}

/**
 * 是不是 DeepSeek **官方**接口。
 *
 * 只有官方认 thinking / reasoning_effort 这些参数。硅基流动之类的第三方
 * 也托管 DeepSeek 模型（模型名同样以 deepseek- 开头），但它们不认这个参数，
 * 传过去可能直接 400。所以这里**只认官方域名**，宁可少一个功能也别报错。
 */
export function isDeepSeekEndpoint(endpoint, model) {
  if (typeof endpoint === 'string' && /(^|\.)deepseek\.com/i.test(endpoint)) return true;
  return false;
}

/**
 * 判断是不是本地/内网的服务（Ollama、llama.cpp、LM Studio、vLLM 都算）
 * 这类服务不需要 API Key，也不消耗任何 token 费用。
 */
export function isLocalEndpoint(endpoint) {
  if (!endpoint) return false;
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/** 从响应体里挖出服务商给的原始错误信息 */
function errorDetail(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    return j?.error?.message || j?.message || '';
  } catch {
    return String(bodyText || '').slice(0, 200);
  }
}

const withDetail = (base, detail) => base + (detail ? '：' + detail : '');

/** 光看状态码就能定的人话 */
const STATUS_HINTS = {
  401: 'API Key 不对，或者已经失效了。请到设置里重新填一个。',
  402: '账户余额不足，需要充值。',
  429: '请求太频繁了，缓几秒再发。',
};

/** 400 的时候得看响应体说了什么（顺序有意义，先命中的先用） */
const BAD_REQUEST_HINTS = [
  [/context|length|too long/i, () => '这轮对话太长了，清空一下重新开始吧。'],
  [/model/i, (d) => `模型名不可用（${d}）。DeepSeek 的老模型 deepseek-chat / deepseek-reasoner 已下线，改用 deepseek-flash。`],
];

const LOCAL_STATUS_HINTS = {
  404: '本地服务找不到这个模型名，检查设置里的模型名是否和本地加载的一致。',
};

/** 把 API 错误翻译成人话 */
function friendlyError(status, bodyText, local = false) {
  const detail = errorDetail(bodyText);

  if (local) {
    if (LOCAL_STATUS_HINTS[status]) return LOCAL_STATUS_HINTS[status];
    if (status >= 500) return `本地模型出错（${status}），看看电脑上的服务日志。`;
    return withDetail(`本地服务返回 ${status}`, detail);
  }

  if (STATUS_HINTS[status]) return STATUS_HINTS[status];
  if (status === 400) {
    const hit = BAD_REQUEST_HINTS.find(([re]) => re.test(detail));
    if (hit) return hit[1](detail);
  }
  if (status >= 500) return `模型服务暂时出错（${status}），稍后再试。`;
  return withDetail(`请求失败（${status}）`, detail);
}

/**
 * 流式对话
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.endpoint]
 * @param {string} [opts.model]
 * @param {string} opts.systemPrompt
 * @param {Array<{role:string,content:string}>} opts.messages  历史（不含 system）
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.thinking]  DeepSeek 专用：是否开启深度思考
 * @param {(text:string)=>void} opts.onDelta
 * @param {(text:string)=>void} [opts.onReasoning]  思考过程（不显示给用户，只用来提示"她在想"）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text:string, usage:object|null}>}
 */
export async function streamChat(opts) {
  const {
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    model: rawModel = DEFAULT_MODEL,
    systemPrompt,
    messages,
    temperature = 0.9,
    maxTokens = 500,
    thinking,
    onDelta,
    onReasoning,
    signal,
  } = opts;

  // 老配置里可能还存着已经下线的模型名，这里兜一下
  const model = upgradeModel(rawModel);

  const local = isLocalEndpoint(endpoint);
  if (!apiKey && !local) throw new Error('还没有填 API Key，请先到设置里填一个。');

  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages.map(({ role, content }) => ({ role, content })),
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  // DeepSeek 的新模型默认就开着思考模式：陪聊会又慢又贵，
  // 所以默认显式关掉，想让她"想清楚再开口"时再打开。
  if (typeof thinking === 'boolean' && isDeepSeekEndpoint(endpoint, model)) {
    payload.thinking = { type: thinking ? 'enabled' : 'disabled' };
    if (thinking) {
      // 思考模式下 temperature 不生效，干脆不传（传了也不报错，但没必要）
      delete payload.temperature;
    }
  }

  // 本地服务一般不看 key，但有的（vLLM 等）要求非空，给个占位符
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  else if (local) headers.Authorization = 'Bearer local';

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (local) {
      throw new Error('连不上本地模型。确认电脑开着、本地服务已启动，手机和电脑在同一个 WiFi。');
    }
    throw new Error('网络连不上模型服务，检查一下手机网络。');
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(friendlyError(resp.status, txt, local));
  }

  // 解析 SSE 流
  const reader = resp.body.getReader();

  // 关键：主动响应中止。
  // 有些环境（以及模型服务端）在流已建立后不会因 signal.abort() 自动中断 read()，
  // 若不处理，界面会永远停在"生成中"。这里显式 cancel 读取并在结束时抛 AbortError。
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let reasoning = '';
  let usage = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 以换行分隔事件
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta;
        // 思考模式：思维链在 reasoning_content 里，绝不能当成她的话显示出来
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
          onReasoning?.(delta.reasoning_content);
        }
        const piece = delta?.content;
        if (piece) {
          full += piece;
          onDelta?.(piece);
        }
      }
    }
  } catch (e) {
    if (aborted || signal?.aborted) {
      return { text: full, usage, reasoning, aborted: true };
    }
    throw e;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }

  if (aborted || signal?.aborted) {
    return { text: full, usage, reasoning, aborted: true };
  }

  return { text: full, usage, reasoning };
}

/** 拉取可用模型列表（用于验证 key 是否有效） */
export async function listModels(apiKey, endpoint = DEFAULT_ENDPOINT) {
  const base = endpoint.replace(/\/chat\/completions\/?$/, '');
  const r = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) throw new Error(friendlyError(r.status, await r.text().catch(() => '')));
  const j = await r.json();
  return (j.data || []).map((m) => m.id);
}

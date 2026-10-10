export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

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

export function isDeepSeekEndpoint(endpoint, model) {
  if (typeof endpoint === 'string' && /(^|\.)deepseek\.com/i.test(endpoint)) return true;
  return false;
}

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

  if (typeof thinking === 'boolean' && isDeepSeekEndpoint(endpoint, model)) {
    payload.thinking = { type: thinking ? 'enabled' : 'disabled' };
    if (thinking) {

      delete payload.temperature;
    }
  }

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

  const reader = resp.body.getReader();

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

export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    signup: 'https://platform.deepseek.com/',
    hint: '国内直连，便宜。陪聊一天大概几毛钱。deepseek-flash 快而省，deepseek-v4-pro 更聪明但贵一些。',
    cost: '付费（很便宜）',
  },
  {
    id: 'zhipu',
    name: '智谱 AI（有免费模型）',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    signup: 'https://open.bigmodel.cn/',
    hint: 'glm-4-flash 有免费额度，可以先零成本试。质量比不上 DeepSeek，但陪聊够用。',
    cost: 'glm-4-flash 免费',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'THUDM/glm-4-9b-chat',
    ],
    signup: 'https://cloud.siliconflow.cn/',
    hint: '注册送一些额度，上面有多个模型可选。部分小模型免费。',
    cost: '注册送额度',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'],
    signup: 'https://platform.moonshot.cn/',
    hint: '中文对话比较自然。新用户通常有赠送额度。',
    cost: '赠送额度 + 付费',
  },
  {
    id: 'dashscope',
    name: '阿里通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-flash'],
    signup: 'https://bailian.console.aliyun.com/',
    hint: '阿里云百炼平台。qwen-turbo / qwen-flash 便宜。',
    cost: '有免费额度',
  },
  {
    id: 'custom',
    name: '自定义（其他服务商）',
    endpoint: '',
    model: '',
    models: [],
    signup: '',
    hint: '任何兼容 OpenAI 格式的服务都能用，自己填接口地址和模型名。',
    cost: '看你用的服务',
  },
  {
    id: 'local-ollama',
    name: '🖥 本地模型（Ollama）',
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'qwen2.5:3b',
    models: ['qwen2.5:3b', 'qwen2.5:7b', 'qwen3:4b', 'llama3.2', 'gemma3:4b'],
    signup: '',
    hint: '完全免费、断网可用。需要电脑开着并运行 Ollama。把地址里的 127.0.0.1 换成电脑的局域网 IP，手机才能连上电脑。',
    cost: '免费',
    local: true,
    noKey: true,
  },
  {
    id: 'local-llamacpp',
    name: '🖥 本地模型（llama.cpp）',
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'local-model',
    models: ['local-model'],
    signup: '',
    hint: '完全免费、断网可用。需要电脑开着并运行 llama.cpp 服务。把地址里的 127.0.0.1 换成电脑的局域网 IP，手机才能连上电脑。',
    cost: '免费',
    local: true,
    noKey: true,
  },
  {
    id: 'native-local',
    name: '📱 手机本地模型（完全离线）',
    endpoint: '',
    model: 'on-device',
    models: ['on-device'],
    signup: '',
    hint: '模型跑在手机里，不用连网、不花一分钱、不用开电脑。首次需要下载模型文件（约 2GB），之后一直离线可用。只在安卓 App 版里可用。',
    cost: '免费 · 离线',
    local: true,
    noKey: true,
    native: true,
  },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

/** 是不是本地模型（免费用、可离线） */
export function isLocalProvider(id) {
  return !!getProvider(id).local;
}

/** 根据当前配置反推是哪个服务商 */
export function detectProvider(endpoint, model) {
  for (const p of PROVIDERS) {
    if (p.id === 'custom') continue;
    if (p.endpoint && endpoint && p.endpoint === endpoint) return p.id;
  }

  for (const p of PROVIDERS) {
    if (p.models?.includes(model)) return p.id;
  }
  return 'custom';
}

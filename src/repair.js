export function createRepair(deps) {
  const {
    state, getProvider, nativeStreamChat, streamChat, DEFAULT_ENDPOINT, DEFAULT_MODEL,
    parseThoughtBlock, parseMoodBlock, extractMemory, replyItems, narrLine,
  } = deps;

/** 发一次"只要一小段"的请求（三个兜底共用：补台词 / 补内心 / 重说一遍） */
async function onceText(args) {
  if (getProvider(state.config.provider).id === 'native-local') return nativeStreamChat(args);
  let out = '';
  await streamChat({
    ...args,
    apiKey: state.config.apiKey.trim(),
    endpoint: state.config.endpoint || DEFAULT_ENDPOINT,
    model: state.config.model || DEFAULT_MODEL,
    thinking: false,
    onDelta(piece) { out += piece; },
  });
  return out;
}

async function askForWords({ systemPrompt, history, narration, signal }) {
  const messages = [
    ...history,
    { role: 'assistant', content: narrLine(narration) },
    {
      role: 'user',

      content: '[系统] 她刚才只发了一个动作，一个字都没说，他现在在等她的回答。'
        + '接着往下写：把她说的话补上。说一句就行，哪怕只有两三个字。'
        + '不要重复那个动作，不要写括号旁白，也不要重复这段说明本身。',
    },
  ];
  const args = {
    systemPrompt,
    messages,
    temperature: Number(state.config.temperature) || 1.0,
    maxTokens: 140,
    signal,
  };

  try {
    const out = await onceText(args);

    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    const words = replyItems(cut.clean, 1).filter((it) => !it.narr).map((it) => it.content);
    return { words, thought: cut.thought };
  } catch {
    return { words: [], thought: '' };
  }
}

async function askForThought({ systemPrompt, history, reply, signal, avoid = [] }) {

  const bad = (Array.isArray(avoid) ? avoid : []).map((x) => x?.text).filter(Boolean).join('、');
  const messages = [
    ...history,
    { role: 'assistant', content: reply },
    {
      role: 'user',

      content: '[系统] 上面那条回复漏了"内心"那一块。只补那一块，格式：'
        + '[[思考]]她此刻对下一句话的心里话（10~50 字，第一人称，不写动作、'
        + '不复述他已知的话，也别用"他…了，我应该…"这种句式）。'
        + '不要重复她说过的台词，不要写别的，也不要重复这段说明。'
        + (bad ? `\n⚠️ 而且不要再想「${bad}」这件事 —— 她最近几轮一直在惦记它。` : ''),
    },
  ];
  const args = {
    systemPrompt,
    messages,
    temperature: Number(state.config.temperature) || 1.0,
    maxTokens: 80,
    signal,
  };

  try {
    const out = await onceText(args);

    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    const thought = cut.thought || cut.clean.split('\n').find((s) => s.trim()) || '';
    return String(thought).replace(/\[\[[^\]]*\]\]/g, '').replace(/[（(][^）)]*[）)]/g, '')
      .trim().slice(0, 60);
  } catch {
    return '';
  }
}

async function askAgain({ systemPrompt, history, reply, repeats, signal }) {
  const bad = (Array.isArray(repeats) ? repeats : []).map((x) => x?.text).filter(Boolean).join('、');
  if (!bad) return '';
  const messages = [
    ...history,
    { role: 'assistant', content: reply },
    {
      role: 'user',

      content: `[系统] 她刚才又提了「${bad}」—— 这件事她最近几轮反复说过了。`
        + '重写这一轮的回答：同样的意思可以，但不要再提它，也不要换个说法再说一遍。'
        + '说不出别的就少说一句。只写她要说的话，不要解释，也不要重复这段说明。',
    },
  ];
  const args = {
    systemPrompt,
    messages,
    temperature: Number(state.config.temperature) || 1.0,
    maxTokens: Number(state.config.maxTokens) || 250,
    signal,
  };

  try {
    const out = await onceText(args);

    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    return String(cut.clean || '').trim().slice(0, 600);
  } catch {
    return '';
  }
}

  return { onceText, askForWords, askForThought, askAgain };
}

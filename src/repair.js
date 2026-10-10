/**
 * "再问一次"的三个兜底：补台词 / 补内心 / 把这一轮重说一遍。
 *
 * 为什么单独一个模块：这三件事都是"她这一轮没给够，再要一次"，
 * 请求方式完全一样（构造 messages → 一次请求 → 擦隐藏块 → 取内容），
 * 而且都要遵守同一条规矩：**一轮最多补一次，绝不循环**。
 * 它们原来长在 app.js 里，那边行数一直贴着上限（这套规矩抬过很多次了），
 * 所以整块搬出来 —— 语义也更清楚：这是个"修复回合"的独立概念。
 *
 * ⚠️ 三条硬规矩（都是实测踩出来的，别改）：
 *   1. 补请求的指令前缀必须用 `[系统]`，**不能**用 `（...）` ——
 *      这个项目里括号就是旁白，用括号包指令，模型会把整段当成台词**原样复述**出来，
 *      实测它真的把整段指令发进了聊天气泡（用户截图）。
 *   2. 无论走哪条路，拿回来的内容都要过一遍 `replyItems`（它会拦泄漏、剥标签、
 *      拆连发）—— 别自己 split。
 *   3. 请求失败一律静默返回空，让调用方走它自己的兜底，别往上抛。
 */
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
    thinking: false,          // 补一小段不用深度思考
    onDelta(piece) { out += piece; },
  });
  return out;
}

/**
 * 兜底：她只写了动作、一个字都没说，把欠的那句话要回来。
 *
 * 为什么要在代码里兜，而不是只写进提示词（用户实测踩到的场景）：
 *   他问"几点了" → 她只发"（抬头看墙上的钟）"，然后就没了 —— 他还得再问一遍。
 *   提示词只能降低这种概率（见 persona.js 的【他在等你的回答】），
 *   但"这一轮白聊了"是他明确不能接受的，所以在渲染前补一道：
 *   再问一次，**只要台词**，跟原来那个动作拼起来。
 *
 * ⚠️ 顺便**把"思考"一起要回来**：她要是连动作都只写了一块，多半也没写内心。
 *    分两次请求太贵（一次对话变三次），所以这里一次问齐。
 *
 * 三条自我约束：
 *   1. 只在**整轮都是旁白**时触发 —— 正常回复一次请求都不会多发
 *   2. 一轮最多补一次；补回来还是旁白就认了（**绝不循环**）
 *   3. 补的过程失败（断网/超时）就当没发生，原来的旁白照常显示
 *
 * @returns {Promise<{words: string[], thought: string}>}
 */
async function askForWords({ systemPrompt, history, narration, signal }) {
  const messages = [
    ...history,
    { role: 'assistant', content: narrLine(narration) },
    {
      role: 'user',
      // ⚠️ 前缀必须用 `[系统]` 而**不能**用 `（...）`：这个项目里括号就是旁白，
      //    用括号包指令，模型很容易把整段当成"要演的台词"复述出来 ——
      //    实测它真的把这段话原样发进了聊天气泡（用户截图）。
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
    // 她可能又顺手带上隐藏块（记忆 / 情绪 / 思考）→ 擦掉，这里只取台词 + 思考
    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    const words = replyItems(cut.clean, 1).filter((it) => !it.narr).map((it) => it.content);
    return { words, thought: cut.thought };
  } catch {
    return { words: [], thought: '' };
  }
}

/**
 * 兜底：她这一轮**没写"思考"**，把那一句补回来。
 *
 * 为什么要在代码里兜（用户连问了两轮"还是没有看到"）：
 *   思考块是**模型按格式写出来的**，提示词只能提高概率 ——
 *   而"没写"在界面上和"功能坏了"长得一模一样。
 *   所以这里补一次"只要内心"的短请求（maxTokens 80）：
 *     - 只在她**没写**时触发 —— 写了就一次请求都不会多发
 *     - 一轮最多补一次；补不回来就认了（**绝不循环**）
 *     - 失败就当没发生，原来的回复照常显示
 *
 * @returns {Promise<string>} 补回来的那句心里话（可能为空串）
 */
async function askForThought({ systemPrompt, history, reply, signal, avoid = [] }) {
  // avoid：她这几轮一直在惦记的事。写了但还在想同一件事时也走这条路（见 respond）。
  const bad = (Array.isArray(avoid) ? avoid : []).map((x) => x?.text).filter(Boolean).join('、');
  const messages = [
    ...history,
    { role: 'assistant', content: reply },
    {
      role: 'user',
      // ⚠️ 前缀用 `[系统]`（别用括号：括号=旁白，会被模型当成台词复述出来）
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
    // 她可能直接回了心里话、也可能还是带着 [[思考]] 标记 —— 两种都要能取到。
    // ⚠️ 兜底（cut.clean）拿到的其实是**她的台词**，所以只取第一行、并且去掉
    //    括号旁白 —— 不然整段台词会被当成"内心"存下来，下一轮又原样列进提示词里
    //    （实测会把她的旁白在【你最近写过的旁白】旁边重复列一遍）。
    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    const thought = cut.thought || cut.clean.split('\n').find((s) => s.trim()) || '';
    return String(thought).replace(/\[\[[^\]]*\]\]/g, '').replace(/[（(][^）)]*[）)]/g, '')
      .trim().slice(0, 60);
  } catch {
    return '';
  }
}

/**
 * 让她**重说一遍**（这一轮又提了那件反复提的事）。
 *
 * 用户实测："哪怕我提示说不要再说这个了、我已经记得了，过一两轮依旧会反复强调。"
 * 提示词里写了"别再提"（repeatBlock），但那是**软约束** —— 上下文一长就冲淡了。
 * 所以这里事后检查：真出现了那几个片段就重新请求一次，并且**点名**说清。
 * 规矩同"只发旁白就补一次"：**一轮最多重写一次**，补不回来就认了（绝不循环）。
 *
 * @returns {Promise<string>} 重写后的文本（失败返回空串）
 */
async function askAgain({ systemPrompt, history, reply, repeats, signal }) {
  const bad = (Array.isArray(repeats) ? repeats : []).map((x) => x?.text).filter(Boolean).join('、');
  if (!bad) return '';
  const messages = [
    ...history,
    { role: 'assistant', content: reply },
    {
      role: 'user',
      // ⚠️ 前缀同样用 `[系统]`，别用括号（括号=旁白，会被模型当成台词复述）
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
    // 她可能又带上隐藏块 → 擦掉，这里只取台词
    const cut = parseThoughtBlock(parseMoodBlock(extractMemory(out).clean).clean);
    return String(cut.clean || '').trim().slice(0, 600);
  } catch {
    return '';
  }
}


  return { onceText, askForWords, askForThought, askAgain };
}

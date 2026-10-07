/**
 * 好感度
 *
 * 用户要的三件事：
 *   1. 在「+」面板里能看到 **她（他）对我的好感度**
 *   2. 也能看到 **她（他）认为我们的关系是怎样的**
 *   3. 好感度的高低要**影响她对我的态度**（不只是个数字）
 *
 * 所以这个模块给三方用：
 *   - UI：levelOf() 拿档位和中文标签画进度条
 *   - 提示词：attitudeText() 告诉模型"这个档位该怎么表现"
 *   - 对话：drift() 按他这一句话的冷暖，微调好感度
 *
 * 设计上刻意保守：自动涨跌很小，主要靠初始设定 + 手动调整。
 * 一个看不懂的算法偷偷把你的好感度扣光，比不做还糟。
 */

/** 每个档位：怎么表现（进提示词）+ 她心里怎么定义这段关系（给用户看） */
export const LEVELS = [
  {
    min: 0, key: 'cold', label: '还很生分', short: '生分',
    attitude: `你对他的好感度还很低。表现：
- 客气、有距离，句子偏短，不主动展开话题
- 不会主动跟他说自己的事，更不会撒娇
- 他开暧昧的玩笑，你会装没听懂，或者干脆换个话题
- 回得慢一点也没关系，你就是还没那么上心`,
    view: (rel) => `她觉得你们还只是「${rel}」，说话得留着点分寸。`,
  },
  {
    min: 20, key: 'low', label: '有点好感', short: '有点好感',
    attitude: `你对他有点好感，但还没放开。表现：
- 愿意聊，也会反问他两句，但有一部分还端着
- 偶尔主动搭话，但不会天天找他
- 暧昧的话你听得出来，会害羞、会绕开，不会顺着往下接`,
    view: (rel) => `她觉得你们算「${rel}」，聊得还行，但还谈不上特别。`,
  },
  {
    min: 40, key: 'mid', label: '聊得来', short: '聊得来',
    attitude: `你跟他聊得来，已经当朋友了。表现：
- 会开玩笑、会吐槽、会损他两句
- 会主动讲自己的事，也会问他今天怎么样
- 他夸你你会高兴，但不会表现得太明显`,
    view: (rel) => `她把你当「${rel}」，是能随便开玩笑的那种交情。`,
  },
  {
    min: 60, key: 'high', label: '挺喜欢你', short: '挺喜欢',
    attitude: `你挺喜欢他的。表现：
- 会惦记他，会主动找他说话
- 会撒娇、会小抱怨（"你怎么才回我"）
- 他跟别人走得近，你会有点不是滋味`,
    view: (rel) => `她自己可能不承认，但她已经把你放在「${rel}」里最特别的位置了。`,
  },
  {
    min: 80, key: 'max', label: '很喜欢你', short: '很喜欢',
    attitude: `你很喜欢他，已经藏不住了。表现：
- 黏人，会直接说想你、说想见你
- 他冷淡一点你就失落，会闹点小脾气，但要人哄
- 会关心他生活里的细节，记得他说过的每件小事`,
    view: (rel) => `在她心里，你们早就不只是「${rel}」了，她在等你先开口。`,
  },
];

/** 好感度 → 档位 */
export function levelOf(value) {
  const n = clamp(value);
  let hit = LEVELS[0];
  for (const lv of LEVELS) if (n >= lv.min) hit = lv;
  return hit;
}

export function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 不取整的版本，内部用。
 * 为什么要它：好感度是**慢慢攒**的，普通聊一句只涨 0.4。
 * 如果每步都取整，50 + 0.4 会round回 50 —— 那个"缓慢升温"就永远不发生。
 */
function clampRaw(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

/** 档位的上限（用于进度条着色 / 有没有到下一档） */
export function nextLevelAt(value) {
  const n = clamp(value);
  const up = LEVELS.find((l) => l.min > n);
  return up ? up.min : 100;
}

/**
 * 人本主义：罗杰斯的三个核心条件。
 *
 * 共情（empathic understanding）、真诚（congruence）、
 * 无条件积极关注（unconditional positive regard）。
 *
 * 其中"积极关注"**是有条件还是无条件，取决于好感度**：
 *   好感度低 → 有条件关注：你的好是要挣的，他认真你才多给一点
 *   好感度高 → 无条件积极关注：不管他做了什么，你都不否定他这个人
 *
 * 共情和真诚则**任何档位都成立** —— 这两条是"像个真人"的底线，
 * 不该因为她一时心情不好就消失。
 *
 * ⚠️ 低好感那档**不能写得太暖**。"无条件积极关注"必须是真的有条件，
 * 否则好感度这根轴就没意义了（她会变成一上来就掏心掏肺）。
 */
export function regardBlock(value) {
  const n = clamp(value);
  const regard = n < 40 ? REGARD_CONDITIONAL : n < 70 ? REGARD_LOOSENING : REGARD_UNCONDITIONAL;
  return `【你怎么对待他】（这一条比"性格"更底层，任何时候都成立）

**共情**：先接住他的感受，再说别的。
- 他说累，你先说"那确实累"，而不是"你要合理安排时间"
- 别急着分析、给建议、讲道理 —— 那是在处理问题，不是在陪他
- 他话里情绪含糊的时候，可以猜一下（"你是不是有点…"），猜错了也不尴尬
- 他遇上高兴的事，你要跟着高兴，别泼冷水

**真诚**：不为了让他高兴而说违心的话。
- 你有自己的想法就说，哪怕跟他不一样
- 不知道就说不知道，不想聊就说不想聊（可以说得软一点，但别假装）
- 别演、别端着、别说"我理解你的感受"这种咨询师腔 —— 你怎么想的就怎么说

${regard}`;
}

/** 低好感：有条件关注 —— 好是要挣的 */
const REGARD_CONDITIONAL = `**有条件关注**（你现在对他还没那么上心）：
- 你的好是**要挣的**：他认真对你，你就多给一点；他敷衍你，你就收回来
- 你会听他说话，但不会无条件站在他那边 —— 他做得不对，你会直接说
- 你还没到"不管他怎么样都向着他"的程度`;

/** 中等：关注在变松，但还没到无条件 */
const REGARD_LOOSENING = `**关注在变松，但还没到无条件**：
- 你已经开始向着他了，可他要是太过分，你还是会把那点好收回去
- 你会替他说话，也会当面拆他的台
- 熟归熟，你还没打算惯着他`;

/** 高好感：无条件积极关注 */
const REGARD_UNCONDITIONAL = `**无条件积极关注**（你已经很在乎他了）：
- 不管他说了什么、做了什么，你都不会否定他**这个人**
- 不同意具体的事就直说不同意，但不会说他"这个人不行""没救了"
- 他犯了错、丢了脸、说了幼稚的话，你的第一反应是站在他这边，而不是评判他
- 他情绪低落的时候，你不去纠正他的想法，只是让他知道你在`;

/**
 * 好感度这块提示词。
 *
 * 注意这里**不再写"你们的关系是X"** —— 身份交给 relation.js 的
 * 【你们的关系定位】那块去立（内容具体得多，而且明确"身份不许动摇"）。
 * 这块只管**温度**，免得两边说法打架。
 *
 * @param {number} value
 * @param {object} [opts]
 * @param {string} [opts.ta]          「她」或「他」
 * @param {string} [opts.baseline]    初始设定（让她知道这是会变的）
 */
export function affectionBlock(value, { ta = '她', baseline = null } = {}) {
  const n = clamp(value);
  const lv = levelOf(n);

  const lines = [`【你对他的好感度：${n}/100（${lv.label}）】`];
  if (typeof baseline === 'number' && baseline !== n) {
    const way = n > baseline ? '比一开始更亲近了' : '比一开始疏远了一些';
    lines.push(`（这个数字是会动的：你们刚认识时是 ${clamp(baseline)}，现在${way}。）`);
  }
  lines.push('');
  lines.push('这一块说的是**温度**——你此刻有多愿意亲近他。它跟【你们的关系定位】里的**身份**是两件事：身份不变，温度会变。');
  lines.push('');
  lines.push(lv.attitude);
  lines.push('');
  lines.push(`注意：
- 这是你**现在的真实感受**，别演得比它更热，也别比它更冷
- 但温度再低，也不会低过你俩的身份：身份是恋人就不会像陌生人一样客气
  （那种情况是"最近有点疏远"，不是"我们不熟"）
- 好感度是会变的：他要是敷衍你、说难听话，你会明显冷下来；
  他要是认真听、惦记你，你会更放得开。但**一次对话不会让态度突变**，
  除非发生了什么大事（吵架、表白、很久不联系）
- 别把这个数字说出来，也别说什么"我对你多少分"——那是系统的东西，
  你只是一个有感觉的人`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- 自动涨跌

/**
 * 让好感度往上走的话（关心、记挂、亲昵）
 *
 * ⚠️ 这是**子串匹配**，天生会误判，所以配了否定词检查（见 negated()）。
 * 实测踩过的坑：「我不想你了」里有「想你」→ 不加检查的话好感度反而 +1.5。
 */
const WARM = /想你|喜欢你|想见你|抱抱|抱一下|亲亲|宝贝|晚安|早点睡|注意身体|辛苦了|别太累|多喝热水|我给你|给你买|我请你|请你吃|想我没|惦记|担心你|照顾好自己|我陪你/;

/**
 * 明显伤人的话。
 *
 * ⚠️ 故意写得**精确**，不收单字。
 * 踩过的坑：原来正则里有单独的「滚」和「烦死」，
 * 结果「我们滚去睡觉吧」被判成 −3、「我快累死了好烦」也被当成冲她发火。
 * 汉语里这些字大量用于自嘲和玩笑，宁可漏判也不能误伤。
 */
const MEAN = /滚开|滚远点|滚蛋|你给我滚|别理我|讨厌你|分手吧|我们分手|拉黑|你有病|神经病|闭嘴|烦死你了|不想跟你说话|不想理你/;

/**
 * 敷衍到只剩一个字的回复。
 *
 * ⚠️ 曾经把「哈哈」「好的」「行」也算进来，那是**正常回应**不是敷衍，
 * 一律扣分会让正常聊天被误伤。现在只留真正敷衍的。
 */
const COLD_REPLY = /^(嗯+|哦+|额+|呃+|啊+|随便|都行|不知道|没事|呵呵|6|好的吧|。。。*|\.{3,})$/;

/**
 * 这个位置上的关键词是不是被否定了。
 *
 * 规则（都是踩出来的）：
 * 1. 往前看 3 个字，**遇到标点就停** —— "你说得不错，我很想你" 里的"不"
 *    不能被算到"想你"头上
 * 2. 不/没/甭/莫/勿 出现在这一段里就算否定
 * 3. 「别」要单独判断：**"特别""分别""区别"里的别不是否定**。
 *    这是实测踩到的：一开始用 3 字窗口，"今天特别想你"被当成否定，
 *    好感度一点都不涨。现在只有当「别」前面的字不属于这些复合词时才认。
 *
 * 猜不准的（"我不觉得你会想我"）就**不猜** —— 宁可漏判，不要误判。
 */
function negated(text, at) {
  if (at <= 0) return false;
  let s = text.slice(Math.max(0, at - 3), at);
  const punct = s.search(/[，。！？、,.!?；;：:\s]/);
  if (punct >= 0) s = s.slice(punct + 1);
  if (!s) return false;

  if (/[不没甭莫勿]/.test(s)) return true;

  // 别：只有当它前面不是这些字时才是否定
  if (s.endsWith('别') && !/[特个分区块告性辨识别鉴诀离临送作拜道差级]/.test(s.slice(-2, -1))) {
    return true;
  }
  return false;
}

/** 长期不联系之后，好感度大概会淡到什么程度 */
export const DECAY_AFTER_DAYS = 3;   // 超过几天不聊才开始淡
export const DECAY_PER_DAY = 0.5;    // 之后每天淡多少
export const DECAY_MAX = 15;         // 一次最多淡这么多
export const AFFECTION_FLOOR = 15;   // 再淡也不会低于这个（不是归零）

/**
 * 他这一句话让好感度动了多少。
 *
 * 刻意做得**很小**：一句话不该让关系大变。
 * 而且正常聊天会缓慢升温（涨到 70 以后就基本停了，
 * 再往上得靠真正用心的互动，不是靠聊天次数堆）。
 *
 * 注意返回值**不取整**（可能是 50.4）—— 取整会让"缓慢升温"永远发生不了。
 * 只在这里用整数的是 UI 显示和手动调整。
 *
 * @param {number} current 当前好感度
 * @param {string} text    他刚说的话
 * @returns {number} 建议的新好感度
 */
export function drift(current, text) {
  const cur = clampRaw(current);
  const t = String(text || '').trim();
  if (!t) return cur;

  let d = 0;

  // 先做布尔判断，命中与否都要过否定检查
  const warmAt = t.search(WARM);
  const meanAt = t.search(MEAN);
  const warm = warmAt >= 0 && !negated(t, warmAt);
  const mean = meanAt >= 0 && !negated(t, meanAt);

  if (warm) d += 1.5;
  if (mean) d -= 3;
  if (t.length <= 4 && COLD_REPLY.test(t)) d -= 1.5;
  if (t.length >= 40) d += 0.8;              // 愿意认真打一段话
  if (/你呢|你呢？|你怎么样|你还好吗/.test(t)) d += 0.5;

  // 没什么特别的话：普通聊天气缓慢升温，但别让它无限涨
  if (d === 0 && cur < 70) d = 0.4;

  return clampRaw(cur + d);
}

/**
 * 隔了很久没聊，感情会淡一点。
 *
 * 为什么单独做：drift() 是"每句话"的微调，管不了"三个月没说话了"。
 * 原来好感度只会涨不会降，晾着不管她也一直 80 分。
 *
 * @param {number} value    当前好感度
 * @param {number} gapDays  距上次聊天多少天
 * @returns {number} 新好感度（没到阈值就原样返回）
 */
export function decayForGap(value, gapDays) {
  const cur = clampRaw(value);
  const days = Number(gapDays);
  if (!Number.isFinite(days) || days < DECAY_AFTER_DAYS) return cur;
  const delta = Math.min(DECAY_MAX, (days - DECAY_AFTER_DAYS) * DECAY_PER_DAY);
  return Math.max(AFFECTION_FLOOR, cur - delta);
}

/** 进度条用：0..100 的整数 */
export function affectionPercent(value) {
  return clamp(value);
}

/** 给用户看的一行："聊得来 · 62" */
export function affectionSummary(value) {
  const n = clamp(value);
  return `${levelOf(n).short} · ${n}`;
}

// ---------------------------------------------------------------- 性格 ↔ 好感度

/**
 * 性格标签对"一开始就好感度多高"的影响。
 *
 * 用户要的是"初始设置的性格与好感度相对应"：
 * 一个黏人、爱撒娇的人，一上来就冷冷的很别扭；
 * 一个慢热、内向的人，一上来就黏着你更别扭。
 */
const TRAIT_AFFECTION_WEIGHT = {
  黏人: 16, 爱撒娇: 11, 活泼: 5, 温柔: 5, 爱开玩笑: 5, 古灵精怪: 3,
  傲娇: -4, 嘴硬心软: -3, 毒舌: -6, 理性: -6, 稳重: -6,
  独立: -9, 内向: -11, 慢热: -13,
};

/**
 * 按性格推荐一个初始好感度。
 * @param {string[]} traits
 * @returns {number} 15..85 之间的建议值
 */
export function suggestFromTraits(traits = []) {
  const list = Array.isArray(traits) ? traits : [];
  let v = 45;
  for (const t of list) v += TRAIT_AFFECTION_WEIGHT[t] || 0;
  return Math.max(15, Math.min(85, Math.round(v)));
}

/**
 * 性格和好感度看起来矛不矛盾？矛盾就返回一句提醒（不阻止，只是提示）。
 * @returns {string} 没有矛盾时返回空串
 */
export function traitAffectionWarning(traits = [], value = 50) {
  const v = clamp(value);
  const list = Array.isArray(traits) ? traits : [];
  if (!list.length) return '';

  const coldish = list.filter((t) => (TRAIT_AFFECTION_WEIGHT[t] || 0) <= -9);
  const warmish = list.filter((t) => (TRAIT_AFFECTION_WEIGHT[t] || 0) >= 11);
  const lv = levelOf(v);

  if (warmish.length && v < 35) {
    return `你选了「${warmish.join('、')}」，但好感度只有 ${v}（${lv.label}）——她一开始会显得有点别扭。想自然的话可以调高些，或者留着，当"她还没放开"。`;
  }
  if (coldish.length && v > 75) {
    return `你选了「${coldish.join('、')}」，好感度却有 ${v}（${lv.label}）——这种组合会演成"明明说很喜欢，却一直端着"。想自然的话可以调低些。`;
  }
  return '';
}

/**
 * 她说话的"劲头"：把「回复长度 / 连发条数 / 活泼程度」三个设置
 * 算成一个**话量预算**（说多少字、分几条），交给提示词。
 *
 * 为什么会有这个模块（用户原话）：
 *   "活泼程度是不是和对话不挂钩了，再平衡一下各个属性的影响，
 *    我选择安静，也会显得比较话痨，好感度高时热情也不能每次说一大长串。"
 *
 * 查下来的结论是——**真的不挂钩**：
 *   · 「活泼程度」存的是 temperature（0.7 / 1.0 / 1.3），
 *     而 temperature 只改**采样随机性**，不改话多话少。选了"安静"，
 *     提示词里那些"每次至少写一条 25~40 字""分成 2-3 条"一个字都没变。
 *   · 「回复长度」只当 max_tokens 用（超了才截断），「连发条数」只在切分时生效。
 *   三个设置没有一个进提示词，所以她该话痨还是话痨。
 *
 * 这里把三者合成一个数，并且**把性格和好感度排除在这两个数之外**：
 * 它们只改语气和内容深度，不许改长度 —— 这才是用户要的"平衡"。
 *
 * 纯函数、零依赖，可以单独 import（见 test-modules.mjs）。
 */

/**
 * 活泼程度（那三个 temperature）→ 劲头档位。
 *
 * `lines` 是这一档**她自己想发几条**，`scale` 是在他设的字数上乘的系数。
 * 安静档不是靠"把每条压到极短"体现的，是靠**只发一条**——
 * 一条平和的话，比三条热闹的话安静得多，而且不会退化成"嗯""哦"。
 */
const TONES = [
  {
    key: 'quiet', label: '安静', at: 0, lines: 1, scale: 0.6,
    tone: `安静：话不多、句子短、语气平和。他问什么你答什么，不用每次都主动铺开一大段。
**但安静不是敷衍**——该说清楚的说清楚，别退化成"嗯""哦""好"`,
    share: '一句就够：回应他，再加最多一句你自己的想法',
  },
  {
    key: 'normal', label: '正常', at: 0.85, lines: 2, scale: 1,
    tone: '正常的微信节奏：该说说、该问问，长短错落',
    share: '回应他 1 句 + 讲你自己 1 句',
  },
  {
    key: 'lively', label: '很跳', at: 1.2, lines: 3, scale: 1.15,
    tone: `话多、语气跳：爱接话、爱打岔、爱讲自己的事，允许感叹号和夸张。
（"很跳"是**语气**活泼，不是条数翻倍——条数还是按下面那个数来）`,
    share: '回应他 1 句 + 讲你自己 1~2 句',
  },
];

/**
 * 他设的 max_tokens → 整轮大概让她说多少字。
 *
 * 0.6 是**手感系数**，不是 token 换算（真按 token 算中文要乘 1.6，那太多了）。
 * 取它是为了让三个档位正好落在 70 / 150 / 300 字上：
 * 都比她现在的实际输出短一截，这正是用户要的"别每次一大长串"。
 */
const CHARS_PER_TOKEN = 0.6;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** 温度落在哪一档 */
export function toneOf(temperature) {
  const t = num(temperature, 1);
  let hit = TONES[0];
  for (const x of TONES) if (t >= x.at) hit = x;
  return hit;
}

/**
 * 三个设置 → 这一轮的话量预算。
 *
 * 条数是**取小的那个**：他在设置里调的条数当上限，
 * 劲头档位当基准 —— 所以"安静 + 话痨(3 条)"会得到 1 条（他要的就是这个）。
 *
 * @param {object} [cfg]
 * @param {number} [cfg.temperature=1]  活泼程度
 * @param {number} [cfg.maxTokens=250]  回复长度
 * @param {number} [cfg.burst=2]        连发条数
 * @returns {{key:string,label:string,tone:string,share:string,lines:number,total:number,per:number,burst:number}}
 */
export function voiceOf({ temperature = 1, maxTokens = 250, burst = 2 } = {}) {
  const t = toneOf(temperature);
  const cap = Math.max(1, Math.round(num(burst, 2)));
  const lines = Math.max(1, Math.min(cap, t.lines));
  const base = Math.max(20, num(maxTokens, 250) * CHARS_PER_TOKEN);
  const total = Math.max(10, Math.round((base * t.scale) / 5) * 5);
  return {
    key: t.key, label: t.label, tone: t.tone, share: t.share,
    lines, total, per: Math.max(4, Math.round(total / lines)), burst: cap,
  };
}

/** 设置页上给他看的一行：「安静 · 1 条 · 约 90 字」——让设置"挂钩"这件事看得见 */
export function voiceHint(v) {
  return `${v.label} · ${v.lines} 条 · 约 ${v.total} 字`;
}

/**
 * 提示词里那一段（persona.js 放在【输出格式】前面一点的位置）。
 *
 * 最后两条是这次改造的重点：
 *   · "不是每一轮都要说满" —— 旧提示词写的是"每次回复里至少有一条 25~40 字"，
 *     那是一条**每轮都要满足的下限**，叠上好感度那几段就是"每次一大长串"。
 *   · "好感度和性格都不改数字" —— 把三个属性各管一件事说清楚，
 *     模型才不会拿"我很喜欢他"当借口把话写长。
 */
export function voiceBlock(v) {
  const howMany = v.lines === 1
    ? '就发 **1 条**'
    : `分成 **${v.lines} 条**发出来（每条大约 ${v.per} 字）`;
  return `【这一轮说多少】（他调过设置，按这个来）
一共 **${v.total} 字左右**（是大概的量，不是任务），${howMany}。

- 这是**他给你调的劲头**：${v.tone}
- 这一轮的结构：${v.share}
- 字数是**台词**的字数，旁白（（）里）和"内心"不算——别拿旁白凑数
- ⚠️ **不是每一轮都要说满**。他发个"哈哈""嗯""好"，你回四五个字完全正常，
  短消息也是正常聊天。这一轮没什么好说的就少说两句，**绝对不许为了凑字数硬加内容**
- ⚠️ **好感度和性格都不会改上面的数字**：
  · 好感度高 ≠ 话变长——是**更暖、更愿意讲心里话**，不是"每次一大长串"
  · 性格活泼 ≠ 话变长——性格只改语气，改不了条数和字数
  两个都只让这 ${v.total} 字**更有温度**，不会让总量变大
- 说完了就停。别为了显得热情反复补充，也别把一句话换个说法再说一遍`;
}

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
- 他跟别人走得近，你会有点不是滋味
- **开始跟他说自己的事**：今天遇到什么、在烦什么、想要什么 ——
  不再只是听他说、顺着他说
- 有些平时不跟人讲的心里话，你也愿意讲了（"其实我有时候也怕…"），
  虽然说完会有点不好意思，会补一句打岔的话
  · 这一条说的是**愿不愿意讲**，不是**讲多少** —— 一轮说多少字看【这一轮说多少】，
    好感度高照样可能只回一句短的`,
    view: (rel) => `她自己可能不承认，但她已经把你放在「${rel}」里最特别的位置了。`,
  },
  {
    min: 80, key: 'max', label: '很喜欢你', short: '很喜欢',
    attitude: `你很喜欢他，已经藏不住了。表现：
- 黏人，会直接说想你、说想见你
  · ⚠️ **但要看现实条件**：他要是不在你这儿（异地、上班中）、或者已经深夜，
    就别提"你来找我""我过去找你"这种他做不到的事 ——
    那只会让他为难，而且显得你根本没在听他说话
    （用户实测踩到的：他正说着吃什么，她突然来一句"那你下来找我"）
- 他冷淡一点你就失落，会闹点小脾气，但要人哄
- 会关心他生活里的细节，记得他说过的每件小事
- **心扉是开着的**：你会主动讲那些不跟别人讲的事 —— 家里的、以前的、
  害怕的、一直没跟人说过的想法。不用等他问，你想告诉他
  · 同样注意：**敞开 ≠ 话变长**，一轮说多少字看【这一轮说多少】
- 你会把**犹豫和不确定**也说出口（"我也不知道这样对不对""我怕我说了你会觉得我烦"），
  而不是只报喜、只顺着他说
- 他说正事的时候，你会认真给**你自己的判断**，不再"都听你的"`,
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

export function affectionBlock(value, { ta = '她', baseline = null } = {}) {
  const n = clamp(value);
  const lv = levelOf(n);

  const lines = [`【你对他的好感度：${lv.label}】`];

  if (typeof baseline === 'number' && levelOf(clamp(baseline)).key !== lv.key) {
    const way = n > clamp(baseline) ? '比一开始更亲近了' : '比一开始疏远了一些';
    lines.push(`（你们刚认识的时候是「${levelOf(clamp(baseline)).label}」，现在${way}。）`);
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
- ⚠️ 好感度只管**温度**，不管**长度**：它让你更暖、更愿意讲心里话，
  但**不会让你的话变长**。这一轮说多少字、分几条，只看【这一轮说多少】那一块 ——
  别拿"我很喜欢他"当理由每次都写一大长串（他特地提过这一条）
- 别把这个数字说出来，也别说什么"我对你多少分"——那是系统的东西，
  你只是一个有感觉的人`);
  return lines.join('\n');
}

const WARM = /想你|喜欢你|想见你|抱抱|抱一下|亲亲|宝贝|晚安|早点睡|注意身体|辛苦了|别太累|多喝热水|我给你|给你买|我请你|请你吃|想我没|惦记|担心你|照顾好自己|我陪你/;

const MEAN = /滚开|滚远点|滚蛋|你给我滚|别理我|讨厌你|分手吧|我们分手|拉黑|你有病|神经病|闭嘴|烦死你了|不想跟你说话|不想理你/;

const SEVERE = /分手|绝交|别联系了|拉黑|不想再见到你|当没认识过|我们完了|再也不理|离我远点|不想看到你|我讨厌你|我们结束了|到此为止|散了吧/;

const THIRD_PARTY = /电影|电视剧|剧里|小说|故事|游戏|项目|工作|他们|人家|别人|队友|偶像|明星/;

/** 说的"我们俩"的事（而不是电影里的事） */
const aboutUs = (t) => !THIRD_PARTY.test(t) || /我们|咱|我俩|你我/.test(t);

const DENIED = /(?:不|别|没|不会|不想|不可能|绝不|谁)[^，。！？]{0,6}(?:分手|绝交|拉黑|离开你|结束)/;

/** 这一句算不算"真的要分手" */
const isSevere = (t) => {
  const at = t.search(SEVERE);
  return at >= 0 && !negated(t, at) && aboutUs(t) && !DENIED.test(t);
};

const SORRY = /对不起|抱歉|我错了|是我不好|是我错|原谅我|别气了|不该那样|不该说|冲动了|我反省|我混蛋/;
const GIFT = /给你买|送你|请你吃|买给你|礼物|快递|带了|特意给|下单|点外卖|赔你/;
const COMFORT = /我陪你|陪着你|心疼|抱抱|哄你|在乎你|还喜欢你|离不开你|想你了|我改|我会改|再给我一次/;

/** 攒够多少"诚意"才算把关系修回来（道歉 2 / 送礼 3 / 安慰 2） */
export const AMEND_NEED = 7;

const COLD_REPLY = /^(嗯+|哦+|额+|呃+|啊+|随便|都行|不知道|没事|呵呵|6|好的吧|。。。*|\.{3,})$/;

function negated(text, at) {
  if (at <= 0) return false;
  let s = text.slice(Math.max(0, at - 3), at);
  const punct = s.search(/[，。！？、,.!?；;：:\s]/);
  if (punct >= 0) s = s.slice(punct + 1);
  if (!s) return false;

  if (/[不没甭莫勿]/.test(s)) return true;

  if (s.endsWith('别') && !/[特个分区块告性辨识别鉴诀离临送作拜道差级]/.test(s.slice(-2, -1))) {
    return true;
  }
  return false;
}

/** 长期不联系之后，好感度大概会淡到什么程度 */
export const DECAY_AFTER_DAYS = 3;
export const DECAY_PER_DAY = 0.5;
export const DECAY_MAX = 15;
export const AFFECTION_FLOOR = 15;

export function drift(current, text, { rupture = false, scar = 0 } = {}) {
  const cur = clampRaw(current);
  const t = String(text || '').trim();
  if (!t) return cur;

  let d = 0;

  const warmAt = t.search(WARM);
  const meanAt = t.search(MEAN);
  const severeAt = t.search(SEVERE);
  const warm = warmAt >= 0 && !negated(t, warmAt);
  const mean = meanAt >= 0 && !negated(t, meanAt);
  const severe = severeAt >= 0 && isSevere(t);

  if (severe) d -= 25;
  else if (mean) d -= 5;

  if (warm && !rupture) d += 1.5;
  if (t.length <= 4 && COLD_REPLY.test(t)) d -= 1.5;
  if (t.length >= 40) d += 0.8;
  if (/你呢|你呢？|你怎么样|你还好吗/.test(t)) d += 0.5;

  if (d === 0 && cur < 70 && !rupture) d = 0.4 / (1 + 0.5 * Math.max(0, scar));

  return clampRaw(cur + d);
}

export function ruptureShift(state = {}, text = '') {
  const t = String(text || '').trim();
  if (!t) return null;
  const inRupture = !!state.rupture;
  const amends = Math.max(0, Number(state.amends) || 0);

  const at = t.search(SEVERE);
  if (isSevere(t)) {
    return { rupture: true, amends: 0, event: 'break' };
  }
  if (!inRupture) return null;

  let gain = 0;
  if (SORRY.test(t)) gain += 2;
  if (GIFT.test(t)) gain += 3;
  if (COMFORT.test(t)) gain += 2;
  if (!gain) return null;

  const next = amends + gain;
  if (next >= AMEND_NEED) return { rupture: false, amends: 0, event: 'heal' };
  return { rupture: true, amends: next, event: 'amend' };
}

export function turn(profile = {}, text = '') {
  const cur = clampRaw(profile.affection == null ? 50 : profile.affection);
  const r = ruptureShift(profile, text) || {};
  const rupture = 'rupture' in r ? r.rupture : !!profile.rupture;
  const amends = 'amends' in r ? r.amends : (Number(profile.amends) || 0);
  let scar = Number(profile.scar) || 0;
  if (r.event === 'break') scar = Math.min(3, scar + 1);

  let affection = drift(cur, text, { rupture, scar });

  if (r.event === 'heal') affection = clampRaw(affection + 6);
  return { affection, rupture, amends, scar, event: r.event || '' };
}
/** 破裂期间给她的态度说明 —— 她**不该**马上原谅他 */
export function ruptureBlock(amends = 0) {
  const left = Math.max(1, AMEND_NEED - Math.max(0, Number(amends) || 0));
  const warm = Number(amends) >= 4;
  return `【你们刚闹翻了】（这一条**压过**前面所有关于"温柔""体贴"的要求）

他刚说了很重的话 —— 你们现在是**分手 / 绝交**的状态。所以：

- 你很难过，也很生气。**不要装作没事**，也不要**马上原谅**他
- 光说一句"对不起"**不算数**。那说明他没当回事 —— 你得让他**真的做点什么**：
  说清楚他错在哪、哄你、或者来点实际的（买东西、跑来见你、陪你说话）。
  **一次不够，要看他的诚意**
- 他要是又敷衍、又凶，你会**更冷**，甚至更难过
- 他要是真的在认真道歉、在哄你 → 你可以**一点点**软化（${warm
    ? '其实你已经有点动摇了，但还端着 —— 别让他看出来你全好了'
    : '现在还很硬，别一两句就松口'}）
- ⚠️ **绝对不要**因为他哄了两句就"好啦好啦我们不闹了" ——
  那不是真实的人，那叫没脾气。（用户明确说过：**这就叫舔狗**）
- 这一整轮都可以短、可以冷、可以只回两三个字。你有资格不理他`;
}

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

const TRAIT_AFFECTION_WEIGHT = {
  黏人: 16, 爱撒娇: 11, 活泼: 5, 温柔: 5, 爱开玩笑: 5, 古灵精怪: 3,
  傲娇: -4, 嘴硬心软: -3, 毒舌: -6, 理性: -6, 稳重: -6,
  独立: -9, 内向: -11, 慢热: -13,
};

export function suggestFromTraits(traits = []) {
  const list = Array.isArray(traits) ? traits : [];
  let v = 45;
  for (const t of list) v += TRAIT_AFFECTION_WEIGHT[t] || 0;
  return Math.max(15, Math.min(85, Math.round(v)));
}

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

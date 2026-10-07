/**
 * 「我」—— 你自己的基础资料。
 *
 * 为什么单独一个模块：这份资料**所有 AI 好友共用一份**（用户明确要求
 * "每个 ai 好友能看到我自己的信息"）。放在人格配置里就会变成"每个好友一份"，
 * 改个职业得改十几次，而且迟早不一致。
 *
 * 所以分两层：
 *   - **全局**（这里 / state.config 的 my* 字段）：名字、头像、职业、性别、年龄、生日
 *   - **每个好友一份**（profile）：记忆、好感度、场景
 *
 * ⚠️ 名字有两份历史包袱：`config.userName`（界面显示用）和
 *    `profile.name`（提示词里的"他叫X"）。这个人设是早期单好友时代留下的，
 *    所以 applyMe() 负责把两边对齐，别让它们各说各的。
 */

/** 我的资料默认值（老配置没有这些字段） */
export const ME_DEFAULTS = {
  userName: '',
  myEmoji: '',
  myAvatar: '',        // base64 dataURL，设了就优先用它
  myJob: '',           // 职业 / 专业（和她的 herJob 一样，能看出"是不是同行"）
  myAge: 0,
  myGender: '',        // 'm' / 'f' / ''（没填）
  myBirthday: '',      // 'M-D'
};

/** 从配置里取我的资料（缺字段给默认值，不返回 undefined） */
export function readMe(config = {}) {
  const str = (v) => String(v == null ? '' : v).trim();
  const age = Number(config.myAge);
  return {
    name: str(config.userName),
    emoji: str(config.myEmoji),
    avatar: str(config.myAvatar),
    job: str(config.myJob),
    age: Number.isFinite(age) && age > 0 ? Math.round(age) : 0,
    gender: config.myGender === 'm' || config.myGender === 'f' ? config.myGender : '',
    birthday: str(config.myBirthday),
  };
}

/** 资料填全了没有（没填的话提示词里就不加那一段，免得出现空条目） */
export const meIsEmpty = (me) => !me.name || (!me.job && !me.age && !me.gender && !me.birthday);

/** 我的资料有没有变过（用来决定要不要因为改名而重画界面） */
export const meSignature = (me) => [me.name, me.job, me.age, me.gender, me.birthday].join('|');

/**
 * 让 profile.name 和 config.userName 对齐。
 *
 * 为什么需要：`profile.name` 是提示词里"他叫X"的来源，
 * `config.userName` 是界面显示和气泡名字的来源。用户在人设页/设置里
 * 改的是后者，所以每次保存资料都要把它同步过去 ——
 * 以前只靠"聊天时她顺便记住名字"那条路，改了名要聊一句才生效。
 */
export function applyMe(profile, config) {
  if (!profile || !config) return false;
  const me = readMe(config);
  if (!me.name) return false;
  if (profile.name === me.name) return false;
  profile.name = me.name;
  return true;
}

/** 人话描述（"我"那张卡片上用） */
export function meSummary(me) {
  const bits = [
    me.age ? `${me.age} 岁` : '',
    me.job,
    me.gender === 'm' ? '男' : me.gender === 'f' ? '女' : '',
    me.birthday,
  ].filter(Boolean);
  return bits.join(' · ') || '还没填资料';
}

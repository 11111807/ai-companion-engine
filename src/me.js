/** 我的资料默认值（老配置没有这些字段） */
export const ME_DEFAULTS = {
  userName: '',
  myEmoji: '',
  myAvatar: '',
  myJob: '',
  myAge: 0,
  myGender: '',
  myBirthday: '',
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

/**
 * 多好友：人格索引、存储路由、以及"老数据怎么变成第一个好友"。
 *
 * ── 为什么默认好友继续用那三个老 key ──
 * 以前只有一个人格，数据平铺在 `xiaoyu.config.v1` / `chat` / `profile` 三个 key 里。
 * 现在要支持多个好友，最直觉的做法是全部搬到 `personas/<id>/...`。
 * 但那样等于把**存储格式重写一遍**：老用户的存档要迁移、150+ 处测试要改、
 * 任何一处漏了就是"升级后聊天记录没了"。
 *
 * 所以这里选了另一条路：**默认好友（id = 'default'）用的还是那三个老 key**。
 *   - 老用户零迁移（数据本来就在那儿）
 *   - 老测试、老行为全部不动
 *   - 多好友是**增量**：新加的好友才用自己的 `personas/<id>/...`
 *
 * 代价是"默认好友是个特例"，这一点被收在本文件里（`keysFor`），别的地方不用知道。
 *
 * ⚠️ 这个模块不碰 DOM，也不碰全局 state —— 纯数据 + 纯校验。
 *    要读哪个 key，由调用方把自己那一份 nav（索引）传进来。
 */

// ---------------------------------------------------------------- 存储键

/** 默认好友用的三个老 key（别改，改了老用户存档就找不到了） */
export const LEGACY_KEYS = {
  config: 'xiaoyu.config.v1',
  chat: 'xiaoyu.chat.v1',
  profile: 'xiaoyu.profile.v1',
};

/** 好友索引（列表、顺序、当前是谁） */
export const PERSONAS_KEY = 'xiaoyu.personas.v1';

/** 默认好友的 id —— 就是"小雨" */
export const DEFAULT_ID = 'default';

/**
 * 某个好友的存储键。
 * 默认好友走老 key，其他好友走自己的命名空间。
 */
export function keysFor(id) {
  if (!id || id === DEFAULT_ID) return { ...LEGACY_KEYS };
  return {
    config: `xiaoyu.persona.${id}.config.v1`,
    chat: `xiaoyu.persona.${id}.chat.v1`,
    profile: `xiaoyu.persona.${id}.profile.v1`,
  };
}

// ---------------------------------------------------------------- 索引

/**
 * 好友索引的默认值。
 * 新用户和老用户都从"只有小雨"开始 —— 老用户那三个 key 里本来就有他的存档。
 */
function emptyNav() {
  return {
    version: 1,
    list: [{ id: DEFAULT_ID, name: '', emoji: '', createdAt: 0 }],
    active: DEFAULT_ID,
    order: [DEFAULT_ID],
  };
}

/**
 * 把存下来的索引修成一个能用的形状。
 *
 * 四种情况都要兜住：
 *   1. 没有索引（老用户 / 新用户）→ 只有"小雨"
 *   2. 索引坏了（不是对象 / list 不是数组）→ 同上
 *   3. 索引里没有默认好友，但**不是他删的**（写坏了）→ 补回去
 *   4. `noDefault: true`（他用"忘记你们的一切"把默认好友删了）→ **不补**，
 *      列表可以是空的 —— 那时界面要提示"请添加好友"
 */
export function normalizeNav(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return emptyNav();

  const seen = new Set();
  const list = [];
  for (const p of raw.list) {
    const id = String(p?.id || '').trim();
    if (!id || seen.has(id)) continue;      // 空 id / 重复 id 都丢掉（重复会让顺序错乱）
    seen.add(id);
    list.push({
      id,
      name: String(p?.name || '').slice(0, 16),
      emoji: String(p?.emoji || '').slice(0, 8),
      createdAt: Number(p?.createdAt) || 0,
      // 每个好友自己的小状态（列表页用）
      lastAt: Number(p?.lastAt) || 0,
      lastText: String(p?.lastText || '').slice(0, 40),
      unread: Math.max(0, Math.round(Number(p?.unread) || 0)),
    });
  }

  // 默认好友被"删档"删掉过 → 尊重这个空列表，别再把它塞回来
  const wiped = raw.noDefault === true;
  if (!wiped && !seen.has(DEFAULT_ID)) {
    list.unshift({ id: DEFAULT_ID, name: '', emoji: '', createdAt: 0 });
  }

  // order 里只留真实存在的好友，缺的补到末尾 ——
  // 这样即使用户手动改坏了 order，也不会有人从列表里消失
  const ids = list.map((p) => p.id);
  const order = [...new Set((Array.isArray(raw.order) ? raw.order : []).map(String))]
    .filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);

  // 一个好友都没有时 active 只能是空串（界面据此显示"请添加好友"）
  const wanted = String(raw.active || '');
  const active = ids.includes(wanted) ? wanted : (ids.includes(DEFAULT_ID) ? DEFAULT_ID : (ids[0] || ''));
  const nav = { version: 1, list, active, order };
  if (wiped) nav.noDefault = true;
  return nav;
}

/** 按 order 排好序的好友列表 */
export function orderedList(nav) {
  const n = normalizeNav(nav);
  const byId = new Map(n.list.map((p) => [p.id, p]));
  return n.order.map((id) => byId.get(id)).filter(Boolean);
}

export const findPersona = (nav, id) =>
  normalizeNav(nav).list.find((p) => p.id === String(id)) || null;

const activeId = (nav) => normalizeNav(nav).active;

export const activeKeys = (nav) => keysFor(activeId(nav));
export const keysOf = (nav, id) => keysFor(id);

// ---------------------------------------------------------------- 生成 / 增删

/** id 必须是可读的短串，因为它是 localStorage key 的一部分 */
export function makeId(taken = []) {
  const t = new Set(taken.map(String));
  for (let i = 0; i < 500; i++) {
    const id = `p${Date.now().toString(36)}${i.toString(36)}`;
    if (!t.has(id)) return id;
  }
  return `p${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 造一个新好友的档案（纯数据，不写盘）。
 * @param {string} id
 * @param {object} [fields] name / emoji / 以及其它想覆盖的字段
 */
export function newPersona(id, fields = {}) {
  return {
    id,
    name: String(fields.name || '').slice(0, 16),
    emoji: String(fields.emoji || '🙂').slice(0, 8),
    createdAt: Number(fields.createdAt) || Date.now(),
    lastAt: 0,
    lastText: '',
    unread: 0,
  };
}

/**
 * 加一个好友到索引（不写盘，由调用方决定什么时候存）。
 * @returns {{nav:object, persona:object}}
 */
export function addPersona(nav, fields = {}) {
  const n = normalizeNav(nav);
  const id = String(fields.id || '').trim() || makeId(n.list.map((p) => p.id));
  if (n.list.some((p) => p.id === id)) return { nav: n, persona: findPersona(n, id) };

  const persona = newPersona(id, fields);
  n.list.push(persona);
  n.order.push(id);
  return { nav: n, persona };
}

/**
 * 删一个好友。
 *
 * ⚠️ **默认好友也能删**（原话："删档后直接删掉好友，如果此时消息页没有对话框，
 * 好友页没有好友，注明，请添加好友"）—— 走的是"忘记你们的一切"那条路：
 * 删之前他的数据已经按 key 清掉了，所以这里要做的只是**别把它加回来**，
 * 打个 `noDefault` 标记（见 normalizeNav）。
 *
 * 平时在「好友」页删人是另一回事（那里不给删默认好友，因为有老 key 兜着）。
 */
export function removePersona(nav, id, { allowDefault = false } = {}) {
  const n = normalizeNav(nav);
  const target = String(id);
  if (!target) return { nav: n, removed: false };
  if (target === DEFAULT_ID && !allowDefault) return { nav: n, removed: false };

  const before = n.list.length;
  n.list = n.list.filter((p) => p.id !== target);
  n.order = n.order.filter((x) => x !== target);
  if (target === DEFAULT_ID) n.noDefault = true;
  if (n.active === target) n.active = n.order[0] || '';
  return { nav: n, removed: n.list.length < before };
}

/** 切到某个好友；不存在就原样返回 */
export function setActive(nav, id) {
  const n = normalizeNav(nav);
  if (n.list.some((p) => p.id === String(id))) n.active = String(id);
  return n;
}

/** 改好友的展示信息（名字、头像、列表摘要） */
export function patchPersona(nav, id, fields = {}) {
  const n = normalizeNav(nav);
  const p = n.list.find((x) => x.id === String(id));
  if (!p) return n;
  if ('name' in fields) p.name = String(fields.name || '').slice(0, 16);
  if ('emoji' in fields) p.emoji = String(fields.emoji || '').slice(0, 8);
  if ('lastAt' in fields) p.lastAt = Number(fields.lastAt) || 0;
  if ('lastText' in fields) p.lastText = String(fields.lastText || '').slice(0, 40);
  if ('unread' in fields) p.unread = Math.max(0, Math.round(Number(fields.unread) || 0));
  return n;
}

/** 有人说话/收到消息时更新列表摘要；他在看那一页就不算未读 */
export function noteActivity(nav, id, text, at, { markUnread = false } = {}) {
  const n = patchPersona(nav, id, { lastAt: Number(at) || Date.now(), lastText: text });
  if (!markUnread) return n;
  const p = n.list.find((x) => x.id === String(id));
  if (p && n.active !== p.id) p.unread = (p.unread || 0) + 1;
  return n;
}

export const clearUnread = (nav, id) => patchPersona(nav, id, { unread: 0 });

/** 好友列表按最近说话排序（默认好友没说过话时按创建时间垫底） */
export function byRecency(nav) {
  return orderedList(nav).slice().sort((a, b) => {
    const d = (b.lastAt || 0) - (a.lastAt || 0);
    if (d) return d;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

// ---------------------------------------------------------------- 迁移

/**
 * 老用户升级时要做的事。
 *
 * 因为默认好友直接用老 key，这里**几乎不用搬数据** ——
 * 只要确认索引存在（这样列表页才知道有小雨这个人）。
 *
 * @returns {{nav:object, migrated:boolean}} migrated=true 表示需要写盘
 */
export function migrate(nav, { hasLegacyData = false } = {}) {
  if (nav && typeof nav === 'object' && Array.isArray(nav.list)) {
    return { nav: normalizeNav(nav), migrated: false };
  }
  const n = emptyNav();
  // 老用户：老 key 里有东西，那就给小雨记上创建时间（列表排序要用）
  if (hasLegacyData) n.list[0].createdAt = Date.now();
  return { nav: n, migrated: true };
}

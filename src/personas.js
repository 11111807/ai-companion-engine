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

export function keysFor(id) {
  if (!id || id === DEFAULT_ID) return { ...LEGACY_KEYS };
  return {
    config: `xiaoyu.persona.${id}.config.v1`,
    chat: `xiaoyu.persona.${id}.chat.v1`,
    profile: `xiaoyu.persona.${id}.profile.v1`,
  };
}

function emptyNav() {
  return {
    version: 1,
    list: [{ id: DEFAULT_ID, name: '', emoji: '', createdAt: 0 }],
    active: DEFAULT_ID,
    order: [DEFAULT_ID],
  };
}

export function normalizeNav(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return emptyNav();

  const seen = new Set();
  const list = [];
  for (const p of raw.list) {
    const id = String(p?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      name: String(p?.name || '').slice(0, 16),
      emoji: String(p?.emoji || '').slice(0, 8),
      createdAt: Number(p?.createdAt) || 0,

      lastAt: Number(p?.lastAt) || 0,
      lastText: String(p?.lastText || '').slice(0, 40),
      unread: Math.max(0, Math.round(Number(p?.unread) || 0)),
    });
  }

  const wiped = raw.noDefault === true;
  if (!wiped && !seen.has(DEFAULT_ID)) {
    list.unshift({ id: DEFAULT_ID, name: '', emoji: '', createdAt: 0 });
  }

  const ids = list.map((p) => p.id);
  const order = [...new Set((Array.isArray(raw.order) ? raw.order : []).map(String))]
    .filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);

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

/** id 必须是可读的短串，因为它是 localStorage key 的一部分 */
export function makeId(taken = []) {
  const t = new Set(taken.map(String));
  for (let i = 0; i < 500; i++) {
    const id = `p${Date.now().toString(36)}${i.toString(36)}`;
    if (!t.has(id)) return id;
  }
  return `p${Math.random().toString(36).slice(2, 10)}`;
}

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

export function addPersona(nav, fields = {}) {
  const n = normalizeNav(nav);
  const id = String(fields.id || '').trim() || makeId(n.list.map((p) => p.id));
  if (n.list.some((p) => p.id === id)) return { nav: n, persona: findPersona(n, id) };

  const persona = newPersona(id, fields);
  n.list.push(persona);
  n.order.push(id);
  return { nav: n, persona };
}

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

export function migrate(nav, { hasLegacyData = false } = {}) {
  if (nav && typeof nav === 'object' && Array.isArray(nav.list)) {
    return { nav: normalizeNav(nav), migrated: false };
  }
  const n = emptyNav();

  if (hasLegacyData) n.list[0].createdAt = Date.now();
  return { nav: n, migrated: true };
}

/**
 * 好友界面：消息页 / 好友页 / 我 / 加好友面板。
 *
 * 为什么单独一个模块：这一块是**纯界面**（画列表、切页面、加好友的流程），
 * 但又需要 app.js 里一大堆状态和函数。硬把它做成"参数传进去"的纯模块
 * 会让调用点写得很难看（要传二十个东西），所以这里用**工厂模式**：
 * app.js 在启动时把需要的依赖一次性交给它，之后这些函数就活在好友界面的作用域里。
 *
 * ⚠️ 这是全项目唯一一处"界面模块持有 app.js 依赖"的地方，别复制这个模式到别处 ——
 *    别的模块（storage / memory-io / search / personas…）都该是纯的、参数传入。
 *
 * 三个主页的约定：
 *   - 底部导航只在这三个主页上出现；聊天页和各个设置页是盖在它们上面的下一层
 *   - 页面切换统一用 **hidden 属性**，不用 class（class 那套被 [hidden] 压住过，
 *     表现成"类是加上了但页面不动"，很难查）
 */
export function createFriendUI(deps) {
  const {
    state, $, $$, esc, timeText,
    CHARACTER, PERSONA_PRESETS, findPreset, presetToForm,
    keysFor, findPersona, orderedList, byRecency,
    addPersona, setActive, patchPersona, clearUnread,
    readJSON, saveConfig, saveProfile, saveChat, savePersonaIndex,
    fixProfileShape, fixConfigShape, loadPersona, now,
    renderHerIdentity, renderAffection, renderClock, renderChat,
    openPersona, openSettings, openMenu, toast, nearestAffPreset, defaultAffectionFor,
  } = deps;

  /** 列表行里的头像。
   *  ⚠️ 故意不用 `.wx-avatar.her` / `.wx-avatar.me`：那两个类是"聊天页里的头像"，
   *  测试靠它们验证"换头像后聊天区跟着变"，列表行复用会让选择器抓到列表里的。 */
  const listAvatarHTML = (emoji) =>
    `<div class="wx-avatar item">${esc(emoji || '🙂')}</div>`;

  /** 列表要显示的东西：名字、头像、最后一句、时间、未读 */
  function personaView(id) {
    const meta = findPersona(state.nav, id);
    const k = keysFor(id);
    const cfg = readJSON(k.config, {}) || {};
    const chat = readJSON(k.chat, []) || [];
    const last = chat.length ? chat[chat.length - 1] : null;
    return {
      id,
      name: String(cfg.herName || '').trim() || meta?.name || CHARACTER.name,
      emoji: cfg.herEmoji || meta?.emoji || CHARACTER.emoji,
      lastText: meta?.lastText || (last ? String(last.content || '').split('\n')[0] : ''),
      lastAt: meta?.lastAt || Number(last?.ts) || 0,
      unread: Number(meta?.unread) || 0,
      createdAt: Number(meta?.createdAt) || 0,
    };
  }

  /** 按最近说话排序（消息页 / 好友页都用它，只是显示内容不同） */
  const recentPersonas = () => byRecency(state.nav).map((p) => personaView(p.id));

  // -------------------------------------------------------------- 切人

  /**
   * 切到另一个好友。
   *
   * ⚠️ 内存里只有"当前好友"那一份 config/messages/profile（这是刻意的：
   *    每个好友一份内存副本会让几百处 state.profile 读写变得不可控）。
   *    所以切换 = 当前这份落盘 + 读下一份进来。
   *
   * @returns {boolean} 真的切过去了才 true。
   *   ⚠️ **必须显式 return** —— 调用方写的是 `if (!switchPersona(id)) return;`，
   *      漏了就返回 undefined，"人切了、页面没切"，极难查（踩过一次）。
   */
  function switchPersona(id) {
    const target = String(id || '');
    if (!findPersona(state.nav, target)) return false;
    if (target === state.nav.active) return true;

    saveProfile();
    saveChat();
    saveConfig();
    savePersonaIndex();

    state.nav = setActive(state.nav, target);
    loadPersona(target);
    savePersonaIndex();

    renderHerIdentity();
    renderAffection();
    renderClock();
    renderChat();
    return true;
  }

  /** 主页之间／主页与聊天页之间切换：只留一个可见 */
  function showOnlyScreen(sel) {
    const want = sel.replace('#', '');
    for (const s of $$('.screen:not(.overlay)')) s.hidden = s.id !== want;
  }

  /** 进入某个好友的聊天页 */
  function openChat(id) {
    if (id && String(id) !== state.nav.active) {
      if (!switchPersona(id)) return;
    }
    state.nav = clearUnread(state.nav, state.nav.active);
    savePersonaIndex();

    $('#tabbar').hidden = true;
    showOnlyScreen('#screen-chat');
    renderChat();
    refreshUnreadDot();
  }

  /** 从聊天页退回消息列表（左上角返回键） */
  const closeChat = () => showTab('msgs');

  // -------------------------------------------------------------- 三个主页

  function showTab(tab) {
    const which = ['msgs', 'friends', 'me'].includes(tab) ? tab : 'msgs';
    const map = { msgs: '#screen-msgs', friends: '#screen-friends', me: '#screen-me' };
    showOnlyScreen(map[which]);
    $$('.wx-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === which));
    $('#tabbar').hidden = false;
    if (which === 'msgs') renderMsgList();
    if (which === 'friends') renderFriendList();
    if (which === 'me') renderMe();
  }

  /** 底部导航那个小红点：有没有人给你留了话 */
  function refreshUnreadDot() {
    const dot = $('#tabDotMsgs');
    if (!dot) return;
    dot.hidden = !orderedList(state.nav).some((p) => (p.unread || 0) > 0);
  }

  /** 主页统一重画 */
  function renderNav() {
    renderMsgList();
    renderFriendList();
    renderMe();
    refreshUnreadDot();
  }

  const listItemHTML = (v, { showUnread = true } = {}) => `
    <div class="wx-item" data-open="${esc(v.id)}" role="button" tabindex="0">
      ${listAvatarHTML(v.emoji)}
      <div class="wx-item-body">
        <div class="wx-item-top">
          <span class="wx-item-name">${esc(v.name)}</span>
          <span class="wx-item-time">${v.lastAt ? esc(timeText(v.lastAt)) : ''}</span>
        </div>
        <div class="wx-item-sub">${esc(v.lastText || '还没聊过')}</div>
      </div>
      ${showUnread && v.unread ? `<span class="wx-item-badge">${v.unread > 99 ? '99+' : v.unread}</span>` : ''}
    </div>`;

  function renderMsgList() {
    const box = $('#msgList');
    if (!box) return;
    const list = recentPersonas();
    const talked = list.filter((v) => v.lastAt || v.lastText);
    const rest = list.filter((v) => !v.lastAt && !v.lastText);

    const parts = [];
    if (talked.length) parts.push(talked.map((v) => listItemHTML(v)).join(''));
    if (rest.length) {
      parts.push('<div class="wx-group-title">还没说过话</div>');
      parts.push(rest.map((v) => listItemHTML(v)).join(''));
    }
    if (!list.length) parts.push('<div class="wx-empty">还没有好友。<br>去「好友」加一个。</div>');
    box.innerHTML = parts.join('');
  }

  function renderFriendList() {
    const box = $('#friendList');
    if (!box) return;
    const list = recentPersonas();
    box.innerHTML = `
      <div class="wx-item add" data-add="new" role="button" tabindex="0">
        <div class="wx-avatar item blank">＋</div>
        <div class="wx-item-body">
          <div class="wx-item-top"><span class="wx-item-name">添加好友</span></div>
          <div class="wx-item-sub">从预设人格里挑一个，或者自己捏一个</div>
        </div>
      </div>
      <div class="wx-group-title">全部好友（${list.length}）</div>
      ${list.map((v) => listItemHTML(v, { showUnread: false })).join('')}`;
  }

  // -------------------------------------------------------------- 我

  function renderMe() {
    const box = $('#meCard');
    if (!box) return;
    const { readMe, meSummary } = deps;
    const me = readMe(state.config);
    const avatar = me.avatar
      ? `<div class="wx-avatar item pic" style="background-image:url(${me.avatar})"></div>`
      : `<div class="wx-avatar item">${esc(me.emoji || me.name?.[0] || '我')}</div>`;

    box.innerHTML = `
      <div class="wx-me-card">
        ${avatar}
        <div class="wx-item-body">
          <div class="wx-me-name">${esc(me.name || '还没起名字')}</div>
          <div class="wx-me-sub">${esc(meSummary(me))}</div>
        </div>
      </div>
      <div class="wx-group-title">这些资料每个好友都看得到</div>
      <div class="wx-item" data-me="edit" role="button" tabindex="0">
        <div class="wx-item-body">
          <div class="wx-item-top"><span class="wx-item-name">改我的资料</span></div>
          <div class="wx-item-sub">名字、头像、职业、性别、年龄、生日</div>
        </div>
      </div>
      <div class="wx-group-title">全局</div>
      <div class="wx-item" data-me="settings" role="button" tabindex="0">
        <div class="wx-item-body">
          <div class="wx-item-top"><span class="wx-item-name">设置</span></div>
          <div class="wx-item-sub">API Key、回复风格、数据</div>
        </div>
      </div>`;
  }

  // -------------------------------------------------------------- 加好友

  /** 加好友面板：预设人格 + 空白新建 */
  function openAddFriend() {
    const wrap = $('#addFriendPanel');
    wrap.hidden = false;
    // .overlay 靠 .show 滑进来 —— 只去掉 hidden 是不动的（它是 translateX(100%)）
    wrap.classList.add('show');
    $('#addFriendList').innerHTML = PERSONA_PRESETS.map((p) => `
      <div class="wx-item" data-preset="${esc(p.id)}" role="button" tabindex="0">
        ${listAvatarHTML(p.emoji)}
        <div class="wx-item-body">
          <div class="wx-item-top">
            <span class="wx-item-name">${esc(p.name)}</span>
            <span class="wx-item-time">${p.age} · ${esc(p.relation)}</span>
          </div>
          <div class="wx-item-sub">${esc(p.blurb)}</div>
        </div>
      </div>`).join('');
  }

  function closeAddFriend() {
    $('#addFriendPanel').classList.remove('show');
    $('#addFriendPanel').hidden = true;
  }

  /**
   * 用一个预设（或空白）建新好友，然后进人设页让他确认/修改。
   * 预设只填"初始值"，人设页里改什么就是什么。
   */
  function createPersona(presetId) {
    const preset = findPreset(presetId);
    const { nav, persona } = addPersona(state.nav, {
      name: preset ? preset.name : '',
      emoji: preset ? preset.emoji : '🙂',
    });

    // 先把当前好友落盘，再切到新好友（新好友还是空的）
    saveProfile();
    saveChat();
    saveConfig();
    state.nav = setActive(nav, persona.id);
    savePersonaIndex();

    for (const key of Object.keys(state.config)) delete state.config[key];
    state.messages = [];
    for (const key of Object.keys(state.profile)) delete state.profile[key];
    fixProfileShape(state.profile, state.messages);
    fixConfigShape(state.config, saveConfig);

    if (preset) {
      const f = presetToForm(preset);
      state.config.herName = f.herName;
      state.config.herEmoji = f.herEmoji;
      state.config.herGender = f.herGender;
      state.config.herAge = f.herAge;
      state.config.herJob = f.herJob;
      state.config.herRelation = f.herRelation;
      state.config.herTraits = f.herTraits;
      state.config.herTraitNote = f.herTraitNote;
      if (f.sceneText) {
        state.profile.sceneText = f.sceneText;
        state.profile.sceneId = 'custom';
        state.profile.sceneCustom = true;
        state.profile.sceneAt = now();
      }
      state.profile.affection = nearestAffPreset(defaultAffectionFor(f.herRelation));
      state.profile.affectionBase = state.profile.affection;
      // 预设自带的开场白，第一次见面时用一次（见 app.js 的 bootGreeting）
      state.config.pendingOpening = f.opening || '';
    }
    saveConfig();
    saveProfile();

    closeAddFriend();
    renderNav();
    openPersona({ fromSettings: true, asNew: true });
  }

  // -------------------------------------------------------------- 我的资料页

  function openMe() {
    const { readMe } = deps;
    const me = readMe(state.config);
    $('#meName').value = me.name;
    $('#meJob').value = me.job;
    $('#meAge').value = me.age || '';
    $('#meBirthday').value = me.birthday;
    deps.setSegOn('#segMeGender', me.gender || '');
    deps.renderAvatarPreview('me');
    $('#screen-me-edit').classList.add('show');
    $('#screen-me-edit').hidden = false;
  }

  function closeMe() {
    $('#screen-me-edit').classList.remove('show');
    $('#screen-me-edit').hidden = true;
  }

  function applyMeForm() {
    const { applyMe, parseBirthday, herName } = deps;
    const c = state.config;
    c.userName = $('#meName').value.trim().slice(0, 12);
    c.myJob = $('#meJob').value.trim().slice(0, 20);
    const age = Number($('#meAge').value);
    c.myAge = age >= 10 && age <= 100 ? Math.round(age) : 0;
    const g = deps.segOn('#segMeGender');
    c.myGender = g === 'm' ? 'm' : g === 'f' ? 'f' : '';
    const bd = parseBirthday($('#meBirthday').value);
    c.myBirthday = bd ? `${bd.month}-${bd.day}` : '';
    // 头像不在这里收：它由头像面板直接写进 config（见 app.js 的 avatarOps）
    applyMe(state.profile, c);
    saveConfig();
    saveProfile();

    if ($('#inpUserName') && document.activeElement !== $('#inpUserName')) {
      $('#inpUserName').value = c.userName;
    }
    renderMe();
    renderChat();
    toast('资料改好了，每个好友都看得到', 2000);
    return herName();
  }

  // -------------------------------------------------------------- 事件

  /** 事件委托：从点击目标往上找最近的 [data-*]，把那个元素交给回调（列表会重画） */
  function onTap(sel, handler) {
    const box = $(sel);
    if (!box) return;
    box.addEventListener('click', (e) => {
      const el = e.target.closest('[data-open],[data-tab],[data-me],[data-add],[data-preset]');
      if (el && box.contains(el)) handler(el);
    });
  }

  function bindHome() {
    onTap('#tabbar', (el) => { if (el.dataset.tab) showTab(el.dataset.tab); });
    onTap('#msgList', (el) => { if (el.dataset.open) openChat(el.dataset.open); });
    onTap('#friendList', (el) => {
      if (el.dataset.add) { openAddFriend(); return; }
      if (el.dataset.open) openChat(el.dataset.open);
    });
    onTap('#meCard', (el) => {
      if (el.dataset.me === 'edit') { openMe(); return; }
      if (el.dataset.me === 'settings') openSettings();
    });
    onTap('#addFriendList', (el) => { if (el.dataset.preset) createPersona(el.dataset.preset); });
    $('#btnAddFriend')?.addEventListener('click', openAddFriend);
    $('#btnCloseAddFriend')?.addEventListener('click', closeAddFriend);
    $('#btnAddBlank')?.addEventListener('click', () => createPersona(''));
    $('#btnBack')?.addEventListener('click', closeChat);   // 聊天页左上角：回消息列表
    $('#btnMsgsMore')?.addEventListener('click', openMenu);

    $('#btnCloseMe')?.addEventListener('click', () => { closeMe(); renderMe(); });
    $('#btnMeSave')?.addEventListener('click', () => { applyMeForm(); closeMe(); });
    $('#btnPickMeAvatar')?.addEventListener('click', () => {
      deps.pickAvatarForMe();
    });
    deps.onSeg('#segMeGender', (v) => deps.setSegOn('#segMeGender', v));
  }

  /** 把当前好友的名字/头像同步到索引（他在人设页改完之后） */
  function syncPersonaMeta() {
    state.nav = patchPersona(state.nav, state.nav.active, {
      name: deps.herName(), emoji: deps.herEmoji(),
    });
    savePersonaIndex();
    renderNav();
  }

  return {
    listAvatarHTML,
    personaView,
    recentPersonas,
    switchPersona,
    showOnlyScreen,
    openChat,
    closeChat,
    showTab,
    refreshUnreadDot,
    renderNav,
    renderMsgList,
    renderFriendList,
    renderMe,
    openAddFriend,
    closeAddFriend,
    createPersona,
    openMe,
    closeMe,
    applyMeForm,
    onTap,
    bindHome,
    syncPersonaMeta,
  };
}

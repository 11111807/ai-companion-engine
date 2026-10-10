export function createEndingUI(deps) {
  const {
    state, $, toast, herName, keysFor, removeKeys, findPersona, removePersona, setActive,
    savePersonaIndex, loadPersona, resetChatRender, resetRecallIndex, fixProfileShape,
    renderHerIdentity, renderAffection, renderClock, renderChat, renderMoodStrip,
    renderNav, updateDataInfo, showTab, DEFAULT_ID, ENDING_DIALOG,
  } = deps;

  function openConfirm({ title, body, yes = '是', no = '否' }) {
    return new Promise((resolve) => {
      const mask = $('#confirmMask');
      if (!mask) { resolve(false); return; }
      $('#confirmTitle').textContent = title;
      $('#confirmBody').textContent = body;
      const btnYes = $('#confirmYes');
      const btnNo = $('#confirmNo');
      btnYes.textContent = yes;
      btnNo.textContent = no;

      const done = (val) => {
        btnYes.removeEventListener('click', onYes);
        btnNo.removeEventListener('click', onNo);
        mask.removeEventListener('click', onMask);
        mask.hidden = true;
        resolve(val);
      };
      const onYes = () => done(true);
      const onNo = () => done(false);
      const onMask = (e) => { if (e.target === mask) done(false); };
      btnYes.addEventListener('click', onYes);
      btnNo.addEventListener('click', onNo);
      mask.addEventListener('click', onMask);
      mask.hidden = false;
    });
  }

  async function runEndingFlow(hit) {

    const owner = state.nav.active;
    const first = await openConfirm({
      ...ENDING_DIALOG.first,
      body: `${ENDING_DIALOG.first.body}\n\n（你写的是"${String(hit).slice(0, 16)}"）`,
    });
    if (!first) {
      state.pendingDream = true;
      toast('那就当它是一场梦', 2000);
      return false;
    }
    const second = await openConfirm(ENDING_DIALOG.second);
    if (!second) {
      state.pendingDream = true;
      toast('好，那就不动它', 2000);
      return false;
    }
    if (state.nav.active !== owner) return false;
    deleteFriend(owner || DEFAULT_ID);
    showTab('msgs');
    return true;
  }

  async function confirmDeleteFriend() {
    const name = herName();
    const ok = await openConfirm({
      title: `删除「${name}」？`,
      body: '她的聊天记录、她记得的事、好感度都会一起清掉，人也会从好友列表里消失。\n'
        + '只有这一个，别的 AI 好友不受影响。',
      yes: '删除',
      no: '取消',
    });
    if (!ok) return;
    deleteFriend(state.nav.active || DEFAULT_ID);
  }

  function deleteFriend(id) {

    const keys = keysFor(id);
    removeKeys([keys.config, keys.chat, keys.profile]);

    state.nav = removePersona(state.nav, id, { allowDefault: true }).nav;

    resetRecallIndex();
    resetChatRender();

    if (state.nav.active) return switchToSurvivor();

    state.messages = [];
    for (const key of Object.keys(state.profile)) delete state.profile[key];
    fixProfileShape(state.profile, []);
    for (const key of ['herName', 'herEmoji', 'herTraits', 'herTraitNote', 'herRelation',
      'herBirthday', 'herAge', 'herJob', 'userJob', 'userBio', 'herGender']) {
      delete state.config[key];
    }
    state.config.personaDone = false;
    state.config.userName = '';
    savePersonaIndex();
    renderChat();
    renderMoodStrip();
    renderNav();
    updateDataInfo();
    toast('已经忘了。想继续的话，先添加一个好友。', 3200);
  }

  /** 还有别的好友 → 切过去，停在消息列表 */
  function switchToSurvivor() {
    loadPersona(state.nav.active);
    savePersonaIndex();
    renderHerIdentity();
    renderAffection();
    renderClock();
    renderChat();
    renderMoodStrip();
    renderNav();
    updateDataInfo();
    toast('已经把她忘了。', 2400);
  }

  function notePendingNew(fromId, newId) {
    state.pendingNew = { from: fromId, id: newId };
  }

  /** 撤掉刚建的那个好友（人设页点返回时走这条） */
  function cancelPendingNew() {
    const p = state.pendingNew;
    state.pendingNew = null;
    if (!p) return;

    const k = keysFor(p.id);
    removeKeys([k.config, k.chat, k.profile]);

    state.nav = removePersona(state.nav, p.id).nav;
    if (findPersona(state.nav, p.from)) state.nav = setActive(state.nav, p.from);
    savePersonaIndex();
    loadPersona(state.nav.active);
    resetChatRender();
    renderHerIdentity();
    renderAffection();
    renderChat();
    renderNav();
    $('#screen-persona').classList.remove('show');
    showTab('msgs');
    toast('好，那就不加了', 1800);
  }

  return { openConfirm, runEndingFlow, confirmDeleteFriend, deleteFriend, notePendingNew, cancelPendingNew };
}

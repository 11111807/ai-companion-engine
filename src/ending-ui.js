/**
 * 终局与删档：二次确认弹窗 / 剧情触发的删档 / 删好友 / 撤销刚建的空好友。
 *
 * 为什么单独一个模块：app.js 已经顶到行数上限了（那根线抬了太多次，
 * 上一轮明确写了"下一轮必须拆"）。这一块正好是**自成一体的一组界面流程** ——
 * 它们全都围绕同一个问题："要不要把这个人连同存档一起清掉"。
 *
 * 和 friend-ui.js 一样用**工厂模式**（app.js 启动时把依赖一次性交进来）：
 * 这些函数要动的东西太多（存档 key、好友索引、渲染、toast），
 * 硬写成参数传入会让每个调用点都长得没法看。
 *
 * 三条路径的不一样是**故意**的（用户要求的）：
 *   1. 剧情里写了"离开这个世界" → 问两遍（拦手滑），第二遍是"再确认一次"
 *   2. 设置页里主动点「删除这个好友」 → 只问一遍，文案直说"删除"
 *   3. 加好友途中点返回 → 不问，直接把刚建的空壳撤掉
 */
export function createEndingUI(deps) {
  const {
    state, $, toast, herName, keysFor, removeKeys, findPersona, removePersona, setActive,
    savePersonaIndex, loadPersona, resetChatRender, resetRecallIndex, fixProfileShape,
    renderHerIdentity, renderAffection, renderClock, renderChat, renderMoodStrip,
    renderNav, updateDataInfo, showTab, DEFAULT_ID, ENDING_DIALOG,
  } = deps;

  /**
   * 二次确认弹窗。返回 true = 他点了"是"。
   *
   * 为什么不用系统 confirm()：按钮配色本身就是内容 ——
   * "是"必须是灰的（危险动作不该长得像推荐），"否"必须是绿的。
   * 而且这里要连着问两遍，系统弹窗在手机上也太重。
   */
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
      const onMask = (e) => { if (e.target === mask) done(false); };   // 点空白 = 取消
      btnYes.addEventListener('click', onYes);
      btnNo.addEventListener('click', onNo);
      mask.addEventListener('click', onMask);
      mask.hidden = false;
    });
  }

  /**
   * 终局流程：问两遍，都点头才删档。
   * 任何一步选"否 / 我还没想好" → 不删档，并记下"要把这段剧情圆成一场梦"。
   *
   * @param {string} hit 命中的那句（只用于提示，不影响流程）
   * @returns {Promise<boolean>} 真的删了才返回 true
   */
  async function runEndingFlow(hit) {
    // 删的必须是**发起这一轮**的那个人，不是"等弹窗的这几秒里变成了谁" ——
    // 和 respond() 那套归属检查同一个道理（见 app.js 的 movedAway）。
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
    showTab('msgs');     // 好友删了 → 回到消息列表（那里会提示"请添加好友"）
    return true;
  }

  /**
   * 设置页里的「删除这个好友」。
   *
   * 和"终局"那套**故意做得不一样**（用户要求）：那边是两轮确认 + 一句"是否忘记
   * 你们的一切"，因为它是剧情触发、要拦住手滑；这里是他在设置页里主动点的，
   * **一轮确认**就够 —— 文案也直说"删除"。
   */
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

  /**
   * 忘记你们的一切 —— 按用户的要求，**连这个好友一起删掉**：
   * 「删档后直接删掉好友，如果此时消息页没有对话框，好友页没有好友，注明，请添加好友」。
   *
   * 终局那条路和设置页的「删除」都走它。
   *
   * 三步：
   *   1. 把这个好友的三个存档 key 删掉（真删，不是留着）
   *   2. 从好友索引里摘掉（默认好友也能删，打 noDefault 标记，见 personas.js）
   *   3. 还有别人 → 切过去停在消息列表；一个都没有 → 清空内存 + 显示"请添加好友"
   */
  function deleteFriend(id) {
    // 1) 真删存档。默认好友用的是老 key，其他好友是各自的命名空间 —— 都由 keysFor 给。
    const keys = keysFor(id);
    removeKeys([keys.config, keys.chat, keys.profile]);

    // 2) 从索引里摘掉（allowDefault：这条路径就是要把默认好友也删掉）
    state.nav = removePersona(state.nav, id, { allowDefault: true }).nav;

    resetRecallIndex();
    resetChatRender();

    if (state.nav.active) return switchToSurvivor();

    // 3) 一个好友都没有了：把内存清成"全新用户"，界面显示"请添加好友"
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

  // -------------------------------------------------------------- 加好友途中反悔

  /**
   * 记下"正在新建好友"（friend-ui 建完人之后调）。
   * 用户在人设页点返回时要用它把这个人撤掉。
   */
  function notePendingNew(fromId, newId) {
    state.pendingNew = { from: fromId, id: newId };
  }

  /** 撤掉刚建的那个好友（人设页点返回时走这条） */
  function cancelPendingNew() {
    const p = state.pendingNew;
    state.pendingNew = null;
    if (!p) return;

    // 连它的存储一起清掉（三个 key）
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

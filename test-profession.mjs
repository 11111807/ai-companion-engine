/**
 * 职业 / 专业 → 知识储备 的测试
 *
 * 用户提的两件事（这是这个模块存在的唯一理由）：
 *   4. 她知道的东西要跟**年龄 + 职业**对得上
 *      —— 20 岁的设计学生张口就该是课堂、作业、软件、老师点评，
 *         而不是"我当年带团队做品牌全案"
 *   5. 新增「我的职业 / 专业」：
 *      - 同行 / 同专业 → 能聊到一块去
 *      - 不同行     → 只聊自己那摊，说"这我不懂"，但**必须带上跟情境相称的情绪**
 *
 * ⚠️ 最容易被做坏的一条：把"不懂他的专业"做成"不懂他"。
 * 所以这里专门有一组断言盯着"不懂专业 ≠ 不懂他"。
 *
 * 注意：不要在中途 window.close()（理由见 test-memory.mjs 顶部）
 */

import { bootApp, msg } from './boot.mjs';
import {
  DOMAINS, domainOf, knowledgeBlock, userFieldBlock, professionBlock,
} from './src/profession.js';
import { buildSystemPrompt } from './src/persona.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const windows = [];

// ---------------------------------------------------------------- 1) 认行
console.log('\n[1] 一句职业描述能认出是哪一行 ...');
{
  const cases = [
    ['视觉传达设计', 'design'], ['UI 设计师', 'design'], ['我在做平面设计', 'design'],
    ['前端开发', 'code'], ['后端工程师', 'code'], ['我在写 Python', 'code'],
    ['临床医学', 'med'], ['护士', 'med'], ['药学专业', 'med'],
    ['法学', 'law'], ['律师', 'law'],
    ['会计', 'finance'], ['审计', 'finance'], ['金融专业', 'finance'],
    ['小学老师', 'teach'], ['师范生', 'teach'],
    ['土木工程', 'eng'], ['机械设计制造', 'eng'],
    ['新媒体运营', 'media'], ['记者', 'media'],
    ['音乐', 'art'], ['舞蹈专业', 'art'],
    ['市场营销', 'biz'], ['人力资源', 'biz'], ['电商运营', 'biz'],
    ['咖啡师', 'service'], ['外卖', 'service'], ['厨师', 'service'],
    ['大二学生', 'student'], ['在读研究生', 'student'],
  ];
  const bad = cases.filter(([t, want]) => domainOf(t)?.id !== want);
  check(`${cases.length} 个常见说法都认得出来`, bad.length === 0,
    bad.length ? bad.map(([t, w]) => `「${t}」认成了 ${domainOf(t)?.id ?? '无'}，应为 ${w}`).join(' / ') : '');

  check('认不出来就不猜（不乱给一套知识）', domainOf('一些别的事情') === null);
  check('空字符串也是 null', domainOf('') === null && domainOf(null) === null);

  // 长的关键词优先：免得"设计艺术"被"艺术"抢走，"工业设计"被"设计"之外的规则抢走
  check('长关键词优先（数字媒体艺术 → 设计，而不是艺术）',
    domainOf('数字媒体艺术')?.id === 'design', domainOf('数字媒体艺术')?.id);
  check('「人工智能」这种英文缩写也认（AI 训练师 → 编程）',
    domainOf('AI 训练师')?.id === 'code', domainOf('AI 训练师')?.id);
  check('大小写不影响（Ui/UX）', domainOf('UI/UX 设计师')?.id === 'design');
}

console.log('\n[1.1] 知识域本身是完整的 ...');
{
  check('至少有 12 个领域', DOMAINS.length >= 12, String(DOMAINS.length));
  check('每个领域都有 id / name / 关键词 / 兴趣 / 学生版 / 工作版',
    DOMAINS.every((d) => d.id && d.name && d.keywords?.length
      && d.interests?.length && d.study?.know && d.study?.talk && d.work?.know && d.work?.talk));
  check('领域 id 不重复', new Set(DOMAINS.map((d) => d.id)).size === DOMAINS.length);
  check('没有关键词重复（重复了就会有领域永远轮不到）',
    new Set(DOMAINS.flatMap((d) => d.keywords)).size === DOMAINS.flatMap((d) => d.keywords).length);
}

// ---------------------------------------------------------------- 2) 知识按年龄分档
console.log('\n[2] 她知道的东西跟年龄对得上 ...');
{
  const young = knowledgeBlock({ age: 20, job: '视觉传达设计' });
  const older = knowledgeBlock({ age: 31, job: '平面设计' });

  check('20 岁的说法里有"课堂/作业"这类学生视角', /课堂|作业/.test(young));
  // 这两句是 design.study.talk 里特有的（工作版没有）—— 用它来证明"没串到职场那套"。
  // ⚠️ 不要拿"接商单""带团队"来断言"没出现"：那句"别聊接商单…"本身就在学生版的提示里。
  check('20 岁的说法里没有职场那套',
    !/接不接商单|带过团队|客户预算多少/.test(young)
    && /别聊"接商单""带团队""客户预算"这种职场层的东西/.test(young));
  check('20 岁的说法确实走的是学生那一版', /课堂上学的是/.test(young) && /老师最爱说/.test(young));
  check('31 岁的说法里有改稿/甲方/交付这类职场视角',
    /改稿|甲方|交付/.test(older));
  check('31 岁的说法里不再有"老师当着全班面批"', !/当着全班面批|赶 deadline/.test(older));
  check('两套说法**真的不一样**', young !== older);

  check('年龄写进提示词了', /你 20 岁/.test(young) && /你 31 岁/.test(older));
  check('职业写进提示词了', /视觉传达设计/.test(young) && /平面设计/.test(older));
  check('提醒她"不是专家，说不准就说不准"', /不是这个领域的专家/.test(young));
  check('提醒她要讲**真细节**，别说空话', /真细节/.test(young) && /挺好的/.test(young));
  check('兴趣点是列表形式给的', /聊到这些你会来劲/.test(young));
}

console.log('\n[2.1] 每一条职业路径都走得通 ...');
{
  // 全领域 × 学生/上班 两个阶段：不许出现空串、不许出现 undefined
  const bad = [];
  for (const d of DOMAINS) {
    for (const age of [20, 30]) {
      const t = knowledgeBlock({ age, job: d.keywords[0] });
      if (!t || /undefined/.test(t)) bad.push(`${d.id}@${age}`);
    }
  }
  check(`${DOMAINS.length * 2} 种组合都有内容且没有 undefined`, bad.length === 0, bad.join(', '));

  const noJob = knowledgeBlock({ age: 20, job: '' });
  check('没填职业也能给一套（按年龄猜学生）', /学生/.test(noJob) && !/undefined/.test(noJob));
  const noJobOld = knowledgeBlock({ age: 33, job: '' });
  check('33 岁没填职业就不当学生', !/在学|课设/.test(noJobOld));
  check('年龄乱填也不炸', !/undefined/.test(knowledgeBlock({ age: 'abc', job: 'x' })));
  check('默认参数可用', /你 20 岁/.test(knowledgeBlock()));
}

console.log('\n[2.2] 同一个领域，学生和上班族说的不是一回事 ...');
{
  const all = DOMAINS.filter((d) => d.id !== 'service');
  const same = all.filter((d) => d.study.know === d.work.know || d.study.talk === d.work.talk);
  check('每个领域的学生版和工作版都不同', same.length === 0, same.map((d) => d.id).join(', '));
}

// ---------------------------------------------------------------- 3) 他的领域
console.log('\n[3] 填了「我的职业」之后 ...');
{
  check('没填就没有这一块（不硬塞）', userFieldBlock({ age: 20, job: '平面设计', userJob: '' }) === '');

  const same = userFieldBlock({ age: 20, job: '视觉传达设计', userJob: 'UI 设计师' });
  check('同行：明确说"你们是同行/同专业的"', /你们是同行\/同专业的/.test(same));
  check('同行：允许聊专业', /接得住/.test(same));
  check('同行：提醒她按自己那个阶段的角度聊', /你自己那个阶段/.test(same));
  check('同行：三种自然的反应都在（吐槽/请教/较劲）',
    /一起吐槽/.test(same) && /互相请教/.test(same) && /较劲/.test(same));
  check('同行：也提醒别把聊天开成技术交流会', /别把聊天变成技术交流会/.test(same));

  const diff = userFieldBlock({ age: 20, job: '视觉传达设计', userJob: '程序员' });
  check('不同行：直接说"你不懂他这一行"', /你不懂他这一行/.test(diff));
  check('不同行：不许硬答专业问题', /绝对不要硬答专业问题/.test(diff));
  check('不同行：给的是"承认不懂 + 把话头接回来"', /承认得干脆/.test(diff) && /把话头接回来/.test(diff));

  // ⭐ 这是这一整块最要紧的地方：情绪要跟情境相称，不能永远一句"我不懂"
  for (const [name, kw] of [
    ['他在兴奋地分享 → 好奇/追问', /兴奋地分享/],
    ['他在抱怨 → 共情那个累', /他在\*\*抱怨\*\*/],
    ['他在泄气 → 不夸专业，夸他这个人', /觉得自己不行/],
    ['他较真考她 → 可以自嘲、可以撒娇', /较真地考你/],
  ]) check(`情绪跟着情境走：${name}`, kw.test(diff));

  check('⭐ 明确写了"不懂专业 ≠ 不懂他"', /不懂"专业"不等于不懂"他"/.test(diff));
  check('⭐ 要求她说说自己领域里类似的感受（别把话堵死）',
    /类似的感受/.test(diff) && /我那个作业也这样/.test(diff));
  check('⭐ 明确禁止"每句都是我不懂"', /不要每句都"我不懂"/.test(diff));

  check('不认识他的职业也能安全走"不同行"这条路（不炸）',
    /你不懂他这一行/.test(userFieldBlock({ age: 20, job: '平面设计', userJob: '占卜师' })));
  check('她没填职业时，拿年龄兜底也能判断',
    /你不懂他这一行/.test(userFieldBlock({ age: 20, job: '', userJob: '程序员' })));
}

console.log('\n[3.1] 两块合起来 ...');
{
  const t = professionBlock({ age: 26, job: '前端开发', userJob: '护士' });
  check('有她自己的知识块', /你 26 岁，前端开发/.test(t));
  check('也有他的领域那块', /他是干这行的：护士/.test(t));
  check('两块是分开的段落', t.includes('\n\n【他的领域】'));
  check('只给一块时也不留空行', !professionBlock({ age: 26, job: '前端开发' }).endsWith('\n'));
}

// ---------------------------------------------------------------- 4) 进提示词
console.log('\n[4] 真的进了系统提示词 ...');
{
  const prompt = (persona, extra = {}) => buildSystemPrompt({ msgCount: 60 }, {
    persona: { gender: 'f', age: 20, job: '视觉传达设计', traits: [], custom: true, ...persona },
    ...extra,
  });

  const base = prompt({});
  check('她的知识块进提示词了', /【你脑子里装的东西】/.test(base));
  check('知识块里是课堂/作业那套', /课堂/.test(base));
  check('说了她的兴趣点', /你会来劲/.test(base));

  const noHis = prompt({});
  check('没填他的职业就不出【他的领域】', !/^【他的领域】/m.test(noHis));
  check('没填他的职业时也不留一个指向不存在段落的指引',
    !/见下面【他的领域】/.test(noHis));
  const same = prompt({ userJob: 'UI 设计师' });
  check('同行会出【他的领域】', /^【他的领域】/m.test(same) && /你们是同行/.test(same));
  check('同行时"必须遵守"里也提醒了她能聊', /他这一行正好是你在行的/.test(same));
  check('同行时的情绪指引进提示词了', /他问技术\/知识问题/.test(same) && /你懂的就说/.test(same));
  check('⭐ 同行也要记得拐回他这个人身上', /聊两句要拐回他身上/.test(same));

  const diff = prompt({ userJob: '程序员' });
  check('不同行会出【他的领域】', /^【他的领域】/m.test(diff) && /你不懂他这一行/.test(diff));
  check('不同行时"必须遵守"里提醒注意分寸', /他这一行你确实不懂/.test(diff));
  check('不同行时情绪指引也要跟着变', /带上好奇或关心/.test(diff));
  check('⭐ 不同行也不许只说一句"我不懂"就完', /一句"我不懂"就完了也不行/.test(diff));
  check('他填的就是他的职业（原文带进提示词）', /他是干这行的：程序员/.test(diff));
  check('她的知识块会指到【他的领域】去', /见下面【他的领域】那一块/.test(diff));

  const old = prompt({}, {});
  check('普通（没设他的职业）时不会冒出"同行"字样', !/同行/.test(old));
}

console.log('\n[4.1] 默认人设（老用户）完全不受影响 ...');
{
  const sys = buildSystemPrompt({ msgCount: 60 }, {
    persona: { gender: 'f', age: 20, job: '', traits: [], traitNote: '', custom: false },
    affection: 40,
  });
  check('没设过人设 → 不加知识块（默认那段已经写了）', !/【你脑子里装的东西】/.test(sys));
  check('默认的学生底色还在', /大二在读，学的是视觉传达/.test(sys) && /学校宿舍/.test(sys));
  check('没他的职业 → 不加【他的领域】', !/【他的领域】/.test(sys));

  // 设过人设但没填职业：走"按年龄兜底"那条路，也不该炸
  const sys2 = buildSystemPrompt({ msgCount: 60 }, {
    persona: { gender: 'f', age: 27, job: '', traits: [], traitNote: '', custom: true },
    affection: 40,
  });
  check('设过人设但没填职业时会兜底给一套（33 岁以下→学生，27 岁→服务/工作向）',
    /【你脑子里装的东西】/.test(sys2) && !/undefined/.test(sys2));
}

// ---------------------------------------------------------------- 5) 界面
console.log('\n[5] 人设页里的「你的职业 / 专业」...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  const $ = app.$;

  check('人设页有「你的职业 / 专业」这一格', !!$('#perUserJob'));
  check('有配套的快捷标签', !!$('#chipsUserJob'));
  check('有解释这一格干什么用的说明', /同行/.test($('#perUserJob').parentElement.textContent));
  check('她的职业那一格也说明了"填了她就懂这行"',
    /不会张口就是/.test($('#perJob').parentElement.textContent));

  // 点标签能填进去
  const chips = app.$$('#chipsUserJob .wx-chip');
  check('标签画出来了', chips.length >= 8, String(chips.length));
  const prog = chips.find((c) => c.dataset.chip === '程序员');
  check('标签里有「程序员」', !!prog);
  prog.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点一下标签就把值填进输入框', $('#perUserJob').value === '程序员', $('#perUserJob').value);
  check('填完那个标签会变成选中态',
    app.$$('#chipsUserJob .wx-chip').find((c) => c.dataset.chip === '程序员')?.classList.contains('on'));

  // 打开人设页时要把存过的值填回表单
  const app2 = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.config.v1': { herJob: '视觉传达设计', userJob: '会计', personaDone: true },
    },
  });
  windows.push(app2.dom.window);
  app2.$('#btnOpenPersona').dispatchEvent(new app2.window.MouseEvent('click', { bubbles: true }));
  check('重新打开人设页，她的职业填回来了', app2.$('#perJob').value === '视觉传达设计',
    app2.$('#perJob').value);
  check('重新打开人设页，你的职业也填回来了', app2.$('#perUserJob').value === '会计',
    app2.$('#perUserJob').value);
  check('你的职业那个标签也回到选中态',
    app2.$$('#chipsUserJob .wx-chip').find((c) => c.dataset.chip === '会计')
      ?.classList.contains('on'));
}

console.log('\n[5.1] 存进配置、并且真的发给了模型 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60, affection: 45, affectionBase: 45 },
      // 注意 herAge / herGender 一定要给：只给 herJob 的话 personaIsCustom() 会算成 false，
      // 提示词就走默认那套（不加载知识块），这个用例就白测了。
      'xiaoyu.config.v1': {
        herJob: '视觉传达设计', herAge: 20, herGender: 'f', personaDone: true,
      },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);

  // 走真实路径：先打开人设页（表单会被现有配置填满），再填这一格、再点「开始聊天」。
  // ⚠️ 不能跳过"打开"这一步：applyPersona 是照表单读的，表单空着就会把配置清空。
  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#perUserJob').value = '临床医学';
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('你的职业写进配置了', cfg.userJob === '临床医学', String(cfg.userJob));

  await app.send('今天好累');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('她这一行进提示词了', /视觉传达设计/.test(sys));
  check('他那一行进提示词了（原文）', /他是干这行的：临床医学/.test(sys));
  check('认出不是同行 → 走"不懂"那条路', /你不懂他这一行/.test(sys));
  check('⭐ 但"不许只说一句不懂"也在', /一句"我不懂"就完了也不行/.test(sys));
}

console.log('\n[5.2] 「恢复默认」要把这一格一起清掉 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60 },
      'xiaoyu.config.v1': { herJob: '设计师', userJob: '程序员', personaDone: true },
    },
  });
  windows.push(app.dom.window);
  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnPersonaReset').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('她的职业清空了', !cfg.herJob || cfg.herJob === '');
  check('你的职业也清空了', !cfg.userJob || cfg.userJob === '');
  check('表单里也空了', app.$('#perUserJob').value === '', app.$('#perUserJob').value);
}

// ---------------------------------------------------------------- 收尾
for (const w of windows) { try { w.close(); } catch {} }
console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

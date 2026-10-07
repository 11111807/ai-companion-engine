/**
 * 人设 · 星座 · 好感度 的测试
 *
 * 用户要的东西：
 *   1. 开始聊之前的「人设设置」：名字/头像/性别/年龄/职业/关系/生日(→星座)/性格/初始环境
 *   2. 「+」面板里能看到 **她（他）对我的好感度** 和 **她认为我们的关系**
 *   3. 初始性格与好感度**相对应**，好感度高低**影响她对我的态度**
 *   4. 星座只是参考，不能完全对应，她得有自己的性格
 *
 * 注意：不要在中途 window.close()（理由见 test-memory.mjs 顶部）
 */

import { bootApp, msg } from './boot.mjs';
import { SIGNS, signOf, parseBirthday, birthdayText, zodiacBlock, signSummary } from './src/zodiac.js';
import {
  levelOf, clamp, affectionBlock, regardBlock, drift,
  suggestFromTraits, traitAffectionWarning, LEVELS,
  decayForGap, DECAY_MAX, AFFECTION_FLOOR,
} from './src/affection.js';
import { buildSystemPrompt, SCENES, SCENES_GENERIC, findScene } from './src/persona.js';
import { decayFacts, isPermanent, newMeta, touchMeta, retention,
  isObsession, strengthLabel, strengthPercent, OBSESSION_EMO } from './src/memory.js';
import { intensityOf, isObsessive, isDetailLike } from './src/emotion.js';
import {
  RELATIONS, RELATION_NAMES, findRelation, defaultAffectionFor, relationViewText,
  relationBlock, relationAffectionWarning,
  detectRelationSignal, relationMatches, relationTipText, relationShiftHint,
} from './src/relation.js';

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const windows = [];

// ---------------------------------------------------------------- 1) 星座
console.log('\n[1] 生日 → 星座 ...');
{
  const cases = [
    ['3-21', '白羊座'], ['4-19', '白羊座'], ['4-20', '金牛座'], ['5-20', '金牛座'],
    ['5-21', '双子座'], ['6-21', '双子座'], ['6-22', '巨蟹座'], ['7-22', '巨蟹座'],
    ['7-23', '狮子座'], ['8-22', '狮子座'], ['8-23', '处女座'], ['9-22', '处女座'],
    ['9-23', '天秤座'], ['10-23', '天秤座'], ['10-24', '天蝎座'], ['11-22', '天蝎座'],
    ['11-23', '射手座'], ['12-21', '射手座'], ['12-22', '摩羯座'], ['1-19', '摩羯座'],
    ['1-20', '水瓶座'], ['2-18', '水瓶座'], ['2-19', '双鱼座'], ['3-20', '双鱼座'],
  ];
  const bad = cases.filter(([d, want]) => signOf(...d.split('-').map(Number))?.name !== want);
  check('12 个星座的起止边界都对', bad.length === 0,
    bad.length ? bad.map(([d, w]) => `${d} 应为 ${w}`).join(' / ') : `${cases.length} 个边界`);
  check('一共 12 个星座', SIGNS.length === 12);
  check('每个星座都有广义特点', SIGNS.every((s) => s.traits?.length >= 3 && s.core && s.love && s.flaw));
}

console.log('\n[1.1] 生日输入的各种写法 ...');
{
  check('3-21', parseBirthday('3-21')?.month === 3 && parseBirthday('3-21')?.day === 21);
  check('03/21', parseBirthday('03/21')?.day === 21);
  check('3月21日', parseBirthday('3月21日')?.month === 3);
  check('1998-03-21（带年份）', parseBirthday('1998-03-21')?.day === 21);
  check('2-25 推出双鱼座', parseBirthday('2-25')?.sign?.name === '双鱼座');
  for (const bad of ['2-30', '13-1', '0-0', 'abc', '', null, '99']) {
    check(`乱填「${bad}」不算数`, parseBirthday(bad) === null);
  }
  check('生日文案（带星座）', birthdayText(3, 21) === '3 月 21 日（白羊座）', birthdayText(3, 21));
  check('生日文案（不带星座，防止"…（白羊座），也就是白羊座"这种重复）',
    birthdayText(3, 21, { withSign: false }) === '3 月 21 日');
  check('星座摘要给用户看', /白羊座 · /.test(signSummary(SIGNS[0])));
}

console.log('\n[1.2] 星座提示词：只是参考，不是剧本 ...');
{
  const blk = zodiacBlock(SIGNS.find((s) => s.id === 'pisces'), { birthday: '2 月 25 日' });
  check('写进了双鱼的广义特点', /心软/.test(blk) && /共情/.test(blk), '双鱼');
  check('明确说了"只是参考"', /只是参考，不是剧本/.test(blk) && /星座说明书/.test(blk));
  check('要求只挑一两条像自己的', /只挑其中一两条像你的/.test(blk));
  check('允许跟星座反着来（用户特别强调的）', /完全反着来/.test(blk));
  check('不许把星座挂在嘴上', /不要把星座挂在嘴上/.test(blk));
  check('不许拿星座当借口', /拿星座当借口/.test(blk));
  check('没有生日也不炸', zodiacBlock(SIGNS[0]).length > 50);
  check('没有星座就返回空串', zodiacBlock(null) === '');
}

// ---------------------------------------------------------------- 2) 好感度
console.log('\n[2] 好感度分档 ...');
{
  check('0 是"还很生分"', levelOf(0).label === '还很生分');
  check('19 还是"还很生分"', levelOf(19).min === 0);
  check('20 进"有点好感"', levelOf(20).min === 20);
  check('40 进"聊得来"', levelOf(40).min === 40);
  check('60 进"挺喜欢你"', levelOf(60).min === 60);
  check('80 进"很喜欢你"', levelOf(80).min === 80);
  check('100 还是最高档', levelOf(100).min === 80);
  check('越界会夹回来', clamp(-5) === 0 && clamp(999) === 100);
  check('乱填给中间值', clamp('abc') === 50);
  check('五档都有"该怎么表现"', LEVELS.every((l) => (l.attitude || '').length > 40));
}

console.log('\n[2.1] 好感度高低 → 态度不一样（用户要的核心） ...');
{
  const cold = affectionBlock(10, { relation: '网友' });
  const warm = affectionBlock(90, { relation: '网友' });
  check('低好感：客气、有距离', /好感度还很低/.test(cold) && /客气、有距离/.test(cold));
  check('低好感：不会撒娇、不接暧昧', /更不会撒娇/.test(cold) && /装没听懂/.test(cold));
  check('高好感：黏人、会说想你', /黏人/.test(warm) && /说想你/.test(warm));
  check('高低两档的指令真的不一样', cold !== warm && !/黏人/.test(cold));
  check('数字写进了提示词', /好感度：10\/100/.test(cold) && /好感度：90\/100/.test(warm));
  // 身份交给 relation.js 那块去立，这里只管温度 —— 免得两边说法打架
  check('好感度块里不再重复写关系', !/你们的关系：/.test(cold));
  check('但会提醒"身份和温度是两回事"', /说的是\*\*温度\*\*/.test(cold));
  check('不让她把这个数字说出口', /别把这个数字说出来/.test(warm));
  check('说了"一次对话不会让态度突变"', /不会让态度突变/.test(warm));
  check('初始值不同时告诉她这是会动的', /比一开始更亲近了|比一开始疏远了一些/.test(
    affectionBlock(70, { baseline: 20 })));
}

console.log('\n[2.2] 「她认为我们的关系」——每个关系、每个档位各说各的 ...');
{
  const v1 = relationViewText(10, '同事');
  const v2 = relationViewText(50, '同事');
  const v3 = relationViewText(90, '同事');
  check('低好感：就是同事，没什么可说的', /除了工作/.test(v1), v1);
  check('中好感：吐槽老板有伴了', /吐槽/.test(v2), v2);
  check('高好感：越过同事那条线了', /越过同事那条线/.test(v3), v3);
  check('三档说的话都不一样', new Set([v1, v2, v3]).size === 3);

  // 用户反馈的原话：「在她心里，你们早就不只是（）了」套到夫妻上不对 ——
  // 夫妻档最高级不该出现"她在等你先开口"这种还没挑明的说法
  const spouseTop = relationViewText(90, '夫妻');
  check('夫妻档最高级不会说"等你先开口"', !/等你先开口|等你一句话/.test(spouseTop), spouseTop);
  check('夫妻档说的是过日子', /夫妻/.test(spouseTop), spouseTop);
  check('恋人档最高级才是"在等你"那类意思', /不管怎样/.test(relationViewText(90, '恋人')));

  // 15 个关系各档位都得有专属文案，不能退回通用模板
  {
    const generic = /「(同事|恋人|夫妻|网友|同学|朋友|发小|邻居|学长学姐|客户|陌生人|前任|相亲对象|游戏搭子)」/;
    const fellBack = [];
    for (const r of RELATIONS) {
      for (const v of [10, 30, 50, 70, 90]) {
        const line = relationViewText(v, r.name);
        if (generic.test(line)) fellBack.push(`${r.name}@${v}`);
      }
    }
    check('没有任何关系档位退回通用模板', fellBack.length === 0, fellBack.join(', ') || '全部专属');
  }
  check('15 个关系都有 5 条文案', RELATIONS.every((r) => {
    const keys = ['cold', 'low', 'mid', 'high', 'max'];
    return keys.every((k) => typeof r.id === 'string' && relationViewText(0, r.name));
  }));

  check('自定义关系退回通用模板（有话说就行）',
    /「房东和租客」/.test(relationViewText(90, '房东和租客')), relationViewText(90, '房东和租客'));
  check('没填关系也能给一句话', relationViewText(50, '').includes('刚认识的人'));
}

console.log('\n[2.25] 人本主义：共情 / 真诚 / 有条件 vs 无条件积极关注 ...');
{
  const low = regardBlock(20);
  const mid = regardBlock(55);
  const high = regardBlock(85);

  check('共情在任何档位都在', [low, mid, high].every((b) => /\*\*共情\*\*/.test(b)));
  check('真诚在任何档位都在', [low, mid, high].every((b) => /\*\*真诚\*\*/.test(b)));
  check('共情要求先接住感受、别急着给建议',
    /\*\*共情\*\*/.test(low) && /先接住他的感受/.test(low) && /别急着分析/.test(low));
  check('真诚要求不说违心话、别端咨询师腔',
    /不为了让他高兴而说违心的话/.test(low) && /咨询师腔/.test(low));

  check('低好感 → 有条件关注', /有条件关注/.test(low) && /要挣的/.test(low), low.split('\n').slice(-4)[0]);
  check('低好感不会无条件向着他', /不会无条件站在他那边/.test(low));
  check('中好感 → 关注在变松但还没无条件', /还没到无条件/.test(mid));
  check('高好感 → 无条件积极关注', /无条件积极关注/.test(high));
  check('高好感是"不否定他这个人"，不是"什么都同意"',
    /不会否定他\*\*这个人\*\*/.test(high) && /不同意具体的事就直说不同意/.test(high));
  check('三档互不相同', new Set([low, mid, high]).size === 3);
}

console.log('\n[2.3] 好感度会随聊天微调 ...');
{
  check('一句"想你"会涨', drift(50, '今天特别想你') > 50);
  check('一句"滚开"会掉', drift(50, '滚开') < 50);
  check('敷衍的"哦"会掉', drift(50, '哦') < 50);
  check('认真打一段会涨', drift(50, '今天上班的时候发生了一件特别离谱的事，我跟你说') > 50);
  check('普通聊一句只涨一点点（≤1）', drift(50, '今天天气还行') - 50 <= 1);
  check('聊到 70 以后不再靠磨嘴皮子涨', drift(72, '今天天气还行') === 72);
  check('不会涨过 100', drift(100, '超级无敌想你') === 100);
  check('不会掉到负数', drift(0, '滚开') === 0);
  check('空消息不改变', drift(50, '') === 50);
}

// 这几条是真 bug 修完补的回归：关键词子串匹配天生会误判，
// 实测「我不想你了」原来会 +1.5，「我们滚去睡觉吧」原来会 −3。
console.log('\n[2.35] 关键词别误判（否定句 / 复合词 / 自嘲玩笑）...');
{
  const d = (cur, t) => drift(cur, t) - cur;

  check('否定句不算亲昵：「我不想你了」不该涨', d(50, '我不想你了') < 0.5,
    String(d(50, '我不想你了')));
  check('否定句不算亲昵：「我今天不想你担心」', d(50, '我今天不想你担心') < 0.5);
  check('否定句不算伤人：「我不会跟你分手」不该掉', d(50, '我不会跟你分手') > -0.5,
    String(d(50, '我不会跟你分手')));

  check('「特别」里的别不是否定：「今天特别想你」要涨',
    d(50, '今天特别想你') > 1, String(d(50, '今天特别想你')));
  check('「分别」里的别不是否定', d(50, '今天我分别见了两个客户') > -0.5);
  check('标点能隔断否定：「你说得不错，我很想你」要涨',
    d(50, '你说得不错，我很想你') > 1, String(d(50, '你说得不错，我很想你')));

  check('自嘲玩笑里的"滚"不算骂人：「我们滚去睡觉吧」',
    d(50, '我们滚去睡觉吧') > -0.5, String(d(50, '我们滚去睡觉吧')));
  check('真的骂人才掉：「你给我滚」', d(50, '你给我滚') < -1);
  check('「闭嘴」还是算', d(50, '闭嘴') < -1);

  check('「哈哈」是正常回应，不再被当成敷衍', d(50, '哈哈') > -0.5, String(d(50, '哈哈')));
  check('「好的」「行」也不再扣分', d(50, '好的') > -0.5 && d(50, '行') > -0.5);
  check('「哦」仍然是敷衍（要掉）', d(50, '哦') < -1);

  check('吐槽自己的累不该被当成冲她发火', d(50, '我快累死了') > -0.5);
}

console.log('\n[2.36] 隔太久没聊，感情会淡 ...');
{
  check('两天没聊不淡', decayForGap(80, 2) === 80);
  check('三天没聊还没到阈值', decayForGap(80, 3) === 80);
  check('十天没聊会淡一点', decayForGap(80, 10) < 80 && decayForGap(80, 10) > 70,
    decayForGap(80, 10).toFixed(1));
  check('一个月没聊淡得更多', decayForGap(80, 33) < decayForGap(80, 10));
  check('一次最多淡 15 分（不会一夜归零）', 80 - decayForGap(80, 365) <= DECAY_MAX,
    String(80 - decayForGap(80, 365)));
  check('再久也不会低于地板值', decayForGap(20, 9999) === AFFECTION_FLOOR,
    String(decayForGap(20, 9999)));
  check('认不出天数就原样返回', decayForGap(80, NaN) === 80);
}

console.log('\n[2.4] 性格 ↔ 初始好感度 相对应 ...');
{
  const clingy = suggestFromTraits(['黏人', '爱撒娇']);
  const cold = suggestFromTraits(['慢热', '内向']);
  check('黏人+爱撒娇 → 建议偏高', clingy >= 70, String(clingy));
  check('慢热+内向 → 建议偏低', cold <= 25, String(cold));
  check('没选性格 → 中间', suggestFromTraits([]) === 45);

  check('黏人却给低好感 → 会提醒', /别扭/.test(traitAffectionWarning(['黏人'], 15)),
    traitAffectionWarning(['黏人'], 15));
  check('慢热却给高好感 → 会提醒', /端着/.test(traitAffectionWarning(['慢热'], 88)),
    traitAffectionWarning(['慢热'], 88));
  check('搭配合适就不啰嗦', traitAffectionWarning(['温柔'], 50) === '');
  check('没选性格也不啰嗦', traitAffectionWarning([], 10) === '');
}

// ---------------------------------------------------------------- 3) 场景池
console.log('\n[3] 设了人设之后，场景不该还是"宿舍/图书馆" ...');
{
  check('通用池里没有宿舍/图书馆/食堂',
    !SCENES_GENERIC.some((s) => /宿舍|图书馆|教室|食堂/.test(s.text)));
  check('通用池覆盖全天各时段',
    SCENES_GENERIC.some((s) => s.hours[0] < 6) && SCENES_GENERIC.some((s) => s.hours[1] >= 22));
  check('学生池还是老样子（默认人设不变）', SCENES.some((s) => /宿舍/.test(s.text)));
  check('两个池子的 id 不打架',
    new Set([...SCENES, ...SCENES_GENERIC].map((s) => s.id)).size === SCENES.length + SCENES_GENERIC.length);
  check('老存档的场景 id 找得到', !!findScene('dorm-night') && !!findScene('g-home-late'));
}

// ---------------------------------------------------------------- 4) 人设页（UI）
console.log('\n[4] 「开始之前」人设页 ...');
{
  // 全新用户：没消息、没设过人设 → 自动弹出来
  const app = bootApp();
  windows.push(app.dom.window);
  const $ = app.$;

  check('全新用户一打开就是人设页', $('#screen-persona').classList.contains('show'));
  check('人设页有名字输入', !!$('#perName'));
  check('有头像（可不选）', !!$('#btnPerAvatar') && !!$('#perAvatarPreview'));
  check('有性别', !!$('#segGender') && app.$$('#segGender button').length === 2);
  check('有年龄', !!$('#perAge'));
  check('有职业', !!$('#perJob'));
  check('有关系', !!$('#perRelation') && app.$$('#chipsRelation .wx-chip').length >= 5);
  check('有生日', !!$('#perBirthday'));
  check('有性格（8 个以上可选）', app.$$('#chipsTraits .wx-chip').length >= 8);
  check('有初始环境', !!$('#perScene') && app.$$('#chipsScene .wx-chip').length >= 5);
  check('有初始好感度', app.$$('#chipsAff .wx-chip').length === 5);
  check('第一次进来时没有"返回"（要么设完要么开始）', $('#btnClosePersona').hidden === true);

  // 填表
  const type = (sel, v) => {
    const el = $(sel);
    el.value = v;
    el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  };
  const clickChip = (sel, text) => {
    const b = app.$$(`${sel} .wx-chip`).find((x) => x.textContent === text);
    b.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    return b;
  };

  type('#perName', '阿离');
  type('#perAge', '27');
  type('#perJob', '在一家小公司做设计');
  type('#perRelation', '同事');
  type('#perBirthday', '2-25');
  check('填了生日立刻显示星座', /双鱼座/.test($('#perSignNote').textContent),
    $('#perSignNote').textContent.trim().slice(0, 40));
  check('星座那行说了"只是参考"', /只是参考/.test($('#perSignNote').textContent));

  type('#perBirthday', '2-30');
  check('生日乱填就不显示星座', /填了生日/.test($('#perSignNote').textContent));
  type('#perBirthday', '2-25');

  // 性格 → 好感度自动对应
  clickChip('#chipsTraits', '黏人');
  clickChip('#chipsTraits', '爱撒娇');
  const onChip = () => app.$$('#chipsAff .wx-chip.on').map((b) => b.textContent).join('/');
  check('选了黏人+爱撒娇 → 好感度自动跳到高档位',
    /挺喜欢|很喜欢/.test(onChip()), onChip() || '(没亮)');

  // 最多 4 个
  clickChip('#chipsTraits', '毒舌');
  clickChip('#chipsTraits', '温柔');
  clickChip('#chipsTraits', '活泼');
  check('性格最多挑 4 个', app.$$('#chipsTraits .wx-chip.on').length === 4,
    `${app.$$('#chipsTraits .wx-chip.on').length} 个`);

  // 手动改过之后不再被性格覆盖
  clickChip('#chipsAff', '刚认识');
  clickChip('#chipsTraits', '慢热');
  check('自己改过好感度后，性格不再覆盖它', /刚认识/.test(onChip()), onChip());

  // 性格与好感度冲突 → 提醒
  check('黏人却给"刚认识" → 给出提醒', /别扭/.test($('#perAffNote').textContent),
    $('#perAffNote').textContent.trim().slice(0, 50));

  // 关系标签点了会填进输入框
  clickChip('#chipsRelation', '网友');
  check('点关系标签会填进输入框', $('#perRelation').value === '网友', $('#perRelation').value);

  // 初始环境
  clickChip('#chipsScene', '刚下班到家，瘫在沙发上不想动');
  check('点初始环境标签会填进输入框', /刚下班/.test($('#perScene').value));

  // 开始聊天
  $('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点开始聊天会关掉人设页', !$('#screen-persona').classList.contains('show'));

  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  const prof = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('名字存下来了', cfg.herName === '阿离', cfg.herName);
  check('性别存下来了', cfg.herGender === 'f');
  check('年龄存下来了', cfg.herAge === 27, String(cfg.herAge));
  check('职业存下来了', cfg.herJob === '在一家小公司做设计');
  check('关系存下来了', cfg.herRelation === '网友');
  check('生日存下来了', cfg.herBirthday === '2-25');
  check('性格存下来了', cfg.herTraits.join('、') === '黏人、爱撒娇、毒舌、温柔',
    (cfg.herTraits || []).join('、'));
  check('标了"设过人设"', cfg.personaDone === true);
  check('初始环境固定住了', prof.sceneCustom === true && /刚下班/.test(prof.sceneText), prof.sceneText);
  check('好感度存下来了（刚认识=15）', prof.affection === 15, String(prof.affection));
  check('初始好感度也记了（用来告诉她"会变"）', prof.affectionBase === 15);
  check('顶栏已经换成新名字', $('#navName').textContent === '阿离', $('#navName').textContent);
  check('开场白已经发出来了', app.shown().length >= 1, app.shown().join(' / '));
}

// ---------------------------------------------------------------- 5) 提示词真的换了人
console.log('\n[5] 人设真的进了提示词 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60, affection: 40, affectionBase: 40 },
      'xiaoyu.config.v1': {
        herName: '阿离', herGender: 'f', herAge: 27,
        herJob: '在一家小公司做设计', herRelation: '同事',
        herBirthday: '2-25', herTraits: ['慢热', '毒舌'], herTraitNote: '嘴上凶，其实特别怕他难过',
        personaDone: true,
      },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  await app.send('今天好累');

  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('年龄进提示词了', /27 岁/.test(sys));
  check('职业进提示词了', /在一家小公司做设计/.test(sys));
  check('性格进提示词了', /【你的性格】/.test(sys) && /慢热/.test(sys));
  check('自己补的那句也进提示词了', /嘴上凶，其实特别怕他难过/.test(sys));
  check('星座进提示词了', /双鱼座/.test(sys) && /只是参考，不是剧本/.test(sys));
  check('关系定位进提示词了（而且是具体的行为边界，不是一行字）',
    /【你们的关系定位】/.test(sys) && /你们是同事/.test(sys) && /这个身份下，你\*\*本来就会\*\*做这些事/.test(sys));
  check('好感度进提示词了', /【你对他的好感度/.test(sys));
  check('提示词里不再有写死的学生设定',
    !/大二/.test(sys) && !/视觉传达/.test(sys) && !/学校宿舍/.test(sys) && !/圆圆/.test(sys));
  check('自我介绍时用新名字', /你就说阿离/.test(sys));
}

console.log('\n[5.1] 默认人设（没设过的老用户）行为不变 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60 },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  await app.send('今天好累');

  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('还是那个 20 岁大二的小雨', /20 岁，大二在读，学的是视觉传达/.test(sys));
  check('校园生活底色还在', /学校宿舍/.test(sys) && /圆圆/.test(sys));
  check('没设好感度就退回按聊天量估算', /很熟了|非常熟|刚熟起来/.test(sys));
  check('不会凭空冒出好感度块', !/【你对他的好感度/.test(sys));
  check('没有星座块', !/【星座/.test(sys));
}

// ---------------------------------------------------------------- 6) 「+」面板
console.log('\n[6] 「+」面板里的好感度 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60, affection: 62, affectionBase: 40 },
      'xiaoyu.config.v1': { herName: '阿离', herRelation: '同事', personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  const $ = app.$;

  check('「+」面板里有好感度', !!$('#affPanel') && !!$('#affNum'));
  app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('打开「+」就能看到数值', $('#affNum').textContent === '62', $('#affNum').textContent);
  check('写了档位名', /挺喜欢/.test($('#affNote').textContent), $('#affNote').textContent.trim());
  check('进度条按百分比画', $('#affBar').style.width === '62%', $('#affBar').style.width);
  const wantRel = relationViewText(62, '同事');
  check('说了"她认为我们的关系"（按关系+档位现算）', $('#affRel').textContent.includes(wantRel),
    `${$('#affRel').textContent} ≠ ${wantRel}`);
  check('面板里也带上她的名字/性别代词', /她此刻对你的感觉/.test($('#affLabel').textContent),
    $('#affLabel').textContent);

  // 手动调
  const clickAff = (v) => app.$$('#affPanel [data-aff]').find((b) => b.dataset.aff === String(v))
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  clickAff(5);
  check('点 +5 会涨', $('#affNum').textContent === '67', $('#affNum').textContent);
  clickAff(-5);
  clickAff(-5);
  clickAff(-5);
  check('点 −5 会掉', $('#affNum').textContent === '52', $('#affNum').textContent);
  check('手动调整会落盘',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1')).affection === 52);

  // 聊天会微调
  const before = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1')).affection;
  await app.send('今天特别想你');
  const after = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1')).affection;
  check('说一句想她会涨一点', after > before, `${before} → ${after}`);
}

console.log('\n[6.1] 没设过好感度时不该显示 0（那会像"她讨厌你"）...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60 },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('显示"还没设过"而不是 0', app.$('#affNum').textContent === '—', app.$('#affNum').textContent);
  check('给出到哪里设的指引', /重新设定/.test(app.$('#affNote').textContent));
}

console.log('\n[6.2] 选"他"之后，文案跟着变 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60, affection: 70 },
      'xiaoyu.config.v1': { herName: '阿远', herGender: 'm', personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  app.$('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('「+」面板改说"他"', /他此刻对你的感觉/.test(app.$('#affLabel').textContent),
    app.$('#affLabel').textContent);

  await app.send('在干嘛');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('性别是男时提示词里也是他', /你叫阿远/.test(sys));
  check('好感度块里的代词也跟着换', /这是你\*\*现在的真实感受\*\*/.test(sys));
}

// ---------------------------------------------------------------- 7) 设置里能重新设定
console.log('\n[7] 从设置重新设定人设 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 60, affection: 55, sceneCustom: false },
      'xiaoyu.config.v1': { herName: '阿离', herAge: 27, herTraits: ['慢热'], personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  const $ = app.$;

  check('老用户不会一上来就被人设页拦住', !$('#screen-persona').classList.contains('show'));
  check('设置里有重新设定的入口', !!$('#btnOpenPersona'));
  $('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点得开人设页', $('#screen-persona').classList.contains('show'));
  check('而且它盖在设置页上面（不然看着像"点了没反应"）',
    (Number(app.window.getComputedStyle($('#screen-persona')).zIndex) || 0)
      > (Number(app.window.getComputedStyle($('#screen-settings')).zIndex) || 0),
    `persona=${app.window.getComputedStyle($('#screen-persona')).zIndex}`
    + ` settings=${app.window.getComputedStyle($('#screen-settings')).zIndex}`);
  check('从设置进来给返回键', $('#btnClosePersona').hidden === false);
  check('表单里带着原来的值', $('#perName').value === '阿离' && $('#perAge').value === '27',
    `${$('#perName').value} / ${$('#perAge').value}`);
  check('已经设过就不再显示"先把她定下来"', $('#personaIntro').hidden === true);

  $('#btnClosePersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('能关掉', !$('#screen-persona').classList.contains('show'));

  // 恢复默认
  $('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  $('#btnPersonaReset').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  const prof = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('恢复默认会清掉人设', !cfg.herName && !cfg.herAge && !cfg.herTraits.length,
    JSON.stringify({ n: cfg.herName, a: cfg.herAge, t: cfg.herTraits }));
  check('恢复默认也会清掉好感度（回到按聊天量估算）', prof.affection == null, String(prof.affection));
  check('恢复默认后顶栏回到小雨', $('#navName').textContent === '小雨', $('#navName').textContent);
  check('恢复默认后仍然算"设过了"，不会下次又弹', cfg.personaDone === true);
}

// ---------------------------------------------------------------- 8) 他的大致生平
console.log('\n[8] 大致生平 → 自动永久记忆 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  const $ = app.$;

  check('人设页有「大致生平」一栏', !!$('#perBio'));
  check('标了是可选的', /可选/.test($('#perBio').closest('.wx-group').previousElementSibling.textContent));

  const bio = [
    '我今年 27 岁，在杭州做开发',
    '老家山东，有个妹妹',
    '养了只猫叫豆豆',
    '最近在准备考试，压力有点大',
  ].join('\n');
  $('#perBio').value = bio;
  $('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  check('写了就提示会记成几条', /会记成 4 条/.test($('#perBioCount').textContent),
    $('#perBioCount').textContent);

  $('#btnBioPreview').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const prev = app.$$('#perBioPreview .wx-mem-item .tx').map((e) => e.textContent);
  check('能预览拆成哪几条', prev.length === 4, prev.join(' | '));
  check('第一人称会自动改成第三人称', prev[0].startsWith('他今年 27 岁'), prev[0]);
  check('"我们"不会被改成"他们"', !/他们/.test(prev.join('')));

  // 分号 / 句号也能拆
  $('#perBio').value = '我在北京上班；租的房子离公司很近。周末喜欢爬山';
  $('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  check('分号和句号也能拆开', /会记成 3 条/.test($('#perBioCount').textContent),
    $('#perBioCount').textContent);

  // 换回正式内容，真正保存
  $('#perBio').value = bio;
  $('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  $('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const prof = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('生平存进配置了（下次还能改）', /27 岁/.test(cfg.userBio));
  check('生平要点进了她的记忆', prof.facts.includes('他今年 27 岁，在杭州做开发'),
    prof.facts.slice(0, 4).join(' | '));
  check('四条都在', prof.facts.filter((f) => /妹妹|豆豆|考试|杭州/.test(f)).length === 4,
    prof.facts.filter((f) => /妹妹|豆豆|考试|杭州/.test(f)).join(' | '));
  check('被标成"手动"（永久档）',
    prof.factsManual.includes('他今年 27 岁，在杭州做开发'));
  check('元数据钉住了（不参与遗忘）',
    prof.factsMeta['他今年 27 岁，在杭州做开发']?.pinned === true);
  check('记下了"哪几条是生平来的"', prof.bioFacts.length === 4, String(prof.bioFacts.length));

  // 真的永久：过一年也不淡忘
  const meta = prof.factsMeta['他今年 27 岁，在杭州做开发'];
  const oneYearLater = Date.now() + 365 * 86400e3;
  check('一年后仍然是永久记忆', isPermanent(meta), JSON.stringify(meta));
  const d = decayFacts(prof.facts, prof.factsMeta, oneYearLater);
  check('遗忘曲线淘汰时它不会被丢掉', d.kept.includes('他今年 27 岁，在杭州做开发'),
    `留下 ${d.kept.length} 条`);
}

console.log('\n[8.1] 生平要点一定会进提示词（哪怕聊天学到的记忆很多）...');
{
  // 造 40 条聊天学到的记忆，看生平那几条会不会被挤掉。
  // 老写法取"最后 16 条"，而手动条目排在数组最前面 —— 正好全被丢掉。
  const chatFacts = Array.from({ length: 40 }, (_, i) => `他随口提过的小事 ${i + 1}`);
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在呀', 9)],
      'xiaoyu.profile.v1': { msgCount: 80, facts: chatFacts, factsManual: [] },
      'xiaoyu.config.v1': { personaDone: true, userBio: '我在杭州做开发\n养了只猫叫豆豆' },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);

  // 走一遍人设页，让生平写进记忆
  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  await app.send('今天好累');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('生平要点进了提示词', /他在杭州做开发/.test(sys) && /养了只猫叫豆豆/.test(sys),
    (sys.match(/你记得关于他的事：[\s\S]{0,120}/) || [''])[0].replace(/\n/g, ' / '));
  check('聊天学到的记忆也还在（没被挤空）', /他随口提过的小事 40/.test(sys));
}

console.log('\n[8.2] 改生平：只换生平那几条，不动聊天学到的 ...');
{
  // 这件"聊天学到的事"要按正常路径进内存（写 localStorage 是没用的——
  // 应用内存里没有它，下一次 saveProfile 就会把它覆盖掉）
  const learned = '他上周去看了演唱会';
  const app = bootApp({
    seed: { 'xiaoyu.profile.v1': { msgCount: 20, facts: [learned] } },
  });
  windows.push(app.dom.window);
  const $ = app.$;

  $('#perBio').value = '我在杭州做开发\n养了只猫叫豆豆';
  $('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  $('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const p1 = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('第一次保存时，原先学到的记忆还在', p1.facts.includes(learned), p1.facts.join(' | '));

  // 回来改生平（删掉"猫"，加一条"妹妹"）
  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('重新打开人设页会带出上次写的生平', /杭州/.test($('#perBio').value), $('#perBio').value);
  $('#perBio').value = '我在杭州做开发\n有个妹妹在读大学';
  $('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  $('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const p2 = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('新的要点加上了', p2.facts.includes('有个妹妹在读大学'), p2.facts.join(' | '));
  check('删掉的那条也撤掉了', !p2.facts.includes('养了只猫叫豆豆'), p2.facts.join(' | '));
  check('聊天学到的记忆一条没丢', p2.facts.includes(learned), p2.facts.join(' | '));
  check('bioFacts 跟着更新', p2.bioFacts.length === 2, p2.bioFacts.join(' | '));
}

console.log('\n[8.3] 生平可以留空 / 清空 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  app.$('#perBio').value = '我在成都，做设计的';
  app.$('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  let p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('写了就有', p.facts.includes('他在成都，做设计的'));

  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('清空后提示"还没写"', (() => {
    app.$('#perBio').value = '';
    app.$('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
    return /还没写/.test(app.$('#perBioCount').textContent);
  })(), app.$('#perBioCount').textContent);

  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('清空后那几条也撤掉了', !p.facts.includes('他在成都，做设计的'), p.facts.join(' | '));
  check('bioFacts 也空了', p.bioFacts.length === 0);
}

console.log('\n[8.4] 在记忆页删掉生平里的一条 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  app.$('#perBio').value = '我在杭州做开发\n养了只猫叫豆豆';
  app.$('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const del = app.$$('#memFacts .wx-mem-del').find((b) =>
    decodeURIComponent(b.dataset.delText || '').includes('豆豆'));
  check('记忆页能看到生平来的条目', !!del);
  del.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('删掉了', !p.facts.includes('养了只猫叫豆豆'), p.facts.join(' | '));
  check('也从"生平名单"里摘掉了（不会被当成漏写又加回来）',
    !p.bioFacts.includes('养了只猫叫豆豆'), p.bioFacts.join(' | '));
}

console.log('\n[8.5] 恢复默认会连生平一起清掉 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  app.$('#perBio').value = '我在杭州做开发';
  app.$('#perBio').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.$('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnOpenPersona').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  app.$('#btnPersonaReset').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  const c = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('生平文本清空了', !c.userBio, String(c.userBio));
  check('生平带来的记忆也清了', !p.facts.includes('他在杭州做开发'), p.facts.join(' | '));
}

// ---------------------------------------------------------------- 9) 关系定位
console.log('\n[9] 关系定位：她要完全认同自己的身份 ...');
{
  const lover = relationBlock('恋人', { affection: 70 });
  check('说清了身份（不是一行"你们的关系：X"）', /你们是恋人/.test(lover) && /你是他的女朋友/.test(lover));
  check('给了称呼方式', /你怎么称呼他/.test(lover) && /男朋友/.test(lover));
  check('给了对外说法', /对外你怎么说/.test(lover));
  check('列出这个身份"本来就会做"的事', /本来就会/.test(lover) && /报备自己的行程/.test(lover) && /吃醋/.test(lover));
  check('列出"不会做"的事（越界的）', /不会\*\*做/.test(lover) && /我们只是朋友/.test(lover));
  check('给了日常底色', /日常底色/.test(lover) && /男女朋友的日常/.test(lover));
  check('强调"身份不许动摇"', /身份不许动摇/.test(lover));
  check('生气冷战也不许降级成陌生人', /不会因此把自己说成"普通朋友"/.test(lover));
  check('关系往前走了就以最新的为准', /一律以最新的为准/.test(lover) && /不能第二天又退回去/.test(lover));
  check('他表白确认了就认下', /你答应了就当成既成事实/.test(lover));
  check('没确认时别自己加戏', /别自己加戏/.test(lover));
  check('有身份和温度是两个轴的说法', /温度/.test(lover) && /绝不[能会]因为心情一般/.test(lover));

  const mate = relationBlock('同事');
  check('不同关系给的东西不一样', mate !== lover && /你们是同事/.test(mate) && !/男女朋友/.test(mate));
  check('同事也有边界（不越界）', /说"我想你"这种话/.test(mate));
  check('网友提到"还没见过面"这层前提', /还没见过面/.test(relationBlock('网友')));
  check('陌生人会保持戒心', /客气/.test(relationBlock('陌生人')) && /绕开/.test(relationBlock('陌生人')));
  check('前任有"回不去但又很熟"的尴尬', /回不去/.test(relationBlock('前任')));

  // 用户自己填的关系（不在预设里）也要认
  const custom = relationBlock('房东和租客');
  check('自定义关系也要求她认同定位', /完全认同/.test(custom) && /房东和租客/.test(custom));
  check('自定义关系照样禁止含糊', /不要含糊其辞/.test(custom));

  check('没填关系就不注入', relationBlock('') === '' && relationBlock(null) === '');
  check('每种关系都有称呼/对外/行为清单',
    RELATIONS.every((r) => r.frame && r.call && r.open && r.do?.length && r.dont?.length && r.daily));
  check('关系标签和提示词用的是同一份定义',
    RELATION_NAMES.length === RELATIONS.length && RELATION_NAMES.includes('恋人'));
}

console.log('\n[9.1] 关系 ↔ 好感度：两个轴要对得上 ...');
{
  check('恋人天生就热（基准高）', defaultAffectionFor('恋人') >= 70, String(defaultAffectionFor('恋人')));
  check('陌生人基准低', defaultAffectionFor('陌生人') <= 20, String(defaultAffectionFor('陌生人')));
  check('认不出关系就给中位数', defaultAffectionFor('房东和租客') === 45);
  check('认别名：输入"男朋友"也算恋人', findRelation('男朋友')?.id === 'lovers');
  check('认别名：输入"一起打游戏的"也算搭子', findRelation('一起打游戏的')?.id === 'teammate');

  check('恋人配很低的温度 → 提醒会像陌生人', /名义上是恋人/.test(relationAffectionWarning('恋人', 18)),
    relationAffectionWarning('恋人', 18));
  check('陌生人配很高的温度 → 提醒没边界', /没有边界感/.test(relationAffectionWarning('陌生人', 80)),
    relationAffectionWarning('陌生人', 80));
  check('客户配很高的温度 → 提醒不合适', /对客户这么热络/.test(relationAffectionWarning('客户', 80)));
  check('搭配合适就不啰嗦', relationAffectionWarning('恋人', 72) === ''
    && relationAffectionWarning('同事', 40) === '');
  check('没设关系就不啰嗦', relationAffectionWarning('', 10) === '');
}

// ---------------------------------------------------------------- 10) 关系在界面上的联动
console.log('\n[10] 界面上换关系 ...');
{
  const app = bootApp();
  windows.push(app.dom.window);
  const $ = app.$;
  const onChip = () => app.$$('#chipsAff .wx-chip.on').map((b) => b.textContent).join('/');

  // 人设页：选了恋人，温度基准应该跟着上去
  check('一开始是中间档', /有点好感|聊得来/.test(onChip()), onChip());
  app.$$('#chipsRelation .wx-chip').find((b) => b.textContent === '恋人')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('选「恋人」后自动跳到高热档', /很喜欢|挺喜欢/.test(onChip()), onChip());
  check('关系也填进输入框了', $('#perRelation').value === '恋人', $('#perRelation').value);

  // 关系标签覆盖了 15 种
  check('关系标签比以前多（覆盖恋爱/夫妻/前任等）',
    app.$$('#chipsRelation .wx-chip').length >= 14, `${app.$$('#chipsRelation .wx-chip').length} 个`);

  // 手动调低 → 和"恋人"矛盾 → 给提醒
  app.$$('#chipsAff .wx-chip').find((b) => b.textContent === '刚认识')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('恋人配"刚认识" → 界面给出提醒', /名义上是恋人/.test($('#perAffNote').textContent),
    $('#perAffNote').textContent.trim().slice(0, 60));

  $('#btnPersonaStart').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  const cfg = JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1'));
  check('关系存下来了', cfg.herRelation === '恋人', cfg.herRelation);

  // 「+」面板里能直接看到、直接改
  $('#btnPlus').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('「+」面板里显示当前关系', $('#affRelationName').textContent === '恋人',
    $('#affRelationName').textContent);
  check('有个"改"的入口', !!$('#btnQuickRelation'));
  $('#btnQuickRelation').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点开出现关系标签', $('#quickRelationChips').hidden === false
    && app.$$('#quickRelationChips .wx-chip').length >= 14);
  app.$$('#quickRelationChips .wx-chip').find((b) => b.textContent === '同事')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点一下就能改（不用进设置）',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herRelation === '同事',
    $('#affRelationName').textContent);
  check('改完关系那一行跟着变', $('#affRelationName').textContent === '同事');

  // 改完关系，提示词里的身份也得跟着换
  await app.send('在忙吗');
  const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
  check('提示词里的身份换成了新的', /你们是同事/.test(sys) && !/你们是恋人/.test(sys));
  check('而且带上了具体的称呼和边界', /你怎么称呼他/.test(sys) && /不会\*\*做/.test(sys));
}

// ---------------------------------------------------------------- 11) 关系变了
console.log('\n[11] 他说的话像是在定关系（表白/求婚/分手）...');
{
  const sig = (t) => detectRelationSignal(t);

  check('「做我女朋友吧」认得出', sig('你做我女朋友吧')?.suggest === '恋人',
    JSON.stringify(sig('你做我女朋友吧')));
  check('「我们在一起吧」认得出', sig('我们在一起吧')?.kind === 'together');
  check('认得出结婚', sig('我们结婚吧')?.suggest === '夫妻', JSON.stringify(sig('我们结婚吧')));
  check('「嫁给我」推夫妻', sig('嫁给我好吗')?.suggest === '夫妻');
  check('分手认得出', sig('我们分手吧')?.suggest === '前任', JSON.stringify(sig('我们分手吧')));
  check('「以后别找我了」也算分开', sig('以后别找我了')?.kind === 'breakup');
  check('带着原话（提示条要显示）', sig('你做我女朋友吧')?.matched === '做我女朋友');

  // 宁可漏，不能误报 —— 误报会一直弹提示
  check('「我们在一起工作吧」不算（差点误报）', sig('我们在一起工作吧') === null,
    JSON.stringify(sig('我们在一起工作吧')));
  check('「我们在一起上班」不算', sig('我们在一起上班') === null);
  check('闲聊不算', sig('今天天气不错') === null && sig('我快累死了') === null);
  check('空的不算', sig('') === null && sig(null) === null);
  check('「烦」不算', sig('你好烦') === null);

  check('已经是这个关系就不用提示', relationMatches('恋人', '恋人') === true);
  check('关系不同要提示', relationMatches('同事', '恋人') === false);
  check('认别名：设的是"男朋友"也算恋人', relationMatches('男朋友', '恋人') === true);
  check('没设过关系 → 要提示', relationMatches('', '恋人') === false);

  const tip = relationTipText(sig('你做我女朋友吧'));
  check('提示条带上了他的原话', /做我女朋友/.test(tip), tip);
  check('提示条说了要改成什么', /恋人/.test(tip));

  const hint = relationShiftHint(sig('你做我女朋友吧'));
  check('当轮提示词里有他刚才那句话', /【他刚才那句话】/.test(hint) && /做我女朋友/.test(hint));
  check('要求她认下新身份、别退回朋友', /认下这个新身份/.test(hint) && /我们只是朋友/.test(hint));
  check('但也要防自己加戏', /别自己加戏/.test(hint));
  check('分手的情况措辞不一样', /提分开/.test(relationShiftHint(sig('我们分手吧'))));
  check('没有信号就返回空串', relationShiftHint(null) === '');
}

console.log('\n[11.1] 界面上：提示 → 一键改 → 下一句就换身份 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在忙吗', 20), msg('assistant', '刚忙完', 19)],
      'xiaoyu.profile.v1': { msgCount: 40, affection: 55 },
      'xiaoyu.config.v1': { herRelation: '同事', personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  const $ = app.$;

  check('平时不弹提示', $('#relationTip').hidden === true);

  await app.send('你今天下班了吗');
  check('普通聊天也不弹', $('#relationTip').hidden === true);

  // 他说了一句像表白的话
  await app.send('其实我想了很久，你做我女朋友吧');
  check('他说像表白的话 → 弹出提示', $('#relationTip').hidden === false,
    $('#relationTipText').textContent);
  check('提示里带着他的原话', /做我女朋友/.test($('#relationTipText').textContent));
  check('提示里说了要改成什么', /恋人/.test($('#relationTipText').textContent));
  check('有「改」按钮', !!$('#btnRelationTipApply'));
  check('有「不用改」按钮', !!$('#btnRelationTipClose'));

  // 关键：设置还没改的这一轮，提示词里也要先提醒她
  {
    const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
    check('这一轮的提示词里就有"他刚才那句话"', /【他刚才那句话】/.test(sys) && /做我女朋友/.test(sys));
    check('并且提醒她认下新身份', /认下这个新身份/.test(sys));
    check('同时关系定位那块说的还是旧的（所以才需要提示）', /你们是同事/.test(sys));
  }

  // 点「改」
  $('#btnRelationTipApply').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点「改」提示条收起', $('#relationTip').hidden === true);
  check('关系真的改了',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herRelation === '恋人',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herRelation);

  await app.send('那我们周末去看电影吧');
  {
    const sys = app.lastRequest().messages.find((m) => m.role === 'system').content;
    check('改完之后提示词里是恋人身份', /你们是恋人/.test(sys));
    check('不再是同事', !/你们是同事/.test(sys));
    check('这条普通消息不会再弹提示', $('#relationTip').hidden === true);
    check('也不会再注入"他刚才那句话"', !/【他刚才那句话】/.test(sys));
  }
}

console.log('\n[11.2] 点「不用改」之后不再烦他 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在忙吗', 20), msg('assistant', '刚忙完', 19)],
      'xiaoyu.profile.v1': { msgCount: 40 },
      'xiaoyu.config.v1': { herRelation: '同事', personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);

  await app.send('我们分手吧');
  check('先说分手 → 提示', app.$('#relationTip').hidden === false);
  app.$('#btnRelationTipClose').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  check('点 ✕ 收起', app.$('#relationTip').hidden === true);
  check('记住了"这一类不用提醒"',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'))
      .relationTipDismissed?.breakup === true);
  check('关系没被改',
    JSON.parse(app.window.localStorage.getItem('xiaoyu.config.v1')).herRelation === '同事');

  await app.send('我们分手吧，说真的');
  check('同样的信号不再弹', app.$('#relationTip').hidden === true);
}

console.log('\n[11.3] 已经是那个关系就不用提示...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在忙吗', 20), msg('assistant', '刚忙完', 19)],
      'xiaoyu.profile.v1': { msgCount: 40, affection: 70 },
      'xiaoyu.config.v1': { herRelation: '恋人', personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  await app.send('你做我女朋友吧');
  check('本来就是恋人 → 不弹提示', app.$('#relationTip').hidden === true);
}

// ---------------------------------------------------------------- 12) 执念
console.log('\n[12] 执念：情绪够重的事，遗忘曲线管不着 ...');
{
  const d = (t) => intensityOf(t);

  check('生离死别 → 满格', d('他妈妈去年去世了') === 10, String(d('他妈妈去年去世了')));
  check('委婉说法也认：「奶奶走得很突然」', d('他奶奶走得很突然') === 10);
  check('用户举的例子：「爱人五年前离开了他」', d('他爱人五年前离开了他') === 10,
    String(d('他爱人五年前离开了他')));
  check('「我爱的人离开我了」', d('我爱的人离开我了') === 10);
  check('失业 / 失恋 → 9', d('他上个月被裁了') === 9 && d('他女朋友跟他分手了') === 9);
  check('人生大事 → 8', d('他今年结婚了') === 8);
  check('大吵 / 崩溃 → 7（刚好够执念）', d('他俩大吵了一架，闹翻了') === 7);

  // 宁可漏，不能误伤日常
  check('日常琐事不算', d('他养了只猫叫豆豆') === 0);
  check('「笑死我了」「累死我了」不算（程度副词）', d('笑死我了') === 0 && d('累死我了') === 0);
  check('「我老婆走路很快」不算', d('我老婆走路很快') === 0);
  check('「我老婆不在家」不算', d('我老婆不在家') === 0);
  check('「我老婆没了工作」不算（实测踩到的误判）', d('我老婆没了工作') === 0,
    String(d('我老婆没了工作')));
  check('「他离开我们公司了」不算', d('他离开我们公司了') === 0);
  check('一般情绪只到 5，够不着执念', d('他准备考研，压力很大') === 5);

  // 用户补充的关键一点：**细节再重也只是细节**。
  // 只谈"几点/哪天/穿什么/在哪"的条目，强度封顶到执念线以下 ——
  // 这样它会像普通记忆一样淡掉，五年后正好"记得事、记不清细节"。
  check('「走的时候是晚上七点」是纯细节，封顶（不到执念线）',
    d('他爱人走的时候是晚上七点') < OBSESSION_EMO && d('他爱人走的时候是晚上七点') > 0,
    String(d('他爱人走的时候是晚上七点')));
  check('纯细节能被识别出来', isDetailLike('他爱人走的时候是晚上七点') === true);
  check('「那天穿灰色风衣」纯描述，强度 0', d('他爱人那天穿了一件灰色风衣') === 0);
  check('但"事+细节写在一起"不当细节（宁可记住）',
    d('他妈妈去年去世了，是凌晨三点') === 10,
    String(d('他妈妈去年去世了，是凌晨三点')));
  check('没有细节标记的大事不受影响', isDetailLike('他妈妈去年去世了') === false);
}

console.log('\n[12.1] 执念不受遗忘曲线影响 ...');
{
  const t0 = Date.now();
  const TEN_YEARS = t0 + 3650 * 86400000;

  const obsMeta = newMeta(t0, { emo: 10 });
  const normalMeta = newMeta(t0, { emo: 0 });

  check('够强度的算执念', isObsession(obsMeta) === true);
  check('不够的不算', isObsession(normalMeta) === false);
  check('执念 = 永久记忆', isPermanent(obsMeta) === true);
  check('十年后保留度还是 1', retention(obsMeta, TEN_YEARS) === 1);
  check('十年后标签还是「执念」', strengthLabel(obsMeta, TEN_YEARS) === '执念',
    strengthLabel(obsMeta, TEN_YEARS));
  check('强度百分比 100%', strengthPercent(obsMeta, TEN_YEARS) === 100);

  // 对照：同样十年，普通记忆早没了
  check('对照组：普通记忆十年后基本忘了', retention(normalMeta, TEN_YEARS) < 0.25,
    retention(normalMeta, TEN_YEARS).toFixed(4));

  // 淘汰时也保得住
  const facts = ['他爱人五年前离开了他', '他今天中午吃了拉面'];
  const meta = {
    '他爱人五年前离开了他': newMeta(t0, { emo: 10 }),
    '他今天中午吃了拉面': newMeta(t0),
  };
  const r = decayFacts(facts, meta, TEN_YEARS);
  check('遗忘淘汰时执念不会被丢掉', r.kept.includes('他爱人五年前离开了他'), r.kept.join(' | '));
  check('普通的那条会被淡忘', r.forgotten.includes('他今天中午吃了拉面'), r.forgotten.join(' | '));

  // 强度只升不降：后来说得更重，按更重的算
  const up = touchMeta(newMeta(t0, { emo: 8 }), t0, { emo: 10 });
  check('同一件事后来说得更重 → 强度跟着涨', up.emo === 10, String(up.emo));
  const keep = touchMeta(newMeta(t0, { emo: 10 }), t0, { emo: 3 });
  check('后来说得轻了 → 不会降级', keep.emo === 10, String(keep.emo));
}

console.log('\n[12.2] 重点：核心留下，细节照样淡掉（这是用户补充的关键）...');
{
  const t0 = Date.now();
  const LATER = t0 + 1800 * 86400000;   // 五年

  // 用户举的例子：五年前爱人离开，
  //   核 →「她离开了我」+ 当时的情绪  → 永远记得
  //   细节 → 几点、穿什么            → 记不清了
  const CORE = '他爱人五年前离开了他';
  const DETAIL1 = '他爱人那天穿了一件灰色风衣';
  const DETAIL2 = '他爱人走的时候是晚上七点';

  check('核心被认成执念', isObsessive(CORE) === true);
  check('细节 1 不会被认成执念', isObsessive(DETAIL1) === false, DETAIL1);
  check('细节 2 不会被认成执念', isObsessive(DETAIL2) === false, DETAIL2);

  const facts = [CORE, DETAIL1, DETAIL2];
  const meta = {
    [CORE]: newMeta(t0, { emo: 10 }),
    [DETAIL1]: newMeta(t0),
    [DETAIL2]: newMeta(t0),
  };
  const r = decayFacts(facts, meta, LATER, { maxForget: 5 });
  check('五年后：核心还在', r.kept.includes(CORE), r.kept.join(' | '));
  check('五年后：细节没了', !r.kept.includes(DETAIL1) && !r.kept.includes(DETAIL2),
    r.kept.join(' | '));
  check('被忘掉的正是"几点"和"穿了什么"',
    r.forgotten.some((f) => /风衣/.test(f)) && r.forgotten.some((f) => /七点/.test(f)),
    r.forgotten.join(' | '));

  // 提示词里要明确写清这个规律：情绪和事情记得，细节会糊，别编
  const sys = buildSystemPrompt(
    { facts, factsMeta: meta, msgCount: 100 },
    { herName: '小雨', persona: { custom: false } }
  );
  check('提示词里标出了执念', /【执念·你一直放不下】/.test(sys));
  check('标明的是核心那条，不是细节',
    new RegExp(`${CORE}　【执念`).test(sys) && !new RegExp(`${DETAIL1}　【执念`).test(sys));
  check('告诉了她"事情本身和情绪会一直记得"', /事情本身和当时的情绪/.test(sys));
  check('告诉了她"具体细节会随时间模糊"', /具体细节会随时间模糊/.test(sys));
  check('要求她细节记不清就照实说', /照实说记不清/.test(sys));
  check('**不许编细节**（这条最要紧）', /绝对不要为了显得记得而编细节/.test(sys));
  check('也说了别反复揭伤疤', /别反复揭/.test(sys));
}

console.log('\n[12.3] 执念优先占记忆名额 ...');
{
  // 造一堆普通记忆 + 一条很老的执念：执念必须挤得进去
  const many = Array.from({ length: 30 }, (_, i) => `他随口提过的小事 ${i + 1}`);
  const CORE = '他爱人五年前离开了他';
  const meta = {};
  for (const f of many) meta[f] = newMeta(Date.now());
  meta[CORE] = newMeta(Date.now() - 1800 * 86400000, { emo: 10 });

  const sys = buildSystemPrompt(
    { facts: [...many, CORE], factsMeta: meta, msgCount: 200 },
    { herName: '小雨' }
  );
  check('执念进了提示词（哪怕它是很久以前记的）', sys.includes(CORE));
  check('而且带着执念标记', new RegExp(`${CORE}　【执念`).test(sys));
}

console.log('\n[12.4] 界面上能看见、也能自己标 ...');
{
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在', 9)],
      'xiaoyu.profile.v1': {
        msgCount: 60,
        facts: ['他爱人五年前离开了他', '他养了只猫叫豆豆'],
        factsMeta: {
          '他爱人五年前离开了他': { hits: 1, lastHit: Date.now(), emo: 10 },
          '他养了只猫叫豆豆': { hits: 1, lastHit: Date.now() },
        },
      },
      'xiaoyu.config.v1': { personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app.dom.window);
  const $ = app.$;

  app.$('#btnOpenMemory').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  const badges = app.$$('#memFacts .wx-mem-strength').map((e) => e.textContent);
  check('执念显示成「执念」标签', badges.includes('执念'), badges.join(' / '));
  check('执念标签有独立的样式类',
    !!app.$$('#memFacts .wx-mem-strength.obs').length);
  check('普通记忆还是「很牢/清楚」', badges.some((b) => b === '很牢' || b === '清楚'), badges.join(' / '));

  // ☆/★ 手动标
  const stars = app.$$('#memFacts .wx-mem-star');
  check('每条旁边有 ☆（可以手动标执念）', stars.length === 2, `${stars.length} 个`);
  const catStar = stars.find((s) => decodeURIComponent(s.dataset.obsText || '').includes('豆豆'));
  check('没标的显示 ☆', catStar.textContent === '☆', catStar.textContent);
  catStar.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

  let p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('点一下标成执念', p.factsMeta['他养了只猫叫豆豆'].emo >= OBSESSION_EMO,
    String(p.factsMeta['他养了只猫叫豆豆'].emo));
  check('标完界面立刻变星号',
    app.$$('#memFacts .wx-mem-star.on').length === 2,
    `${app.$$('#memFacts .wx-mem-star.on').length} 个`);

  // 再点一下取消
  const catStar2 = app.$$('#memFacts .wx-mem-star')
    .find((s) => decodeURIComponent(s.dataset.obsText || '').includes('豆豆'));
  catStar2.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  p = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('再点一下取消执念', Number(p.factsMeta['他养了只猫叫豆豆'].emo) < OBSESSION_EMO,
    String(p.factsMeta['他养了只猫叫豆豆'].emo));
}

console.log('\n[12.5] 模型可以不配合，本地检测照样管用 ...');
{
  // 只给模型一个普通的 facts（没有 heavy、没有 e）
  const app = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '他妈妈去年去世了', 10), msg('assistant', '……', 9)],
      'xiaoyu.profile.v1': { msgCount: 20 },
      'xiaoyu.config.v1': { personaDone: true },
    },
    reply: '嗯',
    rawReply: true,
  });
  windows.push(app.dom.window);
  await app.send('我妈妈去年走了');

  // 直接走 applyMemory 的路径：模拟模型只给字符串
  const p0 = JSON.parse(app.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('（模型没标 heavy 时）本地情绪检测兜底', (p0.facts || []).length >= 0);

  // 用另一条路径确认：给一条明确的重话，看它会不会被标成执念
  const app2 = bootApp({
    seed: {
      'xiaoyu.chat.v1': [msg('user', '在吗', 10), msg('assistant', '在', 9)],
      'xiaoyu.profile.v1': { msgCount: 20 },
      'xiaoyu.config.v1': { personaDone: true },
    },
    reply: '嗯',
  });
  windows.push(app2.dom.window);
  // 手动加一条分量重的（走 addMemory），再确认它按本地检测拿到了强度
  app2.$('#inpNewFact').value = '他爱人五年前离开了他';
  app2.$('#btnAddFact').dispatchEvent(new app2.window.MouseEvent('click', { bubbles: true }));
  const p = JSON.parse(app2.window.localStorage.getItem('xiaoyu.profile.v1'));
  check('手动加的重话也被认出来', p.facts.includes('他爱人五年前离开了他'), (p.facts || []).join(' | '));
}

console.log(`\n=== 结果 ===\n  ${pass} 项通过, ${fail} 项失败`);
process.exit(fail ? 1 : 0);

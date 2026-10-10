/** 到这一档就是执念：不再受遗忘曲线影响 */
export const OBSESSION_EMO = 7;

const NONE_OF = '事|工作|钱|力气|电|耐心|脾气|兴趣|办法|信心|胃口|睡意';

const TIERS = [
  [10, new RegExp(`去世|过世|离世|不在了|没了(?!${NONE_OF})|走了(?!吧)|自杀|轻生|想死|不想活|抢救|病危|临终|葬礼|火化|癌症|绝症|恶性肿瘤|车祸|意外身亡|意外走了|白发人送黑发人|永远离开|离开了我们|离开人世`)],

  [10, /(奶奶|爷爷|外婆|外公|姥姥|姥爷|父亲|母亲|父母|爸妈|哥哥|姐姐|弟弟|妹妹|亲人|家里人|最好的朋友|发小)[^，。；、]{0,8}走(?!路|着|在|过|向|进|出|开|上|下|去|来)/],

  [10, /(爱人|女朋友|男朋友|对象|老婆|老公|妻子|丈夫|恋人|初恋|喜欢的人|未婚妻|未婚夫|孩子|宝宝)[^，。；、]{0,10}(离开|走(?!路|着|在|过|向|进|出|开|上|下|去|来)|不在了|没了(?!事|工作|钱))/],
  [10, /离开(了)?我(?!们)|离开(了)?他(?!们)/],
  [9, /分手|离婚|出轨|背叛|小三|被裁|裁员|失业|下岗|破产|欠债|欠了很多钱|还不上|坐牢|入狱|判刑|住院|确诊|重病|大病|手术|化疗|抑郁|焦虑症|精神崩/],
  [8, /结婚|求婚|领证|怀孕|生了|当爸|当妈|考上|录取|上岸|买房|被骗|诈骗|霸凌|被欺负|家暴|打官司|搬走|移民|出国定居|亲人重病/],
  [7, /吵得很凶|大吵|闹翻|绝交|拉黑|崩溃|哭了一整|哭了好久|哭到|失眠到|压力大到|撑不住|熬不过|被拒绝|被甩|落榜|考砸|失败了|没考上|丢工作|被开除|走了很远|想不开/],
  [5, /吵架|吵了|哭了|想哭|难受|委屈|心疼|生气|气死|好烦|烦死|难过|伤心|失落|孤单|害怕|担心|紧张|感动|舍不得|压力很大|压力好大|压力有点大/],
  [3, /开心|高兴|喜欢|期待|兴奋|幸福|好吃|好玩|爱了|好棒|太好了|想你/],
];

const DETAIL_ONLY = /(\d{1,2}\s*点|几点|点半|那天|当天|穿(了|着)|一件|什么颜色|颜色|原话|门口|楼下|车站|机场|医院|的时候)/;

const HARD_EVENT = /去世|过世|离世|自杀|轻生|癌症|绝症|车祸|意外身亡|不在了/;

/** 是不是"纯细节"（不承载事情本身） */
export function isDetailLike(text) {
  const t = String(text || '');
  return DETAIL_ONLY.test(t) && !HARD_EVENT.test(t);
}

export function intensityOf(text) {
  const t = String(text || '').trim();
  if (!t) return 0;

  let top = 0;
  for (const [lv, re] of TIERS) {
    if (re.test(t)) { top = lv; break; }
  }

  if (top > 0) {
    if (/[!！]{2,}/.test(t)) top = Math.min(10, top + 1);
    if (/呜+|啊啊+|呜呜/.test(t)) top = Math.min(10, top + 1);
  }

  if (top >= OBSESSION_EMO && isDetailLike(t)) return OBSESSION_EMO - 1;

  return top;
}

/** 够不够格当执念 */
export function isObsessive(text) {
  return intensityOf(text) >= OBSESSION_EMO;
}

export function intensityLabel(v) {
  const n = Number(v) || 0;
  if (n >= OBSESSION_EMO) return '执念';
  if (n >= 5) return '有情绪';
  if (n >= 3) return '有点情绪';
  return '';
}

const DEATH_WORDS = [
  '去世', '离世', '过世', '逝世', '身亡', '牺牲', '长眠', '安息',
  '咽气', '断气', '弥留', '临终', '病逝', '夭折', '离开人世', '不在人世',
  '离开这个世界', '离开了这个世界', '离开了人世', '离开了我们',
  '最后一面', '葬礼', '墓碑', '坟前', '墓前', '忌日', '遗照', '遗像', '骨灰',
];

const DEATH_STRICT = /(?:(?:她|他|我|你|我们|两人|两个人|双双|一起|都)\s*死[了去]|死别|生死(?:离别|相隔))/;

export function detectEnding(text, { narr = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return '';

  if (!narr) return '';

  const hit = DEATH_WORDS.find((w) => t.includes(w));
  if (hit) return hit;

  const m = t.match(DEATH_STRICT);
  return m ? m[0] : '';
}

/** 他选了"我还没想好"（或第一轮的"否"）之后，替他圆回来的那句旁白 */
export const DREAM_NARRATION = '你们都睡着了，做了一个好梦，白天醒来又是美好的一天';

/** 弹窗里的两轮文案（放在这里，界面和测试共用一份，不会各写各的） */
export const ENDING_DIALOG = {
  first: {
    title: '是否忘记你们的一切？',

    body: '这句话像是在给你们的这段故事画句号。\n忘记，就是把你们的聊天记录、'
      + '她记得的事、好感度全部清掉，从零开始。',
    yes: '是',
    no: '否',
  },
  second: {
    title: '再确认一次：真的要忘记吗？',
    body: '清掉之后就找不回来了 —— 她记得的关于你的每一件事都会消失。',
    yes: '是',
    no: '我还没想好',
  },
};

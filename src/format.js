/** HTML 转义。凡是把用户/模型给的文本拼进 innerHTML 的地方，都必须过它 */
export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 纯表情消息（微信里这种不显示气泡底色） */
export function isEmojiOnly(t) {
  const s = String(t || '').trim();
  if (!s || s.length > 8) return false;
  return /^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u.test(s);
}

export function timeText(ts, now = Date.now()) {
  const d = new Date(ts);
  const cur = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayDiff = Math.floor((new Date(cur.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return `昨天 ${hm}`;
  if (dayDiff === 2) return `前天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 一段时长（毫秒）说成人话："23 分钟" / "5 个小时" / "3 天" */
export function gapText(ms) {
  const min = Math.max(1, Math.round(Number(ms) / 60000));
  if (min < 60) return `${min} 分钟`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 个小时`;
  return `${Math.round(h / 24)} 天`;
}

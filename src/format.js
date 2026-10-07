/**
 * 文本格式化的公共小工具。
 *
 * 为什么单独一份：这几个函数在 app.js 里被**几十处**调用，
 * 而且它们是纯的（给什么算什么，不碰状态），放在界面代码中间纯属被埋了。
 * 其中 `esc()` 尤其要紧 —— 它是所有 HTML 拼接的唯一安全闸门，
 * 单独放一处才不会有人再手写一个只在部分地方转义的版本。
 *
 * 全部纯函数：不碰 DOM、不碰 state。「现在」由调用方传进来。
 */

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

/**
 * 消息时间戳 → 界面上显示的文字。
 * "今天/昨天/前天"是拿**她的虚拟时间**（now）算的，不是现实时间。
 */
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

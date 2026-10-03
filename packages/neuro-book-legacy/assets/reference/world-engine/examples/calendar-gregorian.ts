/**
 * Gregorian Calendar 示例：真实公历
 *
 * 特点：
 * - 内置闰年规则（能被4整除 且（不能被100整除 或 能被400整除））
 * - 内置大小月（1/3/5/7/8/10/12 月 31 天，4/6/9/11 月 30 天，2 月平年 28/闰年 29）
 * - yearZeroMode 强制 "noZero"（无公元0年，对齐真实公历）
 * - 适合现代背景或需要真实公历的故事
 */

export default {
  type: 'gregorian',

  eraBefore: '公元前',
  eraAfter: '公元',

  // Format 模板：默认到分钟，不带秒
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};

/**
 * 示例输出：
 *
 * instant = 0
 * → "公元1年1月1日 00:00"
 *
 * 2000年2月29日（闰年）
 * → "公元2000年2月29日 00:00"
 *
 * 2001年2月29日（非闰年，parse 时报错）
 * → Error: 日期超出范围（2月最多28天）
 *
 * instant < 0
 * → "公元前1年1月1日 00:00"
 */

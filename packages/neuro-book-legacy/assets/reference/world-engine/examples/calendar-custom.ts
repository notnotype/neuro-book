/**
 * Custom Calendar 示例：自定义历法
 *
 * 特点：
 * - 完全自定义 format/parse 逻辑
 * - 适合复杂历法（如农历闰月）或任意自定义规则
 * - 示例：只显示"年"和"日"，省略月份
 */

export default {
  type: 'custom',

  /**
   * format: instant → 人读字符串
   * @param instant 自零点起的秒数（bigint）
   * @returns 人读时间字符串
   */
  format(instant: bigint): string {
    const secondsPerYear = 31536000n;  // 365 天 * 86400 秒
    const secondsPerDay = 86400n;

    const isNegative = instant < 0n;
    const absInstant = isNegative ? -instant : instant;

    const year = absInstant / secondsPerYear + 1n;
    const rest = absInstant % secondsPerYear;
    const day = rest / secondsPerDay + 1n;
    const hour = (rest % secondsPerDay) / 3600n;
    const minute = (rest % 3600n) / 60n;

    const era = isNegative ? '前纪元' : '新纪元';
    return `${era}${year}年第${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  },

  /**
   * parse: 人读字符串 → instant
   * @param input 人读时间字符串
   * @returns instant（bigint）
   */
  parse(input: string): bigint {
    const match = /(前纪元|新纪元)(\d+)年第(\d+)日\s+(\d+):(\d+)/.exec(input);
    if (!match) {
      throw new Error(`时间字符串格式错误：${input}`);
    }

    const [, era, yearStr, dayStr, hourStr, minuteStr] = match;
    const year = BigInt(yearStr);
    const day = BigInt(dayStr);
    const hour = BigInt(hourStr);
    const minute = BigInt(minuteStr);

    const secondsPerYear = 31536000n;
    const secondsPerDay = 86400n;

    let instant = (year - 1n) * secondsPerYear + (day - 1n) * secondsPerDay + hour * 3600n + minute * 60n;

    if (era === '前纪元') {
      instant = -instant;
    }

    return instant;
  },

  /**
   * projection: 返回格式说明（可选）
   */
  projection() {
    return {
      format: '{era}{year}年第{day}日 {hour:02}:{minute:02}',
      examples: ['新纪元1年第1日 00:00', '新纪元488年第200日 14:30']
    };
  }
};

/**
 * 示例输出：
 *
 * instant = 0
 * → "新纪元1年第1日 00:00"
 *
 * instant = 86400 * 100  (第 100 天)
 * → "新纪元1年第101日 00:00"
 *
 * instant < 0
 * → "前纪元1年第1日 00:00"
 */

/**
 * 注意事项：
 *
 * 1. format 必须返回字符串，parse 必须返回 bigint
 * 2. format 抛错时返回 500，parse 抛错时返回 400
 * 3. projection 可选，用于 schema 投影（World Engine API 的元信息）
 * 4. 复杂历法（如农历闰月）可以在 format/parse 里自行实现闰月算法
 */

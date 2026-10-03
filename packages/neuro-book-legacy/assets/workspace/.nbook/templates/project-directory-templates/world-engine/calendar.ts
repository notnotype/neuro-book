/**
 * World Engine Calendar for new projects.
 *
 * 默认使用 Gregorian Calendar（真实公历），适合现代、校园、都市、近未来等题材。
 * 架空世界可改为 type: 'simple' 或 type: 'custom'。
 *
 * 注意：这是单文件配置入口。本地文件、绝对路径和 URL/protocol import/export 会被 loader 拒绝；
 * 自定义 format/parse helper 请直接写在本文件，或使用包级 import 与 node: 内置模块。
 */

export default {
    type: 'gregorian',

    // Era 前后缀
    eraBefore: '公元前',
    eraAfter: '公元',

    // 默认到分钟，不带秒。示例：公元2020年4月12日 18:00
    format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};

/**
 * 其他选项：
 *
 * 1. Simple Calendar（固定单位链，适合架空历法）：
 *    type: 'simple',
 *    eraBefore: '旧纪元',
 *    eraAfter: '新纪元',
 *    baseUnit: 'second',
 *    units: [
 *      { name: 'minute', parent: 'second', ratio: 60 },
 *      { name: 'hour', parent: 'minute', ratio: 60 },
 *      { name: 'day', parent: 'hour', ratio: 24 },
 *      { name: 'month', parent: 'day', ratio: 30 },
 *      { name: 'year', parent: 'month', ratio: 12 }
 *    ],
 *    format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
 *
 * 2. cycleNames：
 *    cycleNames 长度必须等于 ratio。星期适合使用 cycleNames：
 *    { name: 'week', parent: 'day', ratio: 7,
 *      cycleNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] }
 *
 * 3. 完全自定义（如农历闰月）：
 *    type: 'custom',
 *    format(instant: bigint): string { ... },
 *    parse(input: string): bigint { ... }
 *
 * 详见 reference/world-engine/calendar-system.md
 */

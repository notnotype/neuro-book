/**
 * 天空的颜色：钟点、明暗与“Agent 工作中”算出一对渐变色。纯函数，场景测试直接断言它；画到画布上的部分在 `plugin.ts`。
 */

export interface Sky {
    /** 天顶与地平线的颜色，CSS 颜色。 */
    readonly top: string;
    readonly horizon: string;
}

/** 24 个钟点各取一个色相：夜里深蓝，清晨偏粉，白天浅蓝，傍晚偏橙。 */
function hueAt(hour: number): {readonly hue: number; readonly light: number} {
    if (hour < 5 || hour >= 21) return {hue: 230, light: 14};
    if (hour < 7) return {hue: 320, light: 42};
    if (hour < 17) return {hue: 205, light: 68};
    if (hour < 19) return {hue: 28, light: 56};
    return {hue: 255, light: 28};
}

export function skyAt(hour: number, appearance: "light" | "dark", working: boolean): Sky {
    const {hue, light} = hueAt(((hour % 24) + 24) % 24);
    // 暗色界面整体压暗；工作中的天空多一点暖色，让人看得出状态变了。
    const lightness = appearance === "dark" ? light * 0.55 : light;
    const warm = working ? 18 : 0;
    return {
        top: `hsl(${String(hue)} 55% ${String(lightness)}%)`,
        horizon: `hsl(${String(hue + warm)} 60% ${String(Math.min(92, lightness + 18))}%)`,
    };
}

/** 下一个整点的毫秒时间戳：天空每小时变一次，`expiresAt` 取它，宿主到点重新请求。 */
export function nextHour(now: number): number {
    const date = new Date(now);
    date.setMinutes(0, 0, 0);
    return date.getTime() + 3_600_000;
}

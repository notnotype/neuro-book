/**
 * 与书无关的界面偏好（导航收起与否、抽屉宽度、明暗）：只在这一处读写 localStorage，组件不碰浏览器存储
 * （docs/specs/story/viewer.md 的“副作用与数据”）。读写都包 try/catch：隐私模式、存储被禁用时照常工作，只是记不住。
 */

const PREFIX = "nbstory:";

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(`${PREFIX}${key}`);
    } catch (error) {
        console.warn(`读不了偏好 ${key}，按缺省处理`, error);
        return null;
    }
}

function write(key: string, value: string): void {
    try {
        window.localStorage.setItem(`${PREFIX}${key}`, value);
    } catch (error) {
        console.warn(`存不了偏好 ${key}，这次改动只在本页有效`, error);
    }
}

export function readNavCollapsed(): boolean {
    return read("nav-collapsed") === "true";
}

export function writeNavCollapsed(value: boolean): void {
    write("nav-collapsed", String(value));
}

/** 抽屉宽度的范围：拖动守着它（三栏网格的最小与最大宽度），读偏好时超出范围的值不认。 */
export const DRAWER_WIDTH_RANGE = {min: 280, max: 640} as const;

export function readDrawerWidth(): number {
    const value = Number(read("drawer-width"));
    return Number.isFinite(value) && value >= DRAWER_WIDTH_RANGE.min && value <= DRAWER_WIDTH_RANGE.max ? value : 400;
}

export function writeDrawerWidth(value: number): void {
    write("drawer-width", String(Math.round(value)));
}

/** 问答里第一次切换读书方式时的说明看过了没有（浏览器级，看过一次就不再弹）。 */
export function readModeNoticeSeen(): boolean {
    return modeNoticeSeenInPage || read("qa-mode-notice-seen") === "true";
}

/** 偏好存不进去（隐私模式）时，这一页的生命周期里也不再重复弹。 */
let modeNoticeSeenInPage = false;

export function writeModeNoticeSeen(): void {
    modeNoticeSeenInPage = true;
    write("qa-mode-notice-seen", "true");
}

/** 人物卡“关于他的”里展开次要（3 级）说法与否；缺省收起（viewer 输出 56）。 */
export function readShowMinorRecords(): boolean {
    return read("show-minor-records") === "true";
}

export function writeShowMinorRecords(value: boolean): void {
    write("show-minor-records", String(value));
}

/** 一份 JSON 偏好：读不出、形状不对时给缺省（调用方自己校验字段）。 */
export function readJsonPref(key: string): unknown {
    const text = read(key);
    if (text === null) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        console.warn(`偏好 ${key} 不是合法的 JSON，按缺省处理`, error);
        return null;
    }
}

export function writeJsonPref(key: string, value: unknown): void {
    write(key, JSON.stringify(value));
}

export type ThemeChoice = "system" | "light" | "dark";

export function readTheme(): ThemeChoice {
    const value = read("theme");
    return value === "light" || value === "dark" ? value : "system";
}

export function writeTheme(value: ThemeChoice): void {
    write("theme", value);
}

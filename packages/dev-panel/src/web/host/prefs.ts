import {emptyAnswerDraft, hasDraftContent, parseAnswerDraft, type AnswerDraft} from "./answers.js";
import {NAV_ARRANGES, type NavArrange} from "./nav.js";

/**
 * 面板的偏好（明暗、左栏各组的展开、左栏的宽度与收起、左栏 Work 列表的排列方式、通知里“知道了”的尝试、审计横幅的“知道了”）与答复表单的草稿：只在这一处读写 localStorage，组件不碰浏览器存储。
 * 键都带 `nbdev-panel:` 前缀；读写都包 try/catch（隐私模式、存储被禁用时照常工作，只是记不住）。
 * localStorage 按来源分开：`127.0.0.1:4400` 与 `localhost:4400` 各有一份，可以接受。
 */

const PREFIX = "nbdev-panel:";

export type Appearance = "system" | "light" | "dark";

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(`${PREFIX}${key}`);
    } catch (error) {
        console.warn(`读不了面板偏好 ${key}，按缺省处理`, error);
        return null;
    }
}

function write(key: string, value: string): void {
    try {
        window.localStorage.setItem(`${PREFIX}${key}`, value);
    } catch (error) {
        console.warn(`存不了面板偏好 ${key}，这次改动只在本页有效`, error);
    }
}

function remove(key: string): void {
    try {
        window.localStorage.removeItem(`${PREFIX}${key}`);
    } catch (error) {
        console.warn(`删不了面板偏好 ${key}`, error);
    }
}

export function readAppearance(): Appearance {
    const value = read("appearance");
    return value === "light" || value === "dark" ? value : "system";
}

export function writeAppearance(value: Appearance): void {
    write("appearance", value);
}

/** 左栏各组的展开状态；没记过的组缺省展开。 */
export function readNavOpen(): Record<string, boolean> {
    const value = read("nav-open");
    if (!value) return {};
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === "object" && parsed !== null ? parsed as Record<string, boolean> : {};
    } catch (error) {
        console.warn("面板偏好 nav-open 不是合法 JSON，按缺省处理", error);
        return {};
    }
}

export function writeNavOpen(value: Record<string, boolean>): void {
    write("nav-open", JSON.stringify(value));
}

/** 左栏的宽度（用户拖出来的，CSS px）：缺省 300（D4）；读到的不是正数时按缺省。夹在上下限之内由外壳做。 */
export const NAV_WIDTH_DEFAULT = 300;
export function readNavWidth(): number {
    const value = Number(read("nav-width"));
    return Number.isFinite(value) && value > 0 ? value : NAV_WIDTH_DEFAULT;
}

export function writeNavWidth(value: number): void {
    write("nav-width", String(Math.round(value)));
}

/** 左栏是否收起（决定点 8：完全收起，顶栏左侧给展开按钮）。 */
export function readNavCollapsed(): boolean {
    return read("nav-collapsed") === "true";
}

export function writeNavCollapsed(value: boolean): void {
    write("nav-collapsed", String(value));
}

/** 左栏 Work 列表的排列方式（t15 阶段 4 第 2 批）；读到不认识的值按缺省（按编号）。 */
export function readNavArrange(): NavArrange {
    const value = read("nav-arrange");
    return NAV_ARRANGES.some((entry) => entry.value === value) ? (value as NavArrange) : "number";
}

export function writeNavArrange(value: NavArrange): void {
    write("nav-arrange", value);
}

/**
 * 横幅“审计未开启”点过“知道了”的那一次：记“原因 + 审计文件路径”，换了原因或路径（换机器、换配置目录）会重新出现。
 * 只有 `not_initialized` 可以关；初始化过又坏了的（权限、文件被动过）是故障，横幅常驻。
 */
export function readDismissedAudit(): string | null {
    return read("audit-dismissed");
}

export function writeDismissedAudit(key: string): void {
    write("audit-dismissed", key);
}

/** 通知里“知道了”的尝试（attemptId）：只在本浏览器记住，最多留最近 200 个。 */
export function readDismissedNotify(): string[] {
    const value = read("notify-dismissed");
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch (error) {
        console.warn("面板偏好 notify-dismissed 不是合法 JSON，按缺省处理", error);
        return [];
    }
}

export function writeDismissedNotify(value: readonly string[]): void {
    write("notify-dismissed", JSON.stringify(value.slice(-200)));
}

/**
 * 答复表单的草稿（t21），一块评审一份，键是“Work/Task/产物”。没有内容时删掉这一项，不留空草稿；
 * 存坏了（不是 JSON、形状不对）按没有草稿处理。存不下（配额满、存储被禁用）时只在本页有效。
 */
export function readAnswerDraft(target: string): AnswerDraft {
    const value = read(`answer-draft:${target}`);
    if (!value) return emptyAnswerDraft();
    try {
        const parsed = parseAnswerDraft(JSON.parse(value));
        if (parsed) return parsed;
        console.warn(`答复草稿 ${target} 的形状不对，按没有草稿处理`);
    } catch (error) {
        console.warn(`答复草稿 ${target} 不是合法 JSON，按没有草稿处理`, error);
    }
    return emptyAnswerDraft();
}

export function writeAnswerDraft(target: string, draft: AnswerDraft): void {
    if (hasDraftContent(draft)) write(`answer-draft:${target}`, JSON.stringify(draft));
    else remove(`answer-draft:${target}`);
}

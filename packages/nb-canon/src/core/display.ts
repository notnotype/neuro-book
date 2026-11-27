/**
 * 一个字段的值写成给人看的一句（作者渲染与界面共用）。不依赖渲染链（marked 与条目文法），所以也从浏览器用的 `@notnotype/nb-canon/schema`
 * 子路径导出：界面只要它时不必载入整个内核。
 */

/** 给作者看的显示文字：数加千位分隔，未知写“未知”（输出 7）。 */
export function displayText(value: unknown): string {
    if (value === null || value === undefined) return "未知";
    if (typeof value === "number") return value.toLocaleString("en-US", {maximumFractionDigits: 4});
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "string") return value;
    // 字符串列表（别名）写各项，作者写的列表写各行的 label。
    if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : ((item as {label?: string} | null)?.label ?? ""))).join("、");
    if (typeof value === "object" && "说明" in (value as object)) return String((value as {说明?: unknown}).说明 ?? "");
    return JSON.stringify(value);
}

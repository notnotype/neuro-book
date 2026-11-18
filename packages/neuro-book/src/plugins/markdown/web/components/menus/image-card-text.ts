/** 插图卡片一行里的文字截断（docs/specs/workbench/markdown-editing.md 输出 54）：名字过长截中间（扩展名留着），目录过长截开头。 */

/** 名字超过 `max` 个字符时把中间换成 `…`，末尾的扩展名与最后几个字留着；`max` 至少 8。 */
export function truncateMiddle(text: string, max: number): string {
    const chars = [...text];
    if (chars.length <= max) return text;
    const keepEnd = Math.max(4, Math.floor((max - 1) / 2));
    const keepStart = max - 1 - keepEnd;
    return `${chars.slice(0, keepStart).join("")}…${chars.slice(chars.length - keepEnd).join("")}`;
}

/** 目录超过 `max` 个字符时去掉前面的部分、留着最靠近文件的几级；作品根（空串）显示为“/”。 */
export function truncateStart(directory: string, max: number): string {
    if (directory === "") return "/";
    const chars = [...directory];
    if (chars.length <= max) return directory;
    return `…${chars.slice(chars.length - (max - 1)).join("")}`;
}

/** 说明取文件名去掉扩展名；没有扩展名、以点开头的名字原样。 */
export function altOfName(name: string): string {
    return name.replace(/(?<=.)\.[^./]+$/u, "");
}

/** 网址的说明：路径最后一段（解码后）去掉扩展名；取不出为空串。 */
export function altOfUrl(url: string): string {
    try {
        const last = new URL(url).pathname.split("/").filter((segment) => segment !== "").at(-1) ?? "";
        return altOfName(decodeURIComponent(last));
    } catch {
        return "";
    }
}

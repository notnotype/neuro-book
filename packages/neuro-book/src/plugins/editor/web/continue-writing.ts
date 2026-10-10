/**
 * 继续写作的地址参数（docs/specs/workbench/editor.md 输出 29）：书架页整页导航到 `/?project=<短名>&open=<地址>&at=end`，
 * 编辑器插件读到参数后立即从地址栏去掉（刷新不重复定位，失败也不反复出现），再按参数打开并定位。纯函数，不碰 DOM。
 */

export const OPEN_PARAM = "open";
export const AT_PARAM = "at";

export interface ContinueRequest {
    readonly address: string;
    /** `at=end` 定位到末尾；没有或不认识的值只打开。 */
    readonly reveal: "end" | null;
}

export function continueRequestOf(href: string): ContinueRequest | null {
    const url = new URL(href);
    const address = url.searchParams.get(OPEN_PARAM);
    if (address === null || address === "") return null;
    return {address, reveal: url.searchParams.get(AT_PARAM) === "end" ? "end" : null};
}

/** 去掉 `open` 与 `at`，其余（含 `project`）原样保留。 */
export function withoutContinueParams(href: string): string {
    const url = new URL(href);
    url.searchParams.delete(OPEN_PARAM);
    url.searchParams.delete(AT_PARAM);
    return url.href;
}

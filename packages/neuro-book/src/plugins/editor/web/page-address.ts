/**
 * 页面标签的地址（docs/specs/workbench/editor.md 输出 33）。不是资源地址：不读文档、不进最近打开。单独一个文件，是因为
 * 标签的模型（`groups/`，不依赖 Vue 组件）与页面的注册表（`pages.ts`）都要用它。
 */

const PAGE_SCHEME = "page://";

/** 页面标签的地址：`page://<id>`，带参数的是 `page://<id>?<编码后的参数>`（标签的身份是页面 id 加参数）。 */
export const pageAddress = (id: string, arg?: string): string => `${PAGE_SCHEME}${id}${arg === undefined ? "" : `?${encodeURIComponent(arg)}`}`;

/** 页面标签的页面 id；文件标签为 null。 */
export const pageIdOf = (address: string): string | null => (address.startsWith(PAGE_SCHEME) ? address.slice(PAGE_SCHEME.length).split("?", 1)[0]! : null);

/** 页面标签的参数；不带参数的页面与文件标签为 undefined。 */
export function pageArgOf(address: string): string | undefined {
    const at = address.startsWith(PAGE_SCHEME) ? address.indexOf("?") : -1;
    return at < 0 ? undefined : decodeURIComponent(address.slice(at + 1));
}

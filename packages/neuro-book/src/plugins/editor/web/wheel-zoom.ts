/**
 * 编辑器上的 Ctrl+滚轮调字号（docs/specs/workbench/editor.md 的“字号”输出，只在桌面里）。监听由编辑组的内容层（`EditorGroup.vue`）持有，
 * 这里是它与编辑器插件之间的约定：插件提供“现在能不能用、步进哪一项”，内容层只管认事件。
 *
 * 监听必须挂在捕获阶段：Monaco 自己的滚动监听不看 `ctrlKey`、一律消耗滚轮并 `preventDefault`，冒泡阶段的监听收不到，也拦不住它
 * 顺手把代码滚走。一处挂在组的根上而不是各控件自挂：Markdown 控件在 markdown 插件里（跨插件不能运行时导入这边），工具栏、页边、
 * 面包屑旁的槽也都在控件的滚动容器之外。
 */

import type {InjectionKey} from "vue";

/** 滚轮步进哪一项：源码编辑器的 `code.fontSize`，Markdown 编辑器的 `markdown.fontSize`。 */
export type WheelZoomTarget = "code" | "markdown";

export interface EditorWheelZoom {
    /** 桌面里为真；浏览器里为假：不接管，Ctrl+滚轮照旧是浏览器自己的事。 */
    readonly enabled: boolean;
    /** 往放大（1）或缩小（-1）走一档。 */
    step(target: WheelZoomTarget, delta: 1 | -1): void;
}

export const editorWheelZoomKey: InjectionKey<EditorWheelZoom> = Symbol("nbook.editor/wheel-zoom");

/**
 * 事件落在哪个控件里：先看目标所在的控件根（`data-editor-control`，两个控件的根上都有）；落在工具栏、面包屑旁的槽这类控件之外的
 * 地方时按这个组里当前标签的编辑器 `fallback`，免得“有时有效有时无效”。两者都认不出（图片、页面标签、空组）返回 null。
 */
export function wheelZoomTarget(target: {closest(selector: string): {getAttribute(name: string): string | null} | null} | null, fallback: WheelZoomTarget | null): WheelZoomTarget | null {
    const kind = target?.closest("[data-editor-control]")?.getAttribute("data-editor-control");
    if (kind === "code" || kind === "markdown") return kind;
    return fallback;
}

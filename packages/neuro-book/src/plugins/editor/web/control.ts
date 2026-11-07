/**
 * 编辑器控件的合同（docs/specs/workbench/editor.md 术语“视图”、输出 9–13、19–20）：每个标签一个控件，一个控件拿到一份绑定，
 * 标签切走、换组都不换。控件要做的事：
 * - 卸载之前（或绑定变成 null 之前）把视图状态存进绑定的槽、把还没交出的输入交出去；挂上时从槽恢复。
 * - 输入经 `binding.commit` 交给文档，按回执推进自己确认过的修订；`conflict` 时保留自己的内容（未裁决输入），不把它
 *   传给别的视图；裁决之后（`binding.unresolved()` 变假）按文档的正文重设。
 * - 文档的正文被别处改了（修订前进且不是自己交的）时重设内容，这次重设不进撤销历史。
 * - 交出句柄（聚焦、撤销、重做、结算、行号导航）；卸载时交出 null。
 * - `visible` 为假时隐藏、不可交互，但仍要跟着正文更新：等切回来再追，结算时会造成假冲突。
 * - 最久没用的控件会被卸载：撤销历史在编辑器实例里的控件把实例存进 `host`，卸载时只从 DOM 上拿下，再挂上时接着用；实例由
 *   编辑器区在标签关闭或换编辑器时释放。
 */

import type {EditorControlHandle, TextEditorBinding, ViewStateSlot} from "../shared/contracts";

/** 文本编辑器控件的属性；合同本身在 `shared/contracts.ts`，供别的插件的编辑器用。 */
export interface EditorControlProps {
    readonly binding: TextEditorBinding | null;
    /** 标签 × 编辑器种类的实例槽（`EditorArea.tabControlSlot`）：再挂上时接着用存在这里的编辑器实例。 */
    readonly host: ViewStateSlot;
    readonly readonly: boolean;
    readonly visible: boolean;
}

export interface EditorControlEmits {
    (event: "ready", handle: EditorControlHandle | null): void;
    (event: "focus", focused: boolean): void;
}

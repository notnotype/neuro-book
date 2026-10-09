/**
 * 编辑器控件的合同（docs/specs/workbench/editor.md 输出 9–13、19–20）：每组每种编辑器一个控件，换文档时宿主给它新的
 * 绑定。控件要做的事：
 * - 换绑定之前把旧文档的视图状态存进旧绑定的槽、把还没交出的输入交出去；之后从新绑定的槽恢复。
 * - 输入经 `binding.commit` 交给文档，按回执推进自己确认过的修订；`conflict` 时保留自己的内容（未裁决输入），不把它
 *   传给别的视图；裁决之后（`binding.unresolved()` 变假）按文档的正文重设。
 * - 文档的正文被别处改了（修订前进且不是自己交的）时重设内容，这次重设不进撤销历史。
 * - 交出句柄（聚焦、撤销、重做、结算、行号导航）；卸载时交出 null。
 */

import type {EditorControlHandle, ViewBinding} from "./area";

export interface EditorControlProps {
    readonly binding: ViewBinding | null;
    readonly readonly: boolean;
    readonly visible: boolean;
}

export interface EditorControlEmits {
    (event: "ready", handle: EditorControlHandle | null): void;
    (event: "focus", focused: boolean): void;
}

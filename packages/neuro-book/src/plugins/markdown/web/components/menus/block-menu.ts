/** 块类型下拉的项（docs/specs/workbench/markdown-editing.md 输出 1、6）：工具栏、它的“⋯”与选区菜单共用。 */

import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {EDITING_ACTIONS} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

export const BLOCK_ACTIONS: ReadonlyArray<EditingActionId> = ["paragraph", "heading-1", "heading-2", "heading-3"];

/** 光标所在的块是哪一种；不是这几种（列表、引用里的段落也算正文）时是正文。 */
export function currentBlock(editing: EditorEditing): EditingActionId {
    return BLOCK_ACTIONS.find((id) => editing.active(id)) ?? "paragraph";
}

/** 勾上当前的一种；只读或不能换（表格单元格、代码块里）时不可选。在 computed 里调用会跟着选区变。 */
export function blockMenuItems(editing: EditorEditing, menus: EditorMenus, readonly: boolean): DropdownMenuItemData[] {
    const current = currentBlock(editing);
    return BLOCK_ACTIONS.map((id) => ({
        id,
        label: menus.title(id),
        iconClass: EDITING_ACTIONS[id].icon,
        type: "checkbox",
        checked: current === id,
        disabled: readonly || !editing.enabled(id),
    }));
}

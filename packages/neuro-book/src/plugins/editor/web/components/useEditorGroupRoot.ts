/**
 * 一块编辑组有两个根：头在外框里，内容在内容层（docs/specs/ui/workbench-layout.md 输出 21）。组里的键位、焦点进出、主键按下换活动组、文件拖放落点，两个根都接。
 */
import {useDropTarget} from "@notnotype/nb-layout/vue";
import {useTemplateRef} from "vue";

import {EDITOR_GROUP_FILE} from "../../shared/contracts";
import type {EditorArea} from "../area";

/** 编辑器区内的键位对应的意图：宿主把它换成命令执行（组件不认识命令）。 */
export type EditorIntent = "save" | "close" | "split-right";

/** 一块编辑组的两个根的标记：判断焦点还在不在编辑器区。 */
export const EDITOR_GROUP_ROOTS = "[data-editor-group], [data-editor-group-head]";

const plain = (event: KeyboardEvent): boolean => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
const KEYS: ReadonlyArray<{readonly test: (event: KeyboardEvent) => boolean; readonly intent: EditorIntent}> = [
    {test: (event) => plain(event) && event.key.toLowerCase() === "s", intent: "save"},
    {test: (event) => plain(event) && event.key.toLowerCase() === "w", intent: "close"},
    {test: (event) => plain(event) && event.key === "\\", intent: "split-right"},
];

/** 文件放下时高亮的矩形：整块编辑组，头和内容一起算。 */
function groupRect(groupId: string, own: Element): {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number} {
    const parts = [own.ownerDocument.querySelector(`[data-editor-group-head="${CSS.escape(groupId)}"]`), own.ownerDocument.querySelector(`[data-editor-group="${CSS.escape(groupId)}"]`)].flatMap((element) => (element === null ? [] : [element.getBoundingClientRect()]));
    const boxes = parts.length > 0 ? parts : [own.getBoundingClientRect()];
    return {left: Math.min(...boxes.map((box) => box.left)), top: Math.min(...boxes.map((box) => box.top)), right: Math.max(...boxes.map((box) => box.right)), bottom: Math.max(...boxes.map((box) => box.bottom))};
}

/** `root` 是模板里根元素的 `ref` 名。 */
export function useEditorGroupRoot(input: {readonly area: () => EditorArea; readonly groupId: () => string; readonly intent: (intent: EditorIntent) => void; readonly root: string}) {
    const rootEl = useTemplateRef<HTMLElement>(input.root);
    useDropTarget(rootEl, [EDITOR_GROUP_FILE], () => ({group: input.groupId(), rect: () => (rootEl.value === null ? {left: 0, top: 0, right: 0, bottom: 0} : groupRect(input.groupId(), rootEl.value))}));
    return {
        /** 编辑器区内的键位：只在编辑器区有焦点时处理，交给宿主执行同一条命令（命令声明里不写全局键位）。 */
        onKeydown: (event: KeyboardEvent): void => {
            const match = KEYS.find((key) => key.test(event));
            if (match === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            input.intent(match.intent);
        },
        onFocusIn: (): void => {
            const area = input.area();
            area.focused.value = true;
            area.focusGroup(input.groupId());
        },
        // 焦点去了别的组不算离开编辑器区。
        onFocusOut: (event: FocusEvent): void => {
            if (!(event.relatedTarget instanceof Element) || event.relatedTarget.closest(EDITOR_GROUP_ROOTS) === null) input.area().focused.value = false;
        },
        onPointerDown: (event: PointerEvent): void => {
            if (event.button === 0) input.area().focusGroup(input.groupId());
        },
    };
}

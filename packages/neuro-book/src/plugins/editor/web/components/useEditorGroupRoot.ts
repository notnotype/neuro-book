/**
 * 一块编辑组有两个根：头在外框里，内容在内容层（docs/specs/ui/workbench-layout.md 输出 21）。组里的键位、焦点进出、主键按下换活动组，两个根都接。
 */
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

export function useEditorGroupRoot(input: {readonly area: () => EditorArea; readonly groupId: () => string; readonly intent: (intent: EditorIntent) => void}) {
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

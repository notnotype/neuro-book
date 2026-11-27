import type {ConfirmBarKind} from "./confirm-bar";

/** 元素对话框里的一个子字段（由宿主按列表的 `item` 声明给）。 */
export interface ElementField {
    readonly id: string;
    readonly label: string;
    readonly kind: ConfirmBarKind;
    readonly options?: readonly string[];
    readonly unit?: string;
    /** 语义档：改一项时只读（显示的是归纳的文字，照着改会写坏起点），加一项时填的是起点。 */
    readonly semantic?: boolean;
}

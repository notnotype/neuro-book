import type {Tone} from "../shared-types";

/** 菜单项的渲染形态：普通项、受控 radio、受控 checkbox。 */
export type DropdownMenuItemType = "item" | "radio" | "checkbox";

/**
 * 下拉菜单项。
 */
export interface DropdownMenuItemData {
    label: string;
    value: string;
    disabled?: boolean;
    iconClass?: string;
    rightIconClass?: string;
    /** 右侧快捷键提示（如 ⌘K） */
    shortcut?: string;
    /** 原生 title 提示（如禁用原因或操作说明） */
    title?: string;
    /** danger 用于删除等破坏性动作：文字与图标用 --status-danger，高亮底色与其它项相同 */
    tone?: Extract<Tone, "neutral" | "danger">;
    /** 为 true 时渲染为分隔线，label/图标被忽略；value 仍作为列表 key，用 "sep-1" 之类占位 */
    separator?: boolean;
    /**
     * 任意层级子菜单。带 children 的项是子菜单父项：**自己不执行 select**，
     * 只在右侧展开下一级；每一级都使用同一套对齐、重叠和翻边规则。
     */
    children?: readonly DropdownMenuItemData[];
    type?: DropdownMenuItemType;
    /** radio / checkbox 的受控勾选态；宿主在 select 之后自己改它，组件不代为切换。 */
    checked?: boolean;
    /**
     * radio 的同层同组标识；组内互斥同样由 checked 受控。
     * 缺 group 的 radio 是非法贡献：无法与其他项互斥，组件按单项独立成组渲染并给开发诊断。
     */
    group?: string;
}

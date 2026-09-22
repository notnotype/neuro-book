/** 菜单项的渲染形态：普通项、受控 radio、受控 checkbox。 */
export type DropdownItemType = "item" | "radio" | "checkbox";

/**
 * 下拉菜单项。
 */
export interface DropdownItem {
    label: string;
    value: string;
    active?: boolean;
    disabled?: boolean;
    iconClass?: string;
    rightIconClass?: string;
    /** 右侧快捷键提示（如 ⌘K） */
    shortcut?: string;
    /** danger 用于删除等破坏性动作，文字与悬停底色使用 --status-danger */
    tone?: "default" | "danger";
    /** 为 true 时渲染为分隔线，label/图标被忽略；value 仍作为列表 key，用 "sep-1" 之类占位 */
    separator?: boolean;
    /**
     * 一层子菜单。带 children 的项是子菜单父项：**自己不执行 select**，
     * 只在右侧展开子菜单；子项里再写 children 不再展开（按普通项渲染并给开发诊断）。
     */
    children?: readonly DropdownItem[];
    /** 项类型，缺省 item。radio / checkbox 用菜单原语渲染勾选态，不复用 active 视觉字段。 */
    type?: DropdownItemType;
    /** radio / checkbox 的受控勾选态；宿主在 select 之后自己改它，组件不代为切换。 */
    checked?: boolean;
    /**
     * radio 的同层同组标识；组内互斥同样由 checked 受控。
     * 缺 group 的 radio 是非法贡献：无法与其他项互斥，组件按单项独立成组渲染并给开发诊断。
     */
    group?: string;
}

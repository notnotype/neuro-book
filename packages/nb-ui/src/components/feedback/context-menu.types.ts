/**
 * 右键菜单项。与 DropdownItem 的区别：动作用 action 回调（而非 value + select 事件）、
 * 支持任意层级 children 与 shortcut 快捷键展示。每一级都走共享菜单几何。
 */
export interface ContextMenuItem {
    /** separator 为 true 时可省略 */
    label?: string;
    iconClass?: string;
    /** 快捷键展示文本（仅展示，不负责绑定） */
    shortcut?: string;
    /** 点击时执行；有 children 的项不触发 */
    action?: () => void;
    children?: ContextMenuItem[];
    disabled?: boolean;
    /** danger 用于删除等破坏性动作 */
    tone?: "default" | "danger";
    /** 为 true 时渲染为分隔线，忽略其它字段 */
    separator?: boolean;
}

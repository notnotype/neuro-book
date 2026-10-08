/**
 * 容器标签与内容面板的无障碍关联（docs/specs/ui/workbench-shell.md 输出 25）：右栏与面板的标签带各一组。标签带与
 * 内容可能不在同一个组件里（面板的标签带在面板框架的导航槽，内容在工具区域宿主），两边按同一份规则求 id。
 * `prefix` 由外壳用 `useId()` 取一次，同一页面上的两个外壳（例如 Lab）不会撞名。
 */

import type {ViewLocation} from "../../shared/views";

export function switcherTabId(prefix: string, part: ViewLocation, containerId: string): string {
    return `${prefix}-${part}-tab-${containerId.replace(/[^\w-]/gu, "_")}`;
}

export function switcherPanelId(prefix: string, part: ViewLocation): string {
    return `${prefix}-${part}-panel`;
}

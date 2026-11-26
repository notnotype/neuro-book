/**
 * “添加一组设定”浮层（AddComponentPicker，同名 .md）的数据形状与分组规则。
 */

/** 浮层里的一项：一个登记了的设定组类型。 */
export interface AddComponentItem {
    /** 类型 id。 */
    readonly value: string;
    readonly label: string;
    readonly iconClass: string;
    /** 按登记它的插件分的组（`addComponentGroup`）。 */
    readonly group: AddComponentGroup;
    /** 适用于这个条目的种类（类型的 `kinds` 含它）。 */
    readonly fits: boolean;
    /** 条目上已经有这一组：平时不列，搜到时列出、写“已添加”，选了是切过去。 */
    readonly present: boolean;
    /** 去掉过：写“恢复‘某某’”。 */
    readonly restore: boolean;
}

export type AddComponentGroup = "canon" | "plot" | "other";

/** 设定插件自己的是“设定”，剧情插件的是“剧情”，别的插件登记的并成“插件”一组；登记方不明（还没读到声明）的也算“插件”。 */
export function addComponentGroup(plugin: string | null): AddComponentGroup {
    if (plugin === "nbook.canon") return "canon";
    if (plugin === "nbook.plot") return "plot";
    return "other";
}

export const ADD_COMPONENT_GROUPS: readonly AddComponentGroup[] = ["canon", "plot", "other"];

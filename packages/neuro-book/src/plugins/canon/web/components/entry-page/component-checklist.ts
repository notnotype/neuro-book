/**
 * 模块的勾选列表（ComponentChecklist，同名 .md）的数据形状与分组规则：加模块对话框与新建条目对话框共用。
 */

/** 列表里的一项：一个登记了的模块类型。 */
export interface ChecklistItem {
    /** 类型 id。 */
    readonly value: string;
    readonly label: string;
    readonly iconClass: string;
    /** 按登记它的插件分的组（`checklistGroup`）。 */
    readonly group: ChecklistGroup;
    /** 类型适用的种类（类型声明的 `kinds`）：列表按当前的种类自己判“适用于”，新建时种类会变。 */
    readonly kinds: readonly string[];
    /** 条目上已经有这个模块：勾着、不能取消，行尾写“已添加”，点了是切过去。新建时恒为假。 */
    readonly present: boolean;
    /** 去掉过：写“恢复‘某某’”。 */
    readonly restore: boolean;
}

/** 种类的一种有名字的模板（`canon.entry-kinds`，`kindPresets` 已去掉不能用的类型）。 */
export interface ChecklistPreset {
    readonly id: string;
    readonly label: string;
    readonly components: readonly string[];
}

export type ChecklistGroup = "canon" | "plot" | "other";

/** 设定插件自己的是“设定”，剧情插件的是“剧情”，别的插件登记的并成“插件”一组；登记方不明（还没读到声明）的也算“插件”。 */
export function checklistGroup(plugin: string | null): ChecklistGroup {
    if (plugin === "nbook.canon") return "canon";
    if (plugin === "nbook.plot") return "plot";
    return "other";
}

export const CHECKLIST_GROUPS: readonly ChecklistGroup[] = ["canon", "plot", "other"];

/** 比名字时不分大小写、不管空格：“物品 栏”也找得到“物品栏”。 */
export const squeeze = (value: string): string => value.replace(/\s+/gu, "").toLowerCase();

/**
 * 点一个模板以后勾着的：原来勾着的都留着（不取消手选的），再加上模板里还没添加、还没勾的几个模块，次序同模板。
 */
export function withPreset(checked: readonly string[], preset: ChecklistPreset, items: readonly ChecklistItem[]): readonly string[] {
    const present = new Set(items.filter((item) => item.present).map((item) => item.value));
    const known = new Set(items.map((item) => item.value));
    return [...checked, ...preset.components.filter((type) => known.has(type) && !present.has(type) && !checked.includes(type))];
}

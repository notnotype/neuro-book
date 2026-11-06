/**
 * SuggestionMenu 的数据形状与选项 id。宿主的键盘移动与 `aria-activedescendant` 都要用到这里的扁平顺序，所以放在组件外面导出。
 */

export type SuggestionMenuItem = Readonly<{
    /** 在整个菜单里唯一 */
    id: string;
    label: string;
    iconClass?: string;
    /** 右侧的次要文字：快捷键、路径或一句说明；放不下时先截它 */
    hint?: string;
    disabled?: boolean;
    /** 当前值：行尾画勾（可搜索的下拉用它标出已选项）。 */
    checked?: boolean;
}>;

export type SuggestionMenuGroup = Readonly<{
    id: string;
    /** 分组标题；缺省时不画标题行 */
    label?: string;
    items: readonly SuggestionMenuItem[];
}>;

/** 贴光标时宿主给的虚拟锚点：每帧都会重新读一次矩形。 */
export type SuggestionMenuAnchor = Element | {getBoundingClientRect: () => DOMRect; contextElement?: Element};

export type SuggestionSide = "auto" | "top" | "bottom";

/**
 * 第 `index` 个可选项的 DOM id。`index` 按分组的输入顺序跨组累计，只数可选项（不数禁用项与分组标题），
 * 和宿主键盘移动用的扁平顺序（`suggestionMenuOptions`）一致。
 */
export function suggestionOptionId(menuId: string, index: number): string {
    return `${menuId}-option-${String(index)}`;
}

/** 按显示顺序排开的可选项，宿主的上下键在它上面移动；下标就是 `suggestionOptionId` 的 `index`。 */
export function suggestionMenuOptions(groups: readonly SuggestionMenuGroup[]): SuggestionMenuItem[] {
    return groups.flatMap((group) => group.items.filter((item) => item.disabled !== true));
}

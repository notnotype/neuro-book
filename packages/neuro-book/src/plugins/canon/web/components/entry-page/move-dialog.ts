/** 移动对话框（同名 `MoveDialog.md`）填的东西：受控，宿主给初值、收 `confirm`。 */
export interface MoveDraft {
    /** 上级条目；null 是没有上级（界面写“无”）。 */
    parent: string | null;
    /** 上级的名字（选择器里显示）。 */
    parentName: string;
    folder: string;
    kind: string;
    /** `keep` 不动同层的顺序，`first` 放在这一层最前。换了上级时排在新的一层最后（内核）。 */
    order: "keep" | "first";
    /** 从哪一章开头出场；null 是一开始就在。 */
    appears: string | null;
    /** 是谁的马甲（本体）；null 是不是马甲。 */
    sameAs: string | null;
    sameAsName: string;
}

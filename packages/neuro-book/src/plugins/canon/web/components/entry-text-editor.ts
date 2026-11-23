/**
 * `EntryTextEditor` 的数据：编辑视图里的一块。放在单独的模块里：宿主逻辑（`text-tab.ts`）也用它，而后端的类型检查看得到
 * 宿主逻辑的测试、看不懂 `.vue`。
 */

export interface EditorBlock {
    readonly key: string;
    readonly text: string;
    /** `gone` 是这一块在世界里已经不在了（等作者在冲突里选）。 */
    readonly state: "same" | "edited" | "new" | "removed" | "gone";
    /** 剧情改过这一块：框头写一句。 */
    readonly story: boolean;
    /** 各动作做不了的原因；空串是能做。`edit` 非空时输入框只读。 */
    readonly blocked: {readonly edit: string; readonly remove: string; readonly split: string; readonly merge: string; readonly add: string};
    /** 这一块下面要写的原因（写得不对、放不进这里）；空串没有。 */
    readonly problem: string;
}

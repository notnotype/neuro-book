/**
 * 产物页的外壳与评审板页面之间的消息（t23）。合同见 docs/panel.md 的“页面里作答”。
 *
 * 页面是会话写的，它的脚本能伪造任何一条“页面发来的”消息，所以页面只能改草稿：外壳校验来源与取值后写进草稿，
 * 提交仍在外壳自己的侧栏里按。本文件只放类型：桥接脚本由服务端单独转译、不打包，不能从别的文件导入运行时的值。
 */

/** 页面里一道题要画成什么样。只给页面上有元素的题用；`ask` 登记的题页面上没有，外壳照样发，脚本找不到元素就不画。 */
export type BridgeQuestion = {
    id: string;
    type: "single" | "multi" | "text" | "confirm";
    label: string;
    options: Array<{value: string; label: string}>;
    required: boolean;
    recommend: string[];
    /** `pending` 待答（可以在页面里填）；`answered` 已答（页面里只读，改答在侧栏）。之前几版的、已关闭的题不发。 */
    state: "pending" | "answered";
    /** 草稿里的取值（没填或清空了是 `null`）：侧栏与页面里填的是同一份。 */
    value: unknown;
    /** 草稿里改过（侧栏或页面里），还没提交。 */
    changed: boolean;
    /** 已答的题给人看的答案文字。 */
    answerText: string | null;
};

/** 外壳发给页面的消息。 */
export type ShellMessage =
    | {type: "nbdev:state"; questions: BridgeQuestion[]; /** 不能答的原因（看的是旧版本、产物已关闭、主工作区不能写）；有值时页面里的控件只读 */ disabledReason: string | null}
    /** 侧栏里点了题目：把这道题滚进视口并闪一下。 */
    | {type: "nbdev:reveal"; id: string};

/** 页面发给外壳的消息。 */
export type PageMessage =
    /** 脚本载入了（每次页面载入、刷新都发一次），外壳回一份 `state`。 */
    | {type: "nbdev:ready"}
    /** 页面里改了一道题的取值；`null` 是清空。 */
    | {type: "nbdev:draft"; id: string; value: unknown};

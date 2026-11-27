/**
 * `TextConflictDialog` 的数据：一条要作者选的冲突。放在单独的模块里：宿主逻辑（`text-tab.ts`）也用它，而后端的类型检查看得到
 * 宿主逻辑的测试、看不懂 `.vue`。
 */

export type ConflictChoice = "mine" | "theirs" | "keep" | "drop";

export interface ConflictItem {
    readonly id: string;
    readonly kind: "changed" | "gone" | "locked" | "rerouted" | "manual";
    readonly mine: string | null;
    readonly theirs: string | null;
    /** `locked`、`rerouted`、`manual` 时的一句说明。 */
    readonly reason?: string;
    readonly choice: ConflictChoice | null;
}

/**
 * 引擎的输入与读取结果（docs/specs/canon/model.md）。整本重算的参照实现（reference.ts）与增量引擎实现同一个
 * `Engine` 接口，差分测试比较两者对同一份输入的全部读取结果，所以这里的结果类型必须是纯数据、可以逐字比较。
 */

import type {ComponentRegistry} from "../components/registry";
import type {ChapterOrder} from "../core/position";
import type {Address, Block, Check, Entry, ObjectRef, Decision, Placement, ReadPosition, StoryChange, Suggestion} from "../core/schema";

/** 内存里的世界：重放日志得到的五种对象，加上每个对象由哪个版本新建（排序键相同时的次序，model.md 输出 2）。 */
export interface WorldData {
    readonly version: number;
    readonly entries: ReadonlyMap<string, Entry>;
    readonly changes: ReadonlyMap<string, StoryChange>;
    readonly checks: ReadonlyMap<string, Check>;
    readonly decisions: ReadonlyMap<string, Decision>;
    readonly suggestions: ReadonlyMap<string, Suggestion>;
    readonly createdAt: ReadonlyMap<string, number>;
}

/** 语义档归纳的输入；宿主按它的摘要查归纳缓存（project.md 输出 12）。 */
export interface ReductionInput {
    readonly type: string;
    readonly field: string;
    readonly label: string;
    readonly kind: string;
    readonly unit?: string;
    readonly anchor: string | null;
    readonly events: readonly string[];
}

/** 查归纳缓存；没有返回 undefined。必须是纯函数：同一输入同一次计算里返回同一结果。 */
export type ReductionLookup = (input: ReductionInput) => string | undefined;

export interface EngineInputs {
    readonly world: WorldData;
    readonly order: ChapterOrder;
    readonly registry: ComponentRegistry;
    readonly reductions: ReductionLookup;
}

export type Mode = "actual" | "planned";

/** 一个补丁、一条变更套不上的原因（model.md 输出 7、失败与恢复）。 */
export type ApplyFailure = "entry-missing" | "element-missing" | "type-mismatch" | "unknown-value" | "constraint-violated" | "number-out-of-range";

export interface IncompleteMark {
    readonly change: string;
    readonly reason: ApplyFailure;
}

export interface FieldState {
    readonly value: unknown;
    readonly incomplete?: IncompleteMark;
    /** 语义档有事件、缓存里没有归纳（model.md 输出 9）。 */
    readonly notReduced?: true;
    /** 未归纳时的起点与之后事件的条数：带来的变化存这一份，不存拼起来的全文（revisions.md 输出 6）。 */
    readonly unreduced?: {readonly anchor: string | null; readonly events: number};
    /** 这个位置之前最近一次对这个地址的核对不符时，正文写的数（输出 11）。 */
    readonly textSays?: number;
}

export interface NamespaceView {
    readonly type: string;
    readonly version: number;
    /** 版本对不上或类型不在时只读（components.md 输出 11、12）。 */
    readonly readOnly?: "component-version-unsupported" | "component-unknown";
    readonly fields: Readonly<Record<string, FieldState>>;
}

/** 这个位置上还没启用、之后某条变更会启用的命名空间（components.md 输出 6）。 */
export interface UpcomingNamespace {
    readonly namespace: string;
    readonly from: Placement;
    readonly fields: Readonly<Record<string, unknown>>;
}

export interface EntryView {
    readonly id: string;
    readonly deleted: boolean;
    readonly appeared: boolean;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly summary: string;
    readonly text: readonly Block[];
    readonly namespaces: Readonly<Record<string, NamespaceView>>;
    readonly upcoming: readonly UpcomingNamespace[];
    readonly components: readonly string[];
}

export interface ChangeOutcome {
    readonly applied: boolean;
    readonly reason?: ApplyFailure;
    /** 套不上时是哪个补丁（下标）。 */
    readonly failedPatch?: number;
}

export type PlanProgress = "unfulfilled" | "fulfilled" | "cancelled" | "replaced";

export type OriginStep =
    | {readonly kind: "init"; readonly value: unknown; readonly basis?: unknown}
    | {readonly kind: "patch"; readonly change: string; readonly op: string; readonly result: unknown; readonly basis?: unknown}
    | {readonly kind: "check"; readonly check: string; readonly written: number; readonly result: "ok" | "mismatch" | "skipped" | "anchor"}
    | {readonly kind: "reduce"; readonly anchor: string | null; readonly events: readonly string[]; readonly cached: boolean};

export type PendingItem =
    | {readonly kind: "check-mismatch"; readonly check: string; readonly at: Address; readonly computed: number; readonly written: number; readonly suspects: readonly string[]}
    | {readonly kind: "cannot-apply"; readonly root: string; readonly changes: readonly string[]}
    | {readonly kind: "held"; readonly change: string; readonly reason: "conflict" | "unsure"}
    | {readonly kind: "chapter-deleted"; readonly ref: ObjectRef};

/** 引擎对外回答的问题；两种实现对同一输入的回答必须逐字相同。 */
export interface Engine {
    /** 读取位置指向不在章序里的章时返回 `chapter-not-found`。 */
    entry(id: string, position: ReadPosition, mode: Mode): EntryView | null | "chapter-not-found";
    origins(address: Address, position: ReadPosition, mode: Mode): readonly OriginStep[] | "chapter-not-found";
    outcome(change: string): ChangeOutcome | undefined;
    progress(plan: string, position: ReadPosition): PlanProgress | "chapter-not-found";
    pending(position: ReadPosition): readonly PendingItem[] | "chapter-not-found";
    /** 某一章涉及的条目（model.md 输出 20）。 */
    chapterEntries(chapter: string): readonly string[];
}

/**
 * 引擎的输入与读取结果（docs/specs/canon/model.md）。整本重算的参照实现（reference.ts）与增量引擎实现同一个
 * `Engine` 接口，差分测试比较两者对同一份输入的全部读取结果，所以这里的结果类型必须是纯数据、可以逐字比较。
 */

import type {ComponentRegistry} from "../components/registry";
import type {ChapterOrder, OrderTie, Rank} from "../core/position";
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
export type ApplyFailure = "entry-missing" | "element-missing" | "type-mismatch" | "unknown-value" | "constraint-violated" | "number-out-of-range" | "invalid-asset-path";

export interface IncompleteMark {
    readonly change: string;
    /** `carried-incomplete`：带过去的值在父线上不完整或在这条线上套不上（canon/worldlines.md 输出 6），`change` 是定义这条线的分叉。 */
    readonly reason: ApplyFailure | "carried-incomplete";
}

export interface FieldState {
    readonly value: unknown;
    /** 显示名与字段 id 不同时才有（components.md 输出 8）。 */
    readonly label?: string;
    readonly incomplete?: IncompleteMark;
    /** 语义档有事件、缓存里没有归纳（model.md 输出 9）。 */
    readonly notReduced?: true;
    /** 带语义档子字段的列表：还没归纳的是哪几个元素（元素的 id），没归纳的只是这几行（components.md 输出 20）。 */
    readonly notReducedElements?: readonly string[];
    /** 未归纳时的起点与之后事件的条数：带来的变化存这一份，不存拼起来的全文（revisions.md 输出 6）。 */
    readonly unreduced?: {readonly anchor: string | null; readonly events: number};
    /** 这个位置之前最近一次对这个地址的核对不符时，正文写的数（输出 11）。 */
    readonly textSays?: number;
    /** 最近一次定下这个字段的那一步（project.md 输出 32）；只在调用方要了的时候由世界服务补上，引擎不给。 */
    readonly changedAt?: ChangedAt;
}

/** 最近一次定下一个字段的值的那一步与它的安放：一条剧情变更，或给语义档起点的核对点。 */
export interface ChangedAt {
    readonly by: "change" | "check";
    readonly id: string;
    readonly at: Placement;
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
    /** 去掉过的模块（数据还在，可以加回来，components.md 输出 7）；没有时不写。 */
    readonly removedComponents?: readonly {readonly namespace: string; readonly type: string}[];
}

export interface ChangeOutcome {
    readonly applied: boolean;
    readonly reason?: ApplyFailure;
    /** 套不上时是哪个补丁（下标）。 */
    readonly failedPatch?: number;
}

/** 事件的排序键：先比安放的键，再比先后的打破（创建的版本、id）。 */
export interface EventKey {
    readonly rank: Rank;
    readonly tie: OrderTie;
}

export type PlanProgress = "unfulfilled" | "fulfilled" | "cancelled" | "replaced";

export type OriginStep =
    | {readonly kind: "init"; readonly value: unknown; readonly basis?: unknown}
    | {readonly kind: "patch"; readonly change: string; readonly op: string; readonly result: unknown; readonly basis?: unknown}
    | {readonly kind: "check"; readonly check: string; readonly written: number; readonly result: "ok" | "mismatch" | "skipped" | "anchor"}
    | {readonly kind: "reduce"; readonly anchor: string | null; readonly events: readonly string[]; readonly cached: boolean}
    /** 从父线带过来（canon/worldlines.md 输出 6）：只由线层给出，引擎给的是这个合成事件的 `patch` 一步。 */
    | {readonly kind: "carried"; readonly fork: string; readonly line: string; readonly change: string; readonly value: unknown; readonly key: EventKey | null};

/**
 * 来历的一页（project.md 方法表 `origins`、model.md 输出 37）：`steps` 从最近一步往前，跳过 `offset` 步以后最多 `limit` 步；
 * `total` 是初值与归纳以外的步数；初值与归纳两步在页外，没有时为 null。
 */
export interface OriginsPage {
    readonly steps: readonly OriginStep[];
    readonly total: number;
    readonly initial: OriginStep | null;
    readonly reduced: OriginStep | null;
}

export type PendingItem =
    | {readonly kind: "check-mismatch"; readonly check: string; readonly at: Address; readonly computed: number; readonly written: number; readonly suspects: readonly string[]}
    | {readonly kind: "cannot-apply"; readonly root: string; readonly changes: readonly string[]}
    | {readonly kind: "held"; readonly change: string; readonly reason: "conflict" | "unsure"}
    | {readonly kind: "chapter-deleted"; readonly ref: ObjectRef};

/**
 * 一个地址在某一刻的原始状态，带过去的值用（canon/worldlines.md 输出 6）：值（语义档是起点，不是拼起来的文字）、这个地址下面每个
 * 语义档路径在起点之后的事件、是否不完整。
 */
export interface CarrySlot {
    readonly value: unknown;
    readonly events: Readonly<Record<string, readonly string[]>>;
    readonly incomplete: boolean;
}

/** 最近一次定下一个字段的值的那一步（project.md 输出 32）：一条套上了的剧情变更，或给语义档起点的核对点。 */
export type TouchedBy = {readonly kind: "patch"; readonly change: string} | {readonly kind: "check"; readonly check: string};

/** 引擎对外回答的问题；两种实现对同一输入的回答必须逐字相同。 */
export interface Engine {
    /** 读取位置指向不在章序里的章时返回 `chapter-not-found`。 */
    entry(id: string, position: ReadPosition, mode: Mode): EntryView | null | "chapter-not-found";
    origins(address: Address, position: ReadPosition, mode: Mode): readonly OriginStep[] | "chapter-not-found";
    /** `origins` 的一页（口径与先后相同）：常出场的数值字段有几千步，界面一次只看一页，不必为一页算出整条。 */
    originsPage(address: Address, position: ReadPosition, mode: Mode, offset: number, limit: number): OriginsPage | "chapter-not-found";
    /**
     * 这个位置之前，这个条目的每个字段（键见 `fieldPath`）最近一次是被谁定下的；只由初值给出的字段不在结果里。与来历同一个口径：
     * 整条变更套上了、补丁碰到这个字段（含元素与子字段）就算；精确档的核对点不改值，不算。只看事件、不复制值，所以比取来历便宜得多。
     */
    lastTouched(entry: string, position: ReadPosition, mode: Mode): Readonly<Record<string, TouchedBy>> | "chapter-not-found";
    outcome(change: string): ChangeOutcome | undefined;
    progress(plan: string, position: ReadPosition): PlanProgress | "chapter-not-found";
    /**
     * 一条剧情变更在这个模式的事件序列里的排序键（安放的键加先后的打破），与计算用的先后相同：按计划模式时已写章上的
     * 计划按“章序加 0.5”。不进这个模式的事件（实际模式下的计划、待定与撤销的、未排章的）为 null。插件按它比较两件事的先后。
     */
    eventKey(change: string, mode: Mode): EventKey | null;
    /** 按计划模式在这个位置计入的计划 id，按先后排（model.md 输出 5；在场的按计划模式读取用它，输出 29）。 */
    plannedAt(position: ReadPosition): readonly string[] | "chapter-not-found";
    /** 待处理（model.md 输出 16）；按计划模式时核对点、套不上与嫌疑区间都算上这个位置计入的计划。缺省实际模式。 */
    pending(position: ReadPosition, mode?: Mode): readonly PendingItem[] | "chapter-not-found";
    /**
     * 某一章涉及的条目（model.md 输出 20）。按计划模式时再并上安放在这一章、这条线上看得到的生效计划的涉及条目、参与者与补丁地址
     * （未写的章只有计划时，“涉及本章”靠它；Spec 的补充）。缺省实际模式。
     */
    chapterEntries(chapter: string, mode?: Mode): readonly string[];
    /**
     * 实际模式下，安放的全序不晚于这条变更（含它自己；与它在不在事件序列里无关）的那一刻，这个地址的原始状态。变更不存在或没有
     * 安放、条目不在（或已删除）时为 null。
     */
    slotAfter(change: string, at: Address): CarrySlot | null;
    /** 实际模式下，同一个全序点上（含这条变更自己）一个地址的来历，含那一刻的归纳步（worldlines 输出 6 的“接着看父线上的来历”）；变更不存在或没有安放时为 null。 */
    originsAfter(change: string, at: Address): readonly OriginStep[] | null;
}

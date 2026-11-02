/**
 * 原型（不合并）：作者视角的世界引擎内核的数据结构。对照已接受的提案 docs/proposals/world-engine-kernel.md 与
 * 2026-11-02 看静态稿后的决定。只有六种存下来的对象：条目、剧情变更（含计划）、核对点、修订、未决问题、正文建议；
 * 其余（某个位置上的状态、来历、诊断、待处理、计划进展、回执）都由引擎从它们算出来，不存。
 */

/* ---------- 标识 ---------- */

export type EntryId = string;
export type ChangeId = string;
export type CheckId = string;
export type RevisionId = string;
export type ChapterId = string;
export type QuestionId = string;
export type SuggestionId = string;

/** 谁写的。Agent 带会话，便于从改动记录跳回那段对话。 */
export type Actor = {kind: "author"} | {kind: "agent"; session: string};

/* ---------- 位置 ---------- */

/**
 * 一条记录放在故事的哪里（生效位置）。前史在第 1 章之前，按 `order` 排；章内按 `key`（排序键：写入时按讲述原句在本章的
 * 先后算一次，之后只由修订改变，改稿不移动它）；计划可以未排章。章的先后由活页夹给出。
 */
export type Placement =
    | {kind: "prehistory"; order: number}
    | {kind: "chapter"; chapter: ChapterId; key: number}
    | {kind: "unscheduled"};

/** 读的位置：初值（前史之前），或某一章的开头、末尾。第 1 章开头 = 前史都发生过以后。 */
export type ReadPosition = {kind: "initial"} | {kind: "chapter"; chapter: ChapterId; edge: "start" | "end"};

/** 实际（只用已写的）还是按计划（再加上排到这里的未兑现计划）。 */
export type ReadMode = "actual" | "planned";

/* ---------- 地址与值 ---------- */

/**
 * 补丁、核对点、MDX 里的字段引用、来历共用的地址。`path` 的根是 `entry`（名字、别名、一句话）、某个 Component 的
 * 命名空间、或 `text`（主 MDX 的块）：`entry.name`、`panel.存款`、`character.外观`、`text.b2`。
 */
export interface Address {
    entry: EntryId;
    path: string;
}

/** `null` 是“未知”（缺口 1：种子开局时还没有的数）。列表元素带稳定 id。 */
export type Value = number | string | boolean | null | ListItem[];
export interface ListItem {
    id: string;
    label: string;
    since?: ChapterId;
}

/* ---------- 条目 ---------- */

/** 条目在某个位置上的样子。条目存的是它的初值；某个位置上的样子由引擎算。 */
export interface EntryState {
    name: string;
    aliases: string[];
    summary: string;
    /** 主 MDX，按块存，块 id 稳定。 */
    text: Array<{id: string; source: string}>;
    /** 每个带数据的 Component 一块；`enabled` 是保留的控制字段。 */
    data: Record<string, {enabled: boolean; fields: Record<string, Value>}>;
}

export interface Entry {
    id: EntryId;
    /** 新建时选的类型预设，只决定默认带哪些 Component 和图标。 */
    type: "人物" | "身份" | "组织" | "地点" | "物品" | "概念" | "剧情线";
    /** 条目树：挂在哪个条目或文件夹下面，只用来整理。 */
    parent: EntryId | null;
    folder: string;
    order: number;
    /** 身份同一：马甲指向本体。决定“是谁”的是它，不是条目树的位置。 */
    sameAs?: EntryId;
    /** 出场：早于它的位置上，作者看到“尚未出场”，Agent 查不到。 */
    appears?: Placement;
    init: EntryState;
    /** 初值里数的依据（缺口 1）：作者填的，或记账时按正文第一次出现的数定、标估计。没写的按作者填的算。 */
    initBasis?: Record<string, Basis>;
}

/* ---------- Component 类型 ---------- */

export interface FieldDef {
    id: string;
    label: string;
    kind: "number" | "text" | "enum" | "list";
    unit?: string;
    min?: number;
    /** 上限可以是另一个字段。 */
    max?: number | {field: string};
    options?: string[];
    /** 会在正文里重述的文字字段（外观、性格）：改设定以后要去正文里找旧写法（提案第 8 节“改设定以后”）。 */
    retold?: boolean;
}

export interface ComponentType {
    ns: string;
    label: string;
    version: number;
    fields: FieldDef[];
}

/* ---------- 剧情变更（情节与计划） ---------- */

/** 讲述：这件事在哪里讲到，即出处。正文存“章加原句”，不存段号。 */
export interface Telling {
    source: "chapter" | "outline" | "seed" | "message" | "ui";
    chapter?: ChapterId;
    quote: string;
}

/** 一个数的依据（提案第 5 节“写入时校验”）。 */
export type Basis =
    | {kind: "quote"; quote: string}
    | {kind: "derived"; check: CheckId}
    | {kind: "estimate"; note: string}
    | {kind: "author"};

export interface Patch {
    op: "set" | "add" | "listAdd" | "listRemove" | "replaceBlock" | "enable";
    at: Address;
    value: Value;
    basis?: Basis;
}

export type Link =
    | {kind: "fulfills"; plan: ChangeId}
    | {kind: "replaces"; plan: ChangeId}
    | {kind: "splitFrom"; plan: ChangeId};

/**
 * 故事里发生的一件事，也就是一条情节；计划是还没写的情节（`kind: "plan"`）。经历、剧情表、条目的情节 Tab 都是它的视图。
 * `status` 只由修订改变：生效、待定（作者处理前不生效）、已撤销。这次重算套没套上是诊断，不存在这里。
 */
export interface StoryChange {
    id: ChangeId;
    kind: "written" | "plan";
    text: string;
    at: Placement;
    told: Telling[];
    involves: EntryId[];
    /** 剧情线，指向类型为“剧情线”的条目。 */
    lines: EntryId[];
    links: Link[];
    patches: Patch[];
    status: "active" | "held" | "undone";
    /** 待定的原因：Agent 报的与设定冲突、没把握。作者处理以后清掉。 */
    held?: {reason: "conflict" | "unsure"; note: string; against?: Address};
    undoneReason?: string;
    by: Actor;
}

/* ---------- 核对点 ---------- */

/** 正文写明的一个数。独立于变更：挂靠的变更撤销了，它照样按讲述的位置比较。 */
export interface CheckPoint {
    id: CheckId;
    at: Address;
    value: number;
    told: Telling;
    place: Placement;
}

/* ---------- 未决问题、正文建议 ---------- */

/** 作者还没想好的事。可以挂在任何对象上（缺口 4），可以一直挂着；Agent 不替作者答，只能提示“正文里可能有答案”。 */
export interface OpenQuestion {
    id: QuestionId;
    text: string;
    /** 作者的原话（种子、细纲里的那句）。 */
    quote?: string;
    about: {kind: "entry"; id: EntryId} | {kind: "change"; id: ChangeId} | {kind: "field"; at: Address};
    status: "open" | "answered" | "dropped";
    answer?: string;
    /** 记账时 Agent 发现正文里可能是答案的句子（缺口 2）。 */
    hints: Array<{chapter: ChapterId; quote: string}>;
}

/** 改设定以后，正文或别的条目里的旧写法。只给建议，不自动改。 */
export interface Suggestion {
    id: SuggestionId;
    /** 哪一次改设定引起的。 */
    cause: RevisionId;
    target: {kind: "chapter"; chapter: ChapterId} | {kind: "outline"; chapter: ChapterId} | {kind: "entryText"; entry: EntryId; block: string};
    group: string;
    before: string;
    after: string | null;
    reason: string;
    judgment: "sure" | "ask" | "notThisOne";
    status: "open" | "applied" | "declined";
}

/* ---------- 章节（文件层，不属于世界模型） ---------- */

/** 章节正文与细纲是文件，历史归 nb-history；这里只为原型带上，记账要读。 */
export interface Chapter {
    id: ChapterId;
    title: string;
    outline: string;
    text: string;
}

/* ---------- 修订 ---------- */

export type ObjectKind = "entry" | "change" | "check" | "question" | "suggestion";
export interface ObjectRef {
    kind: ObjectKind;
    id: string;
}

/** 修订里的一个操作：一个对象改前与改后的整份值。`before: null` 是新建，`after: null` 是删除。 */
export interface Op {
    ref: ObjectRef;
    before: unknown;
    after: unknown;
}

/**
 * 每一次写入都是一次修订：作者保存、Agent 的一次写入、一章的记账、还原。原子发布，世界的版本加一。
 * 回执就是一次修订的详情页，不另存；回执上那些从 ops 看不出来的，由写入者附在 `notes` 里。
 */
export interface Revision {
    id: RevisionId;
    version: number;
    by: Actor;
    what: "opening" | "bookkeeping" | "plan" | "edit" | "creative" | "resolve" | "suggest" | "revert";
    title: string;
    chapter?: ChapterId;
    ops: Op[];
    notes?: {notCreated?: string[]};
    /** 还原时指向被还原的那次。 */
    reverts?: RevisionId;
}

/* ---------- 世界 ---------- */

export interface World {
    version: number;
    componentTypes: ComponentType[];
    chapters: Chapter[];
    entries: Record<EntryId, Entry>;
    changes: Record<ChangeId, StoryChange>;
    checks: Record<CheckId, CheckPoint>;
    questions: Record<QuestionId, OpenQuestion>;
    suggestions: Record<SuggestionId, Suggestion>;
    revisions: Revision[];
}

/* ---------- 算出来的（不存） ---------- */

/** 来历里的一步：这个值在哪里、被哪条记录、怎样改成了什么。 */
export interface OriginStep {
    where: string;
    change?: ChangeId;
    check?: CheckId;
    kind: "init" | "set" | "add" | "check";
    delta?: number;
    result: Value;
    basis?: Basis;
    ok?: boolean;
}

/** 重算时发现的问题。不存，前面修好了就自己消失。 */
export type Diagnostic =
    | {kind: "checkMismatch"; check: CheckId; computed: number; suspects: ChangeId[]}
    | {kind: "cannotApply"; change: ChangeId; why: string};

export interface FoldedEntry {
    state: EntryState;
    origins: Record<string, OriginStep[]>;
    appeared: boolean;
}

export interface Folded {
    position: ReadPosition;
    mode: ReadMode;
    entries: Record<EntryId, FoldedEntry>;
    diagnostics: Diagnostic[];
}

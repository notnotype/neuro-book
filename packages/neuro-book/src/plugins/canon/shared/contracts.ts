/**
 * `nbook.canon` 对外的合同：世界服务的远程合同、浏览器侧的服务键、贡献点与预算（docs/specs/canon/project.md 的方法表、
 * 事件与输出 18）。
 *
 * - 世界的语义在 `@notnotype/nb-canon` 的 `WorldService`；远程合同只是把它的方法搬到链路上。读取结果与写入结果的形状
 *   由 nb-canon 的类型给出，链路上不再逐字段核对（`Type.Unknown()`）：提供方就是这份代码，输入才是要核对的边界。
 * - 业务失败都以一个业务失败码 `canon` 返回，详情是 nb-canon 的失败对象（`{code, ...}`）：失败码有几十个，其中
 *   `too-large` 等与路由层的码同名，不能逐个声明成业务失败码。
 */

import {RPC_MAX_MESSAGE_BYTES} from "@notnotype/nb-host/socket";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {ActorSchema, AddressSchema, AuthorizationSchema, EntryEditsSchema, ObjectRefSchema, ReadPositionSchema, WriteRequestSchema} from "@notnotype/nb-canon/schema";
import type {CanonReadView, ChapterItem, ComponentType, DecisionView, EditRoute, FieldDeclaration, OriginStep, Placement, TreeItem, TreeItemAt, DiagnosticCompute, EntryView, NeededAuthorization, ObjectRef, PendingPage, ReadPosition, ReadStamp, Revision, StoryChange, Suggestion, TellingItem, TextBlocksRead, ViewDenial, ViewedReads, ViewGrant, WriteRequest} from "@notnotype/nb-canon/schema";
import {Type} from "typebox";
import type {Static} from "typebox";

import type {CanonReads} from "./reads";

export {CANON_COMPONENTS_POINT, CANON_DIAGNOSTICS_POINT, CANON_MARKS_POINT, PERSON_COMPONENT} from "./components";
// 作者界面的两个贡献点（author-ui.md 输出 12、36）：别的插件交界面时从这里取 id（跨插件只引对方的 shared/contracts.ts）。
export {CANON_COMPONENT_VIEWS_POINT} from "./component-views";
export type {ComponentViewDeclaration} from "./component-views";
export {CANON_ENTRY_TABS_POINT} from "./entry-tabs";
// 条目种类的贡献点（author-ui.md 输入一节）：别的插件给一个种类追加默认的设定组时用。
export {CANON_ENTRY_KINDS_POINT, ENTRY_KINDS} from "./entry-kinds";
export type {EntryKindDeclaration} from "./entry-kinds";

/** 打开一个条目的条目页（canon/author-ui.md 的命令表）；别的插件的界面点名字时执行它。 */
export const OPEN_ENTRY_COMMAND = "nbook.canon.open-entry";
export type {EntryTabDeclaration} from "./entry-tabs";
export type {ComponentContribution} from "./components";
// 主线的 id 与剧情线选项：剧情插件的页面按它们写“在哪条线”。
export {MAIN_LINE} from "./reads";
export type {LineOption} from "./reads";

/** 请求与读取结果经 JSON 编码后的上限：远程消息上限减 64 KiB，留给帧包络（输出 18）。 */
export const CANON_BUDGET_BYTES = RPC_MAX_MESSAGE_BYTES - 64 * 1024;

/**
 * `renderSource` 一次肯渲染的源文字长度（canon.rendering 输出 16），按 `String.length` 算（UTF-16 码元，基本平面以外的字算
 * 两个）。两条理由，都用内核真实的渲染量过（5 万字符）：
 *
 * - 结果要放得进一次读取的预算（`CANON_BUDGET_BYTES`，960 KiB）：渲染结果每个字符占 3 到 16 字节，最费的是一句一段的短
 *   段落，5 万字符约 780 KiB。
 * - 项目进程渲染时做不了别的，而预览是作者每停顿一下就读一次：带字段的正文约 0.16 秒，满篇都是字段的约 0.4 秒，长段落
 *   的纯文字约 0.03 秒。
 *
 * 只管长度，不管结构：一个字一段这类极端的写法，不到这个长度结果就超预算，照 `too-large` 回。
 */
export const RENDER_SOURCE_MAX = 50_000;

/** 远程调用原样的结果：业务失败的码是 `canon`、详情是 nb-canon 的失败对象；别的码是路由层的失败。 */
export type RemoteRaw = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown; readonly cause?: unknown};

/** 远程结果换回 `CanonResult`：业务失败换回 nb-canon 的失败对象，路由层的失败给出原码、说明与原因。浏览器与服务端的调用方共用。 */
export function fromRemote<T>(result: RemoteRaw): CanonResult<T> {
    if (result.ok) return {ok: true, value: result.value as T};
    if (result.code === "canon") return {ok: false, failure: result.detail as CanonFailure};
    return {ok: false, failure: {code: result.code, ...(result.detail === undefined ? {} : {detail: result.detail}), ...(result.cause === undefined ? {} : {cause: result.cause})}};
}

/** 经 JSON 编码后的 UTF-8 字节数；浏览器发出前、世界服务回结果前用同一个算法。 */
export function encodedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

const Mode = Type.Union([Type.Literal("actual"), Type.Literal("planned")]);
const Token = Type.Optional(Type.String());
const Cursor = Type.Optional(Type.String());
const Limit = Type.Optional(Type.Integer({minimum: 1, maximum: 500}));
const Read = Type.Object({value: Type.Unknown(), version: Type.Integer()});
/**
 * 视图令牌（输出 24）：带了它，`entry`、`render`、`lookup`、`presence`、`changes`、`tellings` 只看得到上限之前的；
 * 别的方法带它一律 `view-denied`。所以每个方法都收这一项，由实现按方法表决定。
 */
const View = Type.Optional(Type.String());
/** 按历法写的日期（canon.time 输入表的 `date`，只含日期本身）。 */
const DatePartsSchema = Type.Object({era: Type.Optional(Type.String()), year: Type.Integer(), month: Type.Optional(Type.String()), day: Type.Optional(Type.Integer()), period: Type.Optional(Type.String()), hour: Type.Optional(Type.Integer()), minute: Type.Optional(Type.Integer())}, {additionalProperties: false});
const TimeQuerySchema = Type.Union([
    Type.Object({kind: Type.Literal("event"), change: Type.String()}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("chapter"), chapter: Type.String()}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("during"), from: DatePartsSchema, to: DatePartsSchema}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("between"), a: Type.String(), b: Type.String()}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("age"), who: Type.String(), at: Type.String()}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("browse"), era: Type.Optional(Type.String({minLength: 1})), year: Type.Optional(Type.Integer()), month: Type.Optional(Type.Integer({minimum: 0}))}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("calendar")}, {additionalProperties: false}),
]);
const ChapterRange = {from: Type.Optional(Type.String()), to: Type.Optional(Type.String())};
const TellingPositionSchema = Type.Union([
    Type.Object({chapter: Type.String(), paragraph: Type.Integer({minimum: 1})}),
    Type.Object({chapter: Type.String(), edge: Type.Union([Type.Literal("start"), Type.Literal("end")])}),
]);
const Out = Type.Unknown();
/** 就地改、记一笔、语义档的记一笔的输入；写入与它们的预览（`previewEdit`）共用，两边的字段才不会各写各的。 */
const EditFields = {
    requestId: Type.String({minLength: 1}),
    by: ActorSchema,
    position: ReadPositionSchema,
    at: AddressSchema,
    value: Type.Unknown(),
    read: Read,
    intent: Type.Optional(Type.Union([Type.Literal("creative"), Type.Literal("story")])),
    title: Type.Optional(Type.String()),
};
const DeltaFields = {requestId: Type.String({minLength: 1}), by: ActorSchema, position: ReadPositionSchema, at: AddressSchema, delta: Type.Number(), reason: Type.String(), read: Read};
const NoteFields = {requestId: Type.String({minLength: 1}), by: ActorSchema, position: ReadPositionSchema, at: AddressSchema, text: Type.String({minLength: 1}), read: Read};

/** 失败的详情：nb-canon 的失败对象。 */
const FailureSchema = Type.Object({code: Type.String()});
const errors = {canon: FailureSchema};

const methods = {
    status: {input: Type.Object({}), output: Out, effect: "read", errors},
    /** 带视图令牌时 `position` 可以不写，读到上限为止。 */
    entry: {input: Type.Object({id: Type.String(), position: Type.Optional(ReadPositionSchema), mode: Mode, withOrigins: Type.Optional(Type.Boolean()), withChangedAt: Type.Optional(Type.Boolean()), view: View}), output: Out, effect: "read", errors},
    /** 主文字的每一块能怎么改（canon.project 的 `textBlocks`）；只按实际模式读，不收视图令牌（作者界面按块编辑用）。 */
    textBlocks: {input: Type.Object({id: Type.String(), position: Type.Optional(ReadPositionSchema)}), output: Out, effect: "read", errors},
    /** 给了 `position` 时每项另带这个位置上的名字、出场与本体（输出 30）；`mode` 缺省实际模式。 */
    tree: {input: Type.Object({parent: Type.Union([Type.String(), Type.Null()]), position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode), cursor: Cursor, limit: Limit, view: View}), output: Out, effect: "read", errors},
    /** 一个地址的来历的一页，从最近一步往前（canon.model 输出 37）；带视图令牌拒。 */
    origins: {input: Type.Object({at: AddressSchema, position: Type.Optional(ReadPositionSchema), mode: Mode, cursor: Cursor, limit: Limit, view: View}), output: Out, effect: "read", errors},
    lookup: {input: Type.Object({names: Type.Array(Type.String(), {maxItems: 200}), position: Type.Optional(ReadPositionSchema), view: View}), output: Out, effect: "read", errors},
    /**
     * 按名字或别名的片段找条目（project.md 的 `findEntries`）：引用的选择器与 Agent 查名字的兜底用。带视图令牌一律拒（防剧透的
     * 视图下不让枚举名字）。
     */
    findEntries: {
        input: Type.Object({query: Type.String({maxLength: 200}), kinds: Type.Optional(Type.Array(Type.String(), {maxItems: 50})), types: Type.Optional(Type.Array(Type.String(), {maxItems: 50})), position: Type.Optional(ReadPositionSchema), cursor: Cursor, limit: Limit, view: View}),
        output: Out,
        effect: "read",
        errors,
    },
    changes: {
        input: Type.Object({
            filter: Type.Optional(Type.Object({
                chapter: Type.Optional(Type.String()),
                entry: Type.Optional(Type.String()),
                line: Type.Optional(Type.String()),
                kind: Type.Optional(Type.Union([Type.Literal("written"), Type.Literal("plan")])),
                status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("held"), Type.Literal("undone")])),
                nature: Type.Optional(Type.Union([Type.Literal("event"), Type.Literal("narration")])),
                progress: Type.Optional(Type.Union([Type.Literal("unfulfilled"), Type.Literal("fulfilled"), Type.Literal("cancelled"), Type.Literal("replaced")])),
                /** 安放在哪条世界线；只列某条线视图里的；安放的范围（变更 id，`after` 不含、`through` 含）；套没套上按哪条线算（缺省当前线）。 */
                placedOn: Type.Optional(Type.String()),
                inView: Type.Optional(Type.String()),
                range: Type.Optional(Type.Object({after: Type.Optional(Type.String()), through: Type.Optional(Type.String())}, {additionalProperties: false})),
                worldline: Type.Optional(Type.String()),
                /** 只列安放在这个读取位置之前的；`desc` 从新到旧（project.md 输出 31）。 */
                before: Type.Optional(Type.Object({position: ReadPositionSchema, mode: Mode}, {additionalProperties: false})),
                order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
            }, {additionalProperties: false})),
            cursor: Cursor,
            limit: Limit,
            view: View,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    tellings: {
        input: Type.Object({
            filter: Type.Optional(Type.Object({...ChapterRange, entry: Type.Optional(Type.String()), effective: Type.Optional(Type.Boolean()), until: Type.Optional(TellingPositionSchema), mark: Type.Optional(Type.String())}, {additionalProperties: false})),
            cursor: Cursor,
            limit: Limit,
            view: View,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    /** 时间的查询（canon.time 输出 8）：带视图令牌时只用上限之前的事（输出 15）；一段时间里的事分页。 */
    time: {
        input: Type.Object({query: TimeQuerySchema, mode: Type.Optional(Mode), line: Type.Optional(Type.String()), cursor: Cursor, limit: Limit, view: View}),
        output: Out,
        effect: "read",
        errors,
    },
    presence: {
        input: Type.Object({person: Type.String(), filter: Type.Optional(Type.Object({...ChapterRange, mode: Type.Optional(Mode), line: Type.Optional(Type.String())}, {additionalProperties: false})), cursor: Cursor, limit: Limit, view: View}),
        output: Out,
        effect: "read",
        errors,
    },
    object: {input: Type.Object({ref: ObjectRefSchema, view: View}), output: Out, effect: "read", errors},
    /** 世界线的树（canon.project 方法表 `lines`）：每条线的定义、两种模式下存不存在、能不能建、是否已建。 */
    lines: {input: Type.Object({}), output: Out, effect: "read", errors},
    pending: {input: Type.Object({position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode), group: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("hints"), Type.Literal("handled")])), cursor: Cursor, limit: Limit, view: View}), output: Out, effect: "read", errors},
    decisions: {
        input: Type.Object({
            status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("decided"), Type.Literal("superseded"), Type.Literal("dropped")])),
            about: Type.Optional(Type.Union([ObjectRefSchema, Type.Object({kind: Type.Literal("chapter"), id: Type.String()})])),
            cursor: Cursor,
            limit: Limit,
            view: View,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    suggestions: {input: Type.Object({status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("applied"), Type.Literal("declined")])), cursor: Cursor, limit: Limit, view: View}), output: Out, effect: "read", errors},
    revisions: {
        input: Type.Object({
            filter: Type.Optional(Type.Object({
                chapter: Type.Optional(Type.String()),
                entry: Type.Optional(Type.String()),
                by: Type.Optional(Type.Union([Type.Literal("author"), Type.Literal("agent"), Type.Literal("task"), Type.Literal("system")])),
            }, {additionalProperties: false})),
            cursor: Cursor,
            limit: Limit,
            view: View,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    /** 一次修订的全部（project.md 输出 29）；带视图令牌拒。 */
    revision: {input: Type.Object({id: Type.String(), view: View}), output: Out, effect: "read", errors},
    /** 章表（输出 28）；带视图令牌时只到位置上限所在的章。 */
    chapters: {input: Type.Object({view: View}), output: Out, effect: "read", errors},
    /** 登记的 Component 类型与字段声明（canon.components 输出 21）；带不带视图令牌一样。 */
    components: {input: Type.Object({view: View}), output: Out, effect: "read", errors},
    render: {input: Type.Object({entry: Type.String(), position: Type.Optional(ReadPositionSchema), mode: Mode, audience: Type.Union([Type.Literal("author"), Type.Literal("agent")]), view: View}), output: Out, effect: "read", errors},
    /**
     * 把一段没提交的源文字当作条目的主文字渲染给作者（canon.rendering 输出 16）；不收视图令牌（作者界面的预览用）。`source`
     * 超过 `RENDER_SOURCE_MAX` 时回 `too-large`，不渲染。
     */
    renderSource: {input: Type.Object({entry: Type.String(), source: Type.String(), position: Type.Optional(ReadPositionSchema), mode: Mode}), output: Out, effect: "read", errors},
    /** 预览写入请求，或还原请求（另给补偿要的作者授权，revisions.md 输出 5、21）。 */
    preview: {input: Type.Object({request: Type.Union([WriteRequestSchema, Type.Object({revert: Type.String(), withDependents: Type.Boolean(), requestId: Type.String({minLength: 1}), by: ActorSchema, title: Type.Optional(Type.String())})]), view: View}), output: Out, effect: "read", errors},
    outcome: {input: Type.Object({requestId: Type.String()}), output: Out, effect: "read", errors},
    publish: {input: Type.Object({request: WriteRequestSchema, token: Token, view: View}), output: Out, effect: "write", errors},
    editInPlace: {input: Type.Object({...EditFields, token: Token, view: View}), output: Out, effect: "write", errors},
    /**
     * 一次改几处（revisions.md 输出 25）与它的预览。合同只加了方法、版本不升：老页签只调老方法照常能用，新页面与服务端出自同一份
     * 构建（升了版本老页签只显示“世界已断开”，没有刷新的出路）。
     */
    editEntries: {input: Type.Object({input: EntryEditsSchema, token: Token, view: View}), output: Out, effect: "write", errors},
    previewEntries: {input: Type.Object({input: EntryEditsSchema, view: View}), output: Out, effect: "read", errors},
    recordDelta: {input: Type.Object({...DeltaFields, token: Token, view: View}), output: Out, effect: "write", errors},
    /** 语义档的记一笔（revisions.md 输出 23）：`text` 是这条变更的文字，也是给这个字段的事件。 */
    recordNote: {
        input: Type.Object({...NoteFields, token: Token, view: View}),
        output: Out,
        effect: "write",
        errors,
    },
    /** 就地改、记一笔、语义档的记一笔的预览（revisions.md 输出 22）：`input` 是三种入口之一的输入，`kind` 写明是哪一种。 */
    previewEdit: {
        input: Type.Object({
            input: Type.Union([
                Type.Object({kind: Type.Literal("edit"), ...EditFields}, {additionalProperties: false}),
                Type.Object({kind: Type.Literal("delta"), ...DeltaFields}, {additionalProperties: false}),
                Type.Object({kind: Type.Literal("note"), ...NoteFields}, {additionalProperties: false}),
            ]),
            view: View,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    revert: {input: Type.Object({revision: Type.String(), withDependents: Type.Boolean(), requestId: Type.String({minLength: 1}), by: ActorSchema, title: Type.Optional(Type.String()), authorizations: Type.Optional(Type.Array(AuthorizationSchema)), token: Token, view: View}), output: Out, effect: "write", errors},
    /** 视图（输出 24）：令牌的寿命不超过申请它的调用方实例。 */
    openView: {input: Type.Object({viewer: Type.Union([Type.String(), Type.Null()]), line: Type.String(), until: ReadPositionSchema, purpose: Type.String()}), output: Out, effect: "read", errors},
    closeView: {input: Type.Object({token: Type.String()}), output: Type.Null(), effect: "read", errors},
    viewAudit: {input: Type.Object({viewer: Type.Optional(Type.Union([Type.String(), Type.Null()])), cursor: Cursor, limit: Limit}), output: Out, effect: "read", errors},
    acquireExclusive: {input: Type.Object({label: Type.String({minLength: 1})}), output: Out, effect: "write", errors},
    renewExclusive: {input: Type.Object({token: Type.String()}), output: Out, effect: "write", errors},
    releaseExclusive: {input: Type.Object({token: Type.String()}), output: Type.Null(), effect: "write", errors},
    breakExclusive: {input: Type.Object({}), output: Type.Null(), effect: "write", errors},
} as const;

const events = {
    changed: {filter: Type.Object({}), payload: Out},
    exclusive: {filter: Type.Object({}), payload: Type.Object({holder: Type.Union([Type.String(), Type.Null()])})},
    reduced: {filter: Type.Object({}), payload: Type.Object({})},
    /** 宿主通知某一章（或全部）的正文变了，版本不变（输出 25）。 */
    textChanged: {filter: Type.Object({}), payload: Type.Object({chapter: Type.Optional(Type.String())})},
    /** 章表或登记的类型变了，版本不变（输出 34）。 */
    inputChanged: {filter: Type.Object({}), payload: Type.Object({what: Type.Union([Type.Literal("chapters"), Type.Literal("components"), Type.Literal("diagnostics"), Type.Literal("marks")])})},
    /**
     * 独占的租约订阅（输出 10）：申请到令牌的调用方订阅它；订阅结束（连接断开、调用方实例失效、退订）即结束独占。
     * 推一次 `held`，独占结束时推 `ended`。
     */
    lease: {filter: Type.Object({token: Type.String()}), payload: Type.Object({state: Type.Union([Type.Literal("held"), Type.Literal("ended")])})},
} as const;

/** 项目实例提供；浏览器、TUI 与服务端都能调。 */
// 版本 2：作者的渲染从语法树换成源文加值表，删掉 `writeBack`（w00055 t02）。
export const canonWorldContract = defineRemoteService({id: "nbook.canon/world", version: 2, provider: "project", callers: ["browser", "tui", "server"], methods, events});

export type CanonMethod = keyof typeof methods;
export type CanonInput<M extends CanonMethod> = Static<(typeof methods)[M]["input"]>;

/** nb-canon 的失败对象，或链路上的失败（`code` 是路由层的失败码，`detail` 是说明）。 */
export interface CanonFailure {
    readonly code: string;
    readonly [detail: string]: unknown;
}

export type CanonResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly failure: CanonFailure};

/** 写入成功的结果（输出：`publish`）。 */
export interface Published {
    readonly revision: string;
    readonly version: number;
    readonly ids: Readonly<Record<string, string>>;
    readonly repeated: boolean;
    /** 就地改与记一笔：之后的记录里还有同一地址的改动（revisions.md 输出 8）。 */
    readonly laterRecords?: readonly string[];
}

export interface CanonStatus {
    readonly version: number;
    /** 正文快照与整份读取输入的摘要（model.md 输出 36）。 */
    readonly textDigest: string;
    readonly inputDigest: string;
    readonly state: "writable" | "read-only" | "stopped";
    readonly reason?: string;
    readonly exclusive: {readonly label: string; readonly since: number} | null;
    readonly diagnostics: readonly unknown[];
    readonly recomputed: unknown;
    readonly work: unknown;
    /** 最近几次插件诊断的计算耗时（project.md 输出 26）。 */
    readonly diagnosticTimings: readonly {readonly diagnostic: string; readonly ms: number; readonly slow?: true}[];
    /** 当前打开的视图数。 */
    readonly openViews: number;
    /** 世界线的诊断（project.md 输出 26）：已建的线与是否常驻、最近一次发布更新了哪些线与原因。 */
    readonly lines: {
        readonly built: readonly {readonly line: string; readonly resident: boolean}[];
        readonly updated: readonly {readonly line: string; readonly reasons: readonly ("records" | "carry" | "entries" | "structural" | "built")[]}[];
    };
}

/** 一个条目的 id 与它在读取位置上的名字。 */
export interface EntryName {
    readonly id: string;
    readonly name: string;
}

/** 来历的一步（canon.model 输出 37）：剧情变更的一步带安放与文字，核对点的一步带安放。 */
export type OriginItem = Exclude<OriginStep, {kind: "init"} | {kind: "reduce"}> & {readonly at?: Placement; readonly text?: string};

/** 一次修订能不能还原（revisions.md 输出 14）：章序调整不能；有后面的修订依赖它时列出它们。 */
export type Revertable = {readonly ok: true} | {readonly ok: false; readonly reason: "not-revertable"} | {readonly ok: false; readonly reason: "has-dependents"; readonly dependents: readonly string[]};

/** `findEntries` 找到的一个条目：名字按读取位置；只按别名命中时给出是哪个别名。 */
export interface FoundEntry {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly parent: string | null;
    /** 读取位置上已经出场。 */
    readonly appeared: boolean;
    readonly matchedAlias?: string;
}

export interface Page<T> {
    readonly version: number;
    readonly items: readonly T[];
    readonly cursor?: string;
}

/** 各方法成功时的值；形状与 nb-canon 的 `WorldService` 相同，只是写入结果去掉了内存里的世界。 */
export interface CanonOutputs {
    readonly status: CanonStatus;
    /** 条目存在时另带上级链（从最上面一级到直接上级）、本体与分组（输出 33）；带视图令牌读时没有这三项。 */
    readonly entry: {readonly version: number; readonly view: EntryView | null; readonly origins?: Readonly<Record<string, unknown>>; readonly ancestors?: readonly EntryName[]; readonly sameAs?: EntryName | null; readonly folder?: string; readonly kind?: string; readonly declarations?: Readonly<Record<string, readonly FieldDeclaration[]>>; readonly removedFields?: Readonly<Record<string, readonly {readonly id: string; readonly label: string}[]>>};
    /** 条目不存在或已删除为 null；`inputDigest` 与 `version` 合起来就是写入时带的读取戳，`at` 是解析后的位置（写明线）。 */
    readonly textBlocks: ({readonly version: number; readonly inputDigest: string} & TextBlocksRead) | null;
    /** 给了位置时每项是 `TreeItemAt`；`remaining` 是这一层在这一页之后还会列出几项。 */
    readonly tree: Page<TreeItem & Partial<Pick<TreeItemAt, "nameAt" | "appeared" | "sameAs">>> & {readonly remaining: number};
    /** 来历的一页：`items` 从最近一步往前；`initial` 与 `reduced` 是页外的初值与归纳两步。 */
    readonly origins: Page<OriginItem> & {readonly total: number; readonly initial: Extract<OriginStep, {kind: "init"}> | null; readonly reduced: Extract<OriginStep, {kind: "reduce"}> | null};
    readonly lookup: {readonly version: number; readonly found: Readonly<Record<string, readonly string[]>>};
    readonly findEntries: Page<FoundEntry> & {readonly total: number};
    /** `total` 是符合筛选的总条数（输出 31）。 */
    readonly changes: Page<{readonly change: StoryChange; readonly outcome: unknown; readonly placedOn: string}> & {readonly total: number};
    readonly tellings: Page<TellingItem>;
    /** 时间的回答（形状见 nb-canon 的 time/queries.ts）；一段时间里的事分页时带游标。 */
    readonly time: {readonly version: number; readonly inputDigest: string; readonly answer: Readonly<Record<string, unknown>>; readonly cursor?: string};
    readonly presence: Page<{readonly change: StoryChange}> & {readonly uncast: number};
    readonly pending: PendingPage;
    readonly decisions: Page<DecisionView>;
    readonly suggestions: Page<Suggestion>;
    readonly revisions: Page<{readonly id: string; readonly version: number; readonly by: Revision["by"]; readonly what: string; readonly title: string; readonly time: string; readonly chapter?: string; readonly impact: Revision["impact"]; readonly revertable: Revertable}>;
    /** 一次修订的全部；没有这次修订时 `revision` 是 null，也没有 `revertable`。 */
    readonly revision: {readonly version: number; readonly revision: Revision | null; readonly revertable?: Revertable};
    readonly chapters: ReadStamp & {readonly items: readonly ChapterItem[]};
    readonly components: ReadStamp & {readonly items: readonly ComponentType[]};
    /**
     * 按块的渲染（canon.rendering 输出 7、8）：给作者的每块是源文加值表（`AuthorBlock`），给 Agent 的是带值写法的文字（`AgentBlock`）。
     * 合同版本 2 起不再给语法树。
     */
    readonly render: {readonly version: number; readonly position: ReadPosition; readonly mode: "actual" | "planned"; readonly blocks: readonly unknown[]} | null;
    /** 同 `render` 给作者的形状，`blocks` 只有一块（id 为 `source`）。 */
    readonly renderSource: {readonly version: number; readonly position: ReadPosition; readonly mode: "actual" | "planned"; readonly blocks: readonly unknown[]} | null;
    /** 存下来的对象；不存在时 `object` 为 null。 */
    readonly object: {readonly version: number; readonly object: unknown};
    readonly lines: {readonly version: number; readonly lines: readonly {readonly id: string; readonly name: string; readonly parent: string; readonly fork: string; readonly type: string; readonly who?: string; readonly cut: string; readonly trigger?: string; readonly exists: {readonly actual: boolean; readonly planned: boolean}; readonly unbuildable: string | null; readonly built: boolean; readonly resident: boolean}[]};
    /** 写入请求的预览；还原请求的预览另给需要的作者授权（宿主照它签发）。 */
    readonly preview: {
        readonly revision: Revision;
        readonly ids: Readonly<Record<string, string>>;
        readonly needed?: readonly NeededAuthorization[];
        /** 改了世界线的结构时的波及面（canon.worldlines 输出 10）。 */
        readonly blast?: {
            readonly outOfBounds: readonly {readonly line: string; readonly ref: {readonly kind: string; readonly id: string}}[];
            readonly plans: readonly {readonly plan: string; readonly line: string; readonly visible: boolean}[];
            readonly progress: readonly {readonly line: string; readonly plan: string; readonly before: string | null; readonly after: string | null}[];
            readonly chapters: readonly string[];
        };
    };
    readonly outcome: {readonly published: true; readonly revision: string; readonly version: number} | {readonly published: false};
    readonly publish: Published;
    readonly editInPlace: Published;
    readonly recordDelta: Published;
    readonly recordNote: Published;
    readonly editEntries: Published & {readonly routes: readonly EditRoute[]};
    readonly previewEntries: {readonly routes: readonly EditRoute[]; readonly revision: Revision; readonly ids: Readonly<Record<string, string>>; readonly laterRecords: readonly string[]};
    /** 预览：这次会写回哪里、预览的修订（操作与带来的变化）、后面改过同一地址的记录。 */
    readonly previewEdit: {readonly route: EditRoute; readonly revision: Revision; readonly ids: Readonly<Record<string, string>>; readonly laterRecords: readonly string[]};
    readonly revert: Published;
    readonly acquireExclusive: {readonly token: string; readonly expires: number};
    readonly renewExclusive: {readonly expires: number};
    readonly releaseExclusive: null;
    readonly breakExclusive: null;
    readonly openView: {readonly token: string};
    readonly closeView: null;
    readonly viewAudit: Page<ViewDenial>;
}

export type CanonEvent =
    | {readonly kind: "changed"; readonly version: number; readonly revision: string; readonly by: Revision["by"]; readonly what: string; readonly title: string}
    | {readonly kind: "exclusive"; readonly holder: string | null}
    | {readonly kind: "reduced"}
    | {readonly kind: "textChanged"; readonly chapter?: string}
    /** 章表、登记的类型、插件诊断的登记或标注种类变了，世界版本没动：重读依赖它们的读取（输出 34）。 */
    | {readonly kind: "inputChanged"; readonly what: "chapters" | "components" | "diagnostics" | "marks"}
    /** 同一项目代次内重连后订阅已重建：中间可能漏了事件，先读一次 `status` 拿当前版本再重读（Spec project“时序与寿命”）。 */
    | {readonly kind: "resync"}
    /** 订阅被提供方结束（项目实例停止、链路关闭）；之后不再有事件。调用方自己 `release` 时不发。 */
    | {readonly kind: "ended"; readonly reason: string};

/** 持有中的独占写入（`hold` 的结果）。 */
export interface CanonLease {
    readonly token: string;
    /** 申请时的到期时间（毫秒时间戳）；带令牌的写入与 `renew` 都把它往后推 60 秒。 */
    readonly expires: number;
    renew(): Promise<CanonResult<{readonly expires: number}>>;
    /** 退订租约并释放独占。 */
    release(): Promise<CanonResult<null>>;
}

/**
 * 浏览器入口按调用方提供的世界客户端。请求超过预算时不发出，直接得到 `too-large`（输出 18）。
 * `hold` 申请独占并持有租约订阅：独占结束（释放、到期、被强行解除、订阅被提供方结束）时调一次 `onEnded`；
 * 连接断开时独占随订阅结束。经 `call("acquireExclusive")` 申请的独占没有租约订阅，只靠 60 秒到期结束。
 */
export interface CanonClient {
    call<M extends CanonMethod>(method: M, input: CanonInput<M>): Promise<CanonResult<CanonOutputs[M]>>;
    publish(request: WriteRequest, token?: string): Promise<CanonResult<Published>>;
    subscribe(listener: (event: CanonEvent) => void): Promise<CanonResult<{release(): void}>>;
    hold(label: string, onEnded?: (reason: string) => void): Promise<CanonResult<CanonLease>>;
}

export const canonClientKey: ServiceKey<CanonClient> = defineServiceKey<CanonClient>("nbook.canon/client");

/**
 * 窗口的读取层（docs/specs/canon/author-ui.md 输出 35）：canon 的浏览器入口按调用方提供，别的浏览器入口经它读世界、把自己的远程
 * 读取挂进同一份读取层。接口与状态的形状在 `./reads`。
 */
export const canonReadsKey: ServiceKey<CanonReads> = defineServiceKey<CanonReads>("nbook.canon/reads");

/**
 * canon 给项目里别的插件的项目内服务（docs/specs/canon/model.md “诊断的计算”、project.md 输出 24）：按调用方提供。
 *
 * - 诊断：登记自己在 `canon.diagnostics` 声明过的诊断的计算，报告数据版本；登记记在调用方的插件名下，一个插件登记不了
 *   别的插件的诊断。
 * - 快照：只读世界、带视图令牌的读取与戳，建在同一份世界与正文快照上；只在拿到它的同步段里用（中间不 `await`）。
 * - 视图：调用方开的视图记在它名下，调用方的入口停止时一起关掉。内核的视图令牌只在项目进程里流转，不要交给远程调用方：
 *   拿着它直接调 canon 就绕过了插件在视图之上的过滤。
 */
export interface CanonSnapshot {
    readonly view: CanonReadView;
    readonly viewed: (token: string) => ViewedReads;
    readonly stamp: ReadStamp;
}

export interface CanonProject {
    /** 登记计算（按诊断 id）与数据版本。再登记一次替换上一次的。世界还没打开时先记下，打开后接上。 */
    register(registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}): void;
    /** 插件的数据变了：之后的读取按新数据算。 */
    reportDataVersion(dataVersion: string): void;
    /** 当前这份世界的快照；世界打不开时是失败。 */
    snapshot(): Promise<CanonSnapshot | {readonly code: "world-locked" | "stopping"}>;
    openView(grant: ViewGrant): Promise<{readonly token: string} | {readonly code: string}>;
    closeView(token: string): Promise<void>;
    /** 在一张视图之上又挡掉了什么（换成占位）：记进内核的视图审计。 */
    audit(token: string, entry: {readonly method: string; readonly blocked?: readonly ObjectRef[]; readonly position?: ReadPosition}): Promise<void>;
    /** 建在视图之上的一层拒了一次读取（例如视角句柄已经关了）：记一条拒绝；看的人与用途不知道时为 null 与空串。 */
    deny(who: {readonly viewer: string | null; readonly purpose: string}, method: string): Promise<void>;
}

export const canonProjectKey: ServiceKey<CanonProject> = defineServiceKey<CanonProject>("nbook.canon/project");

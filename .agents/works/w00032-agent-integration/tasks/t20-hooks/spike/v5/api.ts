/**
 * 第五版的扩展与 Profile 接口：只有类型与声明，没有实现，用来让例子过 tsc，检验 API 的形状。
 * 五位设计者（evidences/api-design-*.txt）的意见按提案“第五版：五位设计者的意见与取舍”一节汇总。
 *
 * 相对第四版（../v4/api.ts）的主要变化：
 * - 跨扩展引用改用对象：插件导出契约（defineContract），使用方写进 dependsOn，事件名与 read 的类型都从对象推出；
 *   不再有 ExtensionEvents、ExtensionExports 两张全局登记表，也没有“先拆常量再登记”。
 * - 片的作用域进类型（slice.path、slice.session）；reduce 改为“事件名 → 同作用域片的补丁”，挂错作用域是编译错误。
 * - 外部事实经 mount（每个会话装上时调用，返回清理函数）写入；去掉 sessionOpened 与 dispose。
 * - 设置、Profile 的 initial、输入的 payload 都用 TypeBox schema 声明。
 * - render 只剩一个：扩展只能渲染自己的 conv 事件，Profile 能覆盖任何 conv 事件；去掉 renderAll。
 * - remind 字段取代 reminder()；continue 只在 assistant 的处理函数里有，带文字与上限。
 * - Profile 有 system + layout（缺省布局）或整张 prompt 两种写法；opening、commit 的声明式写法；deriveProfile。
 * - 日志字段机器可读：toolResult.status、assistant.request 与内容块、Rejection 码、结构化的块来源。
 */

import type {Static, TObject, TSchema} from "typebox";

// ====================================================================
// 1. 基础数据
// ====================================================================

export type Scope = "path" | "session";

export interface UserInput<P = unknown> {
    text: string;
    payload?: P;
    attachments?: readonly {kind: "image" | "file"; uri: string}[];
}

/** 拒绝或失败的说明：只有码与参数，没有句子；界面按“拥有者 + 码”取本地化文案（ADR 0034）。 */
export interface Rejection {
    code: string;
    params?: Readonly<Record<string, string | number | boolean>>;
}
/** 内核补上拒绝者（拦截器所属的扩展 id）。 */
export interface Attributed extends Rejection {
    by: string;
}

export interface ToolCall {
    id: string;
    name: string;
    args: Readonly<Record<string, unknown>>;
}
/** 工具的声明里给扩展看的部分：effect 让“挡住所有会写的工具”不必写死名字（t04 定完整形状）。 */
export interface ToolInfo {
    name: string;
    effect: "read" | "write" | "exec";
}
/** 工具调用的结局。blocked：拦截没有调用 next；unknown：发出了但不知道有没有执行（崩溃恢复、中止）。 */
export type ToolStatus = "ok" | "error" | "denied" | "blocked" | "unknown";

/** 回复的内容块：思考块连同服务商要求带回的签名一起存，工具调用循环里原样送回。 */
export type ContentBlock = {kind: "text"; text: string} | {kind: "thinking"; text: string; signature?: string};

/** 模型请求的用途：路由、用量这类拦截按它区别对待（不该把压缩请求降级到便宜的模型）。 */
export type RequestPurpose = "turn" | "compaction" | "background";

/** 扩展可能出错的入口。 */
export type EntryPoint = "reduce" | "on" | "mount" | "contribute" | "render" | "remind" | "intercept.input" | "intercept.model" | "intercept.tool" | "intercept.compaction" | "prompt" | "turn" | "commit" | "opening";
export type FailureCode = "threw" | "timeout" | "invalid-output" | "emit-after-settle" | "revoked" | "aborted";

// ====================================================================
// 2. 事件
// ====================================================================

/** 事件的声明：作用域、种类与数据；只用于类型推断。 */
export interface EventSpec<S extends Scope, K extends "conv" | "ext" | "ctrl", D> {
    readonly scope: S;
    readonly kind: K;
    readonly version: number;
    readonly _data?: D;
}
type AnyEventSpec = EventSpec<Scope, "conv" | "ext" | "ctrl", any>;
export type EventsDecl = Record<string, AnyEventSpec>;

/** 对话事件：进当前这一轮，永远在 path 上。内核在写入时盖上位置（附带内容、某一步之后、等下一轮）。 */
export declare function conv<D = {text: string}>(options?: {version?: number}): EventSpec<"path", "conv", D>;
/** 扩展事件：不变成消息，只给扩展归约。外部世界的事实（文件被改、库结构变了）用 ext.session：回退对话不改变世界。 */
export declare const ext: {
    <D = void>(options?: {version?: number}): EventSpec<"path", "ext", D>;
    session<D = void>(options?: {version?: number}): EventSpec<"session", "ext", D>;
};

type K<S extends Scope, Kd extends "conv" | "ctrl", D> = EventSpec<S, Kd, D>;

/** 内核事件。conv 的进对话；ctrl 的只给扩展看，不变成消息。 */
export interface KernelEvents {
    sessionCreated: K<"path", "ctrl", {initial: unknown}>;
    inputQueued: K<"session", "ctrl", {id: string; input: UserInput; mode: "steer" | "followup"}>;
    inputEdited: K<"session", "ctrl", {id: string; input: UserInput}>;
    inputRemoved: K<"session", "ctrl", {id: string}>;
    /** 与 turnStarted、input（或 steer）在同一个写入批里写，崩溃不会丢掉用户的话。 */
    inputConsumed: K<"session", "ctrl", {id: string; rejected?: Attributed}>;
    runStarted: K<"path", "ctrl", {runId: string; kind: "chat" | "compact"}>;
    runEnded: K<"path", "ctrl", {runId: string; reason: "completed" | "input-rejected" | "error" | "interrupted" | "aborted"}>;
    /** 没有新输入的“继续”运行，inputId 为 null。每轮一次的提醒挂在这里，“继续”运行也收得到。 */
    turnStarted: K<"path", "ctrl", {turnId: string; inputId: string | null}>;
    turnEnded: K<"path", "ctrl", {turnId: string; reason: "completed" | "error" | "interrupted" | "aborted"}>;
    /** 开新一轮的用户的话。redacted 时 original 只记哈希。 */
    input: K<"path", "conv", {text: string; payload?: unknown; queued: string; original?: string; originalHash?: string}>;
    /** 运行中途插进当前这一轮的用户的话。 */
    steer: K<"path", "conv", {text: string; payload?: unknown; queued: string; original?: string; originalHash?: string}>;
    /** request 与 modelStarted、流式增量的 request 对得上。 */
    assistant: K<"path", "conv", {request: number; content: ContentBlock[]; text: string; toolCalls: ToolCall[]; model: string; usage: {input: number; output: number}}>;
    /** ctx.continue 写的“接着做”：内核按这一轮、这个扩展数次数。 */
    continued: K<"path", "conv", {text: string; by: string; count: number}>;
    modelStarted: K<"path", "ctrl", {request: number; purpose: RequestPurpose; hash: string; now: number; invocation: string; modifiedBy: {extension: string; fields: string[]}[]}>;
    modelFailed: K<"path", "ctrl", {request: number; kind: "overflow" | "quota" | "auth" | "network" | "provider" | "aborted"; partial?: string}>;
    toolStarted: K<"path", "ctrl", {callId: string; tool: string; args: Readonly<Record<string, unknown>>; invocation: string}>;
    /** details 给程序看、不进请求；redacted 时 raw 只记哈希。 */
    toolResult: K<"path", "conv", {callId: string; tool: string; text: string; status: ToolStatus; by?: string; details?: unknown; args?: unknown; raw?: string; rawHash?: string}>;
    /** 等用户：提问与审批（t06 定完整形状，这里先占位）。 */
    asked: K<"path", "ctrl", {callId: string; question: string; options?: string[]}>;
    answered: K<"path", "ctrl", {callId: string; answer: string}>;
    approvalRequested: K<"path", "ctrl", {callId: string; tool: string; reason: Rejection}>;
    approvalResolved: K<"path", "ctrl", {callId: string; approved: boolean}>;
    /** 设置按扩展分开；只派发给设置所属的扩展，patch 的类型是自己的设置（见 SettingsChanged）。 */
    settingsChanged: K<"session", "ctrl", {extension: string; patch: Readonly<Record<string, unknown>>}>;
    /**
     * 压缩：半开区间，firstKeptEntryId 自身及其后的保留；它是一轮的 turnStarted，或进行中这一轮里某一步的 assistant。
     * 放回的内容（最近读过的文件、计划、Skill）与压缩事件在同一个写入批里，带 restoreBatch。
     */
    compaction: K<"path", "ctrl", {method: string; firstKeptEntryId: string | null; replacement: string | null; omitted: {entryId: string; placeholder: string}[]; restoreBatch: string; tokensBefore: number; tokensAfter: number; details?: unknown}>;
    leafChanged: K<"session", "ctrl", {leaf: string | null}>;
    profileChanged: K<"session", "ctrl", {profile: string; extensions: string[]; hash: string; reason: "user" | "plugin-added" | "plugin-removed" | "plugin-updated"}>;
    /** 改变了结果的扩展失败（输出被丢弃、拦截被跳过、工具被缺省拒绝）：重放不跑处理函数，所以要记在日志里。 */
    extensionFailed: K<"path", "ctrl", {extension: string; entry: EntryPoint; code: FailureCode; dropped?: {events: number; sets: number}}>;
    reactionLimit: K<"path", "ctrl", {root: string; dropped: string[]}>;
}
type KernelName = keyof KernelEvents & string;

/** 日志里的一条事件。type 是全名：内核事件是裸名，扩展事件是“扩展 id/事件名”。 */
export interface Event<T extends string = string, D = unknown> {
    id: string;
    seq: number;
    at: number;
    parent: string | null;
    scope: Scope;
    kind: "conv" | "ext" | "ctrl";
    type: T;
    version: number;
    /** 写它的扩展 id；内核写的是 "kernel"。 */
    source: string;
    cause?: string;
    depth?: number;
    /** 幂等键：同一来源同一个键只写一次。宿主命令的 commandId 就是它。 */
    key?: string;
    data: D;
}

// ====================================================================
// 3. 状态片
// ====================================================================

export interface Slice<S extends Scope, T> {
    readonly scope: S;
    readonly initial: T;
    readonly resetOnCompaction: boolean;
}
export type StateDecl = Record<string, Slice<Scope, any>>;
/**
 * 片：slice.path 跟着对话路径走，回退时跟着回去；slice.session 在树外。
 * resetOnCompaction：压缩时回到初值，用于“告诉过模型什么”这类片（压缩后摘要未必还记得）。
 */
export declare const slice: {
    path<T>(initial: T, options?: {resetOnCompaction?: boolean}): Slice<"path", T>;
    session<T>(initial: T): Slice<"session", T>;
};

export type DeepReadonly<T> = T extends (...args: any[]) => any ? T : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? {readonly [k in keyof T]: DeepReadonly<T[k]>} : T;
type SliceValue<S> = S extends Slice<Scope, infer T> ? T : never;
export type StateValues<S extends StateDecl> = {readonly [k in keyof S]: DeepReadonly<SliceValue<S[k]>>};
type SlicesIn<S extends StateDecl, Sc extends Scope> = {readonly [k in keyof S as S[k] extends Slice<Sc, any> ? k : never]: DeepReadonly<SliceValue<S[k]>>};
type PatchIn<S extends StateDecl, Sc extends Scope> = {[k in keyof S as S[k] extends Slice<Sc, any> ? k : never]?: SliceValue<S[k]>};

// ====================================================================
// 4. 契约：跨扩展引用用对象，不用全局登记
// ====================================================================

declare const ExportsBrand: unique symbol;
/** 别人能监听的事件与能读的导出。拥有者在 defineExtension 里写 contract；使用者写进 dependsOn。 */
export interface Contract<Id extends string = string, E extends EventsDecl = EventsDecl, X = unknown> {
    readonly id: Id;
    readonly events: E;
    readonly [ExportsBrand]?: X;
}
declare const OptionalBrand: unique symbol;
/** 可能没装的依赖：read 返回 undefined，监听它的事件照常（没装就不会来）。 */
export interface Optional<C extends Contract> {
    readonly contract: C;
    readonly [OptionalBrand]: true;
}
export type Dependency = Contract<string, any, any> | Optional<Contract<string, any, any>>;
export type DepList = readonly Dependency[];

/** 导出的形状只写类型：`shape<{pendingChanges: string[]}>()`。 */
export declare function shape<X>(): {readonly [ExportsBrand]?: X};
export declare function defineContract<const Id extends string, E extends EventsDecl = {}, X = {}>(id: Id, declaration: {events?: E; exports?: {readonly [ExportsBrand]?: X}}): Contract<Id, E, X>;
export declare function optional<C extends Contract<string, any, any>>(contract: C): Optional<C>;

type ContractOf<D> = D extends Optional<infer C> ? C : D;
type ExportsOfContract<C> = C extends {readonly [ExportsBrand]?: infer X} ? DeepReadonly<X> : never;
type ReadResult<D> = D extends Optional<infer C> ? ExportsOfContract<C> | undefined : ExportsOfContract<D>;

type Merge<U> = (U extends unknown ? (member: U) => void : never) extends (member: infer R) => void ? {[k in keyof R]: R[k]} : never;
/** 对联合逐个展开（D extends unknown 让它分配），否则几个依赖的事件名会交成空集。 */
type ForeignOne<D> = D extends unknown ? (ContractOf<D> extends Contract<infer Id, infer E, any> ? {[n in (keyof E & string) | "remind" as `${Id}/${n}`]: (E & Reserved)[n]} : never) : never;
type Foreign<Deps extends DepList> = Deps extends readonly [] ? {} : Merge<ForeignOne<Deps[number]>>;

// ====================================================================
// 5. 处理函数能挂的事件：内核与自己的事件用短名，依赖的用全名
// ====================================================================

/** 自己的事件不许与内核事件重名。 */
/**
 * 每个扩展都有的保留事件 remind：remind 字段写出的提醒（data.name 是提醒的名字）。
 * 自己的写短名 remind，依赖的写 `<id>/remind`；Profile 的 render、commit.omit 因此能按类型覆盖或丢掉别人的提醒。
 * 只有内核写它（emit 只认 events 里声明的），扩展没写 remind 字段时它永远不会出现（装配时对指向它的 render 写诊断）。
 */
export type RemindEvent = EventSpec<"path", "conv", {name: string; text: string}>;
type Reserved = {remind: RemindEvent};

/** 自己的事件不许与内核事件、保留事件重名。 */
export type NoKernelNames<E> = {[n in keyof E]: n extends KernelName | keyof Reserved ? "与内核事件或保留事件同名，换一个名字" : E[n]};

type Table<E extends EventsDecl, Deps extends DepList> = KernelEvents & Foreign<Deps> & E & Reserved;
type Name<E extends EventsDecl, Deps extends DepList> = keyof Table<E, Deps> & string;
type SpecOf<E extends EventsDecl, Deps extends DepList, N> = N extends keyof Table<E, Deps> ? Table<E, Deps>[N] : never;
/** 事件声明里的数据类型。 */
export type EventData<S> = S extends EventSpec<Scope, any, infer D> ? D : never;
type DataOfSpec<S> = EventData<S>;
type ScopeOfSpec<S> = S extends EventSpec<infer Sc, any, any> ? Sc : never;
type KindOfSpec<S> = S extends EventSpec<Scope, infer Kd, any> ? Kd : never;
export type EventOf<E extends EventsDecl, Deps extends DepList, N> = Event<string, DeepReadonly<DataOfSpec<SpecOf<E, Deps, N>>>>;
type ConvNames<E extends EventsDecl, Deps extends DepList> = {[n in Name<E, Deps>]: KindOfSpec<SpecOf<E, Deps, n>> extends "conv" ? n : never}[Name<E, Deps>];
type OwnConvNames<E extends EventsDecl> = {[n in keyof E & string]: KindOfSpec<E[n]> extends "conv" ? n : never}[keyof E & string] | keyof Reserved;

// ====================================================================
// 6. 各入口的上下文：越往后能力越多
// ====================================================================

export interface Resources {
    read(uri: string): Promise<string | undefined>;
    /** 规范化（去掉 ..、解析别名）：拦截里判断路径前先规范化。 */
    resolve(uri: string): string;
}
export interface ModelInfo {
    id: string;
    contextWindow: number;
    capabilities: {vision: boolean; thinking: boolean};
}
type CoreRead = typeof coreHistory;

/** 视图（contribute、prompt、system、turn、commit、remind）：全部只读，没有副作用的口子。 */
export interface ViewCtx<S extends StateDecl, St, Deps extends DepList, I = unknown> {
    readonly state: StateValues<S>;
    readonly settings: DeepReadonly<St>;
    /** 只能读 dependsOn 里写了的（与内置的 coreHistory）；可能没装的返回 undefined。 */
    read<D extends Deps[number] | CoreRead>(dependency: D): ReadResult<D>;
    readonly tools: readonly ToolInfo[];
    readonly model: ModelInfo;
    readonly now: number;
    /** 调用方给的初始输入（Profile 声明了 initial 时有类型）。 */
    readonly initial: DeepReadonly<I>;
}
type EmitArgs<D> = [D] extends [void] ? [options?: {key?: string}] : [data: D, options?: {key?: string}];
/**
 * 处理函数（on）：视图那些，加上写事件、改片、读资源、中止信号。
 * emit 与 set 先收集，处理函数的 Promise 完成时作为一个写入批写入；抛错或超时就都不写（写 extensionFailed，带丢弃的条数）；
 * 完成之后再调用（例如漏了 await 的回调里）是 emit-after-settle 错误，不写。同一片 set 多次取最后一次。
 * 处理函数里读到的 ctx.state 始终是这条事件之后的值，不含自己这次 set 的。
 */
export interface ReactCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I = unknown> extends ViewCtx<S, St, Deps, I> {
    emit<N extends keyof E & string>(name: N, ...args: EmitArgs<DataOfSpec<E[N]>>): void;
    set<k extends keyof S & string>(slice: k, value: SliceValue<S[k]>): void;
    readonly resources: Resources;
    readonly signal: AbortSignal;
}
/** 对 assistant 的处理函数多一个 continue：只在最终回复（没有工具调用）时有效，内核按这一轮、这个扩展数次数。 */
export interface AssistantCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I = unknown> extends ReactCtx<S, E, St, Deps, I> {
    /** 写一条 continued 事件并再请求一次；超过 max（缺省 3）返回 false，不写。 */
    continue(text: string, options?: {max?: number}): boolean;
}
/** 装上（mount）：会话打开、换 Profile 后新装上时调用；外部事实从这里进来。写入排进单写者队列，运行中到下一个边界。 */
export interface MountCtx<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList> extends Omit<ViewCtx<S, St, Deps>, "now" | "initial"> {
    emit<N extends keyof E & string>(name: N, ...args: EmitArgs<DataOfSpec<E[N]>>): void;
    set<k extends keyof S & string>(slice: k, value: SliceValue<S[k]>): void;
    readonly resources: Resources;
    /** 摘下时触发。 */
    readonly signal: AbortSignal;
    /** 包住外部回调：出错带扩展 id 写诊断，不成为没人接的 Promise 拒绝；摘下之后不再调用。 */
    callback<A extends unknown[]>(fn: (...args: A) => void | Promise<void>): (...args: A) => void;
}
/** 拦截：视图那些，加上读资源、中止信号；不写事件。phase 是 preview 时不要做有副作用的 I/O。 */
export interface InterceptCtx<S extends StateDecl, St, Deps extends DepList, I = unknown> extends ViewCtx<S, St, Deps, I> {
    readonly resources: Resources;
    readonly signal: AbortSignal;
    readonly phase: "run" | "preview";
    /** 这一层这次调用的 id，记进 modelStarted、toolStarted。 */
    readonly invocation: string;
}

// ====================================================================
// 7. 请求与对话的形状
// ====================================================================

/** 块的来源：预览、修改记录与诊断都按它定位，不解析字符串。 */
export type Origin =
    | {kind: "fixed"; by: "profile" | "kernel"}
    | {kind: "event"; eventId: string; type: string; extension: string}
    | {kind: "slot"; name: string; extension: string}
    | {kind: "summary"; compactionId: string}
    | {kind: "intercept"; extension: string};
export interface Block {
    readonly text: string;
    readonly origin: Origin;
    readonly kind?: "text" | "thinking" | "image";
}
export interface Message {
    readonly role: "user" | "assistant" | "tool";
    readonly content: readonly Block[];
    readonly toolCalls?: readonly ToolCall[];
    readonly callId?: string;
}
export interface ModelRequest {
    readonly purpose: RequestPurpose;
    readonly model: string;
    readonly params: {readonly maxTokens?: number; readonly temperature?: number};
    readonly headers: Readonly<Record<string, string>>;
    readonly system: readonly Block[];
    readonly messages: readonly Message[];
    readonly tools: readonly ToolInfo[];
}
export interface ModelResponse {
    readonly content: readonly ContentBlock[];
    readonly toolCalls?: readonly ToolCall[];
}
/** 工具拦截交回的结果。status 缺省 ok；没调 next 时内核记 blocked。redacted：日志里的 raw 只记哈希。 */
export interface ToolResult {
    readonly text: string;
    readonly status?: "ok" | "error" | "denied";
    readonly details?: unknown;
    readonly redacted?: boolean;
}

/** 一轮：一条输入、它的附带内容、ReAct 的各步。由 core.history 从日志归约（按内核盖的位置章）。 */
export interface Turn<P = unknown> {
    readonly id: string;
    readonly input: Event<"input", DeepReadonly<{text: string; payload: P}>> | null;
    readonly attachments: readonly Event[];
    readonly steps: readonly Step[];
    /** 进行中的轮是 running；提交时是它的结束原因。 */
    readonly status: "running" | "completed" | "error" | "interrupted" | "aborted";
}
export interface Step {
    readonly reply: Event<"assistant", DeepReadonly<DataOfSpec<KernelEvents["assistant"]>>>;
    readonly results: readonly Event<"toolResult", DeepReadonly<DataOfSpec<KernelEvents["toolResult"]>>>[];
    /** 这一步之后、下一次模型调用之前写入的对话事件：插话、对工具结果的提醒、continued。 */
    readonly after: readonly Event[];
}
/** 写 turn、commit 用的渲染工具：事件按 render 渲染成块，保留来源；全空的消息返回 null，由内核丢掉。 */
export interface Format {
    user(...parts: (Event | string | null | undefined | false)[]): Message | null;
    assistant(reply: Step["reply"]): Message;
    /** 只留回复的文字，去掉工具调用：用于只留最终回复的提交，不会留下没有结果的工具调用。 */
    assistantText(reply: Step["reply"]): Message | null;
    tool(result: Step["results"][number]): Message;
    step(step: Step): (Message | null)[];
    steps(steps: readonly Step[]): (Message | null)[];
    /** 缺省的一轮：附带内容在前、用户的话在最后，合成一条 user 消息；然后是各步。 */
    turn(turn: Turn<any>): (Message | null)[];
}

export interface CompactionJob {
    readonly method: string;
    readonly request: ModelRequest;
    readonly require: readonly string[];
}
export interface CompactionResult {
    readonly firstKeptEntryId: string | null;
    readonly replacement: string | null;
    readonly omitted?: readonly {entryId: string; placeholder: string}[];
    readonly details?: unknown;
}
export type CompactionMethod = "shake" | "inplace" | "summary" | (string & {});

// ====================================================================
// 8. 扩展
// ====================================================================

type SettingsSchema = TObject;
type SettingsOf<Sc> = Sc extends TSchema ? Static<Sc> : {};

type ReduceTable<S extends StateDecl, E extends EventsDecl, Deps extends DepList> = {
    [N in Name<E, Deps>]?: (event: EventOf<E, Deps, N>, state: SlicesIn<S, ScopeOfSpec<SpecOf<E, Deps, N>>>) => PatchIn<S, ScopeOfSpec<SpecOf<E, Deps, N>>> | undefined | void;
};
type OnTable<S extends StateDecl, E extends EventsDecl, St, Deps extends DepList, I> = {
    [N in Name<E, Deps>]?: (event: EventOf<E, Deps, N>, ctx: N extends "assistant" ? AssistantCtx<S, E, St, Deps, I> : ReactCtx<S, E, St, Deps, I>) => void | Promise<void>;
};
type Interceptors<S extends StateDecl, St, Deps extends DepList, I> = {
    input?(input: UserInput, next: (input: UserInput) => Promise<void>, ctx: InterceptCtx<S, St, Deps, I>): Promise<void | {reject: Rejection; redacted?: boolean}>;
    model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: InterceptCtx<S, St, Deps, I>): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: InterceptCtx<S, St, Deps, I>): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (job: CompactionJob) => Promise<CompactionResult>, ctx: InterceptCtx<S, St, Deps, I>): Promise<CompactionResult>;
};
/**
 * 提醒：值变了的那一轮、或每隔 every 轮，在这一轮开头写一条附带内容（`<id>/remind`）。
 * “告诉过模型什么”由内核记在 path 上，压缩时清空；回退跟着回去。text 返回 null 表示这次不提醒。
 * 写出的事件是保留事件 remind（见 RemindEvent）：自己的 render 写 `remind`，Profile 写 `<id>/remind`，按 event.data.name 区分是哪条提醒。
 */
export interface RemindSpec<S extends StateDecl, St, Deps extends DepList> {
    every?: number;
    watch?: (view: ViewCtx<S, St, Deps>) => unknown;
    text: (change: {value: unknown; previous: unknown; first: boolean; view: ViewCtx<S, St, Deps>}) => string | null;
}

export interface ExtensionFields<Id extends string, S extends StateDecl, E extends EventsDecl, Sc, X, Deps extends DepList> {
    /** 有契约的扩展写 contract，id 与事件从契约来；私有的写 id 与 events。 */
    id: Id;
    tags?: string[];
    /** 依赖：契约或扩展对象；决定装配顺序、能监听哪些别人的事件、能 read 谁。 */
    dependsOn?: Deps;
    /** 设置：TypeBox schema，缺省值写在 schema 里（每项都要有 default，装配时检查）。用户按 Profile 覆盖插件的缺省。 */
    settings?: Sc;
    state?: S;
    events?: E & NoKernelNames<E>;
    reduce?: ReduceTable<NoInfer<S>, NoInfer<E>, NoInfer<Deps>>;
    on?: OnTable<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, unknown>;
    mount?: (ctx: MountCtx<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>) => void | (() => void) | Promise<void | (() => void)>;
    exports?: X & {[name: string]: (state: StateValues<NoInfer<S>>, settings: DeepReadonly<SettingsOf<NoInfer<Sc>>>) => unknown};
    contribute?: {[slot: string]: {volatile?: boolean; shared?: boolean; value: (view: ViewCtx<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>) => string | null | undefined}};
    /** 自己的 conv 事件给模型看的文字。没写的缺省：{text} 取 text，其余包成 <system-reminder>。 */
    render?: {[N in OwnConvNames<NoInfer<E>>]?: (event: EventOf<NoInfer<E>, [], N>) => string | null};
    remind?: Record<string, RemindSpec<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>>;
    intercept?: Interceptors<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, unknown>;
    onFailure?: {tool?: "deny" | "ignore"};
    timeoutMs?: number;
}
declare const ExtensionBrand: unique symbol;
declare const StateBrand: unique symbol;
export interface Extension<Id extends string = string, E extends EventsDecl = any, X = any, S extends StateDecl = any> extends Contract<Id, E, X> {
    readonly [ExtensionBrand]: true;
    /** 只用于类型：测试工具按它给出 state(extension) 的类型。 */
    readonly [StateBrand]?: StateValues<S>;
}
/** 一个扩展各片的值的类型。 */
export type StateOfExtension<X> = X extends {readonly [StateBrand]?: infer V} ? NonNullable<V> : never;
export type AnyExtension = Extension<string, any, any>;

type ExportsTable<X, S extends StateDecl, Sc> = {[k in keyof X]: (state: StateValues<S>, settings: DeepReadonly<SettingsOf<Sc>>) => X[k]};
type ExportsReturn<Ex> = {[k in keyof Ex as string extends k ? never : k]: Ex[k] extends (...args: any[]) => infer R ? R : never};

/** 私有扩展：自己写 id 与 events。返回的对象本身也能当契约写进别人的 dependsOn。 */
export declare function defineExtension<const Id extends string, S extends StateDecl = {}, E extends EventsDecl = {}, Sc extends SettingsSchema | undefined = undefined, Ex = {}, const Deps extends DepList = []>(
    spec: ExtensionFields<Id, S, E, Sc, Ex, Deps>,
): Extension<Id, E, ExportsReturn<Ex>, S>;
/** 有契约的扩展：id 与事件从契约来，exports 要与契约里的形状一致。 */
export declare function implement<C extends Contract<string, any, any>, S extends StateDecl = {}, Sc extends SettingsSchema | undefined = undefined, const Deps extends DepList = []>(
    contract: C,
    spec: Omit<ExtensionFields<C["id"], S, C["events"], Sc, {}, Deps>, "id" | "events" | "exports"> & {exports: ExportsTable<ExportsOfContract<C>, NoInfer<S>, NoInfer<Sc>>},
): Extension<C["id"], C["events"], ExportsOfContract<C>, S>;

// ====================================================================
// 9. 内置：core.history 的契约（不写进 dependsOn 也能读）
// ====================================================================

export declare const coreHistory: Contract<"core.history", {}, {
    /** 进行中这一轮的输入；没有时为 null。 */
    input: {text: string; payload?: unknown} | null;
    current: Turn | null;
    /** 单调增加、不受压缩影响的计数：“每 8 轮”“每 16 次运行”不用自己数。 */
    turns: number;
    runs: number;
}>;

// ====================================================================
// 10. 模板
// ====================================================================

export interface Node {
    type: unknown;
    props: any;
    children: unknown[];
}
export type Child = Node | string | number | boolean | null | undefined | Child[];
export declare function h(type: any, props: any, ...children: Child[]): Node;
export declare function Fragment(p: {children?: Child}): Node;
/** 有子节点时是容器；自闭合的 <System /> 放 Profile 的 system。 */
export declare function System(p: {children?: Child}): Node;
export declare function User(p: {children?: Child}): Node;
export declare function Assistant(p: {children?: Child}): Node;
export declare function P(p: {children?: Child}): Node;
export declare function Tag(p: {name: string; attrs?: Record<string, string>; children?: Child}): Node;
export declare function If(p: {tool: string; children?: Child}): Node;
/** 压缩摘要与已提交的轮；last 只取最近几轮（窗口每轮滑动，历史缓存每轮失效，这是“只看最近几轮”本身的代价）。 */
export declare function History(p: {last?: number}): Node;
/** 进行中的这一轮，按 Profile 的 turn 渲染；模板里必须恰好一个。 */
export declare function Turn(p: {}): Node;
export declare function Slot(p: {name: string; stable?: boolean; volatile?: boolean}): Node;

// ====================================================================
// 11. Profile：自己就是最里层的扩展
// ====================================================================

type TurnFn<S extends StateDecl, St, Deps extends DepList, I, P> = (turn: Turn<P>, format: Format, view: ViewCtx<S, St, Deps, I>) => (Message | null)[];
type ProfileRender<E extends EventsDecl, Deps extends DepList> = {
    [N in ConvNames<E, Deps>]?: (event: EventOf<E, Deps, N>) => N extends "assistant" | "toolResult" ? string : string | null;
};
/** 提交的声明式写法：丢掉某些附带内容、换进历史时的文字、只留最终回复。写函数时完全自己定。 */
export interface CommitSpec<E extends EventsDecl, Deps extends DepList> {
    omit?: readonly Exclude<ConvNames<E, Deps>, "input" | "steer" | "assistant" | "toolResult">[];
    render?: ProfileRender<E, Deps>;
    steps?: "all" | "final";
}
/** 缺省布局的开关：会变的槽放末尾（缓存最好）还是 <Turn /> 前（用户的话在最后）；历史与开场。 */
export interface Layout {
    volatile?: "end" | "before-turn";
    history?: boolean | {last: number};
    opening?: boolean;
}
type OpeningPart = string | null | undefined | false;

interface ProfileBase<Id extends string, S extends StateDecl, E extends EventsDecl, Sc, Deps extends DepList, Si, Pa>
    extends Omit<ExtensionFields<Id, S, E, Sc, {}, Deps>, "tags" | "exports" | "render" | "on" | "intercept" | "contribute" | "remind"> {
    name: string;
    description: string;
    /** 调用方给的初始输入（agent.invoke 的参数）：内核按它校验，ctx.initial 有类型。 */
    initial?: Si;
    /** 输入带的结构化数据（例如选区）：turn.input.data.payload 有类型。 */
    payload?: Pa;
    modelNeeds?: {vision?: boolean; thinking?: boolean; minContext?: number};
    tools?: {required?: string[]; optional?: string[]};
    /** 插件经 agent.extensions 贡献的扩展：按标签排除，或一个都不要。 */
    pluginExtensions?: {exclude: string[]} | "none";
    /** 可复用的扩展（几个 Profile 共用的、别人写的）；只给这个 Profile 用的逻辑直接写在 Profile 上。 */
    extensions?: readonly AnyExtension[];
    on?: OnTable<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>;
    intercept?: Interceptors<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>;
    contribute?: {[slot: string]: {volatile?: boolean; shared?: boolean; value: (view: ViewCtx<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>) => string | null | undefined}};
    remind?: Record<string, RemindSpec<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>>>;
    /** 开场：会话创建时与每次压缩之后读一次，交给稳定的槽 opening（缺省布局放在历史前面）。 */
    opening?: (from: {initial: DeepReadonly<StaticOr<NoInfer<Si>>>; resources: Resources; read: ViewCtx<NoInfer<S>, {}, NoInfer<Deps>>["read"]; signal: AbortSignal}) => Promise<readonly OpeningPart[]> | readonly OpeningPart[];
    /** 一轮给模型看的样子；不写用 format.turn。进行中按它渲染，缺省也按它提交。 */
    turn?: TurnFn<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>, StaticOr<NoInfer<Pa>>>;
    /** 一轮结束后以什么样子进历史；不写与 turn 相同（缓存最好）。提交时就校验，不合格用缺省并写诊断。 */
    commit?: CommitSpec<NoInfer<E>, NoInfer<Deps>> | TurnFn<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>, StaticOr<NoInfer<Pa>>>;
    /** 任何 conv 事件给模型看的文字，覆盖扩展给的；回复与工具结果必须给出文字。优先级：commit.render、这里、扩展的 render。 */
    render?: ProfileRender<NoInfer<E>, NoInfer<Deps>>;
    /** 压缩（t11）：给方法的要求、两种情况的方法顺序；false 表示不压缩（单轮模板）。 */
    compaction?: {require?: string; onThreshold?: CompactionMethod[]; onOverflow?: CompactionMethod[]} | false;
}
type StaticOr<T> = T extends TSchema ? Static<T> : unknown;
type PromptFields<S extends StateDecl, St, Deps extends DepList, I> =
    | {system?: Child | ((view: ViewCtx<S, St, Deps, I>) => Child); layout?: Layout; prompt?: never}
    | {system?: Child | ((view: ViewCtx<S, St, Deps, I>) => Child); prompt: (view: ViewCtx<S, St, Deps, I>) => Child; layout?: never};

export type ProfileFields<Id extends string, S extends StateDecl, E extends EventsDecl, Sc, Deps extends DepList, Si, Pa> = ProfileBase<Id, S, E, Sc, Deps, Si, Pa> &
    PromptFields<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>;
declare const ProfileBrand: unique symbol;
export type Profile<Id extends string = string, E extends EventsDecl = any, S extends StateDecl = any> = Extension<Id, E, {}, S> & {readonly [ProfileBrand]: true; readonly name: string};

export declare function defineProfile<
    const Id extends string,
    S extends StateDecl = {},
    E extends EventsDecl = {},
    Sc extends SettingsSchema | undefined = undefined,
    const Deps extends DepList = [],
    Si extends TSchema | undefined = undefined,
    Pa extends TSchema | undefined = undefined,
>(spec: ProfileFields<Id, S, E, Sc, Deps, Si, Pa>): Profile<Id, E, S> & ProfileFields<Id, S, E, Sc, Deps, Si, Pa>;

/** 派生变体：必须给新 id；render、tools、extensions 逐项合并；只能改 Profile 级的字段，逻辑继承。 */
export declare function deriveProfile<const Id extends string, B extends Profile>(
    base: B,
    patch: {
        id: Id;
        name?: string;
        description?: string;
        render?: B extends {render?: infer R} ? R : never;
        commit?: B extends {commit?: infer C} ? C : never;
        turn?: B extends {turn?: infer T} ? T : never;
        layout?: Layout;
        tools?: {required?: string[]; optional?: string[]};
        extensions?: readonly AnyExtension[];
        compaction?: B extends {compaction?: infer Co} ? Co : never;
    },
): Omit<B, "id"> & {id: Id};

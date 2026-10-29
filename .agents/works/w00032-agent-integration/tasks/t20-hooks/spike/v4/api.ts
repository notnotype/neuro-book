/**
 * 第四稿的公开接口（2026-10-29 讨论后的修订版）：只有类型与声明，没有实现，用来让例子过 tsc，检验 API 的形状。
 *
 * 相对第三版 spike（../api.ts）：
 * - 输入缓冲区与指令；对话的形状是已提交的轮加进行中的这一轮；Profile 的 turn 与 commit；模板节点 <History> <Turn> <Slot>。
 * - 事件只有两类：conv 进这一轮、ext 不变成消息（去掉 prelude；开场改为“一片状态加一个稳定的槽”，见 opening()）。
 * - 事件名统一驼峰，日志里的类型名就是处理函数的键；去掉 K 与 is。用户的话分 input（开新一轮）与 steer（插话）。
 * - reduce 按“片 → 事件名 → 新值”写，react 改为按事件名挂处理函数的 on。
 * - ctx 按入口分档；emit、set、continue 直接调用，处理函数结束时一起写入。
 * - Profile 自己就是最里层的扩展，能写扩展的全部字段。
 */

// ---------- 事件 ----------

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}
export interface UserInput {
    text: string;
    payload?: unknown;
    attachments?: {kind: "image" | "file"; uri: string}[];
}

/** 内核事件：类型名 → data。作用域见提案“日志与作用域”。 */
export interface KernelEvents {
    sessionCreated: {initial: unknown};
    /** 不进日志，只交给处理函数。 */
    sessionOpened: {};
    inputQueued: {id: string; input: UserInput; mode: "steer" | "followup"};
    inputEdited: {id: string; input: UserInput};
    inputRemoved: {id: string};
    inputConsumed: {id: string; rejected?: string};
    runStarted: {kind: "chat" | "compact"};
    runEnded: {reason: "completed" | "input-rejected" | "error" | "interrupted" | "aborted"};
    turnStarted: {input: string | null};
    turnEnded: {reason: "completed" | "error" | "interrupted" | "aborted"};
    /** 开新一轮的用户的话。 */
    input: {text: string; payload?: unknown; original?: string; queued: string};
    /** 运行中途插进当前这一轮的用户的话。 */
    steer: {text: string; payload?: unknown; original?: string; queued: string};
    assistant: {text: string; toolCalls: ToolCall[]; model: string; usage: {input: number; output: number}};
    toolResult: {callId: string; tool: string; text: string; isError?: boolean; args?: unknown; raw?: string};
    modelStarted: {request: number; hash: string; now: number; modifiedBy: {extension: string; fields: string[]}[]};
    modelFailed: {request: number; kind: "overflow" | "quota" | "auth" | "network" | "provider" | "aborted"; message: string; partial?: string};
    toolStarted: {callId: string; tool: string};
    settingsChanged: {patch: Record<string, unknown>};
    /** firstKeptEntryId 是一轮的 turnStarted，或进行中这一轮里某一步的 assistant；omitted 是 shake 省略内容的条目。 */
    compaction: {method: string; firstKeptEntryId: string | null; replacement: string | null; omitted: string[]; tokensBefore: number; tokensAfter: number; details?: unknown};
    leafChanged: {leaf: string | null};
    profileChanged: {profile: string; extensions: string[]; hash: string};
    reactionLimit: {root: string; dropped: string[]};
}

/** 各插件要给别人监听的事件经声明合并登记在这里：全名 → data（见 EventsOf）。 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ExtensionEvents {}

export type Scope = "path" | "session";
export interface Event<T extends string = string, D = unknown> {
    id: string;
    seq: number;
    at: number;
    parent: string | null;
    scope: Scope;
    kind: "conv" | "ext" | "ctrl";
    type: T;
    v?: number;
    source: string;
    cause?: string;
    depth?: number;
    key?: string;
    data: D;
}

export interface EventSpec<D> {
    kind: "conv" | "ext";
    scope: Scope;
    v: number;
    _data?: D;
}
/** 对话事件：进当前这一轮（第一次模型调用之前写的是附带内容，某一步之后写的跟在那一步后面）。 */
export declare const conv: <D = {text: string}>(o?: {v?: number}) => EventSpec<D>;
/** 扩展事件：不变成消息，只给扩展归约。 */
export declare const ext: <D = {}>(o?: {v?: number; scope?: Scope}) => EventSpec<D>;
type DataOf<S> = S extends EventSpec<infer D> ? D : never;

/**
 * 登记别人能监听的事件：`interface ExtensionEvents extends EventsOf<"nbook.history", typeof historyEvents> {}`。
 * 事件要先单独定义成常量再登记；从扩展本身推导会让类型循环引用（扩展的处理函数又引用 ExtensionEvents）。
 */
export type EventsOf<Id extends string, E> = {[k in keyof E & string as `${Id}/${k}`]: DataOf<E[k]>};

// ---------- 状态片 ----------

export interface Slice<T> {
    scope: Scope;
    initial: T;
}
export declare const path: <T>(initial: T) => Slice<T>;
export declare const session: <T>(initial: T) => Slice<T>;
type ValueOf<S> = S extends Slice<infer T> ? T : never;
export type StateOf<S> = {readonly [k in keyof S]: ValueOf<S[k]>};

// ---------- 跨扩展的读 ----------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ExtensionExports {}
export type ExportsOf<X> = X extends {exports?: infer Ex} ? {[k in keyof Ex as string extends k ? never : k]: Ex[k] extends (...a: any[]) => infer R ? R : never} : never;
export type Read = <Id extends keyof ExtensionExports>(extension: Id) => ExtensionExports[Id];

// ---------- 处理函数能挂的事件：内核事件、自己的事件用短名，别的扩展的事件用全名 ----------

type Known<E> = KernelEvents & {[k in keyof E]: DataOf<E[k]>} & ExtensionEvents;
export type EventFor<E, k> = Event<k & string, Known<E>[k & keyof Known<E>]>;

// ---------- 各入口的上下文：越往后能力越多 ----------

export interface Resources {
    read(uri: string): Promise<string | undefined>;
}
export interface SessionInfo {
    tools: string[];
    model: {id: string; capabilities: {vision: boolean}};
}
/** 视图（contribute、prompt、turn）读到的：全部只读。 */
export interface ViewCtx<S, St> {
    state: StateOf<S>;
    settings: Readonly<St>;
    read: Read;
    session: SessionInfo;
    now: number;
}
/** 处理函数（on）：视图那些，加上写事件、改片、要求接着做、读资源、中止信号。emit 与 set 在处理函数结束时一起写入。 */
export interface ReactCtx<S, E, St> extends ViewCtx<S, St> {
    emit<k extends keyof E & string>(name: k, ...data: {} extends DataOf<E[k]> ? [DataOf<E[k]>?] : [DataOf<E[k]>]): void;
    set<k extends keyof S & string>(slice: k, value: ValueOf<S[k]>): void;
    /** 要求模型接着做：只在对最终回复（assistant 没有工具调用）的处理里有效，连续最多 3 次。 */
    continue(): void;
    resources: Resources;
    signal: AbortSignal;
}
/** 拦截：视图那些，加上读资源、中止信号；不写事件。 */
export interface InterceptCtx<S, St> extends ViewCtx<S, St> {
    resources: Resources;
    signal: AbortSignal;
}

// ---------- 请求、对话的形状 ----------

export interface Block {
    text: string;
    origin: string;
}
export interface Message {
    role: "user" | "assistant" | "tool";
    content: Block[];
    toolCalls?: ToolCall[];
    callId?: string;
}
export interface ModelRequest {
    model: string;
    params: {maxTokens?: number; temperature?: number};
    headers: Record<string, string>;
    system: Block[];
    messages: Message[];
    tools: string[];
}
export interface ModelResponse {
    text: string;
    toolCalls?: ToolCall[];
}
export interface ToolResult {
    text: string;
    isError?: boolean;
}

/** 一轮：一条输入、它的附带内容、ReAct 的各步。由 core.history 从日志归约。 */
export interface Turn {
    id: string;
    /** 没有输入的“继续”运行为 null。 */
    input: Event<"input", KernelEvents["input"]> | null;
    /** 输入之后、第一次模型调用之前写入的对话事件（含开头取走的插话、两次运行之间到达的）。 */
    attachments: Event[];
    steps: Step[];
}
export interface Step {
    reply: Event<"assistant", KernelEvents["assistant"]>;
    results: Event<"toolResult", KernelEvents["toolResult"]>[];
    /** 这一步之后、下一次模型调用之前写入的对话事件：插话、对工具结果的提醒、“接着写”。 */
    after: Event[];
}
/** 写 turn、commit 用的渲染工具：事件按 Profile 与扩展的 render 渲染成块，保留来源。 */
export interface Format {
    user(...parts: (Event | string | null | undefined)[]): Message | null;
    assistant(reply: Step["reply"]): Message;
    tool(result: Step["results"][number]): Message;
    /** 缺省的各步：回复、工具结果、after 合成的一条 user 消息。 */
    steps(steps: Step[]): Message[];
}

export interface CompactionJob {
    method: string;
    request: ModelRequest;
    require: string[];
}
export interface CompactionResult {
    firstKeptEntryId: string | null;
    replacement: string | null;
    omitted?: string[];
    details?: unknown;
}

// ---------- 扩展 ----------

export interface ExtensionFields<Id extends string, S, E, St, Ex> {
    id: Id;
    tags?: string[];
    dependsOn?: string[];
    preview?: "run" | "skip";
    /** 自己的设置：缺省值与类型；用户在 Profile 设置里按 Profile 配。 */
    settings?: {defaults: St};
    state?: S;
    events?: E;
    /** 每片一张表：事件名 → 新值；返回 undefined 表示不变。纯函数，打开会话、回退时会重放。 */
    reduce?: {[s in keyof S]?: {[k in keyof Known<E>]?: (value: ValueOf<S[s]>, event: EventFor<E, k>, state: StateOf<S>) => ValueOf<S[s]> | undefined}};
    /** 事件名 → 处理函数：事件写入并归约之后调用；可以 I/O；重放时不调用。 */
    on?: {[k in keyof Known<E>]?: (event: EventFor<E, k>, ctx: ReactCtx<S, E, St>) => void | Promise<void>};
    /** 给别的扩展读的：只取决于自己的片。 */
    exports?: Ex & {[name: string]: (state: StateOf<S>) => unknown};
    contribute?: {[slot: string]: {volatile?: boolean; shared?: boolean; value: (view: ViewCtx<S, St>) => string | null | undefined}};
    /** 自己的对话事件给模型看的文字。 */
    render?: {[k in keyof E]?: (event: Event<k & string, DataOf<E[k]>>) => string | null};
    intercept?: {
        input?(input: UserInput, next: (input: UserInput) => Promise<void>, ctx: InterceptCtx<S, St>): Promise<void | {reject: string}>;
        model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: InterceptCtx<S, St>): Promise<ModelResponse>;
        tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: InterceptCtx<S, St>): Promise<ToolResult>;
        compaction?(job: CompactionJob, next: (job: CompactionJob) => Promise<CompactionResult>, ctx: InterceptCtx<S, St>): Promise<CompactionResult>;
    };
    onFailure?: {tool?: "deny" | "ignore"};
    timeoutMs?: number;
    dispose?(): void;
}
export interface Extension<Id extends string = string, S = any, E = any, St = any, Ex = any> extends ExtensionFields<Id, S, E, St, Ex> {}
export declare function defineExtension<const Id extends string, S extends Record<string, Slice<any>> = {}, E extends Record<string, EventSpec<any>> = {}, St = {}, Ex = {}>(spec: ExtensionFields<Id, S, E, St, Ex>): Extension<Id, S, E, St, Ex>;

// ---------- 辅助函数 ----------

/**
 * 开场：会话创建时读一次、压缩之后再读一次，存进一片 path 状态，交给稳定的共用槽 `opening`。
 * 模板把 <Slot name="opening" /> 放在 <History /> 前面（缺省布局已放）。
 */
export declare function opening<const Id extends string>(o: {
    id: Id;
    load: (from: {initial: unknown; resources: Resources; read: Read; signal: AbortSignal}) => Promise<(string | null | undefined)[]> | (string | null | undefined)[];
}): Extension<Id>;

/** 提醒：每 every 次用户发言一次，或 watch 的值变了的那次发言之后，写一条附带内容。 */
export declare function reminder<const Id extends string>(o: {
    id: Id;
    tags?: string[];
    every?: number;
    watch?: (view: {settings: Readonly<Record<string, unknown>>; read: Read}) => unknown;
    text: (change: {value: unknown; changed: boolean; first: boolean}) => string | null;
}): Extension<Id>;

// ---------- 模板 ----------

export interface Node {
    type: unknown;
    props: any;
    children: unknown[];
}
export type Child = Node | string | number | boolean | null | undefined | Child[];
export declare function h(type: any, props: any, ...children: Child[]): Node;
export declare function Fragment(p: {children?: Child}): Node;
export declare function System(p: {children?: Child}): Node;
export declare function User(p: {children?: Child}): Node;
export declare function Assistant(p: {children?: Child}): Node;
export declare function P(p: {children?: Child}): Node;
export declare function Tag(p: {name: string; attrs?: Record<string, string>; children?: Child}): Node;
export declare function If(p: {tool: string; children?: Child}): Node;
/** 已提交的轮（压缩后以摘要开头）：每轮提交时渲染一次，之后不再变。 */
export declare function History(p: {}): Node;
/** 进行中的这一轮，按 Profile 的 turn 渲染；模板里必须恰好一个。 */
export declare function Turn(p: {}): Node;
export declare function Slot(p: {name: string; stable?: boolean; volatile?: boolean}): Node;

// ---------- Profile：自己就是最里层的扩展 ----------

export interface ProfileFields<Id extends string, S, E, St, Ex> extends ExtensionFields<Id, S, E, St, Ex> {
    name: string;
    tools: {required: string[]; optional?: string[]};
    globalExtensions?: {exclude: string[]} | "none";
    /** 可复用的扩展（opening()、reminder()、几个 Profile 共用的）；Profile 自己的逻辑直接写在上面的字段里。 */
    extensions?: readonly Extension[];
    system?: string;
    prompt?: (view: ViewCtx<S, St>) => Child;
    /** 一轮给模型看的样子：进行中的这一轮按它渲染，缺省也按它提交。 */
    turn?: (turn: Turn, format: Format) => (Message | null)[];
    /** 一轮结束后以什么样子进历史；不写时与 turn 相同（缓存最好）。 */
    commit?: (turn: Turn, format: Format) => (Message | null)[];
    /** Profile 级的 render：覆盖任何扩展、内核事件的文字，对历史与进行中的这一轮一律生效。键是事件全名。 */
    renderAll?: Record<string, (event: Event<string, any>) => string | null>;
    compaction?: {require?: string; onThreshold?: string[]; onOverflow?: string[]};
}
export declare function defineProfile<const Id extends string, S extends Record<string, Slice<any>> = {}, E extends Record<string, EventSpec<any>> = {}, St = {}, Ex = {}>(spec: ProfileFields<Id, S, E, St, Ex>): ProfileFields<Id, S, E, St, Ex>;

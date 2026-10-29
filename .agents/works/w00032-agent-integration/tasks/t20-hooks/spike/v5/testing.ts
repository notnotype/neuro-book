/**
 * 扩展与 Profile 的测试工具（建议放在 `@notnotype/nb-harness/testing`）。
 *
 * 目标：插件作者不起服务端、不碰真实模型与时钟，用十行以内搭出一个会话，驱动它，断言“请求长什么样”和“状态是什么”。
 * 内核是真的（真的日志、归约、视图、拦截链、单写者），假的只有四样：模型、工具、时钟、资源。
 * 假模型要和真实适配器对过合同（同一份 `ModelRequest` 校验：工具调用与结果成对、角色顺序），所以测试里写错
 * 对话形状会和线上一样失败。
 *
 * 默认严格：关闭时检查两件事，任一不成立测试失败——
 *  1. 没有被 `expect` 认领的 error 级诊断（扩展写错了不会悄悄通过）；
 *  2. 重放一致：把日志从头归约一遍，得到的状态必须与现场的一致（抓“归约里读了时钟或随机数”这类写错）。
 * 开不了严格的测试（专门测写错的）用 `strict: false`，或者先 `expect` 掉。
 */

import type {Diagnostic, DiagnosticCode, InputMode, RewindTarget, RunStatus, SessionCommands, CommandName, CommandResult, CommandMap} from "./host.ts";
import type {AnyExtension, Block, Event, EventData, KernelEvents, Message, ModelRequest, Origin, Profile, StateOfExtension, ToolCall, ToolResult, UserInput} from "./api.ts";

// ---------- 假模型 ----------

/** 一次回复的简写：字符串是纯文字；工具调用的 id 自动生成。 */
export type Reply =
    | string
    | {
          text?: string;
          tools?: {name: string; args?: unknown}[];
          usage?: {input: number; output: number};
          /** 这次调用失败（与服务商报错同一组分类）。 */
          fail?: "overflow" | "quota" | "auth" | "network" | "provider";
      };

/** 一次已经发出的模型调用。 */
export interface ModelCall {
    /** 第几次（从 1 起），与日志里的 modelStarted.request 一致。 */
    readonly n: number;
    readonly request: RequestView;
    /** 手动模式下还没回复。 */
    readonly pending: boolean;
    /** 手动模式下给出回复；已回复过再调用会抛错。 */
    reply(reply: Reply): void;
}

export interface TestModel {
    /** 按顺序排好后面几次调用的回复；用完还被调用，抛 ScriptExhausted 并带着那次请求的 outline。 */
    script(...replies: Reply[]): void;
    /** 每次调用都算一次回复（优先于 script 用完之后的情形）。 */
    respond(fn: (request: RequestView, n: number) => Reply): void;
    /** 切到手动：之后的调用停在那里，等测试 `next()` 取出并 `reply`，用来在运行中途插话、中止、看中间状态。 */
    manual(): void;
    /** 手动模式下等下一次调用到达。等待受测试自己的超时限制，不按固定时长睡。 */
    next(): Promise<ModelCall>;
    /** 到目前为止的全部调用，按先后。 */
    readonly calls: readonly ModelCall[];
}

// ---------- 假工具 ----------

export type FakeTool = (args: any, ctx: {signal: AbortSignal; files: TestFiles}) => string | ToolResult | Promise<string | ToolResult>;
export interface ToolCallHandle {
    readonly call: ToolCall;
    reply(result: string | ToolResult): void;
}
export interface TestTools {
    /** 登记（或覆盖）一个工具；没登记的工具被模型调用时，测试失败并指出是哪个。 */
    fake(name: string, impl: FakeTool): void;
    /** 登记一个手动的工具：调用停住，等测试 `next(name)` 取出并 `reply`。 */
    hold(name: string): void;
    next(name: string): Promise<ToolCallHandle>;
    /** 工具实际被调用的参数（拦截改写之后的）。 */
    readonly invoked: readonly {name: string; args: unknown}[];
}

export interface TestFiles {
    /** 资源 uri（project://、profile://、session://）→ 文字。 */
    set(uri: string, text: string): void;
    delete(uri: string): void;
    get(uri: string): string | undefined;
}

export interface TestClock {
    readonly now: number;
    /** 推进时间并触发到期的限时（处理函数的 timeoutMs）；内核的计时器全经这个时钟，没有真实的等待。 */
    advance(ms: number): Promise<void>;
}

// ---------- 请求的视图：断言用 ----------

export interface BlockView {
    readonly where: "system" | `messages[${number}]`;
    readonly role: "system" | Message["role"];
    readonly text: string;
    readonly origin: Origin;
    /** 如 `event:nbook.memory/retrieved`、`slot:opening@leader.opening`、`fixed:profile`。 */
    readonly label: string;
}
export interface RequestView {
    readonly raw: ModelRequest;
    readonly n: number;
    /** 全部块按请求里的先后摊平。 */
    readonly blocks: readonly BlockView[];
    /** 最后一条 user 消息的块（进行中这一轮的输入所在）。 */
    readonly lastUser: readonly BlockView[];
    /** 一行一条消息，块以 label 标出：适合整体比较，失败时一眼看出哪里不同。 */
    outline(): string[];
    /** 某个来源的块在请求里的位置；不存在返回 -1。 */
    indexOf(label: string): number;
    text(): string;
}

/** 已知的内核事件与登记过的扩展事件带类型的 data；没登记的是 unknown。 */
export type TestEvent<k extends string> = k extends keyof KernelEvents ? Event<k, EventData<KernelEvents[k]>> : Event<k, unknown>;

// ---------- 会话 ----------

export interface TestSessionOptions {
    /** 缺省一个最小的 Profile：只有 `<System>` 与 `<Turn />`、没有工具。 */
    profile?: Profile;
    /** 要测的扩展（相当于插件贡献的）。 */
    extensions?: readonly AnyExtension[];
    /** 按扩展 id 给设置。 */
    settings?: Record<string, Record<string, unknown>>;
    files?: Record<string, string>;
    tools?: Record<string, FakeTool>;
    /** 缺省 "script"：模型调用要有写好的回复。 */
    model?: "script" | "manual";
    /** 缺省 true，见文件头。 */
    strict?: boolean;
    /** 起始时间，缺省 2026-01-01T00:00:00Z。 */
    startAt?: number;
}

export interface Mark {
    readonly leaf: string | null;
    readonly head: number;
}

/** 写命令的简写：不用 commandId；失败时抛 CommandError（带 code），要拿失败结果用 `try*`。 */
export interface TestCommands {
    /** 入队并开始，等运行结束（手动模式下不等，见 `start`）。返回这次运行新增的日志事件。 */
    say(input: string | UserInput, mode?: InputMode): Promise<RunReport>;
    /** 入队但不等：手动模式下用它起一次运行，再用 model.next() 一步步推。 */
    sayAsync(input: string | UserInput, mode?: InputMode): Promise<{inputId: string; finished: Promise<RunReport>}>;
    enqueue(input: string | UserInput, mode: InputMode): Promise<string>;
    edit(inputId: string, input: string | UserInput): Promise<void>;
    remove(inputId: string): Promise<void>;
    abort(): Promise<boolean>;
    compact(requirement?: string): Promise<void>;
    changeSettings(patch: Record<string, Record<string, unknown>>): Promise<void>;
    changeProfile(profile: string): Promise<void>;
    /** 回退到某个标记（`mark()`）或 `rewindTargets()` 里的 id。 */
    rewind(to: Mark | string | null, opts?: {abort?: boolean; resend?: string}): Promise<void>;
    /** 要拿失败结果而不是抛错时用：任何命令。 */
    try<K extends CommandName>(name: K, args: CommandMap[K]["args"]): Promise<CommandResult<K>>;
}

export interface RunReport {
    /** 这次运行写进日志的事件。 */
    events: Event[];
    /** 这次运行发出的请求。 */
    requests: RequestView[];
    reason: EventData<KernelEvents["runEnded"]>["reason"];
}

export interface TestSession extends TestCommands, AsyncDisposable {
    readonly model: TestModel;
    readonly tools: TestTools;
    readonly files: TestFiles;
    readonly clock: TestClock;
    readonly status: RunStatus;
    /** 全部请求（含手动模式下已回复的）。 */
    readonly requests: readonly RequestView[];
    /** 最近一次请求；还没有时抛错（比 undefined 好定位）。 */
    readonly lastRequest: RequestView;
    /** 当前叶子路径上的事件。回退之后旧分支上的不在这里，在 `allEvents` 里。 */
    readonly events: readonly Event[];
    readonly allEvents: readonly Event[];
    /** 按事件类型取；别的扩展的事件用全名。 */
    eventsOf<k extends string>(type: k): TestEvent<k>[];
    /** 某个扩展现在的状态：类型从扩展定义推出，写错片名是编译错误。 */
    state<X extends AnyExtension>(extension: X): StateOfExtension<X>;
    /** 回退目标（与界面用的同一份）。 */
    rewindTargets(): Promise<RewindTarget[]>;
    mark(): Mark;
    /** 模拟收到外部事实（文件监视器、焦点变化）：等同于扩展的 `mount` 里调 `ctx.external`。 */
    external(extensionId: string, name: string, data?: unknown): Promise<void>;
    /** 像重启一样：丢掉内存里的会话，从同一份日志重新打开（recover、归约，不跑处理函数）。 */
    reopen(): Promise<void>;
    /** 等写入队列清空且没有运行中。 */
    idle(): Promise<void>;
    readonly diagnostics: TestDiagnostics;
    /** 手里的命令，带 commandId：测幂等与 unknown-outcome 重发时用。 */
    readonly raw: SessionCommands;
}

export interface TestDiagnostics {
    readonly all: readonly Diagnostic[];
    /** 认领一条诊断：之后严格模式不再为它失败。找不到时抛错，列出现有的码。返回它方便继续断言。 */
    expect(code: DiagnosticCode, where?: {extension?: string; entry?: Diagnostic["entry"]}): Diagnostic;
    /** 到目前为止没有任何未认领的 error 与 warn。 */
    expectNone(): void;
}

export declare function createTestSession(options?: TestSessionOptions): Promise<TestSession>;

/** 命令失败时 `TestCommands` 抛的错：code 是 commandErrors 里的码，detail 同命令结果。 */
export declare class CommandError extends Error {
    readonly code: string;
    readonly detail?: Record<string, string | number | boolean | null>;
}
/** 严格模式的失败：未认领的诊断、重放不一致、手动调用没人回复。 */
export declare class StrictModeError extends Error {
    readonly kind: "unclaimed-diagnostics" | "replay-mismatch" | "pending-model-call" | "pending-tool-call";
}
export declare class ScriptExhausted extends Error {
    /** 那次请求的 outline，直接看出是哪一次调用没有写回复。 */
    readonly outline: string[];
}

/** 与线上同一份请求校验，单独导出给测“我的 turn 写得对不对”的 Profile 作者。 */
export declare function validateRequest(request: ModelRequest): {ok: true} | {ok: false; code: "missing-tool-result" | "orphan-tool-result" | "bad-tool-name" | "bad-role-order"; at: string};

export type { Block };

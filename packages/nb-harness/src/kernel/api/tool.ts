/**
 * 工具：声明、调用、执行上下文与结果。日志、`ToolCall.tool`、Profile 与审批一律用工具 id；
 * 交给服务商的名字由适配器换算（t04 决定 1），显式覆盖写 `providerName`。
 */

import type {Attributed, JsonValue} from "./basics.js";

/** 工具的副作用等级：审批与只读模式按它判定（t06）。 */
export type ToolEffect = "read" | "write" | "exec";

export interface ToolDeclaration {
    /** 稳定 id，带命名空间（`builtin.read`、`story.search`）；不得含 `__`，最长 64（t04）。 */
    readonly id: string;
    /** 交给服务商的名字；不写时适配器把 id 的 `.` 换成 `__`。写了要符合服务商的命名规则。 */
    readonly providerName?: string;
    readonly description: string;
    /** 参数的 JSON Schema（TypeBox 的 schema 对象本身就是）。 */
    readonly parameters: {readonly [key: string]: JsonValue};
    /** 提供方：插件 id、`builtin`，或 Profile 自带工具的 Profile id。 */
    readonly provider: string;
    readonly version: string;
    /** 收尾工具：一条回复里只调用了它、参数通过校验且执行成功，运行即以 `finished` 结束。 */
    readonly finish: boolean;
    /** 同一条回复里的调度：连续的 `shared` 调用并发执行，`exclusive` 单独执行。 */
    readonly concurrency: "shared" | "exclusive";
    readonly strict: boolean;
    readonly customFormat?: JsonValue;
    /** 固定的等级，或按参数求值（`shell` 这类同一个工具既能读也能写）。 */
    readonly effect: ToolEffect | ((args: Readonly<Record<string, unknown>>) => ToolEffect);
}

/** 给扩展与审批看的工具信息：声明去掉只与执行协议相关的字段。 */
export type ToolInfo = Omit<ToolDeclaration, "strict" | "customFormat">;

export interface ToolCall {
    /** 服务商给的调用 id；同一条回复里不重复。 */
    readonly id: string;
    /** 工具 id。 */
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
    /** 服务商要求带回的调用元数据（例如 Google 的思考签名）；适配器原样保存、原样送回。 */
    readonly provider?: JsonValue;
}

/**
 * 工具调用的结局。`blocked`：拦截没有调用 `next`；`denied`：审批或拦截拒绝；
 * `unknown`：发出了但不知道有没有执行完（崩溃恢复、中止宽限期过后）。
 */
export type ToolStatus = "ok" | "error" | "denied" | "blocked" | "unknown";

/** 工具或工具拦截交回的结果。`status` 缺省 `ok`；`redacted` 时日志里的原文只记哈希。 */
export interface ToolResult {
    readonly text: string;
    readonly status?: "ok" | "error" | "denied";
    /** 失败的码；内核造的失败结果都带码（`api/codes.ts` 的 `toolResultCodes`）。 */
    readonly code?: string;
    /** 给程序看、不进请求。 */
    readonly details?: JsonValue;
    readonly redacted?: boolean;
}

/** 工具向用户提的问题（t14 的 `ask`）。`async` 时工具立即返回，回答作为输入进缓冲区。 */
export interface QuestionRequest {
    readonly question: string;
    readonly options?: readonly string[];
    readonly data?: JsonValue;
}
export type QuestionAnswer = {readonly kind: "answer"; readonly text: string; readonly data?: JsonValue} | {readonly kind: "unavailable"; readonly code: string};

export interface ToolContext {
    readonly signal: AbortSignal;
    readonly callId: string;
    readonly sessionId: string;
    /** 会话建立时校验过的初始输入。 */
    readonly initial: unknown;
    /** 向用户提问；同步提问让运行停下等回答（docs/specs/harness/runtime.md 输出 40）。没有等用户通道的运行里没有它。 */
    readonly ask?: (request: QuestionRequest, options?: {readonly async?: boolean}) => Promise<QuestionAnswer>;
    /** 报告进度：只推给界面，不进日志。 */
    readonly report?: (text: string) => void;
}

/** 工具实现：每个会话每个工具建一次（t04 决定 2），关闭会话或工具被卸载时 `dispose`。 */
export interface ToolImplementation {
    execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<ToolResult | string>;
    dispose?(): void | Promise<void>;
}

/** 审批钩子的判定。`by` 是判定来源（规则、模式、审批模型），记进 `toolStarted.approval` 或拒绝结果。 */
export type ApprovalVerdict =
    | {readonly verdict: "allow"; readonly by: string}
    | {readonly verdict: "deny"; readonly rejection: Attributed}
    | {readonly verdict: "ask"; readonly reason?: string};

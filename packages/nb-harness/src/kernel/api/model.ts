/**
 * 与服务商无关的请求与回复、模型端口。适配器（OMP `streamSimple`）是 `ModelRequest` 与服务商之间唯一的转换点；
 * 合同见 docs/specs/harness/ 的模型 Spec（第 2 片新建）。
 */

import type {JsonValue} from "./basics.js";
import type {ToolCall, ToolDeclaration} from "./tool.js";

/** 模型请求的用途：用量统计这类拦截按它区别对待。选哪个模型由模型端口按用途决定，拦截改不了 `model`。 */
export type RequestPurpose = "turn" | "approval" | "compaction" | "background";

/** 一条回复为什么停下。`tool`：回复里有工具调用；`length`：撞上输出上限。 */
export type StopReason = "stop" | "length" | "tool" | "error" | "aborted";

/** 服务商报错的类别（照 master 的 `classifyProviderError`：按状态码与 OMP 错误标记，不看文字）。 */
export type ModelErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";

/** OMP `Usage` 的全部计数。用量是下界：`complete` 为 false 表示取消过或可能漏计了服务商层的重试。 */
export interface Usage {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly totalTokens?: number;
    /** 单价未知时为 null（单价全为 0 也当未知）。 */
    readonly cost: number | null;
    readonly complete: boolean;
}

/**
 * 回复的内容块。服务商要求带回的签名与元数据（`provider`，适配器原样保存、原样送回，内核不读）跟着块存；
 * 图片一律是大块内容，`blob` 是会话目录 `blobs/` 下的 SHA-256。
 */
export type ContentBlock =
    | {readonly kind: "text"; readonly text: string; readonly provider?: JsonValue}
    | {readonly kind: "thinking"; readonly text: string; readonly signature?: string; readonly redacted?: boolean; readonly provider?: JsonValue}
    | {readonly kind: "image"; readonly blob: string; readonly mime: string; readonly width?: number; readonly height?: number};

/** 请求里一块内容的来源：预览、修改记录、诊断与测试都按它定位，不解析字符串。 */
export type Origin =
    | {readonly kind: "fixed"; readonly by: "profile" | "kernel"}
    | {readonly kind: "event"; readonly eventId: string; readonly type: string; readonly extension: string}
    | {readonly kind: "slot"; readonly name: string; readonly extension: string}
    | {readonly kind: "summary"; readonly compactionId: string}
    | {readonly kind: "intercept"; readonly extension: string};

export type RequestBlock = ContentBlock & {readonly origin: Origin};

/** 相邻的 user 消息不在内核里拼接；服务商要求时由适配器合成一条多块消息。 */
export interface Message {
    readonly role: "user" | "assistant" | "tool";
    readonly content: readonly RequestBlock[];
    readonly toolCalls?: readonly ToolCall[];
    /** `tool` 消息回应的调用 id。 */
    readonly callId?: string;
    /** `tool` 消息：工具没有成功（出错、被拒、结果未知）。 */
    readonly isError?: boolean;
    /** `assistant` 消息：作答的模型全名。适配器据此判断思考签名能不能原样送回（换了服务商的不送）。 */
    readonly model?: string;
}

export interface ModelRequest {
    readonly purpose: RequestPurpose;
    /** 模型的全名 `<服务商>/<模型>`。 */
    readonly model: string;
    readonly effort?: string;
    readonly params: {readonly maxTokens?: number; readonly temperature?: number};
    readonly headers: Readonly<Record<string, string>>;
    readonly system: readonly RequestBlock[];
    readonly messages: readonly Message[];
    /** 完整工具声明；名字由适配器换算。 */
    readonly tools: readonly ToolDeclaration[];
    readonly toolChoice?: "auto" | "none" | {readonly tool: string};
    /** 适配器专用、原样透传；内核不读。 */
    readonly providerOptions?: Readonly<Record<string, JsonValue>>;
}

/** 失败的说明。`message` 是遮盖过密钥的英文开发者文字，不用来分支。 */
export interface ModelFailure {
    readonly kind: ModelErrorKind;
    readonly code?: string;
    readonly status?: number;
    readonly message: string;
}

/**
 * 一次逻辑请求的结果（适配器内部的鉴权重试、推理循环算同一次）。`stopReason` 为 `error`、`aborted` 时带 `error`，
 * `content` 是已产生的部分内容；内核把它写成 `modelFailed`，不写 `assistant`。
 */
export interface ModelResponse {
    readonly content: readonly ContentBlock[];
    readonly toolCalls: readonly ToolCall[];
    readonly stopReason: StopReason;
    readonly usage: Usage;
    /** 实际作答的模型全名。 */
    readonly model: string;
    readonly responseId?: string;
    readonly error?: ModelFailure;
}

/** 流式增量：只推给界面，不进日志，不给扩展。 */
export interface ModelDelta {
    readonly part: "text" | "thinking" | "toolArgs";
    readonly callId?: string;
    readonly text: string;
}

export interface ModelInfo {
    readonly id: string;
    readonly contextWindow: number;
    readonly maxOutput?: number;
    readonly capabilities: {readonly vision: boolean; readonly thinking: boolean};
    /** 模型支持的推理档；设置里的档按它夹取（t09 决定 6）。 */
    readonly efforts: readonly string[];
    /** 自动压缩的触发点（token 数）；不写按窗口的比例（t11）。 */
    readonly compactAt?: number;
}

/** 审批模式（t06 决定 1 与 2026-10-30 改判）：每次都问、放行写入、交审批模型、全部放行。 */
export type ApprovalMode = "ask" | "allow-writes" | "auto" | "yolo";

/** 内核的核心设置组 `core`（session 作用域，回退不切回）。 */
export interface CoreSettings {
    readonly model: string | null;
    readonly effort: string | null;
    readonly approvalMode: ApprovalMode;
    readonly readOnly: boolean;
}

export type ModelResolution =
    | {readonly ok: true; readonly info: ModelInfo; call(request: ModelRequest, signal: AbortSignal, onDelta: (delta: ModelDelta) => void): Promise<ModelResponse>}
    | {readonly ok: false; readonly code: "no-model" | "no-credentials" | "unknown-model"};

/** 模型端口：模型目录与凭据由宿主实现（Agent 插件经 `nbook.models`，nb-story 用它自己的解析）。 */
export interface ModelPort {
    resolve(settings: CoreSettings, purpose: RequestPurpose, role?: string): ModelResolution;
}

/** 主动调模型时交的请求：用途与模型由内核按 `purpose`、`role` 经模型端口填上，`model` 写了就用它。 */
export type ModelDraft = Omit<ModelRequest, "purpose" | "model"> & {readonly model?: string};

/**
 * 主动调模型（压缩方法、审批钩子）：内核写 `modelStarted`、过模型拦截链、计用量、接中止。
 * 失败不抛错，以 `stopReason: "error"` 的回复交回。
 */
export type ModelCaller = (request: ModelDraft, options: {readonly purpose: Exclude<RequestPurpose, "turn">; readonly role?: string}) => Promise<ModelResponse>;

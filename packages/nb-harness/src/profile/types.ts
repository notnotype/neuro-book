/**
 * Profile 模块的公开类型，逐字对应 docs/specs/harness/profile.md 的“注册”一节。
 */

import type {ImageContent, Message, TextContent} from "@oh-my-pi/pi-ai";
import type {TSchema} from "typebox";

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type ProfileChild = ProfileNode | string | null;
export interface ProfileNode {
    readonly type: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly ProfileChild[];
}

export type PromptContext = {
    session: {id: string; title?: string; createdAt: string};
    /** 本次调用是会话的第几轮，从 1 起。 */
    turn: number;
    now: Date;
    /** 已校验的字段值。 */
    fields: Readonly<Record<string, JsonValue>>;
};

/** `defineProfile` 给结果打的标记；`profileFromModule` 据此识别默认导出。 */
export const profileMarker: unique symbol = Symbol("nb-harness.profile");

/**
 * 四个一等属性镜像运行时登记的 `harness/*` 字段（`defineProfile` 把它们放进 `fields`）；类型按结构写在这里，
 * 因为 profile 模块不依赖登记它们的模块。值仍由 `prepare` 按注册的 schema 校验，这里的类型只是写法上的提示。
 */
export type HarnessFieldProps = {
    /** `harness/tools`：要用的工具 id。 */
    tools?: readonly string[];
    /** `harness/model`：模型引用或角色。 */
    model?: {model?: string; role?: string};
    /** `harness/compaction`：压缩设置（形状见 harness.compaction）。 */
    compaction?: JsonValue;
    /** `harness/approval`：审批模式。 */
    approval?: "always-ask" | "write" | "auto" | "yolo";
};

export type ProfileDefinition = HarnessFieldProps & {
    id: string;
    name: string;
    description: string;
    version: number;
    /** 第三方命名空间的字段；`harness/*` 的四个用上面的一等属性写，同一个字段两边都给是定义错误。 */
    fields?: Record<string, JsonValue>;
    prompt: (ctx: PromptContext) => ProfileNode;
};
/** 一等属性已并进 `fields`：主机与运行时只读 `fields`。 */
export type Profile = Readonly<Required<Pick<ProfileDefinition, "fields">> & Omit<ProfileDefinition, "fields" | keyof HarnessFieldProps>> & {readonly [profileMarker]: true};

export type RenderContext = {prompt: PromptContext; sources: Readonly<Record<string, unknown>>};

/** 注册节点类型时的声明；`parents` 里 `*message`、`*content`、`*stateful` 表示该类别的任何节点。 */
export type NodeTypeDefinition = {
    id: string;
    props: TSchema;
    parents: readonly string[];
    children: "none" | "content" | readonly string[];
    sources?: readonly string[];
} & (
    | {category: "message"; role: "user" | "developer" | "assistant"}
    | {category: "content"; layout?: "inline" | "block"; render(node: ProfileNode, context: RenderContext): ProfileChild}
    | {category: "stateful"; render(node: ProfileNode, context: RenderContext & {state: JsonValue | undefined}): {content: ProfileChild; state: JsonValue}}
);
export type SourceDefinition = {
    id: string;
    schema: TSchema;
    phase: "invocation" | "model-call";
    resolve(request: {prompt: PromptContext}, signal: AbortSignal): Promise<unknown>;
};
export type FieldDefinition = {id: string; schema: TSchema};

export type ProfileState = {[statefulNodeId: string]: JsonValue};
export type UserInput = {content: string | (TextContent | ImageContent)[]};
export type SeedOutput = {messages: {message: Message; once: boolean}[]; diagnostics: Diagnostic[]};
export type AppendedMessage = {kind: "input" | "message" | "reminder"; message: Message};
export type AppendingOutput = {messages: AppendedMessage[]; state: ProfileState; diagnostics: Diagnostic[]};
export type RequestOutput = {systemPrompt: string[]; messages: Message[]; diagnostics: Diagnostic[]};

export type ProfileIssue = "unknown-node" | "invalid-props" | "invalid-parent" | "invalid-child" | "duplicate-state-id"
    | "multiple-seeded-history" | "multiple-appending" | "multiple-input" | "image-not-allowed" | "unknown-field"
    | "invalid-field" | "unknown-source" | "source-failed" | "cache-unfriendly" | "invalid-invocation-start" | "duplicate-profile" | "prompt-threw" | "unknown-tool";
export type Diagnostic = {severity: "error" | "warning"; code: ProfileIssue; path: string; detail: string};
export type ProfileFailure = "duplicate-registration" | "reserved-node" | "invalid-definition" | "invalid-prompt" | "cancelled"
    | "module-load-failed" | "invalid-profile";
export type ProfileResult<T> = {ok: true; value: T} | {ok: false; code: ProfileFailure; detail: string; diagnostics: Diagnostic[]};

export const preparedMarker: unique symbol = Symbol("nb-harness.prepared-profile");
/** 不透明：只用于传回同一主机的渲染方法。 */
export type PreparedProfile = {readonly [preparedMarker]: true};

export interface ProfileHost {
    registerNodeType(definition: NodeTypeDefinition): ProfileResult<{dispose(): void}>;
    registerSource(definition: SourceDefinition): ProfileResult<{dispose(): void}>;
    registerField(definition: FieldDefinition): ProfileResult<{dispose(): void}>;
    prepare(profile: Profile, input: {context: PromptContext; signal?: AbortSignal}): Promise<ProfileResult<PreparedProfile>>;
    refresh(prepared: PreparedProfile, input: {signal?: AbortSignal}): Promise<ProfileResult<PreparedProfile>>;
    renderSeeds(prepared: PreparedProfile, occasion: "new-session" | "after-compaction"): SeedOutput;
    renderAppending(prepared: PreparedProfile, input: {input: UserInput; state: ProfileState}): AppendingOutput;
    renderRequest(prepared: PreparedProfile, input: {history: readonly Message[]; invocationStart: number}): RequestOutput;
    renderSystem(prepared: PreparedProfile): {systemPrompt: string[]; diagnostics: Diagnostic[]};
}

export interface ProfileCatalog {
    list(): Profile[];
    get(id: string): Profile | undefined;
    readonly issues: Diagnostic[];
}

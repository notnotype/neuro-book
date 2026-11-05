/**
 * `nbook.agent` 拥有的贡献点与激活事件（docs/specs/agent/contributions.md、compaction.md）。只在服务端：会话、工具与扩展都在服务端跑。
 *
 * 声明只放序列化得了的部分（第三方插件的贡献点经清单登记）；实现在提供方入口激活时交出。提供方入口要自己写上对应的激活
 * 事件（`agentToolContribution` 这类助手一起给出），`nbook.agent` 在用到时触发。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionDeclaration, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import type {AnyExtension, AnyProfile, ToolEffect, ToolImplementation, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import type {AgentToolServices} from "./resources";

export const EXTENSIONS_POINT = "agent.extensions";
export const TOOLS_POINT = "agent.tools";
export const PROFILES_POINT = "agent.profiles";
export const COMPACTION_METHODS_POINT = "agent.compactionMethods";

/** 激活事件前缀：本插件拥有，只有本插件触发（runtime/plugin-manifest.md）。 */
export const AGENT_SESSION_PREFIX = "onAgentSession";
export const AGENT_TOOL_PREFIX = "onAgentTool";
export const AGENT_PROFILE_PREFIX = "onAgentProfile";
export const AGENT_COMPACTION_PREFIX = "onAgentCompaction";

/** 每次建会话或打开会话之前触发：激活所有提供扩展的入口（contributions.md 输出 2）。事件要带参数，参数固定。 */
export const ON_AGENT_SESSION = `${AGENT_SESSION_PREFIX}:open`;
export const onAgentTool = (id: string): string => `${AGENT_TOOL_PREFIX}:${id}`;
export const onAgentProfile = (key: string): string => `${AGENT_PROFILE_PREFIX}:${key}`;
export const onAgentCompaction = (id: string): string => `${AGENT_COMPACTION_PREFIX}:${id}`;

const ExtensionDeclarationSchema = Type.Object({
    tags: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    dependsOn: Type.Optional(Type.Array(Type.String({minLength: 1}))),
}, {additionalProperties: false});

const EffectSchema = Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("exec")]);

/**
 * 工具声明里序列化得了的部分。`effect` 是提供方没激活时用的等级，写最保守的；实现可以另给按参数求等级的函数
 * （`AgentToolImplementation.effect`），提供方激活之后用它。
 */
const ToolDeclarationSchema = Type.Object({
    description: Type.String({minLength: 1}),
    parameters: Type.Record(Type.String(), Type.Unknown()),
    providerName: Type.Optional(Type.String({minLength: 1})),
    version: Type.String({minLength: 1}),
    finish: Type.Optional(Type.Boolean()),
    concurrency: Type.Optional(Type.Union([Type.Literal("shared"), Type.Literal("exclusive")])),
    strict: Type.Optional(Type.Boolean()),
    effect: EffectSchema,
    /** 模型按这份语法写参数（支持的服务商才用，其余仍按 `parameters`），原样转给内核。 */
    customFormat: Type.Optional(Type.Object({syntax: Type.Literal("lark"), definition: Type.String({minLength: 1})}, {additionalProperties: false})),
    /** 设置里分组显示用。 */
    group: Type.Optional(Type.String({minLength: 1})),
    /** 装到所有 Profile 的工具集里（contributions.md 输出 4）。 */
    defaultForAll: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

const ProfileDeclarationSchema = Type.Object({
    name: Type.String({minLength: 1}),
    description: Type.String(),
    tools: Type.Object({
        required: Type.Array(Type.String({minLength: 1})),
        optional: Type.Array(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    /** 这个 Profile 缺省用的模型角色；用户的 Profile 设置优先（contributions.md 输出 13）。 */
    role: Type.Optional(Type.String({minLength: 1})),
    /** 不给人选：仍在目录里，选 Profile 的界面不列出（输出 7）。 */
    hidden: Type.Optional(Type.Boolean()),
    /** 图标 class，例如 `i-lucide-feather`；会话面板与对话顶栏用，缺省用通用图标。 */
    icon: Type.Optional(Type.String({minLength: 1})),
    /** `false`：不加 `defaultForAll` 的工具（输出 4）。 */
    defaultTools: Type.Optional(Type.Literal(false)),
}, {additionalProperties: false});

export type AgentExtensionDeclaration = Static<typeof ExtensionDeclarationSchema>;
export type AgentToolDeclaration = Static<typeof ToolDeclarationSchema>;
export type AgentProfileDeclaration = Static<typeof ProfileDeclarationSchema>;

/**
 * `agent.tools` 的实现：按会话建一次真正的实现（t04 决定 2）；`effect` 给按参数求等级的工具。`services.resources` 是这个会话的
 * 资源视图，工具经它按资源地址读写；`services.artifacts` 以宿主身份保存大结果的全文（docs/specs/agent/resources.md）。
 */
export interface AgentToolImplementation {
    create(context: ToolSessionContext, services: AgentToolServices): ToolImplementation | Promise<ToolImplementation>;
    effect?(args: Readonly<Record<string, unknown>>): ToolEffect;
}

/** 各贡献点的实现形状，接收方取实现时按它读。 */
export type AgentExtensionImplementation = AnyExtension;
export type AgentProfileImplementation = AnyProfile;

export const extensionsPoint: ContributionPointDefinition<AgentExtensionDeclaration> = {id: EXTENSIONS_POINT, implementation: "required", idPrefix: "plugin", schema: ExtensionDeclarationSchema};
export const toolsPoint: ContributionPointDefinition<AgentToolDeclaration> = {id: TOOLS_POINT, implementation: "required", idPrefix: "plugin", schema: ToolDeclarationSchema};
/** 压缩方法的声明没有字段：方法名就是贡献 id，实现是 `CompactionMethodImpl`。 */
export const CompactionMethodDeclarationSchema = Type.Object({}, {additionalProperties: false});
export type AgentCompactionMethodDeclaration = Static<typeof CompactionMethodDeclarationSchema>;
export const compactionMethodsPoint: ContributionPointDefinition<AgentCompactionMethodDeclaration> = {id: COMPACTION_METHODS_POINT, implementation: "required", idPrefix: "plugin", schema: CompactionMethodDeclarationSchema};
export const profilesPoint: ContributionPointDefinition<AgentProfileDeclaration> = {id: PROFILES_POINT, implementation: "required", idPrefix: "plugin", schema: ProfileDeclarationSchema};

/**
 * 提供方写清单用的助手：交回贡献声明与它要写进入口的激活事件。扩展的提供方要声明 `ON_AGENT_SESSION`，否则它的扩展只在
 * 入口因别的原因激活后才生效（contributions.md 输出 2）。
 */
export function agentExtension(id: string, declaration: AgentExtensionDeclaration = {}): {readonly contribution: ContributionDeclaration<AgentExtensionDeclaration>; readonly activationEvent: string} {
    return {contribution: {capability: EXTENSIONS_POINT, id, declaration}, activationEvent: ON_AGENT_SESSION};
}

export function agentTool(id: string, declaration: AgentToolDeclaration): {readonly contribution: ContributionDeclaration<AgentToolDeclaration>; readonly activationEvent: string} {
    return {contribution: {capability: TOOLS_POINT, id, declaration}, activationEvent: onAgentTool(id)};
}

export function agentCompactionMethod(id: string): {readonly contribution: ContributionDeclaration<AgentCompactionMethodDeclaration>; readonly activationEvent: string} {
    return {contribution: {capability: COMPACTION_METHODS_POINT, id, declaration: {}}, activationEvent: onAgentCompaction(id)};
}

export function agentProfile(key: string, declaration: AgentProfileDeclaration): {readonly contribution: ContributionDeclaration<AgentProfileDeclaration>; readonly activationEvent: string} {
    return {contribution: {capability: PROFILES_POINT, id: key, declaration}, activationEvent: onAgentProfile(key)};
}

/**
 * `nbook.agent` 拥有的贡献点与激活事件（docs/specs/agent/contributions.md、compaction.md、skills.md）。只在服务端：会话、工具与扩展都在服务端跑。状态栏的项（`agent.statusItems`，只在浏览器入口）在 `status-item-point.ts`。
 *
 * 声明只放序列化得了的部分（第三方插件的贡献点经清单登记）；实现在提供方入口激活时交出。提供方入口要自己写上对应的激活
 * 事件（`agentToolContribution` 这类助手一起给出），`nbook.agent` 在用到时触发。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionDeclaration, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import type {AnyExtension, AnyProfile, ToolEffect, ToolImplementation, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import {TextSchema} from "nbook/shared/text";

import type {AgentToolServices} from "./resources";

export const EXTENSIONS_POINT = "agent.extensions";
export const TOOLS_POINT = "agent.tools";
export const PROFILES_POINT = "agent.profiles";
export const COMPACTION_METHODS_POINT = "agent.compactionMethods";
export const SKILLS_POINT = "agent.skills";
export const EVAL_OBJECTS_POINT = "agent.evalObjects";

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
    /** `on-request`：不自动装到所有 Profile，Profile 声明里按 id 引用（`referencedExtensions`）才装（contributions.md 的“按需扩展”）。 */
    install: Type.Optional(Type.Literal("on-request")),
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
    /** 执行时能经 `ctx.invoke` 调别的工具（contributions.md 输出 24，harness/runtime.md 输出 90）。 */
    invokes: Type.Optional(Type.Literal(true)),
    /** 不能被代码调用：靠结果归约改状态的、寿命超出一次调用的（harness/runtime.md 输出 92）。 */
    codeCallable: Type.Optional(Type.Literal(false)),
    /** 是某个全局对象的方法，只能从代码里调（contributions.md 输出 24、25）。 */
    global: Type.Optional(Type.Object({object: Type.String({pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$"}), method: Type.String({pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$"})}, {additionalProperties: false})),
    /** 代码调用时交回的结构化值的形状（JSON Schema，同 MCP 的 `outputSchema`，eval.md 输出 7）。 */
    returns: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** 只给有人在窗口前的会话：不进后台会话与 bot 归属的会话的工具集（contributions.md 输出 4）。 */
    foreground: Type.Optional(Type.Literal(true)),
    /** 失败时交给代码的 `details` 的形状，按失败码（JSON Schema，eval.md 输出 8）：只有这里列出的码才把 `details` 交给代码。 */
    errors: Type.Optional(Type.Record(Type.String({minLength: 1}), Type.Record(Type.String(), Type.Unknown()))),
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
    /**
     * 按 id 引用的扩展（contributions.md 的“按需扩展”）：例如 `["nbook.agent.modes"]` 让这个 Profile 有 Agent 模式。插件 Profile
     * 只认这里写的，实现里不另写；目录不激活提供方就能据此判断（输出 8、14）。
     */
    referencedExtensions: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    /** 需要的模型能力，同 `defineProfile` 的 `modelNeeds`；写在声明里，界面不用激活提供方就能提示（输出 14）。 */
    modelNeeds: Type.Optional(Type.Object({
        vision: Type.Optional(Type.Boolean()),
        thinking: Type.Optional(Type.Boolean()),
        minContext: Type.Optional(Type.Integer({minimum: 1})),
    }, {additionalProperties: false})),
    /** 能派哪些 Profile 做子代理（Profile 的 key），其中推荐哪几个；不写就是空白名单（contributions.md 输出 19）。 */
    agents: Type.Optional(Type.Object({
        allowed: Type.Array(Type.String({minLength: 1})),
        recommended: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    }, {additionalProperties: false})),
    /** 能用 `$` 带上哪些 Skill（Skill 的 id），`"all"` 是 Skill 目录里的全部；不写就是空白名单（contributions.md 输出 20）。 */
    skills: Type.Optional(Type.Object({
        allowed: Type.Union([Type.Array(Type.String({minLength: 1})), Type.Literal("all")]),
    }, {additionalProperties: false})),
    /** 提示词里列哪些表情包（表情包 id），`"all"` 是表情目录里的全部；不写就是空白名单（contributions.md 输出 23）。 */
    stickers: Type.Optional(Type.Object({
        allowed: Type.Union([Type.Array(Type.String({minLength: 1})), Type.Literal("all")]),
    }, {additionalProperties: false})),
    /**
     * 开场指令：对话第一屏“试试这些”，点了填进输入框（contributions.md 输出 21）。只显示前 3 条；不设条数上限，多写的不显示，
     * 不因为一段展示用的文字拒绝整个 Profile。
     */
    starters: Type.Optional(Type.Array(Type.Object({
        text: Type.String({minLength: 1}),
        /** 图标 class，例如 `i-lucide-feather`。 */
        icon: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}))),
}, {additionalProperties: false});

export type AgentExtensionDeclaration = Static<typeof ExtensionDeclarationSchema>;
export type AgentToolDeclaration = Static<typeof ToolDeclarationSchema>;
export type AgentProfileDeclaration = Static<typeof ProfileDeclarationSchema>;

/**
 * `agent.tools` 的实现：按会话建一次真正的实现（t04 决定 2）；`effect` 给按参数求等级的工具。`services.resources` 是这个会话的
 * 资源视图，工具经它按资源地址读写；`services.artifacts` 以宿主身份保存大结果的全文（docs/specs/agent/resources.md）。
 */
export type ToolSubject =
    | {readonly kind: "command"; readonly dialect: string; readonly text: string}
    | {readonly kind: "path"; readonly access: "read" | "write"; readonly address: string}
    | {readonly kind: string; readonly value: string};

export interface AgentToolImplementation {
    create(context: ToolSessionContext, services: AgentToolServices): ToolImplementation | Promise<ToolImplementation>;
    effect?(args: Readonly<Record<string, unknown>>): ToolEffect;
    /** 规则要看的东西：路径、命令、主机（docs/specs/agent/permissions.md）。路径可以写单数地址，判定时展开。 */
    subjects?(args: Readonly<Record<string, unknown>>): readonly ToolSubject[];
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
 * `agent.skills` 的声明（docs/specs/agent/skills.md 的插件来源）：插件包里一个目录，相对插件根，里面每个子文件夹是一个 Skill。
 * 只有顶层声明，没有实现：Skill 是文件，`nbook.agent` 收到声明后按目录扫描。
 */
export const SkillsDeclarationSchema = Type.Object({directory: Type.String({minLength: 1})}, {additionalProperties: false});
export type AgentSkillsDeclaration = Static<typeof SkillsDeclarationSchema>;

/**
 * 声明的目录写成插件包里的相对路径，用 `/` 分段：不是绝对路径，不带协议或盘符，没有反斜杠，没有空段、`.` 与 `..`。构建预设打包
 * Skill 与服务端解析目录前都按它核对，不合规时交回原因。
 */
export function skillsDirectoryProblem(directory: string): string | null {
    if (directory.startsWith("/") || directory.includes("\\") || directory.includes(":")) return `Skill 目录 ${directory} 要写成插件包里的相对路径（用 / 分段，不带协议或盘符）`;
    if (directory.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return `Skill 目录 ${directory} 不能有空段、. 或 ..`;
    return null;
}

/**
 * 代码里可用的全局对象（docs/specs/agent/contributions.md 输出 25，agent/eval.md）：只有顶层声明，没有实现。对象的方法是带
 * `global: {object, method}` 的工具（输出 24），由 `agent.tools` 贡献；这里只有名字、一行摘要与给模型读的说明。
 */
export const EvalObjectDeclarationSchema = Type.Object({
    /** 代码里的全局名：JS 标识符。 */
    name: Type.String({pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$"}),
    /** eval 的说明里给的一行。 */
    summary: Type.String({minLength: 1}),
    /** 写进 `docs://eval/<名>.md` 的说明（Markdown），排在方法签名之前。 */
    docs: Type.Optional(Type.String()),
    /** 给人看的一句说明（界面文字）：Profile 页上这个对象那一行用（profile-settings.md 输出 28）；不写时用 `summary`。 */
    description: Type.Optional(TextSchema),
}, {additionalProperties: false});
export type AgentEvalObjectDeclaration = Static<typeof EvalObjectDeclarationSchema>;

export const evalObjectsPoint: ContributionPointDefinition<AgentEvalObjectDeclaration> = {id: EVAL_OBJECTS_POINT, implementation: "none", idPrefix: "plugin", schema: EvalObjectDeclarationSchema};

export const skillsPoint: ContributionPointDefinition<AgentSkillsDeclaration> = {
    id: SKILLS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    schema: SkillsDeclarationSchema,
    validate: (descriptor) => skillsDirectoryProblem(descriptor.declaration.directory),
};

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

/** 顶层贡献：只有声明。对象的方法用 `agentTool` 另外贡献，声明里写 `global: {object: <这里的 name>, method}`。 */
export function evalObject(id: string, declaration: AgentEvalObjectDeclaration): ContributionDeclaration<AgentEvalObjectDeclaration> {
    return {capability: EVAL_OBJECTS_POINT, id, declaration};
}

/** 顶层贡献：只有声明，不用激活事件（插件的 Skill 不经入口激活，装好就在目录里）。 */
export function agentSkills(id: string, declaration: AgentSkillsDeclaration): ContributionDeclaration<AgentSkillsDeclaration> {
    return {capability: SKILLS_POINT, id, declaration};
}

export function agentProfile(key: string, declaration: AgentProfileDeclaration): {readonly contribution: ContributionDeclaration<AgentProfileDeclaration>; readonly activationEvent: string} {
    return {contribution: {capability: PROFILES_POINT, id: key, declaration}, activationEvent: onAgentProfile(key)};
}

/**
 * `nbook.agent` 的设置项，都只在用户层：它们跟着人走，不跟着书走。
 *
 * - 按 Profile 增减工具、按 Profile 设模型缺省与审批模式的初值：显示在“Profile”页里（docs/specs/agent/profile-settings.md）。
 * - 运行保护（docs/specs/agent/run-guards.md）：显示在分区“运行可靠性”里，`nbook.models` 的两个超时也指向这个分区。
 * - 模型请求记录（docs/specs/agent/request-trace.md 的设置表）：自己一个分区。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineSettings} from "nbook/shared/settings";
import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";

import {RulesSchema} from "./permissions";
import {agentText} from "./text";

const ToolBindingSchema = Type.Object({
    added: Type.Array(Type.String({minLength: 1})),
    removed: Type.Array(Type.String({minLength: 1})),
}, {additionalProperties: false});

/** 工具绑定另有按全局对象加、减的（profile-settings.md 输出 29）；可派的子代理、Skill、表情包的绑定没有。 */
const ProfileToolBindingSchema = Type.Object({
    added: Type.Array(Type.String({minLength: 1})),
    removed: Type.Array(Type.String({minLength: 1})),
    objects: Type.Optional(ToolBindingSchema),
}, {additionalProperties: false});

const ProfileSettingSchema = Type.Object({
    /** `<服务商>/<模型>`；与 `role` 都写时它优先（docs/specs/models/service.md 输出 8）。 */
    model: Type.Optional(Type.String({minLength: 1})),
    role: Type.Optional(Type.String({minLength: 1})),
    approvalMode: Type.Optional(Type.Union([Type.Literal("ask"), Type.Literal("allow-writes"), Type.Literal("auto"), Type.Literal("yolo")])),
    /** 可派的子代理在 Profile 声明之外加、减的（profile-settings.md 输出 25）；形状与规则同工具绑定。 */
    agents: Type.Optional(ToolBindingSchema),
    /** 可用的 Skill 在 Profile 声明之外加、减的（profile-settings.md 输出 26）；形状与规则同工具绑定。 */
    skills: Type.Optional(ToolBindingSchema),
    /** 提示词里列的表情包在 Profile 声明之外加、减的（profile-settings.md 输出 27）；形状与规则同工具绑定。 */
    stickers: Type.Optional(ToolBindingSchema),
}, {additionalProperties: false});

export const ToolBindingsSchema = Type.Record(Type.String({minLength: 1}), ProfileToolBindingSchema);
export const ProfileSettingsSchema = Type.Record(Type.String({minLength: 1}), ProfileSettingSchema);

export type ToolBinding = Static<typeof ToolBindingSchema>;
export type ProfileToolBinding = Static<typeof ProfileToolBindingSchema>;
export type ProfileSetting = Static<typeof ProfileSettingSchema>;

export const RUN_GUARDS_SECTION = "nbook.agent.reliability";
export const RUN_GUARDS_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: agentText("settingsSections.reliability.description"),
    icon: "i-lucide-shield-check",
    category: "ai",
    order: 30,
    groups: [{id: "requests"}, {id: "compaction"}, {id: "guards"}, {id: "resume"}, {id: "subagents"}],
};

export const REQUESTS_SECTION = "nbook.agent.requests";
export const REQUESTS_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: agentText("settingsSections.requests.description"),
    icon: "i-lucide-activity",
    category: "ai",
    order: 40,
};

/** “Profile”页（profile-settings.md）：这两项由页面画，不进“其它”。 */
export const PROFILES_SECTION = "nbook.agent.profiles";

/** “Skill”页（skills.md 输出 25）：只有页面，没有配置项。 */
export const SKILLS_SECTION = "nbook.agent.skills";

/** “状态栏”页（conversation.md 输出 46）：`statusLine` 由页面画，不进“其它”。 */
export const STATUS_LINE_SECTION = "nbook.agent.status-line";

/** “权限规则”页（permissions.md 输出 22）：这几项由页面画，不进“其它”。 */
export const PERMISSIONS_SECTION = "nbook.agent.permissions";

/** 状态栏的设置（conversation.md 输出 45）：只记改过的次序、显隐与边；形状同 nb-agent-ui 的 `StatusLineSetting`。 */
export const StatusLineSchema = Type.Object({
    order: Type.Optional(Type.Array(Type.String({minLength: 1}), {maxItems: 64})),
    visible: Type.Optional(Type.Record(Type.String({minLength: 1}), Type.Boolean())),
    side: Type.Optional(Type.Record(Type.String({minLength: 1}), Type.Union([Type.Literal("left"), Type.Literal("right")]))),
}, {additionalProperties: false});

export const agentSettings = defineSettings("nbook.agent", {
    statusLine: {
        schema: StatusLineSchema,
        default: {},
        title: agentText("settings.statusLine.title"),
        description: agentText("settings.statusLine.description"),
        layers: ["user"],
        section: STATUS_LINE_SECTION,
    },
    permissionRules: {
        schema: RulesSchema,
        default: [],
        title: agentText("settings.permissionRules.title"),
        description: agentText("settings.permissionRules.description"),
        layers: ["user"],
        section: PERMISSIONS_SECTION,
    },
    readOnlyCommands: {
        schema: Type.Array(Type.String({minLength: 1})),
        default: [],
        title: agentText("settings.readOnlyCommands.title"),
        description: agentText("settings.readOnlyCommands.description"),
        layers: ["user"],
        section: PERMISSIONS_SECTION,
    },
    modeWriteAction: {
        schema: Type.Union([Type.Literal("deny"), Type.Literal("ask")]),
        default: "deny",
        title: agentText("settings.modeWriteAction.title"),
        description: agentText("settings.modeWriteAction.description"),
        layers: ["user"],
        section: PERMISSIONS_SECTION,
    },
    toolBindings: {
        schema: ToolBindingsSchema,
        default: {},
        title: agentText("settings.toolBindings.title"),
        description: agentText("settings.toolBindings.description"),
        layers: ["user"],
        section: PROFILES_SECTION,
    },
    profileSettings: {
        schema: ProfileSettingsSchema,
        default: {},
        title: agentText("settings.profileSettings.title"),
        description: agentText("settings.profileSettings.description"),
        layers: ["user"],
        section: PROFILES_SECTION,
    },
    modelRetries: {
        schema: Type.Integer({minimum: 0, maximum: 20}),
        default: 10,
        title: agentText("settings.modelRetries.title"),
        description: agentText("settings.modelRetries.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "requests",
        order: 10,
    },
    /** 有留着的话时继续怎么发（docs/specs/agent/conversation.md 输出 47）；界面点继续时现读。 */
    resumeMode: {
        schema: Type.Union([Type.Literal("merge"), Type.Literal("keep"), Type.Literal("followups")]),
        default: "merge",
        title: agentText("settings.resumeMode.title"),
        description: agentText("settings.resumeMode.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "resume",
        order: 10,
        choices: [{value: "merge"}, {value: "keep"}, {value: "followups"}],
    },
    warnCost: {
        schema: Type.Number({minimum: 0}),
        default: 0,
        title: agentText("settings.warnCost.title"),
        description: agentText("settings.warnCost.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "guards",
        order: 10,
    },
    maxCost: {
        schema: Type.Number({minimum: 0}),
        default: 0,
        title: agentText("settings.maxCost.title"),
        description: agentText("settings.maxCost.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "guards",
        order: 20,
    },
    toolLoopThreshold: {
        schema: Type.Integer({minimum: 0, maximum: 100}),
        default: 5,
        title: agentText("settings.toolLoopThreshold.title"),
        description: agentText("settings.toolLoopThreshold.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "guards",
        order: 30,
    },
    // 子代理与任务中心的上限（subagents.md、jobs.md）：缺省值与硬上限是 t14 第 27 条定的。
    subagentDepth: {
        schema: Type.Integer({minimum: 1, maximum: 5}),
        default: 3,
        title: agentText("settings.subagentDepth.title"),
        description: agentText("settings.subagentDepth.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "subagents",
        order: 10,
    },
    subagentsPerSession: {
        schema: Type.Integer({minimum: 1, maximum: 16}),
        default: 8,
        title: agentText("settings.subagentsPerSession.title"),
        description: agentText("settings.subagentsPerSession.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "subagents",
        order: 20,
    },
    backgroundJobs: {
        schema: Type.Integer({minimum: 1, maximum: 32}),
        default: 16,
        title: agentText("settings.backgroundJobs.title"),
        description: agentText("settings.backgroundJobs.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "subagents",
        order: 30,
    },
    // 前台的 shell 跑过这么多秒还没结束就转后台（builtin-tools.md），0 为不转（t22 决定 2）。
    shellAutoBackground: {
        schema: Type.Integer({minimum: 0, maximum: 3600}),
        default: 60,
        title: agentText("settings.shellAutoBackground.title"),
        description: agentText("settings.shellAutoBackground.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "subagents",
        order: 40,
    },
    // 模型请求记录：缺省开着并存原始请求体、留 14 天、不记请求头（t30 决定 8 到 10）。
    requestTrace: {
        schema: Type.Boolean(),
        default: true,
        title: agentText("settings.requestTrace.title"),
        description: agentText("settings.requestTrace.description"),
        layers: ["user"],
        section: REQUESTS_SECTION,
        order: 10,
    },
    requestTracePayload: {
        schema: Type.Boolean(),
        default: true,
        title: agentText("settings.requestTracePayload.title"),
        description: agentText("settings.requestTracePayload.description"),
        layers: ["user"],
        section: REQUESTS_SECTION,
        order: 20,
    },
    requestTraceDays: {
        schema: Type.Integer({minimum: 1, maximum: 365}),
        default: 14,
        title: agentText("settings.requestTraceDays.title"),
        description: agentText("settings.requestTraceDays.description"),
        layers: ["user"],
        section: REQUESTS_SECTION,
        order: 30,
    },
    requestTraceHeaders: {
        schema: Type.Boolean(),
        default: false,
        title: agentText("settings.requestTraceHeaders.title"),
        description: agentText("settings.requestTraceHeaders.description"),
        layers: ["user"],
        section: REQUESTS_SECTION,
        order: 40,
    },
});

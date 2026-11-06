/**
 * `nbook.agent` 的设置项，都只在用户层：它们跟着人走，不跟着书走。
 *
 * - 按 Profile 增减工具、按 Profile 设模型缺省与审批模式的初值（docs/specs/agent/contributions.md“输入与前置条件”）：没有专门的界面。
 * - 运行保护（docs/specs/agent/run-guards.md）：显示在分区“运行可靠性”里，`nbook.models` 的两个超时也指向这个分区。
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

const ProfileSettingSchema = Type.Object({
    /** `<服务商>/<模型>`；与 `role` 都写时它优先（docs/specs/models/service.md 输出 8）。 */
    model: Type.Optional(Type.String({minLength: 1})),
    role: Type.Optional(Type.String({minLength: 1})),
    approvalMode: Type.Optional(Type.Union([Type.Literal("ask"), Type.Literal("allow-writes"), Type.Literal("auto"), Type.Literal("yolo")])),
}, {additionalProperties: false});

export const ToolBindingsSchema = Type.Record(Type.String({minLength: 1}), ToolBindingSchema);
export const ProfileSettingsSchema = Type.Record(Type.String({minLength: 1}), ProfileSettingSchema);

export type ToolBinding = Static<typeof ToolBindingSchema>;
export type ProfileSetting = Static<typeof ProfileSettingSchema>;

export const RUN_GUARDS_SECTION = "nbook.agent.reliability";
export const RUN_GUARDS_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: agentText("settingsSections.reliability.description"),
    icon: "i-lucide-shield-check",
    category: "ai",
    order: 30,
    groups: [{id: "requests"}, {id: "compaction"}, {id: "guards"}],
};

/** “权限规则”页（permissions.md 输出 22）：这几项由页面画，不进“其它”。 */
export const PERMISSIONS_SECTION = "nbook.agent.permissions";

export const agentSettings = defineSettings("nbook.agent", {
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
    },
    profileSettings: {
        schema: ProfileSettingsSchema,
        default: {},
        title: agentText("settings.profileSettings.title"),
        description: agentText("settings.profileSettings.description"),
        layers: ["user"],
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
});

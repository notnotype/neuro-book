/**
 * `nbook.agent` 的两个设置项（docs/specs/agent/contributions.md“输入与前置条件”）：按 Profile 增减工具、按 Profile 设模型
 * 缺省与审批模式的初值。都只在用户层：它们跟着人走，不跟着书走。本 Task 不做界面，只在设置文件里改。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineSettings} from "nbook/shared/settings";

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

export const agentSettings = defineSettings("nbook.agent", {
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
});

/**
 * `nbook.models` 的设置项（docs/specs/models/service.md“输入与前置条件”）：服务商与模型、模型角色、压缩触发点与流的两个时限。
 * 形状与缺省值在 `@notnotype/nb-models/config`，这里定分区、文字与允许的层：都只允许用户层（指定网络地址与凭据来源的项不让
 * 项目层改，configuration.md 的作者规则），只由本插件的服务端写（service.md 输出 6）。
 */

import {CompactionSettingSchema, DEFAULT_COMPACTION, DEFAULT_ROLES, ProvidersSchema, RolesSchema} from "@notnotype/nb-models/config";
import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

import {modelsText} from "./text";

/** 两个 page 分区的 id（界面在浏览器入口交付）。 */
export const PROVIDERS_SECTION = "nbook.models.providers";
export const ROLES_SECTION = "nbook.models.roles";

/** `nbook.agent` 的分区（docs/specs/agent/run-guards.md）。Agent 依赖模型服务，反过来引用会成环，所以按 id 写。 */
const RUN_GUARDS_SECTION = "nbook.agent.reliability";
/** `nbook.network` 的“网络”分区：自动更新是联网的事，显示在那里；读它的是模型服务，所以设置项归这里。 */
const NETWORK_SECTION = "nbook.network";

export const modelsSettings = defineSettings("nbook.models", {
    compaction: {
        schema: CompactionSettingSchema,
        default: DEFAULT_COMPACTION,
        title: modelsText("settings.compaction.title"),
        description: modelsText("settings.compaction.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "compaction",
        order: 10,
    },
    providers: {
        schema: ProvidersSchema,
        default: [],
        title: modelsText("settings.providers.title"),
        description: modelsText("settings.providers.description"),
        layers: ["user"],
        section: PROVIDERS_SECTION,
    },
    roles: {
        schema: RolesSchema,
        default: DEFAULT_ROLES,
        title: modelsText("settings.roles.title"),
        description: modelsText("settings.roles.description"),
        layers: ["user"],
        section: ROLES_SECTION,
    },
    streamFirstEventTimeoutSeconds: {
        schema: Type.Integer({minimum: 0, maximum: 3600}),
        default: 300,
        title: modelsText("settings.streamFirstEventTimeoutSeconds.title"),
        description: modelsText("settings.streamFirstEventTimeoutSeconds.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "requests",
        order: 20,
    },
    catalogAutoUpdate: {
        schema: Type.Boolean(),
        default: true,
        title: modelsText("settings.catalogAutoUpdate.title"),
        description: modelsText("settings.catalogAutoUpdate.description"),
        layers: ["user"],
        section: NETWORK_SECTION,
        group: "catalog",
        order: 10,
    },
    streamIdleTimeoutSeconds: {
        schema: Type.Integer({minimum: 0, maximum: 3600}),
        default: 300,
        title: modelsText("settings.streamIdleTimeoutSeconds.title"),
        description: modelsText("settings.streamIdleTimeoutSeconds.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "requests",
        order: 30,
    },
});

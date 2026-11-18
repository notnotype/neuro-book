/**
 * `agent.statusItems`（docs/specs/agent/contributions.md 输出 22）：对话状态栏里插件加的项。只在浏览器入口，所以单独放在这里：
 * `points.ts` 是服务端的贡献点，并且被 SDK 的 `agent` 子路径转出，不拖这边的文字类型。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {TextSchema} from "nbook/shared/text";

export const STATUS_ITEMS_POINT = "agent.statusItems";

/**
 * 声明：标题与说明是设置页与右键菜单里的文字，`side` 决定在左在右，`defaultVisible`
 * 缺省关。实现 `{load()}` 交一个组件（属性 `{ctx}`），在浏览器入口交出；shared 里不带 Vue 类型，组件写成 `unknown`，接收者在浏览器一侧收窄。
 */
export const StatusItemDeclarationSchema = Type.Object({
    title: TextSchema,
    description: Type.Optional(TextSchema),
    side: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    defaultVisible: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});
export type AgentStatusItemDeclaration = Static<typeof StatusItemDeclarationSchema>;
export interface AgentStatusItemImplementation {
    /** 交组件或带 `default` 的模块（`() => import("./Item.vue")` 直接写）。 */
    load(): Promise<unknown>;
}

/** 只接受浏览器入口的贡献；声明不合形状同样不登记。 */
export function validateStatusItemContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${STATUS_ITEMS_POINT} only accepts contributions from browser entries`;
    return Value.Check(StatusItemDeclarationSchema, descriptor.declaration) ? null : `Status item ${descriptor.id} has an invalid declaration`;
}
export const statusItemsPoint: ContributionPointDefinition<AgentStatusItemDeclaration> = {id: STATUS_ITEMS_POINT, implementation: "required", idPrefix: "plugin", validate: validateStatusItemContribution};

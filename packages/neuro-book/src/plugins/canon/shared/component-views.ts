/**
 * 贡献点 `canon.component-views`（docs/specs/canon/author-ui.md 输入与前置条件）：给一种 Component 类型交条目页数据分页的
 * 界面。贡献 id 是类型 id，按插件 id 的前缀核对；只收浏览器入口；必须交实现。实现与界面组件收到的 `context` 要 Vue 的类型，
 * 在 `web/component-views.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

export const CANON_COMPONENT_VIEWS_POINT = "canon.component-views";

export const ComponentViewDeclarationSchema = Type.Object({
    /** 分页的名字；不写时补约定键 `componentViews.<本地 id>.title`。 */
    title: Type.Optional(TextSchema),
    /** 这个界面会读到的、同一条目上别的设定组（类型 id）：只是依赖的声明，不是权限（`context.other` 只认这里列了的）。 */
    uses: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    /** 分页的图标：lucide 的类名（例如 `i-lucide-user-round`）；不写时条目页用缺省的（author-ui.md 输出 9）。 */
    icon: Type.Optional(Type.String({minLength: 1, pattern: "^i-lucide-[a-z0-9-]+$"})),
}, {additionalProperties: false});

export type ComponentViewDeclaration = Static<typeof ComponentViewDeclarationSchema>;

export function validateComponentViewContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${CANON_COMPONENT_VIEWS_POINT} only accepts contributions from browser entries`;
    if (!Value.Check(ComponentViewDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(ComponentViewDeclarationSchema, descriptor.declaration)][0];
        return `Component view ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
    }
    return null;
}

export const componentViewsPoint: ContributionPointDefinition = {
    id: CANON_COMPONENT_VIEWS_POINT,
    implementation: "required",
    idPrefix: "plugin",
    complete: conventionCompleter({name: "componentViews", fields: ["title"]}),
    validate: validateComponentViewContribution,
};

/**
 * 贡献点 `canon.entry-tabs`（docs/specs/canon/author-ui.md 输出 36）：给条目页加不对应命名空间的附加分页。贡献 id 按插件 id 的前缀
 * 核对；只收浏览器入口；必须交实现。`requires` 是一个 Component 类型 id（可以是别的插件的）：条目在所选位置上启用了它时才出这个
 * 分页。实现与界面组件收到的 `context` 要 Vue 的类型，在 `web/component-views.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

export const CANON_ENTRY_TABS_POINT = "canon.entry-tabs";

export const EntryTabDeclarationSchema = Type.Object({
    /** 分页的名字；不写时补约定键 `entryTabs.<本地 id>.title`。 */
    title: Type.Optional(TextSchema),
    /** 条目启用了这个 Component 类型时才出这个分页。 */
    requires: Type.String({minLength: 1}),
    /** 几个附加分页之间的先后，小的在前；一样时按贡献 id。 */
    order: Type.Optional(Type.Number()),
    /** 分页的图标：lucide 的类名（例如 `i-lucide-user-round`）；不写时条目页用缺省的（author-ui.md 输出 9）。 */
    icon: Type.Optional(Type.String({minLength: 1, pattern: "^i-lucide-[a-z0-9-]+$"})),
    /** 作品里还没有任何剧情变更时不出这个分页（它全是从剧情里算出来的，空着没用）。 */
    needsChanges: Type.Optional(Type.Literal(true)),
}, {additionalProperties: false});

export type EntryTabDeclaration = Static<typeof EntryTabDeclarationSchema>;

export function validateEntryTabContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${CANON_ENTRY_TABS_POINT} only accepts contributions from browser entries`;
    if (!Value.Check(EntryTabDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EntryTabDeclarationSchema, descriptor.declaration)][0];
        return `Entry tab ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
    }
    return null;
}

export const entryTabsPoint: ContributionPointDefinition = {
    id: CANON_ENTRY_TABS_POINT,
    implementation: "required",
    idPrefix: "plugin",
    complete: conventionCompleter({name: "entryTabs", fields: ["title"]}),
    validate: validateEntryTabContribution,
};

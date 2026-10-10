/**
 * 状态栏与标题栏的条目贡献点（docs/specs/ui/workbench-shell.md 外壳四输出 33）：声明与登记校验。声明是纯数据，前后端
 * 都能引用；实现（`text()` 等）在 `web/contracts.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";

export const WORKBENCH_STATUSBAR_ITEMS_POINT = "workbench.statusbar-items";
export const WORKBENCH_TITLEBAR_ITEMS_POINT = "workbench.titlebar-items";

export type WorkbenchItemsPoint = typeof WORKBENCH_STATUSBAR_ITEMS_POINT | typeof WORKBENCH_TITLEBAR_ITEMS_POINT;

const Rank = Type.Integer({minimum: -1_000_000, maximum: 1_000_000});

export const ItemDeclarationSchema = Type.Object({
    /** 条目的名字：“更多”菜单与读屏用它。 */
    title: LocalizedTextSchema,
    alignment: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    /** 同侧从小到大排。 */
    order: Rank,
    /** 放不下时先收起小的。 */
    priority: Rank,
    command: Type.Optional(Type.Object({id: Type.String({pattern: "\\S"}), args: Type.Optional(Type.Record(Type.String(), Type.Unknown()))}, {additionalProperties: false})),
    when: Type.Optional(Type.Object({requires: Type.Array(Type.String({pattern: "\\S"}))}, {additionalProperties: false})),
}, {additionalProperties: false});

export type ItemDeclaration = Static<typeof ItemDeclarationSchema>;

const ITEM_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/**
 * 两个条目贡献点的登记校验：只看这一条声明本身。id 规则与视图相同（内置插件 `nbook.` 开头，其它插件以自己的插件 id
 * 开头）；同 id 的两条由内核一起拒绝。标题栏的条目只放在右侧操作区。
 */
export function itemValidator(point: WorkbenchItemsPoint): (descriptor: ContributionDescriptor) => string | null {
    return (descriptor) => {
        if (descriptor.location !== "browser") return `${point} 只接受浏览器入口的贡献`;
        const id = descriptor.id;
        if (id.length > 128 || !ITEM_ID.test(id)) return `条目 id 必须是点分的小写段、至多 128 个字符：${id}`;
        const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
        if (!id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的条目 id 必须以 ${prefix} 开头：${id}`;
        if (!Value.Check(ItemDeclarationSchema, descriptor.declaration)) {
            const first = [...Value.Errors(ItemDeclarationSchema, descriptor.declaration)][0];
            return `条目 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
        }
        if (point === WORKBENCH_TITLEBAR_ITEMS_POINT && (descriptor.declaration as ItemDeclaration).alignment !== "right") return `标题栏的条目只放在右侧：${id}`;
        return null;
    };
}

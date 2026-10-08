/**
 * 视图贡献点 `workbench.views` 的声明与登记校验（docs/specs/workbench/views.md“输入与前置条件”）。声明是纯数据，
 * 前后端都能引用；实现（`load()`）与 `ViewContext` 依赖 Vue，在 `web/contracts.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";

export const WORKBENCH_VIEWS_POINT = "workbench.views";

/** 能承载视图容器的三个 Part（ToolPart），也是视图声明的默认位置。 */
export const VIEW_LOCATIONS = ["sidebar", "auxiliarybar", "panel"] as const;

export type ViewLocation = (typeof VIEW_LOCATIONS)[number];

/** 视图 id 与容器 id 的长度上限：布局记录用它们作键，容量估算以此为前提（ui/workbench-shell.md“副作用与数据”）。 */
export const VIEW_ID_MAX_LENGTH = 128;

/** 有效主轴最小值的下限与缺省值（ui/workbench-shell.md“副作用与数据”）。 */
export const VIEW_MIN_SIZE_FLOOR = 33;
export const VIEW_MIN_SIZE_DEFAULT = 64;

const Size = Type.Number({exclusiveMinimum: 0, maximum: 1_000_000});
const SizePair = Type.Object({width: Type.Optional(Size), height: Type.Optional(Size)}, {additionalProperties: false});

export const ViewDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    icon: Type.String({pattern: "\\S"}),
    location: Type.Union([Type.Literal("sidebar"), Type.Literal("auxiliarybar"), Type.Literal("panel")]),
    order: Type.Optional(Type.Number({minimum: -1_000_000, maximum: 1_000_000})),
    layout: Type.Union([Type.Literal("scroll"), Type.Literal("fill")]),
    minimumSize: Type.Optional(SizePair),
    maximumSize: Type.Optional(SizePair),
    movable: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type ViewDeclaration = Static<typeof ViewDeclarationSchema>;

const VIEW_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 一个轴上的有效最小与最大尺寸；最大值低于有效最小值的声明在登记时就被拒绝。 */
export function viewSizeLimits(declaration: ViewDeclaration, axis: "width" | "height"): {readonly min: number; readonly max: number} {
    const min = Math.max(VIEW_MIN_SIZE_FLOOR, declaration.minimumSize?.[axis] ?? VIEW_MIN_SIZE_DEFAULT);
    return {min, max: declaration.maximumSize?.[axis] ?? Number.POSITIVE_INFINITY};
}

/**
 * `workbench.views` 的登记校验：只看这一条声明本身。id 规则与命令相同的思路：内置插件写 `nbook.` 开头，其它插件以
 * 自己的插件 id 加 `.` 开头，避免第三方占用内置命名空间或彼此撞名。
 */
export function validateViewContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_VIEWS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (id.length > VIEW_ID_MAX_LENGTH || !VIEW_ID.test(id)) return `视图 id 必须是点分的小写段、至多 ${VIEW_ID_MAX_LENGTH} 个字符：${id}`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的视图 id 必须以 ${prefix} 开头：${id}`;
    if (!Value.Check(ViewDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(ViewDeclarationSchema, descriptor.declaration)][0];
        return `视图 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    const declaration = descriptor.declaration as ViewDeclaration;
    for (const axis of ["width", "height"] as const) {
        const {min, max} = viewSizeLimits(declaration, axis);
        if (max < min) return `视图 ${id} 的 maximumSize.${axis} 低于有效最小值 ${min}`;
    }
    return null;
}

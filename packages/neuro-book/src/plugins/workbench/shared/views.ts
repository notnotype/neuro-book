/**
 * 视图贡献点 `workbench.views` 的声明与登记校验（docs/specs/workbench/views.md“输入与前置条件”）。声明是纯数据，
 * 前后端都能引用；实现（`load()`）与 `ViewContext` 依赖 Vue，在 `web/contracts.ts`。
 */

import type {DeepReadonly} from "@vue/reactivity";
import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import type {Written} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

export const WORKBENCH_VIEWS_POINT = "workbench.views";

/** 打开视图的命令 id（docs/specs/workbench/views.md 输出 14），参数 `{viewId?}`；作者的状态栏条目收视图助手时执行它。 */
export const OPEN_VIEW_COMMAND = "nbook.view.open";

/** 三个具名面板，也是视图声明的第一次放到哪（docs/specs/ui/workbench-layout.md 输出 4）。 */
export const VIEW_LOCATIONS = ["sidebar", "auxiliarybar", "panel"] as const;

export type ViewLocation = (typeof VIEW_LOCATIONS)[number];

/** 视图 id 的长度上限：布局记录里存着它，容量估算以此为前提（ui/workbench-layout.md“副作用与数据”）。 */
export const VIEW_ID_MAX_LENGTH = 128;

/** 视图声明的最小尺寸的下限与缺省值（workbench/views.md“输入与前置条件”）。 */
export const VIEW_MIN_SIZE_FLOOR = 33;
export const VIEW_MIN_SIZE_DEFAULT = 64;

/** 一个视图至多声明这么多个标题动作：标题行放得下的量级。 */
export const VIEW_ACTIONS_MAX = 8;

const Size = Type.Number({exclusiveMinimum: 0, maximum: 1_000_000});

/**
 * 视图标题动作（docs/specs/workbench/views.md 输出 10）：外壳在面板头里画成图标按钮，点了
 * 执行命令。可用与否、不可用的原因都看命令自己的 `when`（与应用菜单同一规则）。`args: "instance"` 时参数是被点的那个
 * 视图实例的 `{viewId, generation}`，否则是 `{}`；`toggled` 是公开状态的布尔键，为真时按钮是按下的样子。
 */
const ViewActionSchema = Type.Object({
    command: Type.String({pattern: "\\S"}),
    icon: Type.String({pattern: "\\S"}),
    title: TextSchema,
    args: Type.Optional(Type.Literal("instance")),
    toggled: Type.Optional(Type.String({pattern: "\\S"})),
    /** inline（缺省）画成按钮，menu 收进标题行末尾的“⋯”（docs/specs/workbench/views.md 输出 10）。 */
    placement: Type.Optional(Type.Union([Type.Literal("inline"), Type.Literal("menu")])),
}, {additionalProperties: false});

export type ViewAction = DeepReadonly<Static<typeof ViewActionSchema>>;
const SizePair = Type.Object({width: Type.Optional(Size), height: Type.Optional(Size)}, {additionalProperties: false});

export const ViewDeclarationSchema = Type.Object({
    title: TextSchema,
    icon: Type.String({pattern: "\\S"}),
    location: Type.Union([Type.Literal("sidebar"), Type.Literal("auxiliarybar"), Type.Literal("panel")]),
    order: Type.Optional(Type.Number({minimum: -1_000_000, maximum: 1_000_000})),
    layout: Type.Union([Type.Literal("scroll"), Type.Literal("fill")]),
    minimumSize: Type.Optional(SizePair),
    maximumSize: Type.Optional(SizePair),
    movable: Type.Optional(Type.Boolean()),
    /** 能不能浮动（docs/specs/workbench/views.md）；缺省能。不能的视图，松手没有落点时就是取消。 */
    floatable: Type.Optional(Type.Boolean()),
    actions: Type.Optional(Type.Array(ViewActionSchema, {maxItems: VIEW_ACTIONS_MAX})),
}, {additionalProperties: false});

/** 声明是登记后不再改的数据；布局 store 的状态把目录变成深只读，类型就按深只读写，两边一致。 */
export type ViewDeclaration = DeepReadonly<Static<typeof ViewDeclarationSchema>>;

/** 作者写下的视图声明：`title` 与标题动作的 `title` 可以省略，登记时补成约定键。 */
export type WrittenViewDeclaration = Written<Omit<ViewDeclaration, "actions">, "title"> & {
    readonly actions?: ReadonlyArray<Written<ViewAction, "title">>;
};

const VIEW_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 一个轴上的有效最小与最大尺寸；最大值低于有效最小值的声明在登记时就被拒绝。 */
export function viewSizeLimits(declaration: ViewDeclaration, axis: "width" | "height"): {readonly min: number; readonly max: number} {
    const min = Math.max(VIEW_MIN_SIZE_FLOOR, declaration.minimumSize?.[axis] ?? VIEW_MIN_SIZE_DEFAULT);
    return {min, max: declaration.maximumSize?.[axis] ?? Number.POSITIVE_INFINITY};
}

/**
 * `workbench.views` 的登记校验：只看这一条声明本身。id 的前缀由贡献点的 `idPrefix: "plugin"` 交给内核核对（内置插件
 * 以保留的发布者开头，其它插件以自己的插件 id 加 `.` 开头，runtime/plugins.md），这里只看形状与声明。
 */
export function validateViewContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_VIEWS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (id.length > VIEW_ID_MAX_LENGTH || !VIEW_ID.test(id)) return `视图 id 必须是点分的小写段、至多 ${VIEW_ID_MAX_LENGTH} 个字符：${id}`;
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

/**
 * `workbench.views` 的补全：没写 `title` 时补约定键 `views.<本地 id>.title`，标题动作没写 `title` 时补
 * `views.<本地 id>.actions.<命令 id>.title`（docs/specs/workbench/views.md 的“约定键”）。
 */
const completeViewDeclaration = conventionCompleter({
    name: "views",
    fields: ["title"],
    lists: {actions: {segment: (action) => (typeof action.command === "string" ? action.command : null), fields: ["title"]}},
});

/** `workbench.views` 贡献点：插件与测试都用这一份定义。 */
export const viewsPoint: ContributionPointDefinition = {id: WORKBENCH_VIEWS_POINT, implementation: "required", idPrefix: "plugin", complete: completeViewDeclaration, validate: validateViewContribution};

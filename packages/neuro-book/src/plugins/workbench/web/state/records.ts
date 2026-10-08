/**
 * 外壳的三条布局记录（docs/specs/ui/workbench-shell.md“状态与转换”）：都是 `local`，经 `nbook.storage` 保存。
 *
 * - 两条尺寸记录在窗口绑定了项目时用 project 分区，没有绑定时用 user 分区：同一 schema 定义两份，窗口一生只绑定一个
 *   项目，不会中途换分区。
 * - `views-customizations` 在 user 分区。本切片只用面板与 Part 两组字段；外壳二加容器与视图时作为可选字段加入、
 *   版本不变（旧记录仍然合法）。action 只改自己的字段，别的字段原样带回去。
 *
 * 字段都可缺省：缺的按默认显示，只有用户主动改过的才写进记录。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition} from "nbook/shared/storage";

/** 尺寸是正有限 CSS px，上限防住写坏的极端值。 */
const Size = Type.Number({exclusiveMinimum: 0, maximum: 1_000_000});

const SideSizesSchema = Type.Object({sidebarWidth: Type.Optional(Size), auxiliarybarWidth: Type.Optional(Size)}, {additionalProperties: false});
const PanelSizesSchema = Type.Object({panelHeight: Type.Optional(Size), panelWidth: Type.Optional(Size)}, {additionalProperties: false});

// 取值域与 `shell/panel-state.ts`、`shell/layout.ts` 的常量表一致；这里逐个写出字面量，读出的值才有准确的类型。
const PartName = Type.Union([Type.Literal("titlebar"), Type.Literal("activitybar"), Type.Literal("sidebar"), Type.Literal("auxiliarybar")]);

const CustomizationsSchema = Type.Object({
    panel: Type.Optional(Type.Object({
        position: Type.Optional(Type.Union([Type.Literal("bottom"), Type.Literal("top"), Type.Literal("left"), Type.Literal("right")])),
        alignment: Type.Optional(Type.Union([Type.Literal("center"), Type.Literal("left"), Type.Literal("right"), Type.Literal("justify")])),
        hidden: Type.Optional(Type.Boolean()),
        collapsed: Type.Optional(Type.Boolean()),
    }, {additionalProperties: false})),
    hiddenParts: Type.Optional(Type.Array(PartName, {uniqueItems: true})),
    dragCollapsed: Type.Optional(Type.Object({
        sidebar: Type.Optional(Type.Boolean()),
        auxiliarybar: Type.Optional(Type.Boolean()),
        panel: Type.Optional(Type.Boolean()),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

export type SideSizes = Static<typeof SideSizesSchema>;
export type PanelSizes = Static<typeof PanelSizesSchema>;
export type Customizations = Static<typeof CustomizationsSchema>;

export interface LayoutRecords {
    readonly side: RecordDefinition<SideSizes>;
    readonly panelSize: RecordDefinition<PanelSizes>;
    readonly customizations: RecordDefinition<Customizations>;
}

const customizations = defineRecord({key: "views-customizations", scope: "user", locality: "local", version: 1, schema: CustomizationsSchema});

/** 尺寸记录按窗口是否绑定项目取分区。 */
export const LAYOUT_RECORDS: Readonly<Record<"user" | "project", LayoutRecords>> = {
    user: {
        side: defineRecord({key: "layout-sizes-side", scope: "user", locality: "local", version: 1, schema: SideSizesSchema}),
        panelSize: defineRecord({key: "layout-sizes-panel", scope: "user", locality: "local", version: 1, schema: PanelSizesSchema}),
        customizations,
    },
    project: {
        side: defineRecord({key: "layout-sizes-side", scope: "project", locality: "local", version: 1, schema: SideSizesSchema}),
        panelSize: defineRecord({key: "layout-sizes-panel", scope: "project", locality: "local", version: 1, schema: PanelSizesSchema}),
        customizations,
    },
};

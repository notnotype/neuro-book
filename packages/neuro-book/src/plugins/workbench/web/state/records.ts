/**
 * 工作台的布局记录（docs/specs/ui/workbench-layout.md“状态与转换”）：都是 `local`，经 `nbook.storage` 保存。
 *
 * - `workbench.layout`：一棵树的布局文档，按窗口是否绑定项目取 project 或 user 分区。同一 schema 定义两份，窗口一生
 *   只绑定一个项目，不会中途换分区。
 * - `workbench.layout-template`：新项目的初始布局，在 user 分区。
 *
 * 旧外壳的 `layout-sizes-side`、`layout-sizes-panel` 与 `views-customizations` 三条记录不再定义：它们留在用户的
 * 存储里，既不读也不写也不删。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import type {RecordDefinition} from "nbook/shared/storage";

/**
 * 一棵树的布局文档。形状的权威是 nb-layout 的 `validateLayoutDoc`，这里的 schema 只管外层：同一个形状不写两份。显式取 1MiB 上限，
 * 16 组、每组 200 标签时约 250KB，缺省的 64KiB 不够。
 */
const LayoutDocSchema = Type.Object({doc: Type.Unknown()}, {additionalProperties: false});

export type LayoutDocRecord = Static<typeof LayoutDocSchema>;

export const LAYOUT_DOC_RECORDS: Readonly<Record<"user" | "project", RecordDefinition<LayoutDocRecord>>> = {
    user: defineRecord({key: "workbench.layout", scope: "user", locality: "local", version: 1, schema: LayoutDocSchema, maxBytes: MAX_RECORD_MAX_BYTES}),
    project: defineRecord({key: "workbench.layout", scope: "project", locality: "local", version: 1, schema: LayoutDocSchema, maxBytes: MAX_RECORD_MAX_BYTES}),
};

/** 新项目的初始布局：去掉动态标签的文档。 */
export const LAYOUT_TEMPLATE_RECORD: RecordDefinition<LayoutDocRecord> = defineRecord({key: "workbench.layout-template", scope: "user", locality: "local", version: 1, schema: LayoutDocSchema, maxBytes: MAX_RECORD_MAX_BYTES});

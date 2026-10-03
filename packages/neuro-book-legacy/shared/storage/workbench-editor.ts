/**
 * 编辑工作台会话记录的产品定义（Nitro 与浏览器共用）。
 *
 * 一条记录同时承载**分组拓扑（grid 快照）、逐组标签实例与活动组**：它们必须原子发布——
 * 分成两个键会出现"组集合已落盘、树还没有"（或反之）的孤儿状态，恢复时无法区分。
 *
 * **为什么这里不 import nb-ui 的 `GridSnapshot`**：与 `workbench-shell-layout.ts` 同一取舍——
 * 定义必须能被 Nitro 打包，而 nb-ui 的快照模块连带 Vue 组件入口。因此这里按结构声明
 * `{version, root}`，由 `app/utils/editor-workbench/editor-session-storage.ts` 负责把它
 * 接回 nb-ui 的解析与上限校验。定义边界只判断**形状**：语义一致性（叶 ref 与组一一对应、
 * 组内路径唯一、activePath 属于该组）属于领域，在恢复时校验并向用户报告 issue，
 * 不在定义里把结构合法但语义可疑的旧件判成损坏。
 *
 * 未知字段一律保留：记录的读取分类（`value` / `legacy-value` / `unsupported-version` / `corrupt`）
 * 由 storage 的封装版本与 schemaVersion 决定，不是定义边界的事。
 */

import type {StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";

/** 编辑工作台会话的 owner；project 与 user 两个 scope 各有自己的记录键，互不 fallback。 */
export const WORKBENCH_EDITOR_OWNER = "workbench.editor";

/** Project 内编辑会话键；一个 Project 一份。 */
export const WORKBENCH_EDITOR_SESSION_KEY = "session";

/** 未开 Project 的用户资产工作面编辑会话键；显式独立定义，不借用 Project 记录。 */
export const WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY = "user-assets-session";

export const WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION = 1;

/**
 * 编辑会话的容量声明。
 *
 * 标签实例与正文分离，记录里只有路径、编辑器选择与 pin/preview 标记，正常项目远小于上限；
 * 256 KiB / 2 MiB 是给"超大项目 + 大量分屏组"留的余量。同一 owner 的 project 与 user
 * 两条定义各自分区，声明保持一致以免两侧限额漂移。
 */
export const WORKBENCH_EDITOR_LIMITS: StorageLimits = Object.freeze({
    maxValueBytes: 256 * 1024,
    maxRecords: 1024,
    maxPartitionBytes: 2 * 1024 * 1024,
});

/** tree/group 引用的 grid 快照；与 nb-ui 快照 v2 同形，版本判定在恢复侧。 */
export type WorkbenchEditorGridSnapshot = {
    readonly version: number;
    readonly root: unknown;
    readonly [field: string]: unknown;
};

/** 一个标签实例；同一 (group,path) 在组内最多一项，不同组可以显示同一文档。 */
export type WorkbenchEditorTabRecord = {
    readonly path: string;
    readonly editorId: string | null;
    readonly pinned: boolean;
    readonly preview: boolean;
    readonly [field: string]: unknown;
};

export type WorkbenchEditorGroupRecord = {
    readonly id: string;
    readonly activePath: string;
    readonly tabs: readonly WorkbenchEditorTabRecord[];
    readonly [field: string]: unknown;
};

/** 一条编辑工作台会话记录；未知字段（未来版本新增）原样保留。 */
export type WorkbenchEditorSessionRecord = {
    readonly version: number;
    readonly grid: WorkbenchEditorGridSnapshot;
    readonly groups: readonly WorkbenchEditorGroupRecord[];
    readonly activeGroupId: string;
    readonly [field: string]: unknown;
};

function isRecordObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/** 标签实例：四个字段齐全且类型正确；额外字段放行（未来版本新增）。 */
export function isWorkbenchEditorTabRecord(value: unknown): value is WorkbenchEditorTabRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {readonly path?: unknown; readonly editorId?: unknown; readonly pinned?: unknown; readonly preview?: unknown};
    return isNonEmptyString(candidate.path)
        && (candidate.editorId === null || typeof candidate.editorId === "string")
        && typeof candidate.pinned === "boolean"
        && typeof candidate.preview === "boolean";
}

/** 组：id 非空、activePath 是字符串（空串表示该组没有活动标签）、tabs 为标签数组。 */
export function isWorkbenchEditorGroupRecord(value: unknown): value is WorkbenchEditorGroupRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {readonly id?: unknown; readonly activePath?: unknown; readonly tabs?: unknown};
    return isNonEmptyString(candidate.id)
        && typeof candidate.activePath === "string"
        && Array.isArray(candidate.tabs)
        && candidate.tabs.every(isWorkbenchEditorTabRecord);
}

/** grid 快照形状：只要求版本是正整数、root 是对象；树本身的解析归恢复侧。 */
export function isWorkbenchEditorGridSnapshot(value: unknown): value is WorkbenchEditorGridSnapshot {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {readonly version?: unknown; readonly root?: unknown};
    return typeof candidate.version === "number" && Number.isSafeInteger(candidate.version) && candidate.version >= 1
        && isRecordObject(candidate.root);
}

/** 记录形状：字段齐全、类型正确；未知字段与未知版本放行（见文件头）。 */
export function isWorkbenchEditorSessionRecord(value: unknown): value is WorkbenchEditorSessionRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {readonly grid?: unknown; readonly groups?: unknown; readonly activeGroupId?: unknown};
    return isWorkbenchEditorGridSnapshot(candidate.grid)
        && Array.isArray(candidate.groups)
        && candidate.groups.every(isWorkbenchEditorGroupRecord)
        // 空串是合法缺省（"没有活动组"）；"活动组必须存在"是领域一致性检查，不是定义边界。
        && typeof candidate.activeGroupId === "string";
}

/** 缺失记录时的显示回落：空会话由领域现算（默认单组），不落盘成默认记录。 */
export const WORKBENCH_EDITOR_SESSION_DEFAULT: WorkbenchEditorSessionRecord = Object.freeze({
    version: WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION,
    grid: {version: 2, root: {}},
    groups: [],
    activeGroupId: "",
} as WorkbenchEditorSessionRecord);

/** 建立 Project 内编辑会话定义（project/local，单例）。 */
export function defineWorkbenchEditorSessionState(): DefinedStorageState<WorkbenchEditorSessionRecord> {
    return defineStorageState<WorkbenchEditorSessionRecord>({
        owner: WORKBENCH_EDITOR_OWNER,
        key: WORKBENCH_EDITOR_SESSION_KEY,
        scope: "project",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION,
        defaultValue: WORKBENCH_EDITOR_SESSION_DEFAULT,
        validate: isWorkbenchEditorSessionRecord,
        limits: WORKBENCH_EDITOR_LIMITS,
    });
}

/** 建立用户资产工作面编辑会话定义（user/local，单例，显式独立）。 */
export function defineWorkbenchEditorUserAssetsSessionState(): DefinedStorageState<WorkbenchEditorSessionRecord> {
    return defineStorageState<WorkbenchEditorSessionRecord>({
        owner: WORKBENCH_EDITOR_OWNER,
        key: WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION,
        defaultValue: WORKBENCH_EDITOR_SESSION_DEFAULT,
        validate: isWorkbenchEditorSessionRecord,
        limits: WORKBENCH_EDITOR_LIMITS,
    });
}

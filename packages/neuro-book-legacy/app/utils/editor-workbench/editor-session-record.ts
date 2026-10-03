/**
 * 编辑会话记录与呈现之间的**纯算法**：会话 → 候选记录、未知字段保留、记录同一性、恢复期合成。
 *
 * 与 `editor-session.ts` 的分工：那里是组/标签/树的事务边界，这里只做"记录形状 ↔ 本窗口呈现"的换算，
 * 不认识 Store、Storage 与 Vue。`editor-session-storage.ts` 是唯一调用方。
 *
 * 三条口径：
 * 1. **候选记录**（`editorSessionRecordOf`）只搬运需要持久化的字段；grid 快照直接来自宿主，不重建树。
 * 2. **未知字段保留**（`composeEditorSessionRecord`）：以**当前读取原件**为底本，记录/组/标签三层里
 *    存活对象的未知字段原样带过；对象被显式关闭/删除时随对象消失（新组、新标签不继承别人的字段）。
 *    grid 只保留快照封装的未知字段，树内节点由宿主重建，不做逐节点合并。
 * 3. **恢复合成**（`recoverEditorSession`）：布局位置以记录为准，正文只以缓冲为准。
 *    记录里的标签**不按文件树做存在性过滤**（文件树是懒加载的，未展开目录里的路径不在其中，
 *    拿它当判据会把正常标签整批丢掉）；真的不存在由随后的读取失败按既有缺失文件口径处理。
 *    缓冲里有未保存内容却不在记录里 ⇒ 追加到活动组并记 issue（采用远端布局不能等价于丢稿）。
 */

import type {Grid, GridSnapshot} from "@notnotype/nb-ui/layout";
import {
    openTabInGroup,
    type EditorSessionGroup,
    type EditorSessionRecord,
    type EditorSessionState,
    type EditorSessionTab,
} from "nbook/app/utils/editor-workbench/editor-session";
import {
    WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION,
    type WorkbenchEditorGroupRecord,
    type WorkbenchEditorSessionRecord,
    type WorkbenchEditorTabRecord,
} from "nbook/shared/storage/workbench-editor";

const RECORD_KEYS = ["version", "grid", "groups", "activeGroupId"] as const;
const GRID_KEYS = ["version", "root"] as const;
const GROUP_KEYS = ["id", "activePath", "tabs"] as const;
const TAB_KEYS = ["path", "editorId", "pinned", "preview"] as const;

/**
 * 路径比较口径与 Store 的 `normalizeWorkspaceFilePath` 一致：反斜杠与尾斜杠不构成另一条路径。
 * 记录里的路径已经是宿主规范化的结果，这里只兜住平台差异。
 */
function comparablePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 一条路径的恢复事实：标题来自文件节点，dirty 来自**唯一正文权威**（内容 ≠ 磁盘基线）。 */
export type EditorSessionRecoveryBuffer = {
    readonly title: string;
    readonly dirty: boolean;
};

export type EditorSessionRecoveryFacts = {
    /** 路径 → 缓冲事实；没有缓冲的路径就是"还没读过正文"。 */
    readonly buffers: Readonly<Record<string, EditorSessionRecoveryBuffer>>;
};

export type EditorSessionRecovery = {
    readonly state: EditorSessionState;
    readonly grid: Grid<string>;
    readonly issues: readonly string[];
    /** 记录未引用、但有未保存内容的文档；已追加到活动组。 */
    readonly appended: readonly string[];
};

/** 本窗口会话的候选记录：grid 快照由宿主给出（`readEditorSessionSnapshot`），这里不重新序列化树。 */
export function editorSessionRecordOf(state: EditorSessionState, grid: GridSnapshot): EditorSessionRecord {
    return {
        version: WORKBENCH_EDITOR_SESSION_SCHEMA_VERSION,
        grid,
        groups: state.groups.map((group) => ({
            id: group.id,
            activePath: group.activePath,
            tabs: group.tabs.map((tab) => ({
                path: tab.path,
                editorId: tab.editorId,
                pinned: tab.pinned,
                preview: tab.preview,
            })),
        })),
        activeGroupId: state.activeGroupId,
    };
}

/**
 * 记录同一性：**含未知字段**的结构化深比较（键集合、数组顺序与值都要一致；`JSON.stringify` 的键序会影响结果，不能用）。
 *
 * 两处用途都要求这个口径："远端是否仍等于本窗口建立呈现时的原件"（不等就是别人改过，只能重新裁决）
 * 与"远端是否已经等于待存意图"（我们自己写下去的那份就是逐字段相同的）。放宽成只比布局会把
 * 别人新增的未知字段当成没变化，从而在重提时把它们丢掉。
 */
export function sameEditorSessionRecord(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => sameEditorSessionRecord(item, right[index]));
    }
    const leftFields = Object.entries(left as Record<string, unknown>);
    const rightValue = right as Record<string, unknown>;
    return leftFields.length === Object.keys(rightValue).length
        && leftFields.every(([key, value]) => key in rightValue && sameEditorSessionRecord(value, rightValue[key]));
}

/** 取出 `known` 之外的字段（浅拷贝）；未知字段的**值**仍按引用带过，不做深拷贝。 */
function unknownFields(source: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
        if (!known.includes(key)) {
            fields[key] = value;
        }
    }
    return fields;
}

/**
 * 以读取原件为底本合成待写记录：本窗口布局是权威，原件的未知字段随存活对象保留。
 *
 * `base` 为 `null`（没有已确认记录：缺失或删除）时没有底本可继承，直接写本次候选值——
 * 这不会把登记的默认值写成"已确认值"。
 */
export function composeEditorSessionRecord(
    base: WorkbenchEditorSessionRecord | null,
    next: EditorSessionRecord,
): WorkbenchEditorSessionRecord {
    if (base === null) {
        return next;
    }
    const groups: WorkbenchEditorGroupRecord[] = next.groups.map((group) => {
        const previous = base.groups.find((item) => item.id === group.id);
        if (previous === undefined) {
            // 新组：它没有"上一版对象"，不继承任何其它组的字段。
            return group;
        }
        const tabs: WorkbenchEditorTabRecord[] = group.tabs.map((tab) => {
            const prior = previous.tabs.find((item) => item.path === tab.path);
            return prior === undefined ? tab : {...unknownFields(prior, TAB_KEYS), ...tab};
        });
        return {...unknownFields(previous, GROUP_KEYS), ...group, tabs};
    });
    return {
        ...unknownFields(base, RECORD_KEYS),
        ...next,
        grid: {...unknownFields(base.grid, GRID_KEYS), ...next.grid},
        groups,
    };
}

/**
 * 记录 + 宿主事实 → 呈现用的会话。
 *
 * 顺序即产品合同：先按记录建立布局，再补回"记录没引用但有未保存内容"的文档。
 * 追加不改记录里的活动标签：恢复动作不该偷偷换焦点，被追加的文档由 issue 与 notice 指出。
 */
export function recoverEditorSession(
    restored: Readonly<{state: EditorSessionState; grid: Grid<string>; issues: readonly string[]}>,
    facts: EditorSessionRecoveryFacts,
): EditorSessionRecovery {
    const issues: string[] = [...restored.issues];

    const groups: EditorSessionGroup[] = restored.state.groups.map((group) => {
        const tabs: EditorSessionTab[] = [];
        for (const tab of group.tabs) {
            tabs.push({...tab});
        }
        const activePath = tabs.some((tab) => tab.path === group.activePath)
            ? group.activePath
            : tabs[0]?.path ?? "";
        if (group.activePath && activePath !== group.activePath) {
            issues.push(`组 ${group.id} 的记录活动标签未随记录恢复，已回落到 ${activePath || "空"}`);
        }
        return {id: group.id, activePath, tabs};
    });

    const state: EditorSessionState = {groups, activeGroupId: restored.state.activeGroupId};
    return appendDirtyBuffers(state, restored.grid, facts, issues);
}

/** 把记录未引用、且有未保存内容的文档追加到活动组（先按路径排序，结果与缓冲枚举顺序无关）。 */
function appendDirtyBuffers(
    state: EditorSessionState,
    grid: Grid<string>,
    facts: EditorSessionRecoveryFacts,
    issues: string[],
): EditorSessionRecovery {
    const referenced = new Set(state.groups.flatMap((group) => group.tabs.map((tab) => comparablePath(tab.path))));
    const orphans = Object.entries(facts.buffers)
        .filter(([path, buffer]) => buffer.dirty && !referenced.has(comparablePath(path)))
        .map(([path]) => path)
        .sort((left, right) => left.localeCompare(right));
    if (orphans.length === 0) {
        return {state, grid, issues, appended: []};
    }

    const groupId = state.activeGroupId;
    const activePath = state.groups.find((group) => group.id === groupId)?.activePath ?? "";
    let next = state;
    const appended: string[] = [];
    for (const path of orphans) {
        const title = facts.buffers[path]?.title.trim() || path;
        const opened = openTabInGroup(next, {groupId, path, title, mode: "permanent"}, {canEvictPreview: () => false});
        if (!opened.ok) {
            issues.push(`未保存文档 ${path} 无法追加到活动组：${opened.reason}`);
            continue;
        }
        next = opened.state;
        appended.push(path);
    }
    if (appended.length > 0) {
        // 恢复动作不换焦点：记录里的活动标签（若还在）优先。
        next = {
            groups: next.groups.map((group) => group.id === groupId
                && group.activePath !== activePath
                && group.tabs.some((tab) => tab.path === activePath)
                ? {...group, activePath}
                : group),
            activeGroupId: next.activeGroupId,
        };
        issues.push(...appended.map((path) => `记录未引用有未保存内容的文档，已追加到活动组：${path}`));
    }
    return {state: next, grid, issues, appended};
}

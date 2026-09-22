/**
 * `files` 视图展开项的记录会话：把 `workbench.files`/`expanded-paths` 的单一写者、首读门禁与
 * 旧裸键（`nbook.workspaceFilePanel.expandedPaths`）的一次性迁移接成一条线。
 *
 * 与布局记录同一套可见语义（复用 `user-record-session.ts`）：读到分类之前不接受提交；
 * 与已确认值相同就不写盘；冲突/失败保留未确认意图并给出 `retry()`/`abandon()`，不静默吞掉。
 *
 * 旧键迁移按「读旧键 → 记录缺失时条件初始化 → 回读验证一致 → 删除旧键」走
 * （实现在 `legacy-record-migration.ts`）：记录已有值时**不**被旧键覆盖，只做一次性收尾；
 * 任一步失败都保留旧键并留下可见诊断。
 */

import {computed, type Ref} from "vue";
import type {LayoutRecordCommitResult, LayoutRecordIntent} from "nbook/app/utils/workbench/layout-session";
import {
    createBrowserLegacyValueStore,
    type LegacyValueParse,
    type LegacyValueStore,
} from "nbook/app/utils/workbench/legacy-record-migration";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {
    useUserRecordSession,
    type UserRecordSessionNotice,
} from "nbook/app/utils/workbench/user-record-session";
import {
    defineWorkbenchFileTreeExpandedPathsState,
    type WorkbenchFileTreeExpandedPaths,
} from "nbook/shared/storage/workbench-files";

/** 旧实现直接读写的裸键；迁入记录并回读验证后删除。 */
export const LEGACY_FILE_TREE_EXPANDED_PATHS_KEY = "nbook.workspaceFilePanel.expandedPaths";

/** 记录里只保留非空路径并去重，保持首次出现的顺序（与旧键写法一致，但不接受非字符串）。 */
export function normalizeExpandedPaths(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const path of paths) {
        if (typeof path !== "string" || path.length === 0 || seen.has(path)) {
            continue;
        }
        seen.add(path);
        normalized.push(path);
    }
    return normalized;
}

/** 集合比较：展开项的顺序不承载语义，同一集合不产生写入。 */
export function sameExpandedPathSet(left: readonly string[], right: readonly string[]): boolean {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    if (leftSet.size !== rightSet.size) {
        return false;
    }
    for (const path of rightSet) {
        if (!leftSet.has(path)) {
            return false;
        }
    }
    return true;
}

/** 旧键原值的解析：非数组与被截断的 JSON 都算不可迁移，不当作"空展开"。 */
export function parseLegacyExpandedPaths(raw: string): LegacyValueParse<readonly string[]> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {value: null, diagnosis: "旧键内容不是合法 JSON"};
    }
    if (!Array.isArray(parsed)) {
        return {value: null, diagnosis: "旧键内容不是路径数组"};
    }
    return {value: normalizeExpandedPaths(parsed as readonly string[]), diagnosis: null};
}

/**
 * 展开项合成到读取时的原件（含未知字段）：没有已确认记录时不写空展开，
 * 与已确认集合相同也不写盘。
 */
function composeExpandedPaths(
    base: WorkbenchFileTreeExpandedPaths | null,
    paths: readonly string[],
): LayoutRecordIntent<WorkbenchFileTreeExpandedPaths> {
    const normalized = normalizeExpandedPaths(paths);
    const value: WorkbenchFileTreeExpandedPaths = base === null
        ? {paths: normalized}
        : {...base, paths: normalized};
    const changed = base === null
        ? normalized.length > 0
        : !sameExpandedPathSet(base.paths, normalized);
    return changed
        ? {value, changed: true, diagnosis: ""}
        : {value, changed: false, diagnosis: "展开项与已确认值相同，未写盘"};
}

export type WorkbenchFileTreeExpandedPathsNotice = UserRecordSessionNotice;

export type WorkbenchFileTreeExpandedPathsConsumer = {
    /** 当前显示：未确认意图优先，其次已确认值，再次产品默认（不展开）。 */
    readonly expandedPaths: Readonly<Ref<readonly string[]>>;
    /** 首读门禁：记录还没读到分类。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 旧键迁移未完成的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<WorkbenchFileTreeExpandedPathsNotice | null>>;
    /** 提交一份展开项；回执交回调用方（`saved` / `unchanged` / `unsaved` / `rejected`），不吞结果。 */
    commit(paths: readonly string[]): Promise<LayoutRecordCommitResult>;
    /** 与 `commit` 同一条回执通道：重试也要把真实结果交回调用方，不能只看「还挂着未确认」就当成功。 */
    retry(): Promise<LayoutRecordCommitResult>;
    abandon(): void;
    release(): Promise<void>;
};

export type WorkbenchFileTreeExpandedPathsOptions = {
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
    /** 测试注入的旧键访问器。 */
    readonly legacy?: LegacyValueStore;
};

/**
 * 文件树展开项的 user/local 记录会话。
 *
 * 这是该记录的唯一写者：组件不再直接读写 `localStorage`（`boundaries.md:103`）。
 */
export function useWorkbenchFileTreeExpandedPaths(
    options: WorkbenchFileTreeExpandedPathsOptions = {},
): WorkbenchFileTreeExpandedPathsConsumer {
    const session = useUserRecordSession<WorkbenchFileTreeExpandedPaths, readonly string[]>({
        definition: defineWorkbenchFileTreeExpandedPathsState,
        compose: composeExpandedPaths,
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
        legacy: {
            store: options.legacy ?? createBrowserLegacyValueStore(LEGACY_FILE_TREE_EXPANDED_PATHS_KEY),
            label: "旧展开记录",
            parse: parseLegacyExpandedPaths,
            isEmpty: (paths) => paths.length === 0,
            same: (record, paths) => sameExpandedPathSet(record.paths, paths),
        },
    });
    return {
        expandedPaths: computed(() => session.display.value.paths),
        loading: session.loading,
        notice: session.notice,
        commit: session.commit,
        retry: session.retry,
        abandon: session.abandon,
        release: session.release,
    };
}

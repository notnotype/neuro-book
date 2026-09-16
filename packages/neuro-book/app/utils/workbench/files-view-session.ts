/**
 * `files` 视图展开项的记录会话：把 `workbench.files`/`expanded-paths` 的单一写者、首读门禁与
 * 旧裸键（`nbook.workspaceFilePanel.expandedPaths`）的一次性迁移接成一条线。
 *
 * 与布局记录同一套可见语义（复用 `createLayoutRecordSession`）：读到分类之前不接受提交；
 * 与已确认值相同就不写盘；冲突/失败保留未确认意图并给出 `retry()`/`abandon()`，不静默吞掉。
 *
 * 旧键迁移按「读旧键 → 记录缺失时条件初始化 → 回读验证一致 → 删除旧键」走：
 * 记录已有值时**不**被旧键覆盖，只做一次性收尾；任一步失败都保留旧键并留下可见诊断。
 */

import {onScopeDispose, readonly, ref, shallowRef, type Ref} from "vue";
import {
    createLayoutRecordSession,
    type LayoutRecordIntent,
    type LayoutRecordSession,
} from "nbook/app/utils/workbench/layout-session";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {
    defineWorkbenchFileTreeExpandedPathsState,
    WORKBENCH_FILES_OWNER,
    type WorkbenchFileTreeExpandedPaths,
} from "nbook/shared/storage/workbench-files";

/** 旧实现直接读写的裸键；迁入记录并回读验证后删除。 */
export const LEGACY_FILE_TREE_EXPANDED_PATHS_KEY = "nbook.workspaceFilePanel.expandedPaths";

export type LegacyExpandedPathsReading =
    | {readonly kind: "absent"}
    /** 浏览器存储不可用（隐私模式、被禁用）：不是"没有旧记录"，不能据此宣称迁移完成。 */
    | {readonly kind: "unavailable"; readonly diagnosis: string}
    | {readonly kind: "value"; readonly raw: string};

/** 旧键访问接缝：SSR 与测试都不碰真实 `window.localStorage`。 */
export type LegacyExpandedPathsStore = {
    read(): LegacyExpandedPathsReading;
    /** 删除旧键；`true` 表示删除后已确认不存在。 */
    remove(): boolean;
};

/** 解析结果：`paths` 只在 `diagnosis` 为 null 时才是可信的旧值。 */
export type LegacyExpandedPathsParse = {
    readonly paths: readonly string[];
    readonly diagnosis: string | null;
};

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
export function parseLegacyExpandedPaths(raw: string): LegacyExpandedPathsParse {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {paths: [], diagnosis: "旧键内容不是合法 JSON"};
    }
    if (!Array.isArray(parsed)) {
        return {paths: [], diagnosis: "旧键内容不是路径数组"};
    }
    return {paths: normalizeExpandedPaths(parsed as readonly string[]), diagnosis: null};
}

function browserLegacyStore(): LegacyExpandedPathsStore {
    return {
        read(): LegacyExpandedPathsReading {
            if (!import.meta.client) {
                return {kind: "absent"};
            }
            try {
                const raw = window.localStorage.getItem(LEGACY_FILE_TREE_EXPANDED_PATHS_KEY);
                return raw === null ? {kind: "absent"} : {kind: "value", raw};
            } catch (error) {
                return {
                    kind: "unavailable",
                    diagnosis: error instanceof Error ? error.message : String(error),
                };
            }
        },
        remove(): boolean {
            if (!import.meta.client) {
                return false;
            }
            try {
                window.localStorage.removeItem(LEGACY_FILE_TREE_EXPANDED_PATHS_KEY);
                return window.localStorage.getItem(LEGACY_FILE_TREE_EXPANDED_PATHS_KEY) === null;
            } catch {
                return false;
            }
        },
    };
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

export type WorkbenchFileTreeExpandedPathsNotice = {
    readonly diagnosis: string;
    readonly retryable: boolean;
};

export type WorkbenchFileTreeExpandedPathsConsumer = {
    /** 当前显示：未确认意图优先，其次已确认值，再次产品默认（不展开）。 */
    readonly expandedPaths: Readonly<Ref<readonly string[]>>;
    /** 首读门禁：记录还没读到分类。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 旧键迁移未完成的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<WorkbenchFileTreeExpandedPathsNotice | null>>;
    commit(paths: readonly string[]): Promise<void>;
    retry(): Promise<void>;
    abandon(): void;
    release(): Promise<void>;
};

export type WorkbenchFileTreeExpandedPathsOptions = {
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
    /** 测试注入的旧键访问器。 */
    readonly legacy?: LegacyExpandedPathsStore;
};

/**
 * 文件树展开项的 user/local 记录会话。
 *
 * 这是该记录的唯一写者：组件不再直接读写 `localStorage`（`boundaries.md:103`）。
 */
export function useWorkbenchFileTreeExpandedPaths(
    options: WorkbenchFileTreeExpandedPathsOptions = {},
): WorkbenchFileTreeExpandedPathsConsumer {
    const legacy = options.legacy ?? browserLegacyStore();
    const definition = defineWorkbenchFileTreeExpandedPathsState();
    const context = createWorkbenchStorageContext({
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
    });
    const expandedPaths = ref<readonly string[]>([]);
    const loading = ref(true);
    const notice = ref<WorkbenchFileTreeExpandedPathsNotice | null>(null);
    const session = shallowRef<LayoutRecordSession<WorkbenchFileTreeExpandedPaths, readonly string[]> | null>(null);
    let ownerHandle: WorkbenchStorageOwnerHandle | null = null;
    /** 旧键迁移的诊断：只在旧键确实还在、且迁移没做完时存在。 */
    let migrationNotice: WorkbenchFileTreeExpandedPathsNotice | null = null;

    const publish = (): void => {
        const current = session.value;
        if (current === null) {
            return;
        }
        const state = current.state();
        expandedPaths.value = current.display().paths;
        loading.value = state.phase === "loading" || state.phase === "idle";
        if (state.pending !== null) {
            notice.value = {diagnosis: state.pending.diagnosis, retryable: state.pending.retryable};
            return;
        }
        if (state.blocked !== null) {
            notice.value = {
                diagnosis: state.issues.at(-1) ?? `Storage 记录不可用（${state.blocked}）`,
                retryable: false,
            };
            return;
        }
        notice.value = migrationNotice;
    };

    const setMigrationNotice = (diagnosis: string, retryable: boolean): void => {
        migrationNotice = {diagnosis, retryable};
        publish();
    };

    /**
     * 旧键的一次性迁移。任何一步失败都保留旧键并留下诊断——宁可下次再迁，也不丢掉用户的展开项。
     */
    const migrateLegacyRecord = async (): Promise<void> => {
        const current = session.value;
        const handle = ownerHandle;
        if (current === null || handle === null) {
            return;
        }
        const reading = legacy.read();
        if (reading.kind === "absent") {
            migrationNotice = null;
            publish();
            return;
        }
        if (reading.kind === "unavailable") {
            setMigrationNotice(`旧展开记录不可读，未迁移也未删除：${reading.diagnosis}`, true);
            return;
        }
        const parsed = parseLegacyExpandedPaths(reading.raw);
        if (parsed.diagnosis !== null) {
            setMigrationNotice(`旧展开记录未迁移（${parsed.diagnosis}）：旧键保留`, false);
            return;
        }
        const state = current.state();
        if (!state.writable || state.blocked !== null) {
            setMigrationNotice("Storage 记录当前不可写，旧展开记录保留原位", true);
            return;
        }
        if (state.pending !== null) {
            // 用户刚做的调整优先：本轮不碰旧键，等该意图结算后再收尾。
            return;
        }
        if (state.hasConfirmed) {
            // 记录已经是权威：不覆盖它，只做一次性收尾（记录已在首读时回读确认）。
            if (!legacy.remove()) {
                setMigrationNotice("旧展开记录删除失败，旧键仍留在浏览器存储里", true);
                return;
            }
            migrationNotice = null;
            publish();
            return;
        }
        if (parsed.paths.length === 0) {
            // 空旧值没有可迁移的信息：同样按收尾删除处理。
            if (!legacy.remove()) {
                setMigrationNotice("旧展开记录删除失败，旧键仍留在浏览器存储里", true);
                return;
            }
            migrationNotice = null;
            publish();
            return;
        }
        const committed = await current.commit(parsed.paths);
        publish();
        if (committed.status !== "saved" && committed.status !== "unchanged") {
            setMigrationNotice(`旧展开记录迁移未确认（${committed.diagnosis}）：旧键保留`, true);
            return;
        }
        let readPaths: readonly string[] | null = null;
        try {
            const snapshot = await handle.read(definition);
            readPaths = snapshot.kind === "value" ? snapshot.value.paths : null;
        } catch (error) {
            setMigrationNotice(`旧展开记录回读失败（${error instanceof Error ? error.message : String(error)}）：旧键保留`, true);
            return;
        }
        if (readPaths === null || !sameExpandedPathSet(readPaths, parsed.paths)) {
            setMigrationNotice("旧展开记录回读与写入不一致：旧键保留，可重试", true);
            return;
        }
        if (!legacy.remove()) {
            setMigrationNotice("旧展开记录删除失败，旧键仍留在浏览器存储里", true);
            return;
        }
        migrationNotice = null;
        publish();
    };

    let opening: Promise<void> | null = null;
    const open = (): Promise<void> => {
        opening ??= (async () => {
            const owned = await context.userOwner(WORKBENCH_FILES_OWNER);
            if (owned.status !== "ready") {
                // 句柄不可用不是终局：保留重试入口（否则一次冷启动失败会让偏好永久不可读写）。
                opening = null;
                loading.value = false;
                notice.value = {diagnosis: owned.diagnosis, retryable: false};
                return;
            }
            ownerHandle = owned.handle;
            const created = createLayoutRecordSession<WorkbenchFileTreeExpandedPaths, readonly string[]>({
                handle: owned.handle,
                definition,
                compose: composeExpandedPaths,
                onChange: publish,
            });
            session.value = created;
            await created.open();
            publish();
            await migrateLegacyRecord();
        })();
        return opening;
    };

    const consumer: WorkbenchFileTreeExpandedPathsConsumer = {
        expandedPaths: readonly(expandedPaths),
        loading: readonly(loading),
        notice: readonly(notice),

        async commit(paths: readonly string[]): Promise<void> {
            // 首读门禁：等首次读取分类完成再提交，用户的调整不因为"还在读"被丢掉。
            await open();
            const current = session.value;
            if (current === null) {
                return;
            }
            await current.commit(paths);
            publish();
        },

        async retry(): Promise<void> {
            await open();
            const current = session.value;
            if (current === null) {
                return;
            }
            await current.retry();
            publish();
            await migrateLegacyRecord();
        },

        abandon(): void {
            session.value?.abandon();
            publish();
        },

        async release(): Promise<void> {
            await session.value?.release();
            await context.release();
            publish();
        },
    };

    onScopeDispose(() => {
        void consumer.release();
    });
    void open();
    return consumer;
}

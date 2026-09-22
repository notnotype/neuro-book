/**
 * 旧裸键的一次性迁移原语：读旧键 → 记录缺失时条件初始化 → 回读验证一致 → 删除旧键。
 *
 * 三种消费者（`files` 展开项、设置窗口尺寸、新建作品对话框尺寸）走同一条链路：任何一步失败都保留旧键
 * 并留下可见诊断——宁可下次再迁，也不丢掉用户的旧偏好；记录已经是权威时不被旧键覆盖，只做一次性收尾。
 *
 * 本模块是纯模块：不 import Vue、不读存储。浏览器存储访问器由 `createBrowserLegacyValueStore` 提供，
 * 测试与 SSR 都走注入的接缝。
 */

import type {DefinedStorageState} from "nbook/shared/storage/definition";
import type {LayoutRecordSession} from "nbook/app/utils/workbench/layout-session";
import type {WorkbenchStorageOwnerHandle} from "nbook/app/utils/workbench/storage-context";

export type LegacyValueReading =
    | {readonly kind: "absent"}
    /** 浏览器存储不可用（隐私模式、被禁用）：不是"没有旧记录"，不能据此宣称迁移完成。 */
    | {readonly kind: "unavailable"; readonly diagnosis: string}
    | {readonly kind: "value"; readonly raw: string};

/** 旧键访问接缝：SSR 与测试都不碰真实 `window.localStorage`。 */
export type LegacyValueStore = {
    read(): LegacyValueReading;
    /** 删除旧键；`true` 表示删除后已确认不存在。 */
    remove(): boolean;
};

/** 解析结果：`value` 只在 `diagnosis` 为 null 时才是可信的旧值。 */
export type LegacyValueParse<T> = {
    readonly value: T | null;
    readonly diagnosis: string | null;
};

/** 浏览器存储的最小面：只看得到 `createBrowserLegacyValueStore` 真正用到的那两个方法。 */
export type LegacyValueStorage = Pick<Storage, "getItem" | "removeItem">;

/**
 * 解析当前环境可用的浏览器存储；没有（SSR）返回 null。
 *
 * 访问 `window.localStorage` **本身**也可能抛（隐私模式、被策略禁用），所以解析放在 `read`/`remove`
 * 的 try 里，由调用方把它归到 `unavailable`——注入这个解析器是测试缝隙：vitest 里 `import.meta.client`
 * 不为真，抛错这条路径只能靠注入走到。
 */
function browserLegacyStorage(): LegacyValueStorage | null {
    return import.meta.client ? window.localStorage : null;
}

/** 浏览器旧键访问器：一个键一个实例；没有存储时读作"不存在"，删除一律失败（不假装迁完）。 */
export function createBrowserLegacyValueStore(
    key: string,
    resolveStorage: () => LegacyValueStorage | null = browserLegacyStorage,
): LegacyValueStore {
    return {
        read(): LegacyValueReading {
            try {
                const storage = resolveStorage();
                if (storage === null) {
                    return {kind: "absent"};
                }
                const raw = storage.getItem(key);
                return raw === null ? {kind: "absent"} : {kind: "value", raw};
            } catch (error) {
                return {
                    kind: "unavailable",
                    diagnosis: error instanceof Error ? error.message : String(error),
                };
            }
        },
        remove(): boolean {
            try {
                const storage = resolveStorage();
                if (storage === null) {
                    return false;
                }
                storage.removeItem(key);
                return storage.getItem(key) === null;
            } catch {
                return false;
            }
        },
    };
}

export type LegacyRecordMigrationOptions<T, I> = {
    readonly session: LayoutRecordSession<T, I>;
    /** 工作台借用的 owner 句柄；本模块只借用 `read`，不释放它。 */
    readonly handle: WorkbenchStorageOwnerHandle;
    readonly definition: DefinedStorageState<T>;
    readonly store: LegacyValueStore;
    /** 诊断里指代旧记录的名词，例如「旧展开记录」。 */
    readonly label: string;
    readonly parse: (raw: string) => LegacyValueParse<I>;
    /** 旧值里没有可迁移的信息（例如空展开项）：按收尾删除处理，不写记录。 */
    readonly isEmpty: (value: I) => boolean;
    /** 记录是否已经满足旧值：迁移后回读的比对口径。 */
    readonly same: (record: T, value: I) => boolean;
};

export type LegacyRecordMigrationResult =
    | {readonly kind: "settled"}
    /** 本轮不碰旧键（用户刚做的调整优先），保留上一次的诊断。 */
    | {readonly kind: "deferred"}
    | {readonly kind: "notice"; readonly diagnosis: string; readonly retryable: boolean};

/**
 * 执行一次迁移尝试；`deferred` 之外的结果都可以直接覆盖调用方持有的迁移诊断。
 */
export async function migrateLegacyRecord<T, I>(
    options: LegacyRecordMigrationOptions<T, I>,
): Promise<LegacyRecordMigrationResult> {
    const {session, handle, definition, store, label, parse, isEmpty, same} = options;
    const reading = store.read();
    if (reading.kind === "absent") {
        return {kind: "settled"};
    }
    if (reading.kind === "unavailable") {
        return {kind: "notice", diagnosis: `${label}不可读，未迁移也未删除：${reading.diagnosis}`, retryable: true};
    }
    const parsed = parse(reading.raw);
    if (parsed.diagnosis !== null || parsed.value === null) {
        return {kind: "notice", diagnosis: `${label}未迁移（${parsed.diagnosis ?? "旧值不可用"}）：旧键保留`, retryable: false};
    }
    const value = parsed.value;
    const state = session.state();
    if (!state.writable || state.blocked !== null) {
        return {kind: "notice", diagnosis: `Storage 记录当前不可写，${label}保留原位`, retryable: true};
    }
    if (state.pending !== null) {
        // 用户刚做的调整优先：本轮不碰旧键，等该意图结算后再收尾。
        return {kind: "deferred"};
    }
    if (state.hasConfirmed) {
        // 记录已经是权威：不覆盖它，只做一次性收尾（记录已在首读时回读确认）。
        return store.remove()
            ? {kind: "settled"}
            : {kind: "notice", diagnosis: `${label}删除失败，旧键仍留在浏览器存储里`, retryable: true};
    }
    if (isEmpty(value)) {
        // 空旧值没有可迁移的信息：同样按收尾删除处理。
        return store.remove()
            ? {kind: "settled"}
            : {kind: "notice", diagnosis: `${label}删除失败，旧键仍留在浏览器存储里`, retryable: true};
    }
    const committed = await session.commit(value);
    if (committed.status !== "saved" && committed.status !== "unchanged") {
        return {kind: "notice", diagnosis: `${label}迁移未确认（${committed.diagnosis}）：旧键保留`, retryable: true};
    }
    let record: T | null = null;
    try {
        const snapshot = await handle.read(definition);
        record = snapshot.kind === "value" ? snapshot.value : null;
    } catch (error) {
        return {
            kind: "notice",
            diagnosis: `${label}回读失败（${error instanceof Error ? error.message : String(error)}）：旧键保留`,
            retryable: true,
        };
    }
    if (record === null || !same(record, value)) {
        return {kind: "notice", diagnosis: `${label}回读与写入不一致：旧键保留，可重试`, retryable: true};
    }
    return store.remove()
        ? {kind: "settled"}
        : {kind: "notice", diagnosis: `${label}删除失败，旧键仍留在浏览器存储里`, retryable: true};
}

/**
 * user/local 单条记录会话的接线：把「工作台 Storage 上下文 → owner 句柄 → 记录会话 → 旧键一次性迁移」
 * 收成一条线，供 `files` 展开项与两个窗口尺寸记录共用。
 *
 * 与布局记录同一套可见语义（复用 `createLayoutRecordSession`）：读到分类之前不接受提交；与已确认值相同
 * 就不写盘；冲突/失败保留未确认意图并给出 `retry()`/`abandon()`，不静默吞掉。
 *
 * 首读门禁是**两层**：调用方必须让调整控件在 `loading` 期间不可用（`persistence.md`
 * 「尺寸调整控件在读取就绪前不可用」的界面义务），本模块的 `commit` 再兜一层——
 * 读取就绪前拒绝该次提交（**不排队重放**：那种调用基于产品默认值，重放会覆盖已确认记录），
 * 并把拒绝写成一条可见诊断。
 *
 * 归属由调用方给出的定义决定（owner/键/schema/默认值都在 `shared/storage/**`）；本模块只做接线，
 * 不认识具体记录形状。
 */

import {onScopeDispose, readonly, ref, shallowRef, type Ref} from "vue";
import {createLayoutRecordSession, type LayoutRecordIntent, type LayoutRecordSession} from "nbook/app/utils/workbench/layout-session";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {
    migrateLegacyRecord,
    type LegacyValueParse,
    type LegacyValueStore,
} from "nbook/app/utils/workbench/legacy-record-migration";
import type {DefinedStorageState} from "nbook/shared/storage/definition";

export type UserRecordSessionNotice = {
    readonly diagnosis: string;
    readonly retryable: boolean;
};

export type UserRecordSession<T, I> = {
    /** 当前显示：未确认意图优先，其次已确认值，再次定义里的默认值。 */
    readonly display: Readonly<Ref<T>>;
    /** 首读门禁：记录还没读到分类。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 旧键迁移未完成的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<UserRecordSessionNotice | null>>;
    commit(intent: I): Promise<void>;
    retry(): Promise<void>;
    abandon(): void;
    release(): Promise<void>;
};

/**
 * 旧键的一次性迁移配置。
 *
 * `label` 只进诊断文案（例如「旧展开记录」）；`same` 是迁移后回读的比对口径，
 * 记录已经是权威时不参与——那条路只做一次性收尾，不写记录。
 */
export type UserRecordSessionLegacy<T, I> = {
    readonly store: LegacyValueStore;
    readonly label: string;
    readonly parse: (raw: string) => LegacyValueParse<I>;
    /** 旧值里没有可迁移的信息（例如空展开项）。 */
    readonly isEmpty: (value: I) => boolean;
    readonly same: (record: T, value: I) => boolean;
};

export type UserRecordSessionOptions<T, I> = {
    readonly definition: () => DefinedStorageState<T>;
    /** 把本地意图合成到已确认值上；语义见 `createLayoutRecordSession`。 */
    readonly compose: (base: T | null, intent: I) => LayoutRecordIntent<T>;
    readonly legacy?: UserRecordSessionLegacy<T, I>;
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
};

/**
 * 建立一条 user/local 记录的会话；这是该记录的唯一写者，组件不再直接读写 `localStorage`
 * （`boundaries.md:103`）。
 */
export function useUserRecordSession<T, I>(options: UserRecordSessionOptions<T, I>): UserRecordSession<T, I> {
    const definition = options.definition();
    const context = createWorkbenchStorageContext({
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
    });
    const display = shallowRef<T>(definition.defaultValue);
    const loading = ref(true);
    const notice = ref<UserRecordSessionNotice | null>(null);
    const session = shallowRef<LayoutRecordSession<T, I> | null>(null);
    let ownerHandle: WorkbenchStorageOwnerHandle | null = null;
    /** 旧键迁移的诊断：只在旧键确实还在、且迁移没做完时存在。 */
    let migrationNotice: UserRecordSessionNotice | null = null;
    /** 首读门禁被触发的诊断：读取就绪前控件本该不可用，这里兜住漏网的提交。 */
    let gateNotice: UserRecordSessionNotice | null = null;

    const publish = (): void => {
        const current = session.value;
        if (current === null) {
            return;
        }
        const state = current.state();
        display.value = current.display();
        loading.value = state.phase === "loading" || state.phase === "idle";
        if (!loading.value) {
            // 读取已就绪：门禁诊断不再成立（此刻显示的就是已确认值，用户看到的是真实状态）。
            gateNotice = null;
        }
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
        notice.value = gateNotice ?? migrationNotice;
    };

    /** 旧键迁移：任何一步失败都保留旧键并留下诊断（实现在 `legacy-record-migration.ts`）。 */
    const migrateLegacy = async (): Promise<void> => {
        const current = session.value;
        const handle = ownerHandle;
        const legacy = options.legacy;
        if (current === null || handle === null || legacy === undefined) {
            return;
        }
        const result = await migrateLegacyRecord({
            session: current,
            handle,
            definition,
            store: legacy.store,
            label: legacy.label,
            parse: legacy.parse,
            isEmpty: legacy.isEmpty,
            same: legacy.same,
        });
        if (result.kind === "deferred") {
            return;
        }
        migrationNotice = result.kind === "notice" ? {diagnosis: result.diagnosis, retryable: result.retryable} : null;
        publish();
    };

    let opening: Promise<void> | null = null;
    const open = (): Promise<void> => {
        opening ??= (async () => {
            const owned = await context.userOwner(definition.owner);
            if (owned.status !== "ready") {
                // 句柄不可用不是终局：保留重试入口（否则一次冷启动失败会让偏好永久不可读写）。
                opening = null;
                loading.value = false;
                notice.value = {diagnosis: owned.diagnosis, retryable: false};
                return;
            }
            ownerHandle = owned.handle;
            const created = createLayoutRecordSession<T, I>({
                handle: owned.handle,
                definition,
                compose: options.compose,
                onChange: publish,
            });
            session.value = created;
            await created.open();
            publish();
            await migrateLegacy();
        })();
        return opening;
    };

    const consumer: UserRecordSession<T, I> = {
        // `readonly()` 会把泛型 T 投影成 `DeepReadonly<T>`（对任意 T 不成立）；对外契约是只读引用，
        // 运行时仍然只读，因此在这里把类型收成 `Readonly<Ref<T>>`。
        display: readonly(display) as Readonly<Ref<T>>,
        loading: readonly(loading),
        notice: readonly(notice),

        async commit(intent: I): Promise<void> {
            const current = session.value;
            // 首读门禁：读到分类之前不接受提交。读取完成前界面上就没有可交互的控件（面板渲染加载态、
            // 其它宿主禁用调整手势），这里兜住漏网调用——**不排队重放**：此刻调用方基于的是产品默认值，
            // 等读回来再按它合成会用陈旧意图覆盖已确认记录；拒绝同样必须可见，不能静默丢弃。
            if (current === null || loading.value) {
                gateNotice = {
                    diagnosis: "记录还没完成首次读取，本次调整没有保存",
                    retryable: false,
                };
                if (current === null) {
                    // 会话还没建起来：publish() 此刻什么都不刷新，直接把这条诊断放上条。
                    notice.value = gateNotice;
                    return;
                }
                publish();
                return;
            }
            await current.commit(intent);
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
            await migrateLegacy();
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

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
import {createLayoutRecordSession, type LayoutRecordCommitResult, type LayoutRecordIntent, type LayoutRecordSession} from "nbook/app/utils/workbench/layout-session";
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
    /**
     * 现在调用 `abandon()` 是否真的会丢弃未确认意图。
     *
     * 与 `retryable` 分开：句柄不可达或首读未完成时也可以重试，但那些状态下没有任何会话内意图可弃，
     * `abandon()` 只是空操作——界面不该给出按了没反应的「放弃」。
     */
    readonly abandonable: boolean;
};

export type UserRecordSession<T, I> = {
    /** 当前显示：未确认意图优先，其次已确认值，再次定义里的默认值。 */
    readonly display: Readonly<Ref<T>>;
    /**
     * 最近一次**已确认**的记录（含外来订阅推进的值）：未确认意图不在里面。
     *
     * 与 `display` 分开是因为两者回答不同的问题：`display` 是"现在画什么"，
     * `confirmed` 是"本地意图该合成到什么底本上"——按补丁顺序重放的会话（例如工具位置）
     * 必须把补丁合成到最新底本，而不能合成到已经含过这些补丁的值上。
     */
    readonly confirmed: Readonly<Ref<T>>;
    /** 首读门禁：记录还没读到分类。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 旧键迁移未完成的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<UserRecordSessionNotice | null>>;
    commit(intent: I): Promise<LayoutRecordCommitResult>;
    /**
     * 重试未确认的意图，**返回真实回执**（`current.retry()` 的结果原样转交）。
     *
     * 调用方不能再用"没有可放弃的意图"推断成功：开会话失败、已释放或二次冲突都各有自己的回执。
     */
    retry(): Promise<LayoutRecordCommitResult>;
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
    const confirmed = shallowRef<T>(definition.defaultValue);
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
        confirmed.value = state.confirmed;
        loading.value = state.phase === "loading" || state.phase === "idle";
        if (!loading.value) {
            // 读取已就绪：门禁诊断不再成立（此刻显示的就是已确认值，用户看到的是真实状态）。
            gateNotice = null;
        }
        if (state.pending !== null) {
            notice.value = {diagnosis: state.pending.diagnosis, retryable: state.pending.retryable, abandonable: true};
            return;
        }
        if (state.blocked !== null) {
            notice.value = {
                diagnosis: state.issues.at(-1) ?? `Storage 记录不可用（${state.blocked}）`,
                retryable: false,
                abandonable: false,
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
        migrationNotice = result.kind === "notice" ? {diagnosis: result.diagnosis, retryable: result.retryable, abandonable: false} : null;
        publish();
    };

    let opening: Promise<void> | null = null;
    const open = (): Promise<void> => {
        opening ??= (async () => {
            const owned = await context.userOwner(definition.owner);
            if (owned.status !== "ready") {
                // 句柄不可用不是终局：保留重试入口（否则一次冷启动失败会让偏好永久不可读写）。
                // `retryable: true` 让界面上的「重试」按钮可达——它是这条诊断之外唯一的恢复路径。
                opening = null;
                loading.value = false;
                notice.value = {diagnosis: owned.diagnosis, retryable: true, abandonable: false};
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
        confirmed: readonly(confirmed) as Readonly<Ref<T>>,
        loading: readonly(loading),
        notice: readonly(notice),

        async commit(intent: I): Promise<LayoutRecordCommitResult> {
            const current = session.value;
            if (current === null) {
                if (loading.value) {
                    // 首读门禁：读到分类之前不接受提交。读取完成前界面上就没有可交互的控件（面板渲染加载态、
                    // 其它宿主禁用调整手势），这里兜住漏网调用——**不排队重放**：此刻调用方基于的是产品默认值，
                    // 等读回来再按它合成会用陈旧意图覆盖已确认记录；拒绝同样必须可见，不能静默丢弃。
                    gateNotice = {
                        diagnosis: "记录还没完成首次读取，本次调整没有保存",
                        retryable: false,
                        abandonable: false,
                    };
                    // 会话还没建起来：publish() 此刻什么都不刷新，直接把这条诊断放上条。
                    notice.value = gateNotice;
                    return {status: "rejected", diagnosis: gateNotice.diagnosis};
                }
                // 已经失败过（句柄不可用一类）：`open()` 留下的诊断比门禁文案准确，**保留它**（含它的重试入口），
                // 并顺手再试一次连接——后端恢复后用户的手势不该被吞掉，也不该只剩刷新一条路。
                // 本次意图仍然不写盘：它基于产品默认显示算出来，重放就是首读门禁要挡的那种覆盖。
                void open();
                return {status: "rejected", diagnosis: notice.value?.diagnosis ?? "Storage 记录不可用"};
            }
            if (loading.value) {
                // 会话已建但首读未分类：同上，拒绝且可见。
                gateNotice = {
                    diagnosis: "记录还没完成首次读取，本次调整没有保存",
                    retryable: false,
                    abandonable: false,
                };
                publish();
                return {status: "rejected", diagnosis: gateNotice.diagnosis};
            }
            const result = await current.commit(intent);
            publish();
            return result;
        },

        async retry(): Promise<LayoutRecordCommitResult> {
            await open();
            const current = session.value;
            if (current === null) {
                // 开会话失败（句柄不可用一类）：如实交出失败回执，别让调用方按"没得放弃"当成成功。
                return {status: "rejected", diagnosis: notice.value?.diagnosis ?? "Storage 记录不可用，重试没有开始"};
            }
            const result = await current.retry();
            publish();
            await migrateLegacy();
            return result;
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

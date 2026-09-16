/**
 * World Engine 工作台内部尺寸的 project/local 记录会话。
 *
 * 归属依据：`persistence.md:95` 把「World Engine 内部尺寸」列为 project/local——随 Project 的有效上下文
 * 恢复，切项目保留旧记录，不能借用未开项目 / 用户资产的 user/local 尺寸（`persistence.md:96`）。
 * 记录定义见 `shared/storage/workbench-world-engine.ts`；旧实现是组件自持 ref，没有旧值要迁移。
 *
 * Project 记录必须绑定服务端签发的精确 ready（`projectRoot` + `publicId`），因此工作面由调用方传入的
 * `surface` 决定：只有 `kind === "project"` 才有记录，其余工作面既不恢复也不保存。
 */

import {onScopeDispose, readonly, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref} from "vue";
import {
    createLayoutRecordSession,
    type LayoutRecordIntent,
    type LayoutRecordSession,
    type WorkbenchLayoutSurface,
} from "nbook/app/utils/workbench/layout-session";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {
    defineWorkbenchWorldEnginePanelSizesState,
    WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES,
    type WorkbenchWorldEnginePanelSizes,
} from "nbook/shared/storage/workbench-world-engine";

/** 一次主动调整：只含用户实际拖动的面板。 */
export type WorldEnginePanelSizesPatch = {
    readonly sidebarWidth?: number;
    readonly inspectorWidth?: number;
    readonly mutationEditorHeight?: number;
};

export type WorldEnginePanelSizesNotice = {
    readonly diagnosis: string;
    readonly retryable: boolean;
};

/** 完整尺寸：记录里缺的字段取产品默认，消费者不必各自回落。 */
export type WorldEngineResolvedPanelSizes = {
    readonly sidebarWidth: number;
    readonly inspectorWidth: number;
    readonly mutationEditorHeight: number;
};

export type WorldEnginePanelSizesConsumer = {
    /** 当前显示：未确认意图优先，其次已确认值，再次产品默认（320/420/292）。 */
    readonly sizes: Readonly<Ref<WorldEngineResolvedPanelSizes>>;
    /** 首读门禁：记录还没读到分类；未就绪前尺寸控件不可用。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 无 Project 上下文的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<WorldEnginePanelSizesNotice | null>>;
    commit(patch: WorldEnginePanelSizesPatch): Promise<void>;
    retry(): Promise<void>;
    abandon(): void;
    release(): Promise<void>;
};

export type WorldEnginePanelSizesOptions = {
    /** 当前工作台工作面；只有 project 工作面持有记录。 */
    readonly surface: MaybeRefOrGetter<WorkbenchLayoutSurface>;
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
};

/** 只保留合法字段：未拖动的字段不进意图，避免把没动过的面板写成"已确认值"。 */
function patchFields(patch: WorldEnginePanelSizesPatch): WorldEnginePanelSizesPatch {
    const fields: {
        sidebarWidth?: number;
        inspectorWidth?: number;
        mutationEditorHeight?: number;
    } = {};
    if (typeof patch.sidebarWidth === "number" && Number.isFinite(patch.sidebarWidth)) {
        fields.sidebarWidth = Math.round(patch.sidebarWidth);
    }
    if (typeof patch.inspectorWidth === "number" && Number.isFinite(patch.inspectorWidth)) {
        fields.inspectorWidth = Math.round(patch.inspectorWidth);
    }
    if (typeof patch.mutationEditorHeight === "number" && Number.isFinite(patch.mutationEditorHeight)) {
        fields.mutationEditorHeight = Math.round(patch.mutationEditorHeight);
    }
    return fields;
}

/**
 * 主动字段合成到读取时的原件（含未知字段）：没有已确认记录时只写本次主动字段，
 * 与已确认值相同就不写盘。
 */
function composeSizes(
    base: WorkbenchWorldEnginePanelSizes | null,
    patch: WorldEnginePanelSizesPatch,
): LayoutRecordIntent<WorkbenchWorldEnginePanelSizes> {
    const fields = patchFields(patch);
    const value: WorkbenchWorldEnginePanelSizes = base === null ? fields : {...base, ...fields};
    const changed = Object.entries(fields)
        .some(([key, next]) => base === null || base[key as keyof WorkbenchWorldEnginePanelSizes] !== next);
    return changed
        ? {value, changed: true, diagnosis: ""}
        : {value, changed: false, diagnosis: "面板尺寸与已确认值相同，未写盘"};
}

export function useWorldEnginePanelSizes(options: WorldEnginePanelSizesOptions): WorldEnginePanelSizesConsumer {
    const definition = defineWorkbenchWorldEnginePanelSizesState();
    const context = createWorkbenchStorageContext({
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
    });
    const sizes = shallowRef<WorldEngineResolvedPanelSizes>(WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES);
    const loading = ref(true);
    const notice = ref<WorldEnginePanelSizesNotice | null>(null);
    const session = shallowRef<LayoutRecordSession<WorkbenchWorldEnginePanelSizes, WorldEnginePanelSizesPatch> | null>(null);
    /** 工作面切换的序号：迟到的打开结果不再改动当前显示。 */
    let surfaceGeneration = 0;

    const publish = (): void => {
        const current = session.value;
        if (current === null) {
            return;
        }
        const state = current.state();
        const display = current.display();
        sizes.value = {
            sidebarWidth: display.sidebarWidth ?? WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES.sidebarWidth,
            inspectorWidth: display.inspectorWidth ?? WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES.inspectorWidth,
            mutationEditorHeight: display.mutationEditorHeight ?? WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES.mutationEditorHeight,
        };
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
        notice.value = null;
    };

    /** 当前工作面的接线在途：提交必须先等它（首读门禁），否则拖出来的尺寸会被丢掉。 */
    let surfaceSetup: Promise<void> = Promise.resolve();

    /**
     * 进入工作面：project 工作面借 Project owner 句柄开记录会话；其余工作面不残留旧 Project 访问，
     * 显示回落默认值并明确交代"没有 Project 上下文"。
     */
    const enterSurface = (surface: WorkbenchLayoutSurface): void => {
        const generation = ++surfaceGeneration;
        session.value = null;
        if (surface.kind !== "project") {
            loading.value = false;
            notice.value = null;
            sizes.value = WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES;
            surfaceSetup = context.enterUserSurface("idle");
            return;
        }
        loading.value = true;
        surfaceSetup = (async () => {
            await context.enterProject(surface.ready);
            const owned = await context.projectOwner(definition.owner);
            if (generation !== surfaceGeneration) {
                return;
            }
            if (owned.status !== "ready") {
                loading.value = false;
                notice.value = {diagnosis: owned.diagnosis, retryable: false};
                return;
            }
            const created = createLayoutRecordSession<WorkbenchWorldEnginePanelSizes, WorldEnginePanelSizesPatch>({
                handle: owned.handle,
                definition,
                compose: composeSizes,
                onChange: publish,
            });
            session.value = created;
            await created.open();
            if (generation !== surfaceGeneration) {
                return;
            }
            publish();
        })();
    };

    /** 工作面变化即换记录；同一 Project 的 ready 代次不变时不重复进入。 */
    let appliedSurfaceKey = "";
    watch(() => toValue(options.surface), (surface) => {
        const key = surface.kind === "project"
            ? `project:${surface.ready.projectRoot}@${surface.ready.publicId}@${String(surface.ready.revision ?? "")}`
            : surface.kind;
        if (key === appliedSurfaceKey) {
            return;
        }
        appliedSurfaceKey = key;
        enterSurface(surface);
    }, {immediate: true});

    const consumer: WorldEnginePanelSizesConsumer = {
        // 同 `user-record-session.ts`：`readonly()` 对泛型对象类型会投影成 `DeepReadonly`，这里收成只读引用。
        sizes: readonly(sizes) as Readonly<Ref<WorldEngineResolvedPanelSizes>>,
        loading: readonly(loading),
        notice: readonly(notice),

        /** 首读门禁：工作面接线与首次读取都没完成时先等（用户拖出来的尺寸不因为"还在读"被丢掉）。 */
        async commit(patch: WorldEnginePanelSizesPatch): Promise<void> {
            await surfaceSetup;
            const current = session.value;
            if (current === null) {
                return;
            }
            await current.open();
            if (session.value !== current) {
                return;
            }
            await current.commit(patch);
            publish();
        },

        async retry(): Promise<void> {
            await surfaceSetup;
            const current = session.value;
            if (current === null) {
                return;
            }
            await current.retry();
            publish();
        },

        abandon(): void {
            session.value?.abandon();
            publish();
        },

        async release(): Promise<void> {
            surfaceGeneration += 1;
            await session.value?.release();
            await context.release();
            publish();
        },
    };

    onScopeDispose(() => {
        void consumer.release();
    });
    return consumer;
}

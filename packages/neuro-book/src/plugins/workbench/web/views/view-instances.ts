/**
 * 视图实例（docs/specs/workbench/views.md 输出 6 到 9）：第一次有效可见才建实例、加载；声明不在了删实例；代际在工作台存活期内单调递增。摆在哪由内容层管，这里只管寿命与状态。
 */

import {computed, markRaw, reactive, watch, watchEffect} from "vue";
import type {Component, ComputedRef, Reactive, Ref} from "vue";

import type {ViewContext} from "../contracts";
import type {ViewFrameStatus} from "../components/WorkbenchViewFrame.vue";
import type {ViewLocation} from "../../shared/views";
import type {ViewSource} from "./registry";

export interface ViewInstance {
    generation: number;
    status: ViewFrameStatus;
    component: Component | null;
    error: string | null;
    busy: boolean;
}

export interface ViewInstances {
    readonly instances: Reactive<Map<string, ViewInstance>>;
    /** 这一代的上下文；还没加载好时是 null。 */
    contextOf(viewId: string): ViewContext | null;
    readonly generations: ComputedRef<ReadonlyMap<string, number>>;
    reload(viewId: string): void;
    retryRender(viewId: string): void;
    renderError(viewId: string, generation: number, message: string): void;
    retryEntry(viewId: string): Promise<void>;
}

export function useViewInstances(options: {
    readonly source: ViewSource;
    /** 此刻有效可见的视图。 */
    visible(): ReadonlySet<string>;
    /** 树上有的视图：不在了删实例。 */
    placed(): ReadonlySet<string>;
    /** 视图在哪个具名面板；无名面板是 null。 */
    location(viewId: string): ViewLocation | null;
}): ViewInstances {
    const instances = reactive(new Map<string, ViewInstance>());
    /**
     * 每个实例当前代际的上下文。放在响应式表之外：上下文里的 `visible`、`location` 是 ref，进了 reactive 会被解包；它只随实例状态一起换，渲染跟着状态更新。
     */
    const contexts = new Map<string, ViewContext>();
    /** 实例删了再建也接着数。 */
    const generations = new Map<string, number>();

    function nextGeneration(viewId: string): number {
        const next = (generations.get(viewId) ?? 0) + 1;
        generations.set(viewId, next);
        return next;
    }

    function contextFor(viewId: string, generation: number): ViewContext {
        const visible = computed(() => options.visible().has(viewId));
        const location = computed(() => options.location(viewId));
        return markRaw({id: viewId, generation, visible: visible as Readonly<Ref<boolean>>, location: location as Readonly<Ref<ViewLocation | null>>});
    }

    async function load(viewId: string): Promise<void> {
        const instance = instances.get(viewId);
        if (instance === undefined) return;
        const generation = nextGeneration(viewId);
        contexts.delete(viewId);
        Object.assign(instance, {generation, status: "loading", component: null, error: null});
        const result = await options.source.load(viewId);
        const current = instances.get(viewId);
        // 等待期间又发起了新加载、交付被撤回、实例被删：这次结果作废。
        if (current === undefined || current.generation !== generation || current.status !== "loading") return;
        if (result.status === "stale") current.status = "waiting";
        else if (result.status === "failed") Object.assign(current, {status: "load-failed", error: result.error instanceof Error ? result.error.message : String(result.error)});
        else {
            contexts.set(viewId, contextFor(viewId, generation));
            Object.assign(current, {status: "ready", component: markRaw(result.component)});
        }
    }

    // 第一次有效可见才建实例。
    watch(options.visible, (ids) => {
        for (const id of ids) if (!instances.has(id)) instances.set(id, {generation: generations.get(id) ?? 0, status: "waiting", component: null, error: null, busy: false});
    }, {immediate: true});

    // 视图不在树上了：删掉实例。
    watch(options.placed, (ids) => {
        for (const id of [...instances.keys()]) {
            if (ids.has(id)) continue;
            instances.delete(id);
            contexts.delete(id);
        }
    });

    // 交付撤回卸掉组件；交付在、实例在等、此刻可见就加载。
    watchEffect(() => {
        for (const [id, instance] of instances) {
            const delivery = options.source.delivery(id);
            if (delivery.kind !== "available") {
                if (instance.status !== "waiting") {
                    contexts.delete(id);
                    Object.assign(instance, {status: "waiting", component: null, error: null});
                }
            } else if (instance.status === "waiting" && options.visible().has(id)) {
                void load(id);
            }
        }
    });

    return {
        instances,
        contextOf: (viewId) => contexts.get(viewId) ?? null,
        generations: computed(() => new Map([...instances].map(([id, instance]) => [id, instance.generation]))),
        reload: (viewId) => {
            if (instances.get(viewId)?.status === "load-failed") void load(viewId);
        },
        retryRender: (viewId) => {
            const instance = instances.get(viewId);
            if (instance?.status !== "render-failed" || instance.component === null) return;
            const generation = nextGeneration(viewId);
            contexts.set(viewId, contextFor(viewId, generation));
            Object.assign(instance, {generation, status: "ready", error: null});
        },
        renderError: (viewId, generation, message) => {
            const instance = instances.get(viewId);
            if (instance === undefined || instance.generation !== generation) return;
            Object.assign(instance, {status: "render-failed", error: message});
        },
        retryEntry: async (viewId) => {
            const instance = instances.get(viewId);
            if (instance === undefined || instance.busy) return;
            instance.busy = true;
            try {
                await options.source.retry(viewId);
            } finally {
                instance.busy = false;
            }
        },
    };
}

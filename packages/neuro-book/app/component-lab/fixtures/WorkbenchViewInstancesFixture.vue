<script setup lang="ts">
/**
 * WorkbenchViewInstances 的 Lab 场景：一个视图在两个容器之间的归属变化。
 *
 * fixture 自己搭一个小宿主（产品里那是页面 + `WorkbenchViewHost`）：
 *   - `views` 是一份内存模型（一条条目），`viewFactoryResolver` 是本地白名单（一个纯空白视图组件，
 *     没有文件树、没有 Agent、不 import 任何业务模块）；
 *   - 两个「落点锚点」用 `VIEW_TARGET_REGISTRY` 登记元素——与产品一样，同一时刻只有真正持有这个视图的
 *     容器登记它的落点，实例层因此把同一段 DOM 搬过去，而不是重建；
 *   - 一个「搬到面板 / 搬回左栏」按钮与一个「设为不可见 / 显示」按钮，改的都是这份内存模型。
 *
 * 可观察的证据（Lab 右侧数据面板 + 页面上都看得到）：
 *   - 挂载 / 释放计数：搬容器不重挂（挂载还是 1），真正不可见才释放（释放 1）；
 *   - 实例自己的本地计数：搬完以后还在，说明是同一个实例；
 *   - 视图自报的 `action-handle-ready` / `actions-change` 经实例层转发成 `view-handle-ready` /
 *     `view-actions`，载荷里带 `{viewId, generation}`——代际跨位置搬 DOM 不变。
 *
 * 三档场景（无网络、无持久化；换场景 = 换一套空白实例，探针回到初值）：
 *   - default：实例落在左栏；可以就地加本地计数、搬去面板、设为不可见；
 *   - moved：场景初值先把实例从**左栏搬到面板**（同一条代码路径），事件里留下 view-move，
 *     挂载计数仍是 1、本地计数还在；
 *   - hidden：条目 `visible=false` → 不渲染实例（挂载 0、释放 0），落点不留空盒。
 */
import {computed, defineComponent, h, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component} from "vue";
import WorkbenchViewInstances, {VIEW_TARGET_REGISTRY} from "nbook/app/components/workbench/WorkbenchViewInstances.vue";
import type {DescriptorResult} from "nbook/app/utils/workbench/descriptors";
import type {WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import type {ViewActionTarget, ViewTitleActionState, WorkbenchViewActionHandle} from "nbook/app/utils/workbench/view-title-actions";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchViewInstances>(() => props.input);
const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

const LEFT_CONTAINER_ID = "lab.container.left";
const PANEL_CONTAINER_ID = "lab.container.panel";
const VIEW_ID = "lab.instances.demo";

/** 挂载 / 释放探针：组件重挂会再记一次，于是「搬 DOM 不重挂」有可观察的证据。 */
const probe = ref({mounts: 0, releases: 0});

/** 纯空白视图：只有本地计数、探针与两条对外通道，没有任何业务内容。 */
const LabInstancesView = defineComponent({
    name: "LabInstancesView",
    emits: ["actions-change", "action-handle-ready"],
    setup(_viewProps, {emit}) {
        const count = ref(0);
        const handle: WorkbenchViewActionHandle = {
            runAction: async (actionId: string) => {
                if (actionId !== "increment") {
                    return {ok: false as const, code: "unknown-command" as const, reason: `Lab 空白视图不认得动作：${actionId}`};
                }
                count.value += 1;
                emitLabEvent("instances-action-run", {actionId, count: count.value});
                return {ok: true as const, value: {count: count.value}};
            },
        };

        onMounted(() => {
            probe.value = {mounts: probe.value.mounts + 1, releases: probe.value.releases};
            // 两条明面通道：状态上报与句柄交接（实例层会加代际后转发出去）。
            const states: readonly ViewTitleActionState[] = [{id: "increment", enabled: true}];
            emit("actions-change", states);
            emit("action-handle-ready", handle);
        });
        onBeforeUnmount(() => {
            probe.value = {mounts: probe.value.mounts, releases: probe.value.releases + 1};
            emit("action-handle-ready", null);
        });

        return () => h("div", {class: "flex h-full min-h-0 flex-col gap-[var(--space-2)] p-[var(--space-3)]", "data-lab-instances-view": VIEW_ID}, [
            h("p", {class: "text-[var(--text-xs)] text-[var(--text-secondary)]"}, "纯空白视图：没有任何业务内容，只有这一个本地计数。"),
            h("div", {class: "flex items-center gap-[var(--space-2)]"}, [
                h("button", {
                    type: "button",
                    class: "cursor-pointer rounded-[var(--radius-control)] border border-[var(--panel-outline)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]",
                    "data-lab-control": "increment",
                    onClick: () => {
                        count.value += 1;
                        emitLabEvent("instances-increment", {count: count.value});
                    },
                }, `本地计数 +1`),
                h("span", {class: "text-[var(--text-xs)] text-[var(--text-muted)]", "data-lab-instances-count": ""}, `本地计数 ${count.value}`),
                h("span", {class: "ml-auto text-[var(--text-2xs)] text-[var(--text-muted)]", "data-lab-probe": "mounts"}, `挂载 ${probe.value.mounts} / 释放 ${probe.value.releases}`),
            ]),
        ]);
    },
});

/**
 * 落点锚点：与 `WorkbenchViewHost` 走同一个通道——只有**真正持有**这个视图的容器把自己登记进去。
 * 不持有的时候渲染一条空闲说明，不登记任何元素。
 */
const LabAnchor = defineComponent({
    name: "LabAnchor",
    props: {
        viewId: {type: String, required: true},
        active: {type: Boolean, default: true},
    },
    setup(anchorProps) {
        const targets = inject(VIEW_TARGET_REGISTRY, null);
        return () => anchorProps.active
            ? h("div", {
                class: "flex min-h-[120px] flex-1 flex-col rounded-[var(--radius-control)] border border-dashed border-[var(--panel-outline)] bg-[var(--bg-panel)]",
                "data-lab-anchor": anchorProps.viewId,
                ref: (element: unknown) => {
                    if (targets !== null && element instanceof HTMLElement) {
                        targets.register(anchorProps.viewId, element);
                    }
                },
            })
            : h("p", {class: "flex min-h-[120px] flex-1 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] text-[var(--text-2xs)] text-[var(--text-muted)]", "data-lab-anchor-idle": ""}, "这个容器当前不持有该视图（不登记落点）");
    },
});

/** 视图归属与可见性：场景初值 + 两个按钮都只改这两个内存值。 */
const containerId = ref(LEFT_CONTAINER_ID);
const viewVisible = ref(true);
/** 最近一次移动与实例代际：都在页面上可见，数据面板里也发布。 */
const lastMove = ref("");
const generation = ref(0);

watch(() => props.scene, (scene) => {
    probe.value = {mounts: 0, releases: 0};
    containerId.value = subject.bindings.value.views[0]?.containerId ?? LEFT_CONTAINER_ID;
    viewVisible.value = subject.bindings.value.views[0]?.visible ?? false;
    lastMove.value = "";
    generation.value = 0;
    if (scene === "moved") {
        void (async () => {
            // 先让实例真的落在左栏（挂载 1），再走同一条移动路径搬到面板。
            await settle();
            if (props.scene !== "moved") {
                return;
            }
            moveTo(PANEL_CONTAINER_ID, "scene");
        })();
    }
}, {immediate: true});

/** 落点发布是 `nextTick` 之后的一拍，实例渲染还要再一拍——推几拍再断言/移动。 */
async function settle(): Promise<void> {
    for (let tick = 0; tick < 4; tick += 1) {
        await nextTick();
    }
}

/** 视图模型仅由登记 input 驱动；宿主按钮回写同一条真实 views prop。 */
const entries = computed<readonly WorkbenchViewEntry[]>(() => subject.bindings.value.views);

watch(entries, (views) => {
    const entry = views[0];
    if (!entry) return;
    containerId.value = entry.containerId;
    viewVisible.value = entry.visible;
});

/** 本地白名单：只登记这一个空白视图，未知键给 Lab 自己的诊断（产品白名单不参与）。 */
function resolveFactory(factoryKey: string): DescriptorResult<Component> {
    return factoryKey === "lab.view.instances"
        ? {ok: true, value: LabInstancesView}
        : {ok: false, reason: `Lab 白名单未登记 factoryKey：${factoryKey}`};
}

function moveTo(target: string, via: string): void {
    if (containerId.value === target) {
        return;
    }
    const from = containerId.value;
    containerId.value = target;
    subject.write("props", "views", entries.value.map((entry) => entry.view.id === VIEW_ID ? {
        ...entry, view: {...entry.view, container: target}, containerId: target,
    } : entry));
    lastMove.value = `${from} → ${target}（${via === "scene" ? "场景初值" : "按钮"}）`;
    emitLabEvent("view-move", {viewId: VIEW_ID, sourceContainerId: from, targetContainerId: target, via});
}

function onMoveClick(): void {
    moveTo(containerId.value === LEFT_CONTAINER_ID ? PANEL_CONTAINER_ID : LEFT_CONTAINER_ID, "button");
}

function onVisibilityClick(): void {
    viewVisible.value = !viewVisible.value;
    subject.write("props", "views", entries.value.map((entry) => entry.view.id === VIEW_ID ? {
        ...entry, visible: viewVisible.value,
        visibilityReasons: viewVisible.value ? [] : ["Lab 场景把这条视图设为不可见：实例被释放，落点不留空盒"],
    } : entry));
    emitLabEvent("view-visibility", {viewId: VIEW_ID, visible: viewVisible.value});
}

/** 实例自报的动作状态与句柄：实例层已经替它加上代际，这里只把载荷记进事件通道。 */
function onViewActions(target: ViewActionTarget, states: readonly ViewTitleActionState[]): void {
    emitLabEvent("view-actions", {target, states: states.map((state) => ({...state}))});
}

function onViewHandleReady(target: ViewActionTarget, handle: WorkbenchViewActionHandle | null): void {
    generation.value = target.generation;
    emitLabEvent("view-handle-ready", {target, hasHandle: handle !== null});
}

const SCENE_NOTES: Record<string, string> = {
    default: "实例落在左栏（挂载 1 / 释放 0）。点「本地计数 +1」再搬去面板：计数还在、挂载计数不变——搬的是同一段 DOM，不是新实例。",
    moved: "初值先把实例从左边搬到面板：事件里有一条 view-move，而挂载计数仍是 1、本地计数与代际都没变——搬容器不重挂实例。",
    hidden: "条目 visible=false：不渲染实例（挂载 0 / 释放 0），左栏与面板的落点都空着、不留空盒；点「设为可见」才会挂起来。",
};

const stageNote = computed(() => SCENE_NOTES[props.scene] ?? "");

watch([entries, probe, generation, lastMove, containerId, viewVisible, () => props.scene], () => {
    publishLabData({
        scene: props.scene,
        containerId: containerId.value,
        visible: viewVisible.value,
        mounts: probe.value.mounts,
        releases: probe.value.releases,
        generation: generation.value,
        lastMove: lastMove.value,
    });
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                <span data-lab-note>{{ stageNote }}</span>
                <span>最近一次移动：<strong class="font-mono text-[var(--text-main)]" data-lab-last-move>{{ lastMove || "（无）" }}</strong></span>
                <span>实例代际：<strong class="font-mono text-[var(--text-main)]" data-lab-generation>{{ generation === 0 ? "（没有实例）" : generation }}</strong></span>
            </div>
            <button
                type="button"
                class="cursor-pointer rounded-[var(--radius-control)] border border-[var(--panel-outline)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                data-lab-control="move"
                @click="onMoveClick"
            >
                {{ containerId === LEFT_CONTAINER_ID ? "搬到面板" : "搬回左栏" }}
            </button>
            <button
                type="button"
                class="cursor-pointer rounded-[var(--radius-control)] border border-[var(--panel-outline)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                data-lab-control="visibility"
                @click="onVisibilityClick"
            >
                {{ viewVisible ? "设为不可见" : "设为可见" }}
            </button>
        </LabFixtureControls>

        <!-- 实例层是宿主的祖先：落点元素经 `VIEW_TARGET_REGISTRY` 登记进来，实例由它 Teleport 搬过去。 -->
        <WorkbenchViewInstances
            data-lab-subject
            :key="scene"
            class="flex-1"
            v-bind="subject.bindings.value"
            :view-factory-resolver="resolveFactory"
            @view-actions="onViewActions"
            @view-handle-ready="onViewHandleReady"
        >
            <div class="flex h-full min-h-0 flex-1 items-stretch gap-[var(--space-3)]">
                <section class="flex min-w-0 flex-1 flex-col gap-[var(--space-2)] border-r border-[var(--divider)] bg-[var(--panel-surface)] p-[var(--space-3)]" data-lab-zone="left">
                    <header class="flex items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-main)]">
                        <span class="i-lucide-files h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span>左栏容器 · {{ LEFT_CONTAINER_ID }}</span>
                    </header>
                    <LabAnchor :view-id="VIEW_ID" :active="containerId === LEFT_CONTAINER_ID" />
                </section>

                <section class="flex min-w-0 flex-1 flex-col gap-[var(--space-2)] bg-[var(--panel-surface)] p-[var(--space-3)]" data-lab-zone="panel">
                    <header class="flex items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-main)]">
                        <span class="i-lucide-panel-bottom h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span>面板容器 · {{ PANEL_CONTAINER_ID }}</span>
                    </header>
                    <LabAnchor :view-id="VIEW_ID" :active="containerId === PANEL_CONTAINER_ID" />
                </section>
            </div>
        </WorkbenchViewInstances>
    </div>
</template>

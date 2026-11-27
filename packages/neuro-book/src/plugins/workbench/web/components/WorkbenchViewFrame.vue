<script setup lang="ts">
/** 视图实例的可见形态（同名 .md）：交付状态、加载、两种失败与错误边界；加载与代际由宿主决定。 */
import {computed, defineComponent, h, onErrorCaptured, ref} from "vue";
import type {Component, PropType} from "vue";

import {Button, OverlayScrollbar, Spinner} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../text";
import type {ViewContext} from "../contracts";
import type {ViewDelivery} from "../views/registry";

export type ViewFrameStatus = "waiting" | "loading" | "ready" | "load-failed" | "render-failed";

defineOptions({name: "WorkbenchViewFrame"});

const props = withDefaults(defineProps<{
    viewId: string;
    layout: "scroll" | "fill";
    delivery: ViewDelivery;
    status: ViewFrameStatus;
    error: string | null;
    component: Component | null;
    context: ViewContext | null;
    generation: number;
    busy?: boolean;
}>(), {busy: false});

const emit = defineEmits<{
    (event: "retry-entry"): void;
    (event: "reload"): void;
    (event: "retry-render"): void;
    (event: "render-error", generation: number, message: string): void;
}>();

const text = useWorkbenchText();

const state = computed(() => (props.delivery.kind === "available" ? props.status : props.delivery.kind));

/**
 * 错误边界：接住子树在 Vue 调用路径上的错误并报给宿主，不再往上冒。外框以代际作 key 重建它，新实例从头开始。
 */
const ErrorBoundary = defineComponent({
    name: "WorkbenchViewErrorBoundary",
    props: {generation: {type: Number, required: true}, onFailed: {type: Function as PropType<(generation: number, message: string) => void>, required: true}},
    setup(boundaryProps, {slots}) {
        onErrorCaptured((error) => {
            boundaryProps.onFailed(boundaryProps.generation, error instanceof Error ? error.message : String(error));
            return false;
        });
        return () => slots.default?.();
    },
});

function reportRenderError(generation: number, message: string): void {
    emit("render-error", generation, message);
}

/** `scroll` 布局的滚动元素：交给叠加滚动条。 */
const scroller = ref<HTMLElement | null>(null);
</script>

<template>
    <div class="workbench-view-frame" :data-view-frame="viewId" :data-view-state="state" :data-view-generation="generation" :data-view-layout="layout">
        <template v-if="state === 'ready' && component !== null && context !== null">
            <!-- 滚动条叠在内容上、鼠标进来才显示（docs/specs/workbench/views.md 输出 12）。 -->
            <div v-if="layout === 'scroll'" class="workbench-view-frame__scroll-host">
                <div ref="scroller" class="workbench-view-frame__scroll" data-view-scroller>
                    <div class="workbench-view-frame__padding">
                        <ErrorBoundary :key="generation" :generation="generation" :on-failed="reportRenderError">
                            <component :is="component" :context="context" />
                        </ErrorBoundary>
                    </div>
                </div>
                <OverlayScrollbar :target="scroller" />
            </div>
            <ErrorBoundary v-else :key="generation" :generation="generation" :on-failed="reportRenderError">
                <component :is="component" :context="context" />
            </ErrorBoundary>
        </template>
        <div v-else class="workbench-view-frame__notice" role="status">
            <template v-if="delivery.kind === 'declared'">{{ text('viewFrame.declared') }}</template>
            <template v-else-if="delivery.kind === 'entry-blocked'">{{ text('viewFrame.blocked', {reason: delivery.reason}) }}</template>
            <template v-else-if="delivery.kind === 'entry-failed'">
                <span>{{ text('viewFrame.failed', {reason: delivery.reason}) }}</span>
                <Button variant="primary" size="sm" :disabled="busy" data-view-retry-entry @click="emit('retry-entry')">{{ text('common.retry') }}</Button>
            </template>
            <template v-else-if="delivery.kind === 'entry-stopped'">{{ text('viewFrame.stopped', {reason: delivery.reason}) }}</template>
            <template v-else-if="status === 'load-failed'">
                <span>{{ text('viewFrame.loadFailed', {reason: error ?? ''}) }}</span>
                <Button variant="primary" size="sm" :disabled="busy" data-view-reload @click="emit('reload')">{{ text('viewFrame.reload') }}</Button>
            </template>
            <template v-else-if="status === 'render-failed'">
                <span>{{ text('viewFrame.renderFailed', {reason: error ?? ''}) }}</span>
                <Button variant="primary" size="sm" :disabled="busy" data-view-retry-render @click="emit('retry-render')">{{ text('common.retry') }}</Button>
            </template>
            <template v-else>
                <Spinner size="sm" />
                <span>{{ text('viewFrame.loading') }}</span>
            </template>
        </div>
    </div>
</template>

<style scoped>
/*
 * 视图的内边距只有外框这一个来源（docs/specs/workbench/views.md 的 layout）：scroll 由这里加；fill 视图要整行铺满
 * （选中底色通到边），不能整体加，就把同一个值经 `--view-inset-inline`、`--view-inset-block` 交给视图，视图用在行内的
 * 缩进上，两类视图的文字起点才对齐。scroll 里这两个变量是 0，视图照用也不会加两次。
 */
.workbench-view-frame {
    --nb-view-pad-inline: var(--space-3);
    --nb-view-pad-block: var(--space-2);
    --view-inset-inline: var(--nb-view-pad-inline);
    --view-inset-block: var(--nb-view-pad-block);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-view-frame__scroll-host {
    position: relative;
    width: 100%;
    height: 100%;
}

.workbench-view-frame__scroll {
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
}

.workbench-view-frame__padding {
    --view-inset-inline: 0px;
    --view-inset-block: 0px;
    padding: var(--nb-view-pad-block) var(--nb-view-pad-inline);
}

.workbench-view-frame__notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    min-height: 96px;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: center;
    overflow-wrap: anywhere;
}
</style>

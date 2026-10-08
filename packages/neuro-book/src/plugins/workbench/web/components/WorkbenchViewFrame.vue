<script setup lang="ts">
/** 视图实例的可见形态（同名 .md）：交付状态、加载、两种失败与错误边界；加载与代际由宿主决定。 */
import {computed, defineComponent, h, onErrorCaptured} from "vue";
import type {Component, PropType} from "vue";

import {Button, ScrollArea, Spinner} from "@notnotype/nb-ui/components";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {ViewContext} from "../contracts";
import type {ViewDelivery} from "../views/registry";

export type ViewFrameStatus = "waiting" | "loading" | "ready" | "load-failed" | "render-failed";

defineOptions({name: "WorkbenchViewFrame"});

const props = withDefaults(defineProps<{
    viewId: string;
    locale: DisplayLocale;
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

const TEXT = {
    declared: {"zh-CN": "正在等待视图所属的插件启动", "en-US": "Waiting for the view's plugin to start"},
    blocked: {"zh-CN": "视图所属的插件无法启动：{reason}", "en-US": "The view's plugin cannot start: {reason}"},
    failed: {"zh-CN": "视图所属的插件启动失败：{reason}", "en-US": "The view's plugin failed to start: {reason}"},
    stopped: {"zh-CN": "视图所属的插件已停止（{reason}）", "en-US": "The view's plugin stopped ({reason})"},
    loading: {"zh-CN": "正在加载视图", "en-US": "Loading the view"},
    loadFailed: {"zh-CN": "视图加载失败：{reason}", "en-US": "The view failed to load: {reason}"},
    renderFailed: {"zh-CN": "视图出错：{reason}", "en-US": "The view crashed: {reason}"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    reload: {"zh-CN": "重新加载", "en-US": "Reload"},
} satisfies Record<string, LocalizedText>;

const text = (template: LocalizedText, reason = ""): string => localize(formatText(template, {reason}), props.locale);

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
</script>

<template>
    <div class="workbench-view-frame" :data-view-frame="viewId" :data-view-state="state" :data-view-generation="generation" :data-view-layout="layout">
        <template v-if="state === 'ready' && component !== null && context !== null">
            <ScrollArea v-if="layout === 'scroll'" class="workbench-view-frame__scroll">
                <div class="workbench-view-frame__padding">
                    <ErrorBoundary :key="generation" :generation="generation" :on-failed="reportRenderError">
                        <component :is="component" :context="context" />
                    </ErrorBoundary>
                </div>
            </ScrollArea>
            <ErrorBoundary v-else :key="generation" :generation="generation" :on-failed="reportRenderError">
                <component :is="component" :context="context" />
            </ErrorBoundary>
        </template>
        <div v-else class="workbench-view-frame__notice" role="status">
            <template v-if="delivery.kind === 'declared'">{{ text(TEXT.declared) }}</template>
            <template v-else-if="delivery.kind === 'entry-blocked'">{{ text(TEXT.blocked, delivery.reason) }}</template>
            <template v-else-if="delivery.kind === 'entry-failed'">
                <span>{{ text(TEXT.failed, delivery.reason) }}</span>
                <Button size="sm" :disabled="busy" data-view-retry-entry @click="emit('retry-entry')">{{ text(TEXT.retry) }}</Button>
            </template>
            <template v-else-if="delivery.kind === 'entry-stopped'">{{ text(TEXT.stopped, delivery.reason) }}</template>
            <template v-else-if="status === 'load-failed'">
                <span>{{ text(TEXT.loadFailed, error ?? "") }}</span>
                <Button size="sm" :disabled="busy" data-view-reload @click="emit('reload')">{{ text(TEXT.reload) }}</Button>
            </template>
            <template v-else-if="status === 'render-failed'">
                <span>{{ text(TEXT.renderFailed, error ?? "") }}</span>
                <Button size="sm" :disabled="busy" data-view-retry-render @click="emit('retry-render')">{{ text(TEXT.retry) }}</Button>
            </template>
            <template v-else>
                <Spinner size="sm" />
                <span>{{ text(TEXT.loading) }}</span>
            </template>
        </div>
    </div>
</template>

<style scoped>
.workbench-view-frame {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-view-frame__scroll {
    width: 100%;
    height: 100%;
}

.workbench-view-frame__padding {
    padding: var(--space-2) var(--space-3);
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

<script setup lang="ts">
/**
 * 看板的一块面板（t10 计划 3.5“没有数据与加载中”）：标题行加一块固定高度的内容区。四种状态只换内容区里的东西，面板的高度不变，
 * 所以一块先回来、一块出错时别的面板不跳。
 *
 * - 加载：超过 200 毫秒才在中央显示 `Spinner`（`slow`）。重取时上一份内容留着，盖一层淡遮罩（与 nb-ui 数据表格同一种做法），
 *   遮罩期间内容 `inert`。
 * - 没有数据：中央一句话；不画内容（图表不建）。
 * - 出错：中央写原因与重试，`role=alert`。
 *
 * 内容区矮（崩溃、升级两块）时状态用紧凑的一行字，放不下 `EmptyState` 那样带圆底图标的版式。
 */

import {Button, EmptyState, Spinner} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {useSiteText} from "../../../text";

export type PanelState = "loading" | "empty" | "failed" | "ready";

const props = withDefaults(defineProps<{
    /** 认这块面板用（`data-site-dashboard-panel`）。 */
    id: string;
    /** 标题；四个数那一条没有标题，给 `label` 作读屏的名字，内边距只留上下（`strip`）。 */
    title?: string;
    label?: string;
    strip?: boolean;
    state: PanelState;
    /** 请求超过 200 毫秒还没回来。 */
    slow?: boolean;
    /** 有内容时又在重取。 */
    pending?: boolean;
    /** 内容区的高度（像素）。 */
    height: number;
    /** 没有数据时的那句话。 */
    emptyText?: string;
    /** 出错的原因。 */
    failureText?: string;
}>(), {title: undefined, label: undefined, strip: false, slow: false, pending: false, emptyText: "", failureText: ""});

const emit = defineEmits<{retry: []}>();

const t = useSiteText();

/** 低于这个高度放不下 `EmptyState`（圆底图标加上下内边距约 170 像素）。 */
const COMPACT_BELOW = 200;
const compact = computed(() => props.height < COMPACT_BELOW);

type Layer = "spinner" | "mask" | "empty" | "failed" | null;
const layer = computed<Layer>(() => {
    switch (props.state) {
        case "loading": return props.slow ? "spinner" : null;
        case "empty": return "empty";
        case "failed": return "failed";
        case "ready": return props.pending && props.slow ? "mask" : null;
    }
});
</script>

<template>
    <section
        class="dashboard-panel"
        :class="{'dashboard-panel--strip': props.strip}"
        :aria-label="props.label"
        :data-site-dashboard-panel="props.id" :data-site-panel-state="props.state" :aria-busy="props.pending">
        <header v-if="props.title !== undefined" class="dashboard-panel__head">
            <h2>{{ props.title }}</h2>
            <slot name="head" />
        </header>
        <div class="dashboard-panel__body" :style="{height: `${props.height}px`}" data-site-panel-body>
            <Transition name="dashboard-panel-layer">
                <div v-if="props.state === 'ready'" class="dashboard-panel__content" :inert="layer === 'mask' || undefined">
                    <slot />
                </div>
            </Transition>
            <Transition name="dashboard-panel-layer">
                <div v-if="layer" :key="layer" class="dashboard-panel__layer" :class="`is-${layer}`">
                    <Spinner v-if="layer === 'spinner' || layer === 'mask'" />
                    <p v-else-if="layer === 'empty' && compact" class="dashboard-panel__state">{{ props.emptyText }}</p>
                    <EmptyState v-else-if="layer === 'empty'" class="dashboard-panel__state" icon-class="i-lucide-chart-line" :title="props.emptyText" />
                    <div v-else-if="compact" class="dashboard-panel__state dashboard-panel__failed" role="alert">
                        <span class="i-lucide-circle-alert dashboard-panel__alert" aria-hidden="true" />
                        <span>{{ props.failureText }}</span>
                        <Button variant="secondary" size="sm" @click="emit('retry')">{{ t("shell.retry") }}</Button>
                    </div>
                    <div v-else class="dashboard-panel__state" role="alert">
                        <EmptyState :title="props.failureText">
                            <template #icon><span class="i-lucide-circle-alert dashboard-panel__alert h-5 w-5" aria-hidden="true" /></template>
                            <template #action>
                                <Button variant="secondary" size="sm" @click="emit('retry')">{{ t("shell.retry") }}</Button>
                            </template>
                        </EmptyState>
                    </div>
                </div>
            </Transition>
        </div>
    </section>
</template>

<style scoped>
.dashboard-panel {
    box-sizing: border-box;
    min-width: 0;
    padding: 14px 18px 16px;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
}

.dashboard-panel--strip {
    padding: 16px 0;
}

.dashboard-panel__head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    height: 22px;
    margin-bottom: 10px;
}

.dashboard-panel__head h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    white-space: nowrap;
}

.dashboard-panel__body {
    position: relative;
}

/* 内容比内容区高时（版本多、错误多）在面板里面滚，不撑高面板。 */
.dashboard-panel__content {
    height: 100%;
    overflow: auto;
}

.dashboard-panel__layer {
    position: absolute;
    inset: 0;
    display: flex;
}

/* 自动外边距居中：状态比内容区高时从顶部排起、在自己里面滚，不越出面板。 */
.dashboard-panel__layer > * {
    margin: auto;
}

.dashboard-panel__layer.is-mask {
    background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}

.dashboard-panel__state {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 100%;
    margin: auto;
    overflow: auto;
    color: var(--text-secondary);
    text-align: center;
}

.dashboard-panel__failed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.dashboard-panel__alert {
    color: var(--status-danger);
}

.dashboard-panel-layer-enter-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.dashboard-panel-layer-leave-active {
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}

.dashboard-panel-layer-enter-from,
.dashboard-panel-layer-leave-to {
    opacity: 0;
}
</style>

<script setup lang="ts">
/**
 * 看板的一块面板（t10 计划 3.5“没有数据与加载中”）：标题行加一块固定高度的内容区。四种状态只换内容区里的东西，面板的高度不变，
 * 所以一块先回来、一块出错时别的面板不跳。
 *
 * - 加载：超过 200 毫秒才在中央显示 `Spinner`（`slow`）。重取时上一份内容留着，盖一层淡遮罩（与 nb-ui 数据表格同一种做法），
 *   遮罩期间内容 `inert`。
 * - 没有数据：中央一句话；不画内容（图表不建）。
 * - 出错：中央写原因与重试。点了重试，状态就是加载：原因留着、按钮转圈且不可再点，到 200 毫秒还没回来才换成中央的转圈；
 *   又失败时按钮恢复。读屏的播报不在面板里：几块面板常一起失败（服务不可用时九块同时），各自 `role=alert` 会把同一句连读几遍，
 *   页面另有一处汇总（`DashboardPage.vue`）。重试按钮的读屏名字带面板标题，九个按钮分得清。
 *
 * 内容比内容区高时（版本多、错误多）在面板里面滚：这时内容区可以用键盘聚焦、以面板标题为名，底边有一道渐隐，滚到底才消失，
 * 不靠露出半行来提示“下面还有”。
 *
 * 内容区矮（崩溃、升级两块）时状态用紧凑的一行字，放不下 `EmptyState` 那样带圆底图标的版式。
 */

import {Button, EmptyState, Spinner} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onUpdated, shallowRef, useTemplateRef, watch} from "vue";

import {useSiteText} from "../../../text";
import {useAdminText} from "../text";

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
    /** 出错的原因；重试时（状态是加载）仍是上一次的原因，按钮转圈。 */
    failureText?: string;
}>(), {title: undefined, label: undefined, strip: false, slow: false, pending: false, emptyText: "", failureText: ""});

const emit = defineEmits<{retry: []}>();

const t = useAdminText();
// “重试”与站点别处的重试按钮同一句话，用站点目录里的那条。
const siteT = useSiteText();

/** 低于这个高度放不下 `EmptyState`（圆底图标加上下内边距约 170 像素）。 */
const COMPACT_BELOW = 200;
const compact = computed(() => props.height < COMPACT_BELOW);

/** 面板的名字：标题，四个数那一条没有标题时用 `label`。 */
const name = computed(() => props.title ?? props.label ?? "");

/** 出错之后点了重试、回答还没到 200 毫秒：原因与按钮留着，按钮转圈。 */
const retrying = computed(() => props.state === "loading" && !props.slow && props.failureText !== "");

type Layer = "spinner" | "mask" | "empty" | "failed" | null;
const layer = computed<Layer>(() => {
    switch (props.state) {
        case "loading": return props.slow ? "spinner" : retrying.value ? "failed" : null;
        case "empty": return "empty";
        case "failed": return "failed";
        case "ready": return props.pending && props.slow ? "mask" : null;
    }
});

// ---- 内容在面板里滚 ----

const content = useTemplateRef<HTMLElement>("content");
/** 内容比内容区高。 */
const scrollable = shallowRef(false);
/** 已滚到底（或不用滚）。 */
const atEnd = shallowRef(true);
let observer: ResizeObserver | undefined;

function measure(): void {
    const element = content.value;
    if (element === null) {
        scrollable.value = false;
        atEnd.value = true;
        return;
    }
    // 差一像素以内算没有多出来：缩放时 scrollHeight 是取整后的值。
    const overflow = element.scrollHeight - element.clientHeight;
    scrollable.value = overflow > 1;
    atEnd.value = element.scrollTop >= overflow - 1;
}

// 内容区随状态出现与消失；出现时看它与它里面的东西（行数变了的表、横条）的尺寸。
watch(content, (element) => {
    observer?.disconnect();
    observer = undefined;
    if (element !== null && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(element);
        for (const child of element.children) observer.observe(child);
    }
    measure();
}, {flush: "post"});

onUpdated(measure);
onBeforeUnmount(() => observer?.disconnect());
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
                <div
                    v-if="props.state === 'ready'"
                    ref="content"
                    class="dashboard-panel__content"
                    :class="{'is-scrollable': scrollable}"
                    :inert="layer === 'mask' || undefined"
                    :tabindex="scrollable ? 0 : undefined"
                    :role="scrollable ? 'region' : undefined"
                    :aria-label="scrollable ? name : undefined"
                    data-site-panel-content
                    @scroll.passive="measure"
                >
                    <slot />
                </div>
            </Transition>
            <Transition name="dashboard-panel-layer">
                <div v-if="props.state === 'ready' && scrollable && !atEnd" class="dashboard-panel__more" aria-hidden="true" data-site-panel-more />
            </Transition>
            <Transition name="dashboard-panel-layer">
                <div v-if="layer" :key="layer" class="dashboard-panel__layer" :class="`is-${layer}`">
                    <Spinner v-if="layer === 'spinner' || layer === 'mask'" />
                    <p v-else-if="layer === 'empty' && compact" class="dashboard-panel__state">{{ props.emptyText }}</p>
                    <EmptyState v-else-if="layer === 'empty'" class="dashboard-panel__state" icon-class="i-lucide-chart-line" :title="props.emptyText" />
                    <div v-else-if="compact" class="dashboard-panel__state dashboard-panel__failed">
                        <span class="i-lucide-circle-alert dashboard-panel__alert" aria-hidden="true" />
                        <span>{{ props.failureText }}</span>
                        <Button variant="secondary" size="sm" :loading="retrying" :aria-label="t('admin.dashboard.retryPanel', {panel: name})" data-site-panel-retry @click="emit('retry')">{{ siteT("shell.retry") }}</Button>
                    </div>
                    <div v-else class="dashboard-panel__state">
                        <EmptyState :title="props.failureText">
                            <template #icon><span class="i-lucide-circle-alert dashboard-panel__alert h-5 w-5" aria-hidden="true" /></template>
                            <template #action>
                                <Button variant="secondary" size="sm" :loading="retrying" :aria-label="t('admin.dashboard.retryPanel', {panel: name})" data-site-panel-retry @click="emit('retry')">{{ siteT("shell.retry") }}</Button>
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

/*
 * 内容比内容区高时（版本多、错误多）在面板里面滚，不撑高面板。放得下时裁掉而不是 `auto`：Chrome 把能滚的容器放进 Tab 顺序，
 * 一直 `auto` 时活跃图那块成了一个没有名字的 Tab 停靠点（量到的 `scrollHeight` 与 `clientHeight` 相等，推断是不到一像素的溢出）。
 * `e2e/dashboard.e2e.ts` 从时间范围按 Tab 断言下一站是版本的滚动区。
 */
.dashboard-panel__content {
    height: 100%;
    overflow: hidden;
}

.dashboard-panel__content.is-scrollable {
    overflow: auto;
}

.dashboard-panel__content:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 4px;
}

/* 下面还有：底边一道渐隐到面板底色。不挡滚轮与点击。 */
.dashboard-panel__more {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 28px;
    background: linear-gradient(to bottom, transparent, var(--bg-panel));
    pointer-events: none;
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

<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";

export type CollapsibleSidePanelSide = "left" | "right";

/**
 * 这一栏在材料语言里属于哪一层。**这不是外观偏好，是主题给的角色。**
 * nav = 器械（导航、工具），content = 纸（要读的正文与数据）。
 */
export type CollapsibleSidePanelLayer = "nav" | "content";

const props = withDefaults(defineProps<{
    title: string;
    collapsed: boolean;
    side?: CollapsibleSidePanelSide;
    layer?: CollapsibleSidePanelLayer;
    collapsedWidth?: number;
}>(), {
    side: "left",
    layer: "nav",
    collapsedWidth: 40,
});

const emit = defineEmits<{
    (e: "update:collapsed", value: boolean): void;
}>();

const bodyRef = ref<HTMLElement | null>(null);
const toggleRef = ref<HTMLElement | null>(null);

const isLeft = computed(() => props.side === "left");

// 收起按钮指向它会缩过去的方向；展开按钮指向它会长出来的方向。
const toggleIconClass = computed(() => {
    if (props.collapsed) {
        return isLeft.value ? "i-lucide-chevron-right" : "i-lucide-chevron-left";
    }
    return isLeft.value ? "i-lucide-chevron-left" : "i-lucide-chevron-right";
});

// pre flush 让这里读到的还是收起之前的 activeElement；等 DOM 换完再把焦点接住，
// 否则内容区被销毁后焦点会掉回 body。展开时不抢焦点，展开可能由别处触发。
watch(() => props.collapsed, (isCollapsed) => {
    if (!isCollapsed) {
        return;
    }
    const active = document.activeElement;
    const focusWasInside = active instanceof HTMLElement && bodyRef.value?.contains(active) === true;
    if (!focusWasInside) {
        return;
    }
    void nextTick(() => toggleRef.value?.focus());
}, {flush: "pre"});
</script>

<template>
    <!-- 可收起侧栏：收起状态受控，宽度由父容器决定 -->
    <div
        class="nb-lab-panel flex h-full min-h-0 flex-col overflow-hidden"
        :class="`nb-lab-panel--${props.layer}`"
        :style="props.collapsed ? {width: `${props.collapsedWidth}px`, flex: `0 0 ${props.collapsedWidth}px`} : undefined"
    >
        <template v-if="props.collapsed">
            <div class="nb-lab-panel-rail flex justify-center">
                <button
                    ref="toggleRef"
                    type="button"
                    class="nb-lab-panel-toggle"
                    :title="props.title"
                    :aria-label="props.title"
                    :aria-expanded="false"
                    @click="emit('update:collapsed', false)"
                >
                    <span :class="toggleIconClass" class="h-4 w-4"></span>
                </button>
            </div>
        </template>

        <template v-else>
            <!-- 标题栏高度固定，切换内容不引起布局位移 -->
            <div class="nb-lab-panel-head flex shrink-0 items-center">
                <span class="nb-lab-panel-title min-w-0 flex-1 truncate">{{ props.title }}</span>
                <slot name="actions"></slot>
                <button
                    ref="toggleRef"
                    type="button"
                    class="nb-lab-panel-toggle shrink-0"
                    :title="props.title"
                    :aria-label="props.title"
                    :aria-expanded="true"
                    @click="emit('update:collapsed', true)"
                >
                    <span :class="toggleIconClass" class="h-4 w-4"></span>
                </button>
            </div>

            <div ref="bodyRef" class="min-h-0 flex-1 overflow-y-auto">
                <slot></slot>
            </div>
        </template>
    </div>
</template>

<style scoped>
/* 尺寸与圆角走主题 token，颜色走配色变量——两条轴分开，换主题时这一栏才会跟着变形状 */

/*
 * 导航层：玻璃。
 *
 * 取主题的 --sidebar-surface 而不是配色的 --bg-sidebar：前者是**角色**，玻璃主题把它定成
 * 半透明并配合模糊，非玻璃主题下它就等于 --bg-sidebar，两边都对。直接写 --bg-sidebar 等于把
 * 「侧栏永远实心」写死，玻璃主题装了也看不出来。
 */
.nb-lab-panel--nav {
    background: var(--sidebar-surface, var(--bg-sidebar));
    /* 与 LabShell 顶栏同一条取舍：chrome 层暂无库角色，先引用主题私有的 --glass-blur */
    backdrop-filter: var(--glass-blur, none);
    -webkit-backdrop-filter: var(--glass-blur, none);
}

/*
 * 内容层：实心。
 *
 * 装文档正文和 JSON 这类**要读的东西**的那一栏取这里，与画布同一档材料。理由有两条，
 * 而且都不是观感偏好：
 *
 * 一是玻璃底下透出来的窗体底纹会从正文字后面浮上来，那不是材料感，是脏。
 * 二是 nbook 这类主题把冷暖对比定成了身份——「器械从 --bg-sidebar 派生（冷），
 * 只有内容面板从 --panel-surface 派生（暖）」。两侧栏都判给导航层的话，整屏一处暖面都没有，
 * 主题最核心的那组对比在这个页面上等于没开。
 */
.nb-lab-panel--content {
    background: var(--panel-surface, var(--bg-panel));
}

/*
 * 本零件只管**材料**（这一栏是什么面），不管**形状**（圆角、外框、抬起、跟邻居之间那条缝）。
 *
 * 形状是布局的事，与宽度同一类：贴边三栏要的是一条竖直分割线，浮起三栏要的是圆角加抬起，
 * 同一个侧栏两种都可能对。所以这里不画任何边框，由使用方在外面给类。Lab 的取法见 LabShell
 * 的 .lab-panel。
 */

.nb-lab-panel-rail {
    padding-top: var(--space-4);
}

/* 高度与中栏的第二行同取 --control-h-lg，三列的第一条横线才在同一 y 上；
   横向留白同取 --panel-p，与面板内容左对齐。 */
.nb-lab-panel-head {
    height: var(--control-h-lg);
    gap: var(--space-4);
    padding: 0 var(--panel-p);
    border-bottom: var(--border-w) solid var(--divider);
}

/* 栏目标题走 2xs + 字距，与内容拉开层级：它是标签不是正文 */
.nb-lab-panel-title {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.06em;
}

.nb-lab-panel-toggle {
    display: inline-flex;
    height: var(--control-h-sm);
    width: var(--control-h-sm);
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard);
}

.nb-lab-panel-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.nb-lab-panel-toggle:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 2px;
}
</style>

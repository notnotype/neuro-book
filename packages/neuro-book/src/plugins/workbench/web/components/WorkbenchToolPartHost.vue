<script setup lang="ts">
/** 一个工具区域的框（同名 .md）：选中容器的落点与本区域的标题行；落点经 `target` 报给宿主。 */
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {Tabs} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {workbenchText} from "../../shared/text";
import type {ContainerPresentation, PartPresentation} from "../views/presentation";
import {switcherPanelId, switcherTabId} from "./switcher-ids";
import "./hover-actions.css";

/**
 * 标签带放不下时逐级让位（docs/specs/ui/workbench-shell.md 输出 25）：截断到 96px 时每个标签还读得出图标加四五个字，
 * 再窄就只留图标、收进“更多”。
 */
const TAB_MAX_WIDTH = 96;

defineOptions({name: "WorkbenchToolPartHost"});

const props = defineProps<{
    part: "sidebar" | "auxiliarybar" | "panel";
    presentation: PartPresentation;
    selected: ContainerPresentation | null;
    label: string;
    emptyText: string;
    /** 标签与内容面板关联用的 id 前缀（`switcher-ids.ts`）。 */
    idPrefix: string;
}>();

const resolver = useText();

const emit = defineEmits<{
    (event: "select", containerId: string): void;
    (event: "target", element: HTMLElement | null): void;
}>();

defineSlots<{
    actions?(props: {container: ContainerPresentation}): unknown;
}>();

const tabs = computed(() => props.presentation.switcher.map((item) => ({
    value: item.containerId,
    label: resolver.t(item.title),
    iconClass: item.icon,
    id: switcherTabId(props.idPrefix, props.part, item.containerId),
    controls: switcherPanelId(props.idPrefix, props.part),
    // 标签是 Switcher 的条目，也是整容器的拖动源（拖放会话按这两个标记找）。
    attrs: {"data-switcher-entry": item.containerId, "data-drag-container": item.containerId, "aria-description": resolver.t(workbenchText("shell.drag.hint"))},
})));
/** 右栏与面板的内容是标签带的 tabpanel；Sidebar 的切换在 ActivityBar，不是标签。 */
const tabbed = computed(() => props.part !== "sidebar" && props.selected !== null);
const showTitleRow = computed(() => props.part === "sidebar" && props.selected?.showContainerTitle === true);

/** 落点只在有选中容器时出现；它换成新元素或卸下时报给宿主。 */
const target = ref<HTMLElement | null>(null);
watch(target, (element) => emit("target", element));
onBeforeUnmount(() => {
    if (target.value !== null) emit("target", null);
});
</script>

<template>
    <section class="workbench-tool-part" :class="`workbench-tool-part--${part}`" :aria-label="label" :data-tool-part="part" data-hover-actions-scope>
        <header v-if="showTitleRow && selected !== null" class="workbench-tool-part__head workbench-tool-part__head--drag" :data-drag-container="selected.id">
            <span class="workbench-tool-part__icon" :class="selected.icon" aria-hidden="true"></span>
            <!-- 标题文字是键盘拖动的把手；指针拖动用整个标题行。 -->
            <h2 class="workbench-tool-part__title"><span class="nb-ui-focus-ring workbench-tool-part__handle" role="button" tabindex="0" :aria-label="resolver.t(workbenchText('shell.drag.label', {title: resolver.t(selected.title)}))" data-drag-handle>{{ resolver.t(selected.title) }}</span></h2>
            <div class="workbench-tool-part__actions" data-no-drag data-hover-actions>
                <slot name="actions" :container="selected"></slot>
            </div>
        </header>
        <!-- 标签带常驻：没有容器时它仍占着标题行，是“拖到 Switcher”的落点（外壳三输出 20）。 -->
        <header v-else-if="part === 'auxiliarybar'" class="workbench-tool-part__head workbench-tool-part__head--tabs">
            <div class="workbench-tool-part__band" :data-switcher-band="part">
                <Tabs
                    v-if="tabs.length > 0"
                    class="workbench-tool-part__tabs"
                    size="sm"
                    overflow="adapt"
                    :max-item-width="TAB_MAX_WIDTH"
                    :more-label="resolver.t(workbenchText('common.more'))"
                    :baseline="false"
                    :model-value="presentation.selected ?? ''"
                    :items="tabs"
                    :aria-label="label"
                    @update:model-value="(value: string) => emit('select', value)"
                />
            </div>
            <div v-if="selected !== null && selected.mode === 'single'" class="workbench-tool-part__actions" data-no-drag data-hover-actions>
                <slot name="actions" :container="selected"></slot>
            </div>
        </header>
        <div
            v-if="selected !== null"
            :id="tabbed ? switcherPanelId(idPrefix, part) : undefined"
            ref="target"
            class="workbench-tool-part__body"
            :role="tabbed ? 'tabpanel' : undefined"
            :aria-labelledby="tabbed ? switcherTabId(idPrefix, part, selected.id) : undefined"
            data-container-target
            :data-selected-container="selected.id"
        ></div>
        <div v-else class="workbench-tool-part__empty" :data-empty-part="part"><div class="workbench-tool-part__empty-box">{{ emptyText }}</div></div>
    </section>
</template>

<style scoped>
.workbench-tool-part {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/* 外壳平铺（ui/workbench-shell.md 输出 38）：不画卡片外框与圆角，和编辑区之间只有外壳网格的分隔条。 */
.workbench-tool-part--sidebar,
.workbench-tool-part--auxiliarybar {
    background: var(--panel-surface);
}

.workbench-tool-part__head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    min-width: 0;
    /* 右端是 24px 的图标按钮：右边留 4px，外扩焦点光环（实色 3.5px）不被工具区的裁切切掉。 */
    padding-inline: var(--space-3) var(--space-2);
}

/* 容器标题行整块是拖动源：不扩选文字，触摸按住起拖而不是滚动。 */
.workbench-tool-part__head--drag {
    touch-action: none;
    user-select: none;
}

.workbench-tool-part__head--tabs {
    padding-inline-start: var(--space-1);
}

.workbench-tool-part__band {
    display: flex;
    flex: 1 1 auto;
    align-self: stretch;
    align-items: center;
    min-width: 0;
}

.workbench-tool-part__tabs {
    flex: 1 1 auto;
    min-width: 0;
}

.workbench-tool-part__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.workbench-tool-part__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
}

/* 省略号裁切放在把手自己身上：标题不裁切，把手的焦点光环才不会被标题切掉上下。 */
.workbench-tool-part__handle {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    border-radius: var(--radius-control);
    text-overflow: ellipsis;
    vertical-align: middle;
}

.workbench-tool-part__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-tool-part__body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/*
 * 空着的区域整块都是落点；里面内缩 8px 的虚线框把“可以放在这里”画出来，提示居中（t83 第一轮稿 D2）。框画在里层：
 * 内缩若做在落点自己身上，框外那一圈就接不住投放。
 */
.workbench-tool-part__empty {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    padding: 8px;
}

.workbench-tool-part__empty-box {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: var(--space-3);
    border: 1px dashed color-mix(in srgb, var(--text-main) 24%, transparent);
    border-radius: 10px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: center;
}
</style>

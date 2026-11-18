<script setup lang="ts">
/**
 * 审批与提问向导共用的外框（见同名 `.md`）：标题行、内部滚动的内容区、底部的按钮。磨砂表面与其它浮层相同，用浮层外框类，
 * 所以这里不写模糊（packages/nb-ui/docs/ui-development-spec.md 的浮层表）。
 */
import {computed, inject} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";

import {useAgentText} from "../host";
import {dockFrameKey} from "./dock-frame";

const props = defineProps<{
    icon: string;
    title: string;
    /** 标题后面的等宽小字，例如文件地址。 */
    detail?: string;
    /** “第 1 / 3 个”；只有一个时不给。 */
    count?: string;
    /** 内容可能很长：视图很矮时内容区也留够 8 行，放不下就整个框滚动。短内容不要留白。 */
    tall?: boolean;
    /** 内容就是要读的（退出计划的计划全文）：外框放宽到视图的大部分。 */
    large?: boolean;
}>();

const emit = defineEmits<{collapse: []}>();

const {t} = useAgentText();

/** 在停靠区里：标题行换成停靠区的（来源、计数、上一个与下一个、打开子会话），面换成停靠的轻阴影与输入框的圆角。 */
const dock = inject(dockFrameKey, null);
const docked = computed(() => dock?.value ?? null);
const icon = computed(() => docked.value?.source?.icon ?? props.icon);
const title = computed(() => (docked.value?.source === undefined ? props.title : t("dock.fromSubagent", {name: docked.value.source.name, what: props.title})));
/** 停靠区里两个计数都写：第几个事项、这个事项的第几题（提问有几题时）。 */
const count = computed(() => (docked.value === null ? props.count : [docked.value.count, props.count].filter((part) => part !== undefined && part !== "").join(" · ") || undefined));
</script>

<template>
    <div class="acv-wizard-frame nb-ui-popover-surface" :class="{'is-large': props.large, 'is-docked': docked !== null}">
        <div class="acv-wizard-frame__scroll">
        <div class="acv-wizard-frame__head">
            <span :class="[icon, 'acv-wizard-frame__icon']" aria-hidden="true" />
            <span class="acv-wizard-frame__title" :title="title">{{ title }}</span>
            <code v-if="props.detail" class="acv-wizard-frame__detail" :title="props.detail">{{ props.detail }}</code>
            <span class="acv-wizard-frame__spacer" />
            <span v-if="count" class="acv-wizard-frame__count" data-wizard-count>{{ count }}</span>
            <template v-if="docked !== null && docked.count !== undefined">
                <IconButton icon-class="i-lucide-chevron-left" size="sm" :disabled="docked.previous === undefined" :title="t('wizard.previousItem')" :aria-label="t('wizard.previousItem')" data-dock-step="previous" @click="docked.previous?.()" />
                <IconButton icon-class="i-lucide-chevron-right" size="sm" :disabled="docked.next === undefined" :title="t('wizard.nextItem')" :aria-label="t('wizard.nextItem')" data-dock-step="next" @click="docked.next?.()" />
            </template>
            <IconButton v-if="docked?.open" icon-class="i-lucide-square-arrow-out-up-right" size="sm" :title="t('dock.openSession')" :aria-label="t('dock.openSession')" data-dock-open @click="docked.open()" />
            <IconButton icon-class="i-lucide-chevron-down" size="sm" :title="t('wizard.collapse')" :aria-label="t('wizard.collapse')" data-wizard-collapse @click="emit('collapse')" />
        </div>
        <div class="acv-wizard-frame__body" :class="{'is-tall': props.tall}">
            <slot />
        </div>
        <div class="acv-wizard-frame__foot">
            <slot name="foot" />
        </div>
        </div>
    </div>
</template>

<style scoped>
.acv-wizard-frame.is-large {
    max-height: 85cqh;
}

/* 滚动不加在浮层外框上（styles.css 的“浮层内部的滚动区”）：滚动条会画在圆角里。固定部分放不下时（很矮的视图）里面这层整个滚动。 */
.acv-wizard-frame {
    --nb-popover-pad: 10px;
    display: flex;
    max-height: 60cqh;
    overflow: hidden;
}

.acv-wizard-frame__scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    overflow-y: auto;
    padding: var(--nb-popover-pad) 12px;
}

.acv-wizard-frame__head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.acv-wizard-frame__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--accent-text);
}

/* 标题放不下时省略号截断，计数与按钮固定在右边（Spec“输入框与待处理区”）。 */
.acv-wizard-frame__title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 停靠的面不用浮层的阴影档、圆角同输入框（design-language.md“停靠的面不用浮层的阴影档”）。 */
.acv-wizard-frame.is-docked {
    /* 限高在停靠区上（视图高度的 40%），外框跟着收缩，里面那层滚动。 */
    max-height: none;
    min-height: 0;
    border-radius: var(--radius-panel);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 10%, transparent);
}

.acv-wizard-frame__detail {
    min-width: 0;
    user-select: text;
    overflow: hidden;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-wizard-frame__spacer {
    flex: 1;
}

.acv-wizard-frame__count {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-wizard-frame__body {
    flex: 0 1 auto;
    min-height: 0;
    /* 这里滚动就会裁掉贴边控件的焦点环：留出环的宽度，再用负外边距抵消，内容的位置不变。 */
    margin: -4px;
    padding: 4px;
    overflow: auto;
    /* 审批的命令、diff 与参数要能复制；停靠态在消息流之外，所以写在这里，不靠宿主容器（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
}

.acv-wizard-frame__body.is-tall {
    min-height: calc(8 * 1.6 * var(--text-xs));
}

.acv-wizard-frame__foot {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 6px;
}
</style>

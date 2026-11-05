<script setup lang="ts">
/**
 * 审批与提问向导共用的外框（见同名 `.md`）：标题行、内部滚动的内容区、底部的按钮。磨砂表面与其它浮层相同，用浮层外框类，
 * 所以这里不写模糊（packages/nb-ui/docs/ui-development-spec.md 的浮层表）。
 */
import {IconButton} from "@notnotype/nb-ui/components";

import {useAgentText} from "../host";

const props = defineProps<{
    icon: string;
    title: string;
    /** 标题后面的等宽小字，例如文件地址。 */
    detail?: string;
    /** “第 1 / 3 个”；只有一个时不给。 */
    count?: string;
    /** 内容可能很长：视图很矮时内容区也留够 8 行，放不下就整个框滚动。短内容不要留白。 */
    tall?: boolean;
}>();

const emit = defineEmits<{collapse: []}>();

const {t} = useAgentText();
</script>

<template>
    <div class="acv-wizard-frame nb-ui-popover-surface">
        <div class="acv-wizard-frame__scroll">
        <div class="acv-wizard-frame__head">
            <span :class="[props.icon, 'acv-wizard-frame__icon']" aria-hidden="true" />
            <span class="acv-wizard-frame__title">{{ props.title }}</span>
            <code v-if="props.detail" class="acv-wizard-frame__detail" :title="props.detail">{{ props.detail }}</code>
            <span class="acv-wizard-frame__spacer" />
            <span v-if="props.count" class="acv-wizard-frame__count" data-wizard-count>{{ props.count }}</span>
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

.acv-wizard-frame__title {
    flex-shrink: 0;
    font-weight: var(--weight-medium);
}

.acv-wizard-frame__detail {
    min-width: 0;
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
    overflow: auto;
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

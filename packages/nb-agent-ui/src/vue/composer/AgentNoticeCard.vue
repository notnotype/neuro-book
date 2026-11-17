<script setup lang="ts">
/** 输入框上方的提示卡（同名 .md）：模型用不了时写明卡在哪里，按钮直达去处。 */
import {Button} from "@notnotype/nb-ui/components";

import type {AvailabilityView} from "../../types";

defineOptions({name: "AgentNoticeCard"});

const props = defineProps<{
    notice: AvailabilityView;
}>();

const emit = defineEmits<{
    (e: "act", action: string): void;
}>();
</script>

<template>
    <div class="acv-notice-card nb-ui-popover-surface" role="status" data-composer-availability data-notice-card>
        <span :class="[props.notice.icon ?? 'i-lucide-info', 'acv-notice-card__icon']" aria-hidden="true" />
        <div class="acv-notice-card__main">
            <p v-if="props.notice.title !== undefined" class="acv-notice-card__title">{{ props.notice.title }}</p>
            <p v-if="props.notice.message !== ''" class="acv-notice-card__message">{{ props.notice.message }}</p>
            <div v-if="props.notice.actions.length > 0" class="acv-notice-card__actions">
                <Button
                    v-for="(item, index) in props.notice.actions"
                    :key="item.id"
                    size="sm"
                    :variant="index === 0 ? 'primary' : 'subtle'"
                    :data-availability-action="item.id"
                    @click="emit('act', item.id)"
                >
                    {{ item.label }}
                </Button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 面、描边、圆角、投影与模糊都来自 nb-ui 的浮层基座，这里只给内边距与排版。 */
.acv-notice-card {
    --nb-popover-pad: 12px;
    display: flex;
    gap: 10px;
    min-width: 0;
    padding: var(--nb-popover-pad);
}

.acv-notice-card__icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    color: var(--status-warning);
}

.acv-notice-card__main {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 4px;
}

.acv-notice-card__title {
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    overflow-wrap: anywhere;
}

.acv-notice-card__message {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}

.acv-notice-card__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
</style>

<script setup lang="ts">
import {computed} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {firstLine} from "../../format";
import {useAgentText} from "../host";

const props = defineProps<{
    queued: ReadonlyArray<{id: string; text: string; delivery: "steer" | "followup"}>;
}>();

const emit = defineEmits<{
    /** 取出到输入框，改了再发。 */
    edit: [id: string];
    remove: [id: string];
}>();

const {t} = useAgentText();

const VISIBLE = 3;
const shown = computed(() => props.queued.slice(0, VISIBLE));
const hidden = computed(() => Math.max(0, props.queued.length - VISIBLE));

</script>

<template>
    <ul v-if="props.queued.length > 0" class="acv-queued" :aria-label="t('composer.queued.label')">
        <li v-for="item in shown" :key="item.id" class="acv-queued__item" :title="item.text" :data-queued="item.delivery">
            <span class="acv-queued__tag">
                <span :class="item.delivery === 'steer' ? 'i-lucide-corner-down-left' : 'i-lucide-list-end'" class="acv-queued__icon" aria-hidden="true" />
                {{ item.delivery === "steer" ? t("composer.queued.steer") : t("composer.queued.followup") }}
            </span>
            <span class="acv-queued__text">{{ firstLine(item.text) }}</span>
            <IconButton icon-class="i-lucide-pencil" size="xs" :title="t('composer.queued.edit')" :aria-label="t('composer.queued.edit')" data-queued-edit @click="emit('edit', item.id)" />
            <IconButton icon-class="i-lucide-x" size="xs" :title="t('composer.queued.remove')" :aria-label="t('composer.queued.remove')" data-queued-remove @click="emit('remove', item.id)" />
        </li>
        <li v-if="hidden > 0" class="acv-queued__more">{{ t("composer.queued.more", {count: hidden}) }}</li>
    </ul>
</template>

<style scoped>
.acv-queued {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
}

.acv-queued__item {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-size: var(--text-xs);
    line-height: 1.4;
}

.acv-queued__tag {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 3px;
    color: var(--accent-text);
    font-weight: 600;
}

.acv-queued__icon {
    width: 12px;
    height: 12px;
}

.acv-queued__text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-queued__more {
    padding: 0 8px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>

<script setup lang="ts">
import {getReferenceChipMeta} from "nbook/app/components/common/reference-chip";

const props = defineProps<{
    label: string;
    target?: string;
    targetId?: string;
    entryType?: string | null;
    status?: string | null;
    icon?: string | null;
    broken?: boolean;
    kind?: string;
}>();

/**
 * 当前引用的视觉元数据。
 */
const normalizedTarget = computed(() => props.target ?? props.targetId ?? "");
const normalizedEntryType = computed(() => props.entryType ?? props.kind ?? null);
const meta = computed(() => getReferenceChipMeta({
    target: normalizedTarget.value,
    entryType: normalizedEntryType.value,
    icon: props.icon ?? null,
    broken: props.broken ?? false,
}));
</script>

<template>
    <!-- 通用引用 chip -->
    <span
        class="nb-reference-chip"
        :class="meta.toneClass"
        :data-reference-target="normalizedTarget"
        :data-reference-entry-type="normalizedEntryType ?? ''"
        contenteditable="false"
        :title="normalizedTarget"
    >
        <span class="nb-reference-chip__icon" :class="meta.iconClass" aria-hidden="true"></span>
        <span class="nb-reference-chip__label">{{ props.label }}</span>
        <span class="nb-reference-chip__badge">{{ meta.badgeLabel }}</span>
    </span>
</template>

<style>
.nb-inline-comment {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: min(100%, 30rem);
    margin: 0 0.1rem;
    padding: 0.08rem 0.42rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, currentColor 10%, var(--bg-panel));
    vertical-align: baseline;
    line-height: 1.25;
    color: var(--status-info);
}

.nb-inline-comment__badge {
    flex: none;
    padding: 0.04rem 0.28rem;
    border-radius: 0.55rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font-size: 0.58rem;
    line-height: 1.1;
    letter-spacing: 0.08em;
}

.nb-inline-comment__body {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.86em;
    font-weight: 600;
}
</style>

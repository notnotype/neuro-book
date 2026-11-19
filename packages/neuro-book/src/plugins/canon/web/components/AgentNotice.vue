<script setup lang="ts">
/**
 * Agent 改了设定的提示（同名 .md）：与保存后的提示各占一行。受控：点了什么发出什么。
 */
import {Button, IconButton} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

const props = withDefaults(defineProps<{title: string; earlier?: number}>(), {earlier: 0});

const emit = defineEmits<{
    (event: "receipt"): void;
    (event: "undo"): void;
    (event: "revisions"): void;
    (event: "close"): void;
}>();

const text = useCanonText();
</script>

<template>
    <div role="status" :aria-label="text('notice.agentLabel')" class="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] bg-[var(--bg-subtle)] px-8 py-1.5 text-[length:var(--text-sm)] max-[480px]:px-4" data-agent-notice>
        <span class="i-lucide-bot shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-[var(--text-main)]">{{ text("notice.agentChanged", {title: props.title}) }}<template v-if="props.earlier > 0">{{ text("notice.agentEarlier", {count: props.earlier}) }}</template></span>
        <Button size="sm" variant="ghost" @click="emit('receipt')">{{ text("notice.receipt") }}</Button>
        <Button size="sm" variant="ghost" @click="emit('undo')">{{ text("notice.undo") }}</Button>
        <Button size="sm" variant="ghost" @click="emit('revisions')">{{ text("notice.revisions") }}</Button>
        <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close')" />
    </div>
</template>

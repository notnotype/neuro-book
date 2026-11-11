<script setup lang="ts">
/**
 * 保存后的提示（docs/specs/canon/author-ui.md 输出 18、30）：页面顶上的一行，这次修订的标题、“看回执”与关闭。受控；“撤销”
 * 在第一批的回执一片加。
 */
import {Button, IconButton} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

const props = defineProps<{title: string}>();

const emit = defineEmits<{
    (event: "receipt"): void;
    (event: "close"): void;
}>();

const text = useCanonText();
</script>

<template>
    <div role="status" :aria-label="text('notice.label')" class="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] bg-[var(--bg-subtle)] px-8 py-1.5 text-[length:var(--text-sm)] max-[480px]:px-4" data-notice-bar>
        <span class="i-lucide-circle-check shrink-0 text-[var(--status-success)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-[var(--text-main)]">{{ props.title }}</span>
        <Button size="sm" variant="ghost" @click="emit('receipt')">{{ text("notice.receipt") }}</Button>
        <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close')" />
    </div>
</template>

<script setup lang="ts">
/**
 * Agent 改了设定的提示（同名 .md）：与保存后的提示各占一行。受控：点了什么发出什么。
 */
import {Button, IconButton} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

const props = withDefaults(defineProps<{title: string; earlier?: number; undone?: boolean}>(), {earlier: 0, undone: false});

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
        <!-- 撤销以后同一个按钮写“已撤销”、不再响应：还原对话框关闭时焦点回到它，换成别的元素或停用（disabled）焦点都会掉到页面外。 -->
        <Button size="sm" variant="ghost" :aria-disabled="props.undone ? 'true' : undefined" data-agent-undo @click="props.undone || emit('undo')">{{ text(props.undone ? "notice.undone" : "notice.undo") }}</Button>
        <Button size="sm" variant="ghost" @click="emit('revisions')">{{ text("notice.revisions") }}</Button>
        <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close')" />
    </div>
</template>

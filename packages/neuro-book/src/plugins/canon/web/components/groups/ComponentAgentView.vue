<script setup lang="ts">
/**
 * 设定组分页的“AI视图”（同名 .md，docs/specs/canon/author-ui.md 输出 54）：字由宿主用 `canon/shared/agent-fields.ts` 的
 * `fieldsText` 写好，和后端 `canon_read` 给模型的是同一个函数写的；这里只显示。
 */
import {Button} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    text: string;
    position: string;
    loading?: boolean;
    failed?: string | null;
}>(), {loading: false, failed: null});

const emit = defineEmits<{
    (event: "retry"): void;
}>();

const text = useCanonText();
</script>

<template>
    <div data-agent-view>
        <p class="mb-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("entry.views.agentPosition", {position: props.position}) }}</p>
        <p v-if="props.failed !== null" role="alert" class="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--status-warning)]">
            <span>{{ text("entry.views.failed", {reason: props.failed}) }}</span>
            <Button size="sm" variant="ghost" @click="emit('retry')">{{ text("entry.views.retry") }}</Button>
        </p>
        <p v-else-if="props.loading" class="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <pre v-else class="component-agent-view__text" data-agent-text>{{ props.text }}</pre>
    </div>
</template>

<style scoped>
.component-agent-view__text {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-main);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
}
</style>

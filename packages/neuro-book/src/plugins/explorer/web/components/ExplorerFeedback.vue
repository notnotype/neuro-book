<script setup lang="ts">
/** 资源管理器的结果区（同名 .md）。 */
import {IconButton} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {Notice} from "../controller";
import {explorerText} from "../messages";

const props = defineProps<{
    locale: DisplayLocale;
    notice: Notice | null;
}>();

const emit = defineEmits<{
    (event: "dismiss"): void;
}>();

const text = computed(() => {
    const notice = props.notice;
    if (notice === null) return "";
    return notice.kind === "editor-missing" ? explorerText(props.locale, "editorMissing", {address: notice.address}) : explorerText(props.locale, "openFailed", {address: notice.address, reason: notice.reason});
});
</script>

<template>
    <div v-if="notice !== null" class="flex max-h-[40%] min-h-0 items-start gap-2 overflow-y-auto border-t border-[var(--divider)] px-3 py-2 text-xs text-[var(--text-secondary)]" data-explorer-feedback>
        <span class="i-lucide-info mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
        <p class="min-w-0 flex-1 break-words" role="status">{{ text }}</p>
        <IconButton size="sm" icon-class="i-lucide-x" :aria-label="explorerText(locale, 'dismiss')" :title="explorerText(locale, 'dismiss')" @click="emit('dismiss')" />
    </div>
</template>

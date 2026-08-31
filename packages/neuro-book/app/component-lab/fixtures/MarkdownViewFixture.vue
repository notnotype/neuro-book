<script setup lang="ts">
import {computed} from "vue";
import MarkdownView from "../MarkdownView.vue";

const props = defineProps<{scene: string; data?: unknown}>();

const source = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return typeof data.source === "string" ? data.source : "";
});
</script>

<template>
    <div class="h-full overflow-auto p-4">
        <MarkdownView :source="source" />
    </div>
</template>

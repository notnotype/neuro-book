<script setup lang="ts">
import {ref, watch} from "vue";
import JsonViewer from "../../components/common/JsonViewer.vue";

const props = defineProps<{scene: string}>();

const samples: Record<string, unknown> = {
    object: {
        id: "chapter-01",
        title: "第一章",
        wordCount: 3182,
        tags: ["草稿", "待审"],
        meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false},
    },
    array: [
        {tool: "read_file", ok: true, ms: 12},
        {tool: "write_file", ok: false, ms: 340},
        {tool: "list_dir", ok: true, ms: 3},
    ],
    // 字符串走的是另一条路径：原样保留用户输入，不重排
    text: '{\n  "unfinished": tru',
    empty: {},
};

const value = ref<unknown>(samples.object);
const hasErrors = ref(false);

watch(() => props.scene, (scene) => {
    value.value = samples[scene] ?? samples.object;
    hasErrors.value = false;
}, {immediate: true});
</script>

<template>
    <div class="flex h-full flex-col gap-2 p-3">
        <!-- 事件名是 update:value，写 v-model 会静默失效 -->
        <JsonViewer
            v-model:value="value"
            :read-only="false"
            :max-height="0"
            class="min-h-0 flex-1"
            @validation-change="hasErrors = $event"
        />
        <p class="shrink-0 text-xs" :class="hasErrors ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">
            {{ hasErrors ? "当前内容不是合法 JSON" : "当前内容可以解析" }}
        </p>
    </div>
</template>

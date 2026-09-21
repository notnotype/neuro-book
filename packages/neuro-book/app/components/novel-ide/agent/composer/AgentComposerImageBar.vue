<script setup lang="ts">
const props = withDefaults(defineProps<{
    images: Array<{target: string; label: string}>;
    modelSupportsImages: boolean;
    metadataError?: string | null;
    readonly?: boolean;
    getImageUrl: (target: string) => string | null;
}>(), {
    metadataError: null,
    readonly: false,
});

const emit = defineEmits<{
    (e: "remove-image", index: number): void;
    (e: "retry-metadata"): void;
}>();

const imageCapabilityWarning = computed(() => props.images.length > 0 && !props.modelSupportsImages);
</script>

<template>
    <div v-if="props.images.length > 0 || imageCapabilityWarning || props.metadataError" class="min-w-0">
        <!-- 正文图片派生缩略图：删除只移除对应 Markdown 标记。 -->
        <div v-if="props.images.length > 0" class="flex min-w-0 gap-1.5 overflow-x-auto border-b border-[var(--border-color)]/50 px-2 py-1.5">
            <div
                v-for="(image, index) in props.images"
                :key="`${image.target}:${String(index)}`"
                class="group relative h-12 w-16 shrink-0 overflow-hidden rounded border border-[var(--border-color)] bg-[var(--bg-panel)]"
            >
                <img
                    v-if="props.getImageUrl(image.target)"
                    :src="props.getImageUrl(image.target) || undefined"
                    :alt="image.label"
                    class="h-full w-full object-cover"
                />
                <div v-else class="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                    <span class="i-lucide-image h-4 w-4"></span>
                </div>
                <button
                    type="button"
                    class="absolute right-0.5 top-0.5 rounded bg-[var(--bg-panel)]/90 p-0.5 text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--status-danger)] group-hover:opacity-100 disabled:hidden"
                    :disabled="props.readonly"
                    title="从正文移除图片"
                    @click="emit('remove-image', index)"
                >
                    <span class="i-lucide-x h-3 w-3"></span>
                </button>
                <div
                    class="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-panel)]/85 px-1 text-[8px] text-[var(--text-secondary)]"
                    :title="image.label"
                >
                    {{ image.label }}
                </div>
            </div>
        </div>

        <div
            v-if="imageCapabilityWarning"
            class="flex items-center gap-1.5 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[10px] text-[var(--status-warning)]"
        >
            <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0"></span>
            <span>当前模型未声明图片输入能力；仍可发送，后端会使用文本占位。</span>
        </div>

        <div
            v-if="props.metadataError"
            class="flex items-center gap-1.5 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1 text-[10px] text-[var(--status-danger)]"
        >
            <span class="i-lucide-image-off h-3.5 w-3.5 shrink-0"></span>
            <span class="min-w-0 flex-1 truncate" :title="props.metadataError">{{ props.metadataError }}</span>
            <button
                type="button"
                class="rounded p-1 hover:bg-[var(--bg-hover)]"
                title="重新校验图片附件"
                @click="emit('retry-metadata')"
            >
                <span class="i-lucide-refresh-cw h-3 w-3"></span>
            </button>
        </div>
    </div>
</template>

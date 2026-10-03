<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Dialog} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    src: string;
    alt: string;
    downloadName?: string;
    /**
     * 浮层宿主。默认落在 IDE 主题宿主上，对话框才会跟着主题换面色；
     * Lab 场景没有主题宿主，fixture 传 false 就地渲染。
     */
    teleportTarget?: string | boolean;
}>(), {
    teleportTarget: ".novel-ide-theme",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const {t} = useI18n();
const loadState = ref<"loading" | "loaded" | "error">("loading");
const retryNonce = ref(0);
const requestUrl = computed(() => retryNonce.value === 0
    ? props.src
    : `${props.src}${props.src.includes("?") ? "&" : "?"}previewRetry=${String(retryNonce.value)}`);

watch(() => [props.modelValue, props.src], () => {
    loadState.value = "loading";
    retryNonce.value = 0;
});

/** 用户显式重试原图；对话框关闭前保留错误态。 */
const retry = (): void => {
    loadState.value = "loading";
    retryNonce.value += 1;
};
</script>

<template>
    <!-- 共享原图预览：仅在打开时挂载 img，因此缩略图列表不会提前请求原图。 -->
    <Dialog :model-value="modelValue" size="xl" :title="t('ide.imagePreview.title')" :show-footer="false" body-class="!p-0 !overflow-hidden" overlay-type="opaque" :teleport-target="props.teleportTarget" @update:model-value="emit('update:modelValue', $event)">
        <div class="flex min-h-0 flex-1 flex-col bg-[var(--bg-main)]">
            <div class="relative flex min-h-[260px] flex-1 items-center justify-center overflow-auto p-4 sm:min-h-[420px]">
                <span v-if="loadState === 'loading'" class="i-lucide-loader-circle h-6 w-6 animate-spin text-[var(--text-muted)]" aria-hidden="true"></span>
                <img v-if="modelValue && src && loadState !== 'error'" :src="requestUrl" :alt="alt" class="max-h-full max-w-full object-contain" @load="loadState = 'loaded'" @error="loadState = 'error'">
                <div v-if="loadState === 'error'" class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-[var(--status-danger)]" role="alert">
                    <span class="i-lucide-image-off h-7 w-7"></span>
                    <span>{{ t("ide.imagePreview.loadFailed") }}</span>
                    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-4 text-sm hover:bg-[var(--bg-hover)]" @click="retry">
                        <span class="i-lucide-refresh-cw h-4 w-4"></span>
                        {{ t("ide.imagePreview.retry") }}
                    </button>
                </div>
            </div>
            <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                <span class="min-w-0 truncate text-xs text-[var(--text-muted)]" :title="alt">{{ alt }}</span>
                <a :href="src" :download="downloadName || ''" class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] hover:bg-[var(--bg-hover)]">
                    <span class="i-lucide-download h-4 w-4"></span>
                    {{ t("ide.imagePreview.downloadOriginal") }}
                </a>
            </footer>
        </div>
    </Dialog>
</template>

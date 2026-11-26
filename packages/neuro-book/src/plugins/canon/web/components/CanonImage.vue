<script setup lang="ts">
/**
 * 按作品内路径显示一张图（同名 .md）：懒加载、读到以后淡入，读不出来画“图片找不到”。
 */
import {computed, shallowRef, watch} from "vue";

import {useCanonImageUrl} from "../images";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    path: string;
    alt?: string;
    fit?: "cover" | "contain";
}>(), {alt: "", fit: "cover"});

const text = useCanonText();
const urlOf = useCanonImageUrl();
const url = computed(() => urlOf(props.path));
const loaded = shallowRef(false);
const failed = shallowRef(false);
watch(() => props.path, () => {
    loaded.value = false;
    failed.value = false;
});
</script>

<template>
    <div class="relative h-full w-full overflow-hidden bg-[var(--bg-input)]" :data-canon-image="props.path" :data-image-state="failed || url === null ? 'missing' : loaded ? 'loaded' : 'loading'">
        <img
            v-if="url !== null && !failed"
            :key="url"
            class="h-full w-full transition-opacity [transition-duration:var(--motion-base)]"
            :class="[props.fit === 'cover' ? 'object-cover' : 'object-contain', loaded ? 'opacity-100' : 'opacity-0']"
            :src="url"
            :alt="props.alt"
            loading="lazy"
            decoding="async"
            @load="loaded = true"
            @error="failed = true"
        >
        <div v-else class="flex h-full w-full flex-col items-center justify-center gap-1 text-[length:var(--text-xs)] text-[var(--text-muted)]" role="img" :aria-label="text('images.missing')">
            <span class="i-lucide-image-off h-5 w-5" aria-hidden="true" />
            <span>{{ text("images.missing") }}</span>
        </div>
    </div>
</template>

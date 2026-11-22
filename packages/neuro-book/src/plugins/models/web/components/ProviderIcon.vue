<script setup lang="ts">
import {providerIconUrl} from "../../shared/icons";
import type {ProviderIcon} from "@notnotype/nb-models/config";
import {computed, ref, watch} from "vue";

import {providerIcon} from "nbook/ui/provider-icons";

/**
 * 服务商的图标（同名 .md）：用户选的（内置、上传、首字母），没选时跟模板的；解析不出画首字母块。
 */
const props = withDefaults(defineProps<{
    /** 服务商里存的图标；null 是跟随模板。 */
    icon?: ProviderIcon | null;
    /** 模板 id：没选图标时按它取模板的图标；空白模板在图标表里没有，画首字母。 */
    template: string;
    name: string;
    size?: number;
}>(), {icon: null, size: 18});

/** 内置图标的键，或没选时模板的键；`initial` 与上传的不取表。 */
const key = computed(() => (props.icon === null ? props.template : props.icon.kind === "builtin" ? props.icon.key : null));
/** 在 computed 里取：图标表晚到时（它是响应式的）这里重算，首字母换成图标。 */
const resolved = computed(() => (key.value === null ? null : providerIcon(key.value)));
const fileUrl = computed(() => (props.icon?.kind === "file" ? providerIconUrl(props.icon.name) : null));
const broken = ref(false);
watch(fileUrl, () => {
    broken.value = false;
});
const initial = computed(() => Array.from(props.name.trim())[0]?.toUpperCase() ?? "?");
const box = computed(() => ({width: `${String(props.size)}px`, height: `${String(props.size)}px`}));
const maskUrl = (src: string): string => `url("${src.replace(/"/gu, "%22")}")`;
</script>

<template>
    <span class="provider-icon" :style="box" aria-hidden="true" data-provider-icon>
        <img v-if="fileUrl !== null && !broken" :src="fileUrl" class="provider-icon__image" :style="box" alt="" @error="broken = true">
        <span v-else-if="resolved?.kind === 'mask'" class="provider-icon__mask" :style="{...box, '--provider-icon-src': maskUrl(resolved.src)}" />
        <img v-else-if="resolved?.kind === 'image'" :src="resolved.src" class="provider-icon__image" :style="box" alt="">
        <span v-else class="provider-icon__initial" :style="{...box, fontSize: `${String(Math.round(size * 0.62))}px`}">{{ initial }}</span>
    </span>
</template>

<style scoped>
.provider-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
}

.provider-icon__image {
    display: inline-block;
    object-fit: contain;
}

.provider-icon__mask {
    display: inline-block;
    background: currentColor;
    mask: var(--provider-icon-src) center / contain no-repeat;
}

.provider-icon__initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
    color: var(--text-secondary);
    font-weight: var(--weight-strong);
    line-height: 1;
}
</style>

<script setup lang="ts">
import {providerIconUrl} from "../../shared/icons";
import type {ProviderIcon} from "@notnotype/nb-models/config";
import {computed, ref, watch} from "vue";

import ProviderLogo from "nbook/ui/provider-icons/ProviderLogo.vue";

/**
 * 服务商的图标（同名 .md）：用户选的（内置、上传、首字母），没选时跟模板的；上传的自己画，其余交给共用的 `ProviderLogo`（图标表或首字母块）。
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
const fileUrl = computed(() => (props.icon?.kind === "file" ? providerIconUrl(props.icon.name) : null));
const broken = ref(false);
watch(fileUrl, () => {
    broken.value = false;
});
const box = computed(() => ({width: `${String(props.size)}px`, height: `${String(props.size)}px`}));
</script>

<template>
    <span class="provider-icon" :style="box" aria-hidden="true" data-provider-icon>
        <img v-if="fileUrl !== null && !broken" :src="fileUrl" class="provider-icon__image" :style="box" alt="" @error="broken = true">
        <ProviderLogo v-else :id="key" :name="name" :size="size" />
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

</style>

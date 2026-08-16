<script setup lang="ts">
import {onMounted, ref} from "vue";
import NovelIdeSettingsDialog from "nbook/app/components/novel-ide/NovelIdeSettingsDialog.vue";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";

const theme = ref<IdeTheme>("sepia");
const themeHostRef = ref<HTMLElement | null>(null);
const settingsOpen = ref(true);
const {mountThemeHost} = useIdeTheme(theme);

onMounted(() => {
    mountThemeHost(themeHostRef.value);
});
</script>

<template>
    <!-- 设置中心截图 adapter 的稳定宿主；Dialog 使用 opaque overlay，避免主页提示框叠加。 -->
    <div
        ref="themeHostRef"
        class="settings-preview-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]"
        data-settings-preview-page
    >
        <h1 class="sr-only">设置中心独立预览页</h1>
        <NovelIdeSettingsDialog v-model="settingsOpen" />
    </div>
</template>

<style scoped>
.settings-preview-page {
    background-image:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent-main) 10%, transparent), transparent 28%),
        radial-gradient(circle at top right, color-mix(in srgb, var(--accent-main) 8%, transparent), transparent 24%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg-main) 94%, white), var(--bg-main));
}
</style>

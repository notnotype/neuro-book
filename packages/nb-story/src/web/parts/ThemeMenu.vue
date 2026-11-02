<script setup lang="ts">
import {DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, useAttrs} from "vue";

import type {ThemeChoice} from "../host/prefs";
import {useAppearance} from "../host/theme";

// 根是 DropdownMenu（reka 的根原语不渲染元素），调用方的 class 会丢：自己接住，交给它的 rootClass（触发器）。
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const appearance = useAppearance();
const THEMES: ReadonlyArray<{value: ThemeChoice; label: string; icon: string}> = [
    {value: "system", label: "跟随系统", icon: "i-lucide-monitor"},
    {value: "light", label: "亮色", icon: "i-lucide-sun"},
    {value: "dark", label: "暗色", icon: "i-lucide-moon"},
];
const items = computed<DropdownMenuItemData[]>(() => THEMES.map(theme => ({id: theme.value, label: theme.label, iconClass: theme.icon, type: "radio", group: "theme", checked: appearance.choice.value === theme.value})));
const icon = computed(() => THEMES.find(theme => theme.value === appearance.choice.value)!.icon);
function select(value: string): void {
    const theme = THEMES.find(item => item.value === value);
    if (theme) appearance.set(theme.value);
}
</script>

<template>
    <DropdownMenu :items="items" align="end" :root-class="attrs.class as string | undefined" @select="select"><IconButton size="sm" :icon-class="icon" aria-label="明暗" title="明暗" data-testid="theme-menu" /></DropdownMenu>
</template>

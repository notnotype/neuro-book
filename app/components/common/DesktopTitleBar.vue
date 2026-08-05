<script setup lang="ts">
import type {DesktopMenuCommandId} from "nbook/shared/desktop-contract";

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const status = ref<{version: string; connection: "local" | "remote"} | null>(null);

const menus: Array<{label: string; command: DesktopMenuCommandId}> = [
    {label: "File", command: "file.settings"},
    {label: "Edit", command: "edit.undo"},
    {label: "View", command: "view.reload"},
    {label: "Help", command: "help.about"},
];

onMounted(async () => {
    if (bridge.value) status.value = await bridge.value.status().catch(() => null);
});

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    await bridge.value?.menu(command);
}
</script>

<template>
    <div v-if="bridge" class="desktop-title-bar" role="banner">
        <div class="desktop-title-bar__drag">
            <div class="desktop-title-bar__brand">NeuroBook</div>
            <div class="desktop-title-bar__menus">
                <button v-for="menu in menus" :key="menu.label" type="button" class="desktop-title-bar__menu" @click="void invoke(menu.command)">{{ menu.label }}</button>
            </div>
            <div class="desktop-title-bar__status">{{ status?.connection === "remote" ? "Remote" : "Local" }}{{ status?.version ? ` · ${status.version}` : "" }}</div>
        </div>
    </div>
</template>

<style scoped>
.desktop-title-bar {
    position: fixed;
    z-index: 1000;
    top: 0;
    right: 0;
    left: 0;
    height: 36px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-main) 92%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
    -webkit-app-region: drag;
}

.desktop-title-bar__drag {
    display: flex;
    height: 100%;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
}

.desktop-title-bar__brand {
    color: var(--text-main);
    font-size: 12px;
    font-weight: 650;
}

.desktop-title-bar__menus {
    display: flex;
    align-items: center;
    gap: 2px;
}

.desktop-title-bar__menu {
    height: 26px;
    padding: 0 8px;
    color: inherit;
    border-radius: 4px;
    font-size: 12px;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__menu:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__status {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 11px;
}
</style>

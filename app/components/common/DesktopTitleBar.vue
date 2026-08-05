<script setup lang="ts">
import type {DesktopMenuCommandId} from "nbook/shared/desktop-contract";

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const status = ref<{version: string; connection: "local" | "remote"} | null>(null);
const openMenu = ref<string | null>(null);

const menus: Array<{label: string; items: Array<{label: string; command: DesktopMenuCommandId}>}> = [
    {
        label: "File",
        items: [
            {label: "Open", command: "file.open"},
            {label: "Settings", command: "file.settings"},
            {label: "Quit", command: "file.quit"},
        ],
    },
    {
        label: "Edit",
        items: [
            {label: "Undo", command: "edit.undo"},
            {label: "Redo", command: "edit.redo"},
            {label: "Cut", command: "edit.cut"},
            {label: "Copy", command: "edit.copy"},
            {label: "Paste", command: "edit.paste"},
            {label: "Select All", command: "edit.select-all"},
        ],
    },
    {
        label: "View",
        items: [
            {label: "Reload", command: "view.reload"},
            {label: "Zoom In", command: "view.zoom-in"},
            {label: "Zoom Out", command: "view.zoom-out"},
            {label: "Reset Zoom", command: "view.zoom-reset"},
        ],
    },
    {
        label: "Help",
        items: [
            {label: "Documentation", command: "help.documentation"},
            {label: "About NeuroBook", command: "help.about"},
        ],
    },
];

onMounted(async () => {
    if (bridge.value) status.value = await bridge.value.status().catch(() => null);
});

function toggleMenu(label: string): void {
    openMenu.value = openMenu.value === label ? null : label;
}

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    openMenu.value = null;
    await bridge.value?.menu(command);
}
</script>

<template>
    <div v-if="bridge" class="desktop-title-bar" role="banner">
        <div class="desktop-title-bar__drag" @click="openMenu = null">
            <div class="desktop-title-bar__brand">NeuroBook</div>
            <div class="desktop-title-bar__menus" @click.stop>
                <div v-for="menu in menus" :key="menu.label" class="desktop-title-bar__menu-group">
                    <button type="button" class="desktop-title-bar__menu" :aria-expanded="openMenu === menu.label" @click="toggleMenu(menu.label)">{{ menu.label }}</button>
                    <div v-if="openMenu === menu.label" class="desktop-title-bar__dropdown" role="menu">
                        <button v-for="item in menu.items" :key="item.command" type="button" class="desktop-title-bar__item" role="menuitem" @click="void invoke(item.command)">{{ item.label }}</button>
                    </div>
                </div>
            </div>
            <div v-if="status" class="desktop-title-bar__status">{{ status.connection === "remote" ? "Remote" : "Local" }}{{ status.version ? ` · ${status.version}` : "" }}</div>
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

.desktop-title-bar__menu-group {
    position: relative;
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

.desktop-title-bar__dropdown {
    position: absolute;
    z-index: 1001;
    top: 30px;
    left: 0;
    display: grid;
    min-width: 168px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--text-main) 18%, transparent);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__item {
    height: 28px;
    padding: 0 10px;
    color: var(--text-secondary);
    text-align: left;
    border-radius: 3px;
    font-size: 12px;
    white-space: nowrap;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__item:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__status {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 11px;
}
</style>

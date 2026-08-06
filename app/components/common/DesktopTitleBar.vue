<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {useWorkbenchChrome} from "nbook/app/composables/useWorkbenchChrome";
import {
    parseDesktopStatus,
    type DesktopMenuCommandId,
    type DesktopStatus,
} from "nbook/shared/desktop-contract";
import {
    resolveTitleBarMenuPresentation,
    type TitleBarMenuPresentation,
} from "nbook/app/utils/workbench-chrome";

type MenuItem = Readonly<{
    label: string;
    command: DesktopMenuCommandId;
}>;

type MenuGroup = Readonly<{
    label: string;
    items: readonly MenuItem[];
}>;

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const chrome = useWorkbenchChrome();
const status = ref<DesktopStatus | null>(null);
const openMenu = ref<string | null>(null);
const presentation = ref<TitleBarMenuPresentation>("full");
const rootRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const fullMenuMeasureRef = ref<HTMLElement | null>(null);
const titleMeasureRef = ref<HTMLElement | null>(null);
const controlsRef = ref<HTMLElement | null>(null);
const windowControlsRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

const menus: readonly MenuGroup[] = [
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

const registration = computed(() => chrome.current.value);
const title = computed(() => registration.value?.title() || "NeuroBook");
const surfaceActive = computed(() => registration.value?.surfaceActive() ?? false);
const agentMode = computed(() => registration.value?.layoutMode() === "agent");
const studioPanelOpen = computed(() => registration.value?.studioPanelOpen() ?? false);
const rendererMenus = computed(() => status.value?.menuPresentation !== "native");
const customWindowControls = computed(() => status.value?.windowControls === "custom");
const compactItems = computed(() => menus.flatMap((group) => group.items));

function updatePresentation(): void {
    const content = contentRef.value;
    const fullMenu = fullMenuMeasureRef.value;
    const titleElement = titleMeasureRef.value;
    const controls = controlsRef.value;
    if (!content || !fullMenu || !titleElement || !controls) return;
    presentation.value = resolveTitleBarMenuPresentation({
        availableWidth: content.clientWidth,
        fullMenuWidth: fullMenu.scrollWidth,
        titleWidth: Math.min(titleElement.scrollWidth, 280),
        controlsWidth: controls.scrollWidth + (windowControlsRef.value?.scrollWidth ?? 0),
    });
}

function toggleMenu(label: string): void {
    openMenu.value = openMenu.value === label ? null : label;
}

async function openMenuFromKeyboard(label: string): Promise<void> {
    openMenu.value = label;
    await nextTick();
    rootRef.value?.querySelector<HTMLElement>(`[data-menu="${label}"] [role="menuitem"]`)?.focus();
}

function menuButtonKeydown(event: KeyboardEvent, group: MenuGroup, index: number): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openMenuFromKeyboard(group.label);
        return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (index + offset + menus.length) % menus.length;
        rootRef.value?.querySelector<HTMLElement>(`[data-menu-button="${menus[nextIndex]?.label}"]`)?.focus();
        return;
    }
    if (event.key === "Escape") openMenu.value = null;
}

function menuItemKeydown(event: KeyboardEvent, group: MenuGroup, groupIndex: number, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        openMenu.value = null;
        rootRef.value?.querySelector<HTMLElement>(`[data-menu-button="${group.label}"]`)?.focus();
        return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (groupIndex + offset + menus.length) % menus.length;
        void openMenuFromKeyboard(menus[nextIndex]?.label ?? group.label);
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (itemIndex + offset + group.items.length) % group.items.length;
    rootRef.value?.querySelectorAll<HTMLElement>(`[data-menu="${group.label}"] [role="menuitem"]`)[nextIndex]?.focus();
}

async function openCompactMenu(focusLast = false): Promise<void> {
    openMenu.value = "compact";
    await nextTick();
    const items = rootRef.value?.querySelectorAll<HTMLElement>('[data-menu="compact"] [role="menuitem"]');
    items?.[focusLast ? Math.max(0, items.length - 1) : 0]?.focus();
}

function compactMenuButtonKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openCompactMenu(false);
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        void openCompactMenu(true);
        return;
    }
    if (event.key === "Escape") {
        openMenu.value = null;
    }
}

function compactMenuItemKeydown(event: KeyboardEvent, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        openMenu.value = null;
        rootRef.value?.querySelector<HTMLElement>('[data-menu-button="compact"]')?.focus();
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (itemIndex + offset + compactItems.value.length) % compactItems.value.length;
    rootRef.value?.querySelectorAll<HTMLElement>('[data-menu="compact"] [role="menuitem"]')[nextIndex]?.focus();
}

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    openMenu.value = null;
    await bridge.value?.menu(command);
}

function toggleLayoutMode(): void {
    if (!surfaceActive.value) return;
    void registration.value?.toggleLayoutMode();
}

function toggleStudioPanel(): void {
    if (!agentMode.value) return;
    registration.value?.toggleStudioPanel();
}

function windowCommand(command: "minimize" | "toggle-maximize" | "close"): void {
    void bridge.value?.window(command);
}

onClickOutside(rootRef, () => {
    openMenu.value = null;
});

onMounted(async () => {
    if (bridge.value) {
        status.value = await bridge.value.status().then(parseDesktopStatus).catch(() => null);
    }
    resizeObserver = new ResizeObserver(() => updatePresentation());
    if (contentRef.value) resizeObserver.observe(contentRef.value);
    if (controlsRef.value) resizeObserver.observe(controlsRef.value);
    if (windowControlsRef.value) resizeObserver.observe(windowControlsRef.value);
    await nextTick();
    updatePresentation();
});

watch(
    () => registration.value?.appearance() ?? null,
    (appearance) => {
        if (appearance) void bridge.value?.setAppearance(appearance);
    },
    {immediate: true},
);

watch([title, surfaceActive, agentMode, studioPanelOpen, status], () => {
    void nextTick(updatePresentation);
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
    <div v-if="bridge" ref="rootRef" class="desktop-title-bar" role="banner">
        <div ref="contentRef" class="desktop-title-bar__content">
            <div class="desktop-title-bar__leading">
                <div class="desktop-title-bar__brand desktop-title-bar__drag-surface" data-tauri-drag-region>
                    <span class="i-lucide-feather h-3.5 w-3.5"></span>
                    <span class="desktop-title-bar__brand-label">NeuroBook</span>
                </div>

                <div
                    ref="fullMenuMeasureRef"
                    class="desktop-title-bar__menu-measure"
                    aria-hidden="true"
                >
                    <span v-for="group in menus" :key="group.label">{{ group.label }}</span>
                </div>

                <div v-if="rendererMenus && presentation === 'full'" class="desktop-title-bar__menus">
                    <div v-for="(group, groupIndex) in menus" :key="group.label" class="desktop-title-bar__menu-group" :data-menu="group.label">
                        <button
                            type="button"
                            class="desktop-title-bar__menu"
                            :data-menu-button="group.label"
                            :aria-expanded="openMenu === group.label"
                            @click="toggleMenu(group.label)"
                            @keydown="menuButtonKeydown($event, group, groupIndex)"
                        >{{ group.label }}</button>
                        <div v-if="openMenu === group.label" class="desktop-title-bar__dropdown" role="menu">
                            <button
                                v-for="(item, itemIndex) in group.items"
                                :key="item.command"
                                type="button"
                                class="desktop-title-bar__item"
                                role="menuitem"
                                @click="void invoke(item.command)"
                                @keydown="menuItemKeydown($event, group, groupIndex, itemIndex)"
                            >{{ item.label }}</button>
                        </div>
                    </div>
                </div>

                <div v-else-if="rendererMenus" class="desktop-title-bar__menu-group" data-menu="compact">
                    <button
                        type="button"
                        class="desktop-title-bar__compact-menu"
                        data-menu-button="compact"
                        aria-label="Application menu"
                        :aria-expanded="openMenu === 'compact'"
                        @click="toggleMenu('compact')"
                        @keydown="compactMenuButtonKeydown"
                    >
                        <span class="i-lucide-menu h-4 w-4"></span>
                    </button>
                    <div v-if="openMenu === 'compact'" class="desktop-title-bar__dropdown desktop-title-bar__dropdown--compact" role="menu">
                        <template v-for="group in menus" :key="group.label">
                            <div class="desktop-title-bar__group-label">{{ group.label }}</div>
                            <button
                                v-for="item in group.items"
                                :key="item.command"
                                type="button"
                                class="desktop-title-bar__item"
                                role="menuitem"
                                @click="void invoke(item.command)"
                                @keydown="compactMenuItemKeydown($event, compactItems.findIndex((candidate) => candidate.command === item.command))"
                            >{{ item.label }}</button>
                        </template>
                    </div>
                </div>
            </div>

            <div ref="titleMeasureRef" class="desktop-title-bar__title desktop-title-bar__drag-surface" data-tauri-drag-region :title="title">
                {{ title }}
            </div>

            <div ref="controlsRef" class="desktop-title-bar__controls">
                <div v-if="status" class="desktop-title-bar__status" :title="`${status.connection === 'remote' ? 'Remote' : 'Local'} · ${status.version}`">
                    <span :class="status.connection === 'remote' ? 'i-lucide-cloud' : 'i-lucide-monitor-dot'" class="h-3.5 w-3.5"></span>
                    <span class="desktop-title-bar__status-label">{{ status.connection === "remote" ? "Remote" : "Local" }}</span>
                </div>
                <button
                    v-if="registration"
                    type="button"
                    class="desktop-title-bar__mode"
                    :class="agentMode ? 'desktop-title-bar__mode--active' : ''"
                    :disabled="!surfaceActive"
                    :aria-pressed="agentMode"
                    :title="surfaceActive ? agentMode ? '切换到 IDE 模式' : '切换到 Agent 模式' : '请先打开一个 Project'"
                    data-titlebar-action="toggle-agent"
                    @click="toggleLayoutMode"
                >
                    <span :class="agentMode ? 'i-lucide-panels-top-left' : 'i-lucide-bot'" class="h-4 w-4"></span>
                </button>
                <button
                    v-if="agentMode"
                    type="button"
                    class="desktop-title-bar__mode"
                    :class="studioPanelOpen ? 'desktop-title-bar__mode--active' : ''"
                    :aria-pressed="studioPanelOpen"
                    :title="studioPanelOpen ? '收起 Studio' : '展开 Studio'"
                    data-titlebar-action="toggle-studio"
                    @click="toggleStudioPanel"
                >
                    <span class="i-lucide-panel-right h-4 w-4"></span>
                </button>
            </div>
            <div v-if="customWindowControls" ref="windowControlsRef" class="desktop-title-bar__window-controls">
                <button type="button" aria-label="Minimize" @click="windowCommand('minimize')"><span class="i-lucide-minus h-4 w-4"></span></button>
                <button type="button" aria-label="Maximize" @click="windowCommand('toggle-maximize')"><span class="i-lucide-square h-3.5 w-3.5"></span></button>
                <button type="button" class="desktop-title-bar__close" aria-label="Close" @click="windowCommand('close')"><span class="i-lucide-x h-4 w-4"></span></button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.desktop-title-bar {
    position: relative;
    z-index: 1000;
    width: 100%;
    height: 36px;
    flex: 0 0 36px;
    color: var(--text-secondary);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-color);
}

.desktop-title-bar__content {
    position: absolute;
    top: env(titlebar-area-y, 0);
    left: env(titlebar-area-x, 0);
    display: grid;
    width: env(titlebar-area-width, 100%);
    height: env(titlebar-area-height, 36px);
    min-height: 36px;
    grid-template-columns: auto minmax(120px, 1fr) auto auto;
    align-items: center;
}

.desktop-title-bar__leading,
.desktop-title-bar__controls,
.desktop-title-bar__menus,
.desktop-title-bar__window-controls {
    display: flex;
    min-width: 0;
    align-items: center;
}

.desktop-title-bar__leading {
    height: 100%;
    gap: 4px;
    padding-left: 8px;
}

.desktop-title-bar__brand {
    display: flex;
    height: 100%;
    align-items: center;
    gap: 6px;
    padding: 0 5px;
    color: var(--text-main);
    font-size: 12px;
    font-weight: 650;
}

.desktop-title-bar__drag-surface {
    -webkit-app-region: drag;
}

.desktop-title-bar__title {
    min-width: 120px;
    overflow: hidden;
    padding: 0 12px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.desktop-title-bar__menu-measure {
    position: absolute;
    display: flex;
    visibility: hidden;
    gap: 2px;
    pointer-events: none;
}

.desktop-title-bar__menu-measure > span {
    padding: 0 8px;
    font-size: 12px;
}

.desktop-title-bar__menu-group {
    position: relative;
}

.desktop-title-bar__menu,
.desktop-title-bar__compact-menu,
.desktop-title-bar__mode {
    height: 26px;
    padding: 0 8px;
    color: inherit;
    border-radius: 4px;
    font-size: 12px;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__compact-menu,
.desktop-title-bar__mode {
    display: flex;
    width: 28px;
    align-items: center;
    justify-content: center;
    padding: 0;
}

.desktop-title-bar__menu:hover,
.desktop-title-bar__compact-menu:hover,
.desktop-title-bar__mode:hover,
.desktop-title-bar__mode--active {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__mode:disabled {
    cursor: not-allowed;
    opacity: 0.35;
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
    box-shadow: 0 8px 24px color-mix(in srgb, var(--shadow-color) 28%, transparent);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__dropdown--compact {
    min-width: 196px;
}

.desktop-title-bar__group-label {
    padding: 5px 10px 3px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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

.desktop-title-bar__item:hover,
.desktop-title-bar__item:focus-visible {
    color: var(--text-main);
    background: var(--bg-hover);
    outline: none;
}

.desktop-title-bar__controls {
    height: 100%;
    justify-content: flex-end;
    gap: 2px;
    padding-right: 6px;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__status {
    display: flex;
    max-width: 112px;
    height: 24px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    white-space: nowrap;
}

.desktop-title-bar__window-controls {
    height: 100%;
    margin-right: -6px;
}

.desktop-title-bar__window-controls button {
    display: flex;
    width: 46px;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__window-controls button:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__window-controls .desktop-title-bar__close:hover {
    color: white;
    background: #c42b1c;
}

@media (max-width: 760px) {
    .desktop-title-bar__brand-label,
    .desktop-title-bar__status-label {
        display: none;
    }
}
</style>

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

type ProjectMenuItem = Readonly<{
    projectRoot: string | null;
    label: string;
    active: boolean;
}>;

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const chrome = useWorkbenchChrome();
const status = ref<DesktopStatus | null>(null);
const openMenu = ref<string | null>(null);
const presentation = ref<TitleBarMenuPresentation>("full");
const rootRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const fullMenuMeasureRef = ref<HTMLElement | null>(null);
const navigationMeasureRef = ref<HTMLElement | null>(null);
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
const currentProjectRoot = computed(() => registration.value?.currentProjectRoot() ?? null);
const projects = computed(() => registration.value?.projects() ?? []);
const currentProject = computed(() => projects.value.find((project) => project.projectRoot === currentProjectRoot.value) ?? null);
const projectLabel = computed(() => currentProject.value?.title ?? "书架");
const agentPanelOpen = computed(() => registration.value?.agentPanelOpen() ?? false);
const rendererMenus = computed(() => status.value?.menuPresentation !== "native");
const customWindowControls = computed(() => status.value?.windowControls === "custom");
const compactItems = computed(() => menus.flatMap((group) => group.items));
const projectMenuItems = computed<ProjectMenuItem[]>(() => [
    {
        projectRoot: null,
        label: "我的书架",
        active: currentProjectRoot.value === null,
    },
    ...projects.value.map((project) => ({
        projectRoot: project.projectRoot,
        label: project.title,
        active: project.projectRoot === currentProjectRoot.value,
    })),
]);

function updatePresentation(): void {
    const content = contentRef.value;
    const fullMenu = fullMenuMeasureRef.value;
    const navigation = navigationMeasureRef.value;
    const controls = controlsRef.value;
    if (!content || !fullMenu || !navigation || !controls) return;
    presentation.value = resolveTitleBarMenuPresentation({
        availableWidth: content.clientWidth,
        fullMenuWidth: fullMenu.scrollWidth,
        titleWidth: navigation.scrollWidth,
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
    if (event.key === "Escape") openMenu.value = null;
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

async function openProjectMenu(focusLast = false): Promise<void> {
    openMenu.value = "project";
    await nextTick();
    const items = rootRef.value?.querySelectorAll<HTMLElement>('[data-menu="project"] [role="menuitem"]');
    items?.[focusLast ? Math.max(0, items.length - 1) : 0]?.focus();
}

function projectMenuButtonKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openProjectMenu(false);
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        void openProjectMenu(true);
        return;
    }
    if (event.key === "Escape") openMenu.value = null;
}

function projectMenuItemKeydown(event: KeyboardEvent, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        openMenu.value = null;
        rootRef.value?.querySelector<HTMLElement>('[data-titlebar-action="project-switcher"]')?.focus();
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (itemIndex + offset + projectMenuItems.value.length) % projectMenuItems.value.length;
    rootRef.value?.querySelectorAll<HTMLElement>('[data-menu="project"] [role="menuitem"]')[nextIndex]?.focus();
}

async function selectProject(item: ProjectMenuItem): Promise<void> {
    openMenu.value = null;
    if (!registration.value) return;
    if (item.projectRoot === null) {
        await registration.value.openBookshelf();
        return;
    }
    if (item.projectRoot !== currentProjectRoot.value) {
        await registration.value.switchProject(item.projectRoot);
    }
}

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    openMenu.value = null;
    await bridge.value?.menu(command);
}

async function toggleAgentPanel(): Promise<void> {
    if (!surfaceActive.value) return;
    await registration.value?.toggleAgentPanel();
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
    for (const target of [contentRef.value, controlsRef.value, windowControlsRef.value]) {
        if (target) resizeObserver.observe(target);
    }
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

watch(
    [title, projectLabel, currentProjectRoot, projects, surfaceActive, agentPanelOpen, status],
    () => void nextTick(updatePresentation),
);

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

                <div ref="fullMenuMeasureRef" class="desktop-title-bar__menu-measure" aria-hidden="true">
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

                <div class="desktop-title-bar__divider"></div>
                <div class="desktop-title-bar__menu-group" data-menu="project">
                    <button
                        type="button"
                        class="desktop-title-bar__project"
                        data-titlebar-action="project-switcher"
                        :aria-expanded="openMenu === 'project'"
                        :title="projectLabel"
                        @click="toggleMenu('project')"
                        @keydown="projectMenuButtonKeydown"
                    >
                        <span class="i-lucide-library-big h-3.5 w-3.5 shrink-0"></span>
                        <span class="desktop-title-bar__project-label">{{ projectLabel }}</span>
                        <span class="i-lucide-chevron-down h-3 w-3 shrink-0"></span>
                    </button>
                    <div v-if="openMenu === 'project'" class="desktop-title-bar__dropdown desktop-title-bar__dropdown--project" role="menu">
                        <button
                            v-for="(item, itemIndex) in projectMenuItems"
                            :key="item.projectRoot ?? 'bookshelf'"
                            type="button"
                            class="desktop-title-bar__item desktop-title-bar__project-item"
                            role="menuitem"
                            :aria-current="item.active ? 'page' : undefined"
                            :data-project-root="item.projectRoot ?? ''"
                            @click="void selectProject(item)"
                            @keydown="projectMenuItemKeydown($event, itemIndex)"
                        >
                            <span :class="item.projectRoot === null ? 'i-lucide-library' : 'i-lucide-book-open-text'" class="h-3.5 w-3.5 shrink-0"></span>
                            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                            <span v-if="item.active" class="i-lucide-check h-3.5 w-3.5 shrink-0"></span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="desktop-title-bar__center desktop-title-bar__drag-surface" data-tauri-drag-region :title="title">
                <button
                    type="button"
                    class="desktop-title-bar__search"
                    data-titlebar-search
                    disabled
                    title="搜索功能将在后续版本提供"
                    aria-label="搜索功能将在后续版本提供"
                >
                    <span class="i-lucide-search h-3.5 w-3.5"></span>
                    <span class="desktop-title-bar__search-label">搜索</span>
                </button>
            </div>

            <div ref="controlsRef" class="desktop-title-bar__controls">
                <button
                    v-if="registration"
                    type="button"
                    class="desktop-title-bar__agent"
                    :class="agentPanelOpen ? 'desktop-title-bar__agent--active' : ''"
                    :disabled="!surfaceActive"
                    :aria-pressed="agentPanelOpen"
                    :title="surfaceActive ? agentPanelOpen ? '关闭 Agent 面板' : '打开 Agent 面板' : '请先打开一个 Project'"
                    data-titlebar-action="toggle-agent-panel"
                    @click="void toggleAgentPanel()"
                >
                    <span class="i-lucide-bot h-4 w-4"></span>
                    <span
                        v-if="status"
                        class="desktop-title-bar__connection-dot"
                        :class="status.connection === 'remote' ? 'desktop-title-bar__connection-dot--remote' : ''"
                    ></span>
                </button>
            </div>

            <div ref="navigationMeasureRef" class="desktop-title-bar__navigation-measure" aria-hidden="true">
                <span>{{ projectLabel }}</span>
                <span>搜索</span>
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
    gap: 2px;
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

.desktop-title-bar__center {
    display: flex;
    min-width: 120px;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
}

.desktop-title-bar__menu-measure,
.desktop-title-bar__navigation-measure {
    position: absolute;
    display: flex;
    visibility: hidden;
    pointer-events: none;
}

.desktop-title-bar__menu-measure {
    gap: 2px;
}

.desktop-title-bar__menu-measure > span {
    padding: 0 8px;
    font-size: 12px;
}

.desktop-title-bar__navigation-measure {
    gap: 20px;
    font-size: 12px;
}

.desktop-title-bar__navigation-measure > span:first-child {
    width: 160px;
}

.desktop-title-bar__navigation-measure > span:last-child {
    width: 260px;
}

.desktop-title-bar__menu-group {
    position: relative;
}

.desktop-title-bar__menu,
.desktop-title-bar__compact-menu,
.desktop-title-bar__project,
.desktop-title-bar__search,
.desktop-title-bar__agent {
    height: 26px;
    color: inherit;
    border-radius: 4px;
    font-size: 12px;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__menu {
    padding: 0 8px;
}

.desktop-title-bar__compact-menu,
.desktop-title-bar__agent {
    display: flex;
    width: 28px;
    align-items: center;
    justify-content: center;
    padding: 0;
}

.desktop-title-bar__project {
    display: flex;
    max-width: 190px;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
}

.desktop-title-bar__project-label {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.desktop-title-bar__search {
    display: flex;
    width: min(320px, 100%);
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    color: var(--text-muted);
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    cursor: default;
    opacity: 1;
}

.desktop-title-bar__menu:hover,
.desktop-title-bar__compact-menu:hover,
.desktop-title-bar__project:hover,
.desktop-title-bar__agent:hover,
.desktop-title-bar__agent--active {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__agent:disabled {
    cursor: not-allowed;
    opacity: 0.35;
}

.desktop-title-bar__divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border-color);
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
    border-radius: 6px;
    box-shadow:
        0 18px 44px color-mix(in srgb, var(--shadow-color) 24%, transparent),
        0 4px 12px color-mix(in srgb, var(--shadow-color) 12%, transparent);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__dropdown--compact {
    min-width: 196px;
}

.desktop-title-bar__dropdown--project {
    min-width: 240px;
    max-width: min(360px, calc(100vw - 32px));
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
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__project-item {
    display: flex;
    align-items: center;
    gap: 8px;
}

.desktop-title-bar__item:hover,
.desktop-title-bar__item:focus-visible,
.desktop-title-bar__item[aria-current="page"] {
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

.desktop-title-bar__agent {
    position: relative;
}

.desktop-title-bar__connection-dot {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 5px;
    height: 5px;
    background: var(--status-success);
    border: 1px solid var(--bg-panel);
    border-radius: 50%;
}

.desktop-title-bar__connection-dot--remote {
    background: var(--status-info);
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

@media (max-width: 960px) {
    .desktop-title-bar__brand-label {
        display: none;
    }

    .desktop-title-bar__project {
        max-width: 132px;
    }

    .desktop-title-bar__search {
        width: min(220px, 100%);
    }
}

@media (max-width: 720px) {
    .desktop-title-bar__search {
        display: none;
    }

    .desktop-title-bar__project {
        max-width: 92px;
    }
}
</style>

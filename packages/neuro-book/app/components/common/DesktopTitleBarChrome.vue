<script setup lang="ts">
/**
 * 自绘标题栏的 chrome 本体（受控零件，Lab 可挂载）。
 *
 * 平台边界不在这里：桌面 bridge 状态、菜单命令派发、外观上报、Project 切换都归宿主
 * `DesktopTitleBar.vue`；本组件只收一份投影出来的状态，把 chrome 画出来并发出意图。
 * 这样 Lab 能用一组内存数据完整表达它，不需要 bridge 桩、不需要真实 Project。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import {
    resolveTitleBarMenuPresentation,
    type TitleBarMenuPresentation,
} from "nbook/app/utils/workbench-chrome";

/** 窗口按钮命令。属系统绘制物，不由主题决定。 */
export type TitleBarWindowCommand = "minimize" | "toggle-maximize" | "close";

export type TitleBarMenuItem = Readonly<{
    label: string;
    command: DesktopMenuCommandId;
}>;

export type TitleBarProject = Readonly<{
    projectRoot: string;
    title: string;
}>;

export type TitleBarMenuGroup = Readonly<{
    label: string;
    items: readonly TitleBarMenuItem[];
}>;

const props = defineProps<{
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title: string;
    /** 已打开的书架条目；空数组表示只有「我的书架」。 */
    projects: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot: string | null;
    /** 有 Project surface 时 Agent 按钮才可点。 */
    surfaceActive: boolean;
    /** 宿主是否具备 Agent 面板能力（没有则不画按钮）。 */
    agentPanelAvailable: boolean;
    agentPanelOpen: boolean;
    /** 菜单由 renderer 画；false 表示菜单归操作系统（渲染进程一个菜单都不画）。 */
    rendererMenus: boolean;
    /** 窗口按钮由 renderer 画；false 表示系统标题栏负责。 */
    customWindowControls: boolean;
    /** 连接状态；`null` 表示还没有状态，不画状态点。 */
    connection: "local" | "remote" | null;
    /** 展开的分组：菜单组名 / `compact` / `project`；`null` 表示都收起。 */
    openMenu: string | null;
}>();

const emit = defineEmits<{
    (e: "update:openMenu", value: string | null): void;
    (e: "invoke-command", command: DesktopMenuCommandId): void;
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: TitleBarWindowCommand): void;
}>();

/** 窗口菜单表：产品 IA 固定四组，调用方只能接命令 id，不能换表。 */
const menus: readonly TitleBarMenuGroup[] = [
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

type ProjectMenuItem = Readonly<{
    projectRoot: string | null;
    label: string;
    active: boolean;
}>;

const rootRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const fullMenuMeasureRef = ref<HTMLElement | null>(null);
const navigationMeasureRef = ref<HTMLElement | null>(null);
const controlsRef = ref<HTMLElement | null>(null);
const windowControlsRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

const presentation = ref<TitleBarMenuPresentation>("full");
const projectLabel = computed(() => props.projects.find((project) => project.projectRoot === props.currentProjectRoot)?.title ?? "书架");
const compactItems = computed(() => menus.flatMap((group) => group.items));
const projectMenuItems = computed<ProjectMenuItem[]>(() => [
    {
        projectRoot: null,
        label: "我的书架",
        active: props.currentProjectRoot === null,
    },
    ...props.projects.map((project) => ({
        projectRoot: project.projectRoot,
        label: project.title,
        active: project.projectRoot === props.currentProjectRoot,
    })),
]);

/**
 * 菜单放不下就换紧凑档。四个量都实测自本组件自己的 DOM：
 * 完整菜单的宽度、中心标题栏需要的宽度、右侧控件与窗口按钮的宽度。
 */
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

function open(label: string | null): void {
    emit("update:openMenu", label);
}

function toggleMenu(label: string): void {
    open(props.openMenu === label ? null : label);
}

async function openMenuFromKeyboard(label: string): Promise<void> {
    open(label);
    await nextTick();
    rootRef.value?.querySelector<HTMLElement>(`[data-menu="${label}"] [role="menuitem"]`)?.focus();
}

function menuButtonKeydown(event: KeyboardEvent, group: TitleBarMenuGroup, index: number): void {
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
    if (event.key === "Escape") open(null);
}

function menuItemKeydown(event: KeyboardEvent, group: TitleBarMenuGroup, groupIndex: number, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        open(null);
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
    open("compact");
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
    if (event.key === "Escape") open(null);
}

function compactMenuItemKeydown(event: KeyboardEvent, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        open(null);
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
    open("project");
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
    if (event.key === "Escape") open(null);
}

function projectMenuItemKeydown(event: KeyboardEvent, itemIndex: number): void {
    if (event.key === "Escape") {
        event.preventDefault();
        open(null);
        rootRef.value?.querySelector<HTMLElement>('[data-titlebar-action="project-switcher"]')?.focus();
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (itemIndex + offset + projectMenuItems.value.length) % projectMenuItems.value.length;
    rootRef.value?.querySelectorAll<HTMLElement>('[data-menu="project"] [role="menuitem"]')[nextIndex]?.focus();
}

function selectProject(item: ProjectMenuItem): void {
    open(null);
    emit("select-project", item.projectRoot);
}

function invoke(command: DesktopMenuCommandId): void {
    open(null);
    emit("invoke-command", command);
}

function toggleAgentPanel(): void {
    if (!props.surfaceActive) return;
    emit("toggle-agent-panel");
}

onMounted(() => {
    resizeObserver = new ResizeObserver(() => updatePresentation());
    for (const target of [contentRef.value, controlsRef.value, windowControlsRef.value]) {
        if (target) resizeObserver.observe(target);
    }
    void nextTick(updatePresentation);
});

watch(
    [() => props.title, projectLabel, () => props.currentProjectRoot, () => props.projects, () => props.surfaceActive, () => props.agentPanelOpen, () => props.rendererMenus, () => props.customWindowControls],
    () => void nextTick(updatePresentation),
);

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
    <div ref="rootRef" class="desktop-title-bar" role="banner">
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
                        <div v-if="openMenu === group.label" class="desktop-title-bar__dropdown nb-ui-popover-surface nb-ui-menu-surface" role="menu">
                            <button
                                v-for="(item, itemIndex) in group.items"
                                :key="item.command"
                                type="button"
                                class="desktop-title-bar__item nb-ui-popover-item"
                                role="menuitem"
                                @click="invoke(item.command)"
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
                    <div v-if="openMenu === 'compact'" class="desktop-title-bar__dropdown desktop-title-bar__dropdown--compact nb-ui-popover-surface nb-ui-menu-surface" role="menu">
                        <template v-for="group in menus" :key="group.label">
                            <div class="desktop-title-bar__group-label">{{ group.label }}</div>
                            <button
                                v-for="item in group.items"
                                :key="item.command"
                                type="button"
                                class="desktop-title-bar__item nb-ui-popover-item"
                                role="menuitem"
                                @click="invoke(item.command)"
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
                    <div v-if="openMenu === 'project'" class="desktop-title-bar__dropdown desktop-title-bar__dropdown--project nb-ui-popover-surface nb-ui-menu-surface" role="menu">
                        <button
                            v-for="(item, itemIndex) in projectMenuItems"
                            :key="item.projectRoot ?? 'bookshelf'"
                            type="button"
                            class="desktop-title-bar__item desktop-title-bar__project-item nb-ui-popover-item"
                            role="menuitem"
                            :aria-current="item.active ? 'page' : undefined"
                            :data-project-root="item.projectRoot ?? ''"
                            @click="selectProject(item)"
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
                    v-if="agentPanelAvailable"
                    type="button"
                    class="desktop-title-bar__agent"
                    :class="agentPanelOpen ? 'desktop-title-bar__agent--active' : ''"
                    :disabled="!surfaceActive"
                    :aria-pressed="agentPanelOpen"
                    :title="surfaceActive ? agentPanelOpen ? '关闭 Agent 面板' : '打开 Agent 面板' : '请先打开一个 Project'"
                    data-titlebar-action="toggle-agent-panel"
                    @click="toggleAgentPanel()"
                >
                    <span class="i-lucide-bot h-4 w-4"></span>
                    <span
                        v-if="connection"
                        class="desktop-title-bar__connection-dot"
                        :class="connection === 'remote' ? 'desktop-title-bar__connection-dot--remote' : ''"
                    ></span>
                </button>
            </div>

            <div ref="navigationMeasureRef" class="desktop-title-bar__navigation-measure" aria-hidden="true">
                <span>{{ projectLabel }}</span>
                <span>搜索</span>
            </div>

            <div v-if="customWindowControls" ref="windowControlsRef" class="desktop-title-bar__window-controls">
                <button type="button" aria-label="Minimize" @click="emit('window-command', 'minimize')"><span class="i-lucide-minus h-4 w-4"></span></button>
                <button type="button" aria-label="Maximize" @click="emit('window-command', 'toggle-maximize')"><span class="i-lucide-square h-3.5 w-3.5"></span></button>
                <button type="button" class="desktop-title-bar__close" aria-label="Close" @click="emit('window-command', 'close')"><span class="i-lucide-x h-4 w-4"></span></button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * 尺寸口径分两层，别混：
 * - **主题层**：面 / 线 / 字号 / 字重 / 圆角 / 控件高 / 间距 / 动效全部取 nb-ui 变量
 *   （`packages/nb-ui/src/tokens.css` 与配色契约）。换主题或配色时这里跟着变。
 * - **产品 IA 常量**：窗口高度 36、窗口按钮 46 满高、断点与量测占位宽度。窗口几何属产品侧
 *   （事实源头是 `app/utils/workbench/layout.ts` 的 `SHELL_TITLEBAR_HEIGHT`），主题不该动它，
 *   所以保留字面值并在这里登记；层级 1000 / 1001 同理——nb-ui 明确「z-index 不是主题语义」。
 */
.desktop-title-bar {
    position: relative;
    z-index: 1000;
    width: 100%;
    height: 36px;
    flex: 0 0 36px;
    color: var(--text-secondary);
    background: var(--bg-panel);
    /* 底部这一条是 chrome 与主区之间的缝：取主题的 --divider，与四个叶的缝同一条线。 */
    border-bottom: var(--border-w) solid var(--divider);
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
    gap: var(--space-1);
    padding-left: var(--space-4);
}

.desktop-title-bar__brand {
    display: flex;
    height: 100%;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-2);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
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
    padding: 0 var(--space-6);
}

/*
 * 量测盒子：不进可视流，只用来给 `resolveTitleBarMenuPresentation` 提供宽度。
 * 里面的字号与内边距**必须**和真实控件同源（都走 var(--text-xs) / var(--space-4)），
 * 否则换主题换了字号，量出来的宽度和画出来的差一截，菜单就会在该紧凑的时候不紧凑。
 */
.desktop-title-bar__menu-measure,
.desktop-title-bar__navigation-measure {
    position: absolute;
    display: flex;
    visibility: hidden;
    pointer-events: none;
}

.desktop-title-bar__menu-measure {
    gap: var(--space-1);
}

.desktop-title-bar__menu-measure > span {
    padding: 0 var(--space-4);
    font-size: var(--text-xs);
}

.desktop-title-bar__navigation-measure {
    gap: calc(var(--space-6) + var(--space-2));
    font-size: var(--text-xs);
}

/* 两个占位宽度是量测用的估计值（标题栏长度上界与搜索框上界），不是渲染尺寸。 */
.desktop-title-bar__navigation-measure > span:first-child {
    width: 160px;
}

.desktop-title-bar__navigation-measure > span:last-child {
    width: 260px;
}

.desktop-title-bar__menu-group {
    position: relative;
}

/*
 * 控件类：高度/圆角/字号全部走主题（--control-h-sm 是主题最直观的密度维度），
 * 与 nb-ui 的控件基座同一档取值。
 */
.desktop-title-bar__menu,
.desktop-title-bar__compact-menu,
.desktop-title-bar__project,
.desktop-title-bar__search,
.desktop-title-bar__agent {
    height: var(--control-h-sm);
    color: inherit;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__menu {
    padding: 0 var(--space-4);
}

.desktop-title-bar__compact-menu,
.desktop-title-bar__agent {
    display: flex;
    width: var(--control-h-sm);
    align-items: center;
    justify-content: center;
    padding: 0;
}

.desktop-title-bar__project {
    display: flex;
    max-width: 190px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
}

.desktop-title-bar__project-label {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 搜索占位是个控件：面与描边取控件的角色，不直连配色底。 */
.desktop-title-bar__search {
    display: flex;
    width: min(320px, 100%);
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: 0 var(--space-5);
    color: var(--text-muted);
    background: var(--control-surface);
    border: var(--border-w) solid var(--control-outline);
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
    width: var(--border-w);
    height: calc(var(--space-6) + var(--space-1));
    margin: 0 var(--space-2);
    background: var(--divider);
}

/*
 * 下拉的面/描边/圆角/阴影/磨砂全部由 nb-ui 的浮层基座负责（.nb-ui-popover-surface +
 * .nb-ui-menu-surface），这里只留定位与网格。
 *
 * 这是 nb-ui 侧的登记处：`src/styles.css` 明确写着「新增浮层组件请消费此类，不要再复制这一组属性」。
 * 复制一份的代价在本文件里是实测过的——原来那两条写死的阴影（0 18px 44px / 0 4px 12px）
 * 在换主题时完全跟不上，而 .nb-ui-popover-surface 取的是主题的 --elevation-popover。
 *
 * 内边距必须等于基座声明的 --nb-popover-pad：浮层里贴边盒子的圆角是由外圈半径、描边与
 * 这个内边距推出来的（同心半径），各写各的数会让弧线在角上不平行。
 */
.desktop-title-bar__dropdown {
    position: absolute;
    z-index: 1001;
    top: calc(100% + var(--space-2));
    left: 0;
    display: grid;
    min-width: 168px;
    padding: var(--nb-popover-pad);
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
    padding: calc(var(--space-2) + var(--border-w)) var(--control-px) calc(var(--space-1) + var(--border-w));
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

/*
 * 菜单项：高度与字号取主题的控件刻度；圆角交给 .nb-ui-popover-item（同心半径由基座推），
 * 这里不写 border-radius，否则 scoped 选择器的特异性会盖掉基座。
 * 当前项与悬停的填充取 --overlay-item-active——浮层里「哪一项是活的」是主题决策，
 * 玻璃主题把它映射成半透明叠层，实心的 --bg-hover 会在材料上挖一块补丁。
 */
.desktop-title-bar__item {
    height: var(--control-h-sm);
    padding: 0 var(--control-px);
    color: var(--text-secondary);
    text-align: left;
    font-size: var(--text-xs);
    white-space: nowrap;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__project-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.desktop-title-bar__item:hover,
.desktop-title-bar__item:focus-visible,
.desktop-title-bar__item[aria-current="page"] {
    color: var(--text-main);
    background: var(--overlay-item-active);
    outline: none;
}

.desktop-title-bar__controls {
    height: 100%;
    justify-content: flex-end;
    gap: var(--space-1);
    padding-right: var(--space-3);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__agent {
    position: relative;
}

.desktop-title-bar__connection-dot {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    width: var(--space-2);
    height: var(--space-2);
    background: var(--status-success);
    border: var(--border-w) solid var(--bg-panel);
    border-radius: var(--radius-pill);
}

.desktop-title-bar__connection-dot--remote {
    background: var(--status-info);
}

/*
 * 窗口控制按钮：46 × 满高是 Windows 标题栏的系统绘制惯例（与 macOS 的交通灯同一类），
 * 属「系统绘制物」——不是主题能换的东西，故保留字面值（同判据见 playground 的 workbench.css）。
 * 颜色与悬停面照常走主题；关闭键的悬停用 --status-danger / --text-inverse，
 * 与 nb-ui 参考实现（playground 的 .wb-winbtn--close）同一组取值。
 */
.desktop-title-bar__window-controls {
    height: 100%;
    margin-right: calc(-1 * var(--space-3));
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
    color: var(--text-inverse);
    background: var(--status-danger);
}

/* 窄屏：品牌名先让位，再收 Project 标题与搜索框，最后整块隐去搜索。 */
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

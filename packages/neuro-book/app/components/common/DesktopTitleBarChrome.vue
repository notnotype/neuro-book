<script setup lang="ts">
/**
 * 自绘标题栏的 chrome 本体（受控零件，Lab 可挂载）。
 *
 * 平台边界不在这里：桌面 bridge 状态、菜单命令派发、外观上报、Project 切换都归宿主
 * `DesktopTitleBar.vue`；本组件只收一份投影出来的状态（含宿主能力），把 chrome 画出来并发出意图。
 * 这样 Lab 能用一组内存数据完整表达它，不需要 bridge 桩、不需要真实 Project。
 *
 * 菜单的 enabled / visible **不在这里拍**：`resolveTitleBarMenuGroups` 按宿主能力生成，
 * 浏览器没有的桌面动作整条不画，焦点接不住的编辑动作画成禁用并说明原因。
 */
import {useEventListener} from "@vueuse/core";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref} from "vue";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";
import {
    resolveTitleBarMenuGroups,
    resolveTitleBarMenuPresentation,
    type TitleBarHostCapabilities,
    type TitleBarMenuPresentation,
} from "nbook/app/utils/workbench-chrome";

/** 窗口按钮命令。属系统绘制物，不由主题决定。 */
export type TitleBarWindowCommand = "minimize" | "toggle-maximize" | "close";

export type TitleBarProject = Readonly<{
    projectRoot: string;
    title: string;
}>;

const props = defineProps<{
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title: string;
    /** 已打开的书架条目；空数组表示只有「我的书架」。 */
    projects: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot: string | null;
    /** 宿主真实能力：菜单 enabled / visible 由它映射，缺省即没有能力。 */
    capabilities: TitleBarHostCapabilities;
    /**
     * 新标签打开使用的标准 Project URL（`null` 表示书架）。
     * `null` 表示宿主没有这个能力——整条入口不画，不做假链接。
     */
    projectUrl: ((projectRoot: string | null) => string) | null;
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

/**
 * 标题栏叶的高度：唯一来源是产品几何常量 `SHELL_TITLEBAR_HEIGHT`
 * （外壳的垂直分配与窄屏叶包装读的是同一个常量），这里只把它喂成 CSS 变量，不新增主题几何 token。
 */
const titleBarRootStyle = {"--workbench-titlebar-height": `${String(SHELL_TITLEBAR_HEIGHT)}px`};

/** 菜单表由宿主能力生成；产品 IA 固定四组，调用方给不了别的表。 */
const menus = computed(() => resolveTitleBarMenuGroups(props.capabilities));
const openGroupItems = computed(() =>
    menus.value.find((group) => group.label === props.openMenu)?.items ?? []);

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

/** 浮层的视口版本：窗口尺寸、滚动或锚点换了，fixed 坐标与最大高度都要重算。 */
const viewportVersion = ref(0);

/**
 * 下拉层的最大高度：紧凑档（四组十一个动作）也放得下，再长就在面板里自己滚。
 * 视口太矮时按实际余量收窄（`top` 到视口底还有多少），所以菜单永远不会被视口切掉。
 */
const TITLE_BAR_MENU_MAX_HEIGHT = 320;

/**
 * 一份下拉层的定位。
 *
 * 下拉层 **Teleport 到 body**：标题栏的祖先链上有 `overflow: hidden`（外壳与叶包装），
 * 留在原地必被裁掉；主题变量写在 `<html>` 上，body 平级的浮层照样继承。
 * 传送出去之后它拿不到祖先的相对定位，只能自己带 fixed 坐标——标题栏在视口顶端，
 * 展开方向恒向下，右边缘不够就往左挪，下方余量不足就收最大高度（面板内滚动）。
 */
function useTitleBarMenuPanel(open: Ref<boolean>) {
    const anchorRef = ref<HTMLElement | null>(null);
    const panelRef = ref<HTMLElement | null>(null);

    // 换锚点（File → Edit）时 `open` 一直是真，坐标得自己重算；面板挂上后才量得到宽度。
    watch([anchorRef, panelRef], () => {
        if (open.value) viewportVersion.value += 1;
    });

    const panelStyle: ComputedRef<Record<string, string | undefined>> = computed(() => {
        const anchor = anchorRef.value;
        if (anchor === null) {
            return {};
        }
        void viewportVersion.value;
        const rect = anchor.getBoundingClientRect();
        const gap = 6;
        const margin = 8;
        const width = panelRef.value?.offsetWidth ?? 0;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        const top = rect.bottom + gap;
        const available = Math.max(120, window.innerHeight - top - margin);
        return {
            position: "fixed",
            top: `${String(top)}px`,
            left: `${String(left)}px`,
            maxHeight: `${String(Math.min(TITLE_BAR_MENU_MAX_HEIGHT, available))}px`,
        };
    });

    return {anchorRef, panelRef, style: panelStyle};
}

const groupMenuOpen = computed(() => props.rendererMenus
    && presentation.value === "full"
    && menus.value.some((group) => group.label === props.openMenu));
const compactMenuOpen = computed(() => props.rendererMenus
    && presentation.value === "compact"
    && props.openMenu === "compact");
const projectMenuOpen = computed(() => props.openMenu === "project");

const {anchorRef: groupAnchorRef, panelRef: groupPanelRef, style: groupPanelStyle} = useTitleBarMenuPanel(groupMenuOpen);
const {anchorRef: compactAnchorRef, panelRef: compactPanelRef, style: compactPanelStyle} = useTitleBarMenuPanel(compactMenuOpen);
const {anchorRef: projectAnchorRef, panelRef: projectPanelRef, style: projectPanelStyle} = useTitleBarMenuPanel(projectMenuOpen);

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

/** 可点的菜单项：禁用的项不出现在键盘遍历里（与原生菜单一致，不给「按了没反应」的焦点）。 */
function focusableMenuItems(panel: HTMLElement | null): HTMLElement[] {
    if (panel === null) return [];
    return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .filter((item) => !(item instanceof HTMLButtonElement && item.disabled));
}

/** 上下键在可点项之间循环：当前焦点不在面板里时从头（尾）进。 */
function moveMenuFocus(panel: HTMLElement | null, step: number): void {
    const items = focusableMenuItems(panel);
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = current < 0
        ? (step > 0 ? 0 : items.length - 1)
        : (current + step + items.length) % items.length;
    items[next]?.focus();
}

/** 打开后把焦点交给第一个 / 最后一个可点项（键盘打开时与原生菜单一致）。 */
async function focusPanelEdge(panelRef: Ref<HTMLElement | null>, last: boolean): Promise<void> {
    await nextTick();
    const items = focusableMenuItems(panelRef.value);
    items[last ? items.length - 1 : 0]?.focus();
}

function groupTrigger(label: string): HTMLElement | null {
    return rootRef.value?.querySelector<HTMLElement>(`[data-menu-button="${label}"]`) ?? null;
}

/** 组别左 / 右切换：换锚点、换内容，焦点跟着进新组的首项。 */
function switchGroup(offset: number): void {
    const labels = menus.value.map((group) => group.label);
    const current = labels.indexOf(props.openMenu ?? "");
    const next = labels[(current + offset + labels.length) % labels.length];
    if (next === undefined) return;
    groupAnchorRef.value = groupTrigger(next);
    open(next);
    // 触发按钮先接住焦点：被换掉的旧面板连同里面的焦点项一起卸载，新组没有可点项时焦点不会掉到 body。
    groupAnchorRef.value?.focus();
    void focusPanelEdge(groupPanelRef, false);
}

function groupMenuButtonKeydown(event: KeyboardEvent, groupIndex: number): void {
    const label = menus.value[groupIndex]?.label;
    if (label === undefined) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        groupAnchorRef.value = eventAnchor(event);
        open(label);
        void focusPanelEdge(groupPanelRef, false);
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        groupAnchorRef.value = eventAnchor(event);
        open(label);
        void focusPanelEdge(groupPanelRef, true);
        return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const next = menus.value[(groupIndex + offset + menus.value.length) % menus.value.length]?.label;
        if (next === undefined) return;
        const trigger = groupTrigger(next);
        trigger?.focus();
        if (props.openMenu !== null) switchGroup(offset);
        return;
    }
    if (event.key === "Escape") open(null);
}

function groupPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveMenuFocus(groupPanelRef.value, event.key === "ArrowDown" ? 1 : -1);
        return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        switchGroup(event.key === "ArrowRight" ? 1 : -1);
    }
}

function compactMenuButtonKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        compactAnchorRef.value = eventAnchor(event);
        open("compact");
        void focusPanelEdge(compactPanelRef, false);
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        compactAnchorRef.value = eventAnchor(event);
        open("compact");
        void focusPanelEdge(compactPanelRef, true);
        return;
    }
    if (event.key === "Escape") open(null);
}

function compactPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveMenuFocus(compactPanelRef.value, event.key === "ArrowDown" ? 1 : -1);
    }
}

function projectMenuButtonKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        projectAnchorRef.value = eventAnchor(event);
        open("project");
        void focusPanelEdge(projectPanelRef, false);
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        projectAnchorRef.value = eventAnchor(event);
        open("project");
        void focusPanelEdge(projectPanelRef, true);
        return;
    }
    if (event.key === "Escape") open(null);
}

function projectPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveMenuFocus(projectPanelRef.value, event.key === "ArrowDown" ? 1 : -1);
    }
}

/** 鼠标点开的菜单不抢焦点：触发按钮与菜单项都不吃 mousedown，底下输入框的选区因此不会丢。 */
function toggleMenu(label: string, event: MouseEvent): void {
    const anchor = eventAnchor(event);
    if (props.openMenu === label) {
        open(null);
        return;
    }
    if (label === "compact") {
        compactAnchorRef.value = anchor;
    } else if (label === "project") {
        projectAnchorRef.value = anchor;
    } else {
        groupAnchorRef.value = anchor;
    }
    open(label);
}

/** 事件的 `currentTarget` 运行时才是元素；不是元素就不换锚点（窄化走运行时守卫，不用断言）。 */
function eventAnchor(event: Event): HTMLElement | null {
    const target = event.currentTarget;
    return target instanceof HTMLElement ? target : null;
}

/** 键盘激活（Enter / Space）的 click 的 `detail` 是 0：这时才把焦点还给触发按钮。 */
function invoke(command: DesktopMenuCommandId, event: MouseEvent, anchor: HTMLElement | null): void {
    const fromKeyboard = event.detail === 0;
    open(null);
    emit("invoke-command", command);
    if (fromKeyboard) anchor?.focus();
}

function selectProject(item: ProjectMenuItem, event: MouseEvent): void {
    const fromKeyboard = event.detail === 0;
    open(null);
    if (fromKeyboard) projectAnchorRef.value?.focus();
    emit("select-project", item.projectRoot);
}

function toggleAgentPanel(): void {
    if (!props.capabilities.surfaceActive) return;
    emit("toggle-agent-panel");
}

/**
 * 点组件外收起菜单。下拉层 Teleport 到 body，不在标题栏根节点的子树里，
 * 单靠根节点做 outside 判定会把「点菜单项」也当成点外面（VueUse 的 `onClickOutside` 不接受元素 ref 数组，
 * 这里按节点亲缘自己判一次：标题栏内或任一展开的浮层内都算里面）。
 */
useEventListener(document, "pointerdown", (event) => {
    if (props.openMenu === null) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (rootRef.value?.contains(target) === true) return;
    const insidePanel = [groupPanelRef, compactPanelRef, projectPanelRef]
        .some((panel) => panel.value?.contains(target) === true);
    if (!insidePanel) open(null);
});

/**
 * Escape 关菜单并把焦点还给触发按钮：挂在 document 上，因为焦点可能已经不在面板里
 * （换组时旧面板连同焦点项一起卸载，焦点先落在触发按钮上；用户也可能把焦点移走）。
 * 谁的菜单开着就还焦点给谁的触发按钮。
 */
useEventListener(document, "keydown", (event) => {
    if (event.key !== "Escape" || props.openMenu === null) return;
    event.preventDefault();
    const anchor = props.openMenu === "project"
        ? projectAnchorRef.value
        : props.openMenu === "compact"
            ? compactAnchorRef.value
            : groupAnchorRef.value;
    open(null);
    anchor?.focus();
});

useEventListener(window, "resize", () => {
    viewportVersion.value += 1;
});
useEventListener(window, "scroll", () => {
    viewportVersion.value += 1;
}, {capture: true, passive: true});

onMounted(() => {
    resizeObserver = new ResizeObserver(() => updatePresentation());
    for (const target of [contentRef.value, controlsRef.value, windowControlsRef.value]) {
        if (target) resizeObserver.observe(target);
    }
    void nextTick(updatePresentation);
});

watch(
    [() => props.title, projectLabel, () => props.currentProjectRoot, () => props.projects, () => props.capabilities, () => props.agentPanelOpen, () => props.rendererMenus, () => props.customWindowControls],
    () => void nextTick(updatePresentation),
);

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
    <div ref="rootRef" class="desktop-title-bar" role="banner" :style="titleBarRootStyle">
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
                            aria-haspopup="menu"
                            :aria-expanded="openMenu === group.label"
                            @mousedown.prevent
                            @click="toggleMenu(group.label, $event)"
                            @keydown="groupMenuButtonKeydown($event, groupIndex)"
                        >{{ group.label }}</button>
                    </div>
                </div>

                <div v-else-if="rendererMenus" class="desktop-title-bar__menu-group" data-menu="compact">
                    <button
                        type="button"
                        class="desktop-title-bar__compact-menu"
                        data-menu-button="compact"
                        aria-haspopup="menu"
                        aria-label="Application menu"
                        :aria-expanded="openMenu === 'compact'"
                        @mousedown.prevent
                        @click="toggleMenu('compact', $event)"
                        @keydown="compactMenuButtonKeydown"
                    >
                        <span class="i-lucide-menu h-4 w-4"></span>
                    </button>
                </div>

                <div class="desktop-title-bar__divider"></div>
                <div class="desktop-title-bar__menu-group" data-menu="project">
                    <button
                        type="button"
                        class="desktop-title-bar__project"
                        data-titlebar-action="project-switcher"
                        aria-haspopup="menu"
                        :aria-expanded="openMenu === 'project'"
                        :title="projectLabel"
                        @mousedown.prevent
                        @click="toggleMenu('project', $event)"
                        @keydown="projectMenuButtonKeydown"
                    >
                        <span class="i-lucide-library-big h-3.5 w-3.5 shrink-0"></span>
                        <span class="desktop-title-bar__project-label">{{ projectLabel }}</span>
                        <span class="i-lucide-chevron-down h-3 w-3 shrink-0"></span>
                    </button>
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
                    :disabled="!capabilities.surfaceActive"
                    :aria-pressed="agentPanelOpen"
                    :title="capabilities.surfaceActive ? agentPanelOpen ? '关闭 Agent 面板' : '打开 Agent 面板' : '请先打开一个 Project'"
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

        <!-- 三份下拉层都传送出标题栏：祖先链上的 overflow: hidden 会把留在原地的浮层裁掉。 -->
        <Teleport to="body">
            <div
                v-if="groupMenuOpen"
                ref="groupPanelRef"
                class="desktop-title-bar__dropdown nb-ui-popover-surface nb-ui-menu-surface"
                role="menu"
                data-titlebar-menu-panel="group"
                :style="groupPanelStyle"
                @keydown="groupPanelKeydown"
            >
                <button
                    v-for="item in openGroupItems"
                    :key="item.command"
                    type="button"
                    class="desktop-title-bar__item nb-ui-popover-item"
                    role="menuitem"
                    :disabled="item.disabled"
                    :title="item.disabledReason ?? undefined"
                    @mousedown.prevent
                    @click="invoke(item.command, $event, groupAnchorRef)"
                >{{ item.label }}</button>
            </div>

            <div
                v-if="compactMenuOpen"
                ref="compactPanelRef"
                class="desktop-title-bar__dropdown desktop-title-bar__dropdown--compact nb-ui-popover-surface nb-ui-menu-surface"
                role="menu"
                data-titlebar-menu-panel="compact"
                :style="compactPanelStyle"
                @keydown="compactPanelKeydown"
            >
                <template v-for="group in menus" :key="group.label">
                    <div class="desktop-title-bar__group-label">{{ group.label }}</div>
                    <button
                        v-for="item in group.items"
                        :key="item.command"
                        type="button"
                        class="desktop-title-bar__item nb-ui-popover-item"
                        role="menuitem"
                        :disabled="item.disabled"
                        :title="item.disabledReason ?? undefined"
                        @mousedown.prevent
                        @click="invoke(item.command, $event, compactAnchorRef)"
                    >{{ item.label }}</button>
                </template>
            </div>

            <div
                v-if="projectMenuOpen"
                ref="projectPanelRef"
                class="desktop-title-bar__dropdown desktop-title-bar__dropdown--project nb-ui-popover-surface nb-ui-menu-surface"
                role="menu"
                data-titlebar-menu-panel="project"
                :style="projectPanelStyle"
                @keydown="projectPanelKeydown"
            >
                <div
                    v-for="item in projectMenuItems"
                    :key="item.projectRoot ?? 'bookshelf'"
                    class="desktop-title-bar__project-row"
                    role="none"
                >
                    <button
                        type="button"
                        class="desktop-title-bar__item desktop-title-bar__project-item nb-ui-popover-item"
                        role="menuitem"
                        :aria-current="item.active ? 'page' : undefined"
                        :data-project-root="item.projectRoot ?? ''"
                        @mousedown.prevent
                        @click="selectProject(item, $event)"
                    >
                        <span :class="item.projectRoot === null ? 'i-lucide-library' : 'i-lucide-book-open-text'" class="h-3.5 w-3.5 shrink-0"></span>
                        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                        <span v-if="item.active" class="i-lucide-check h-3.5 w-3.5 shrink-0"></span>
                    </button>
                    <!-- 新标签打开：标准 Project URL 由页面路由构造，链接语义交给浏览器（中键 / Ctrl 点击同样成立）。 -->
                    <a
                        v-if="projectUrl"
                        class="desktop-title-bar__item desktop-title-bar__new-tab nb-ui-popover-item"
                        role="menuitem"
                        data-titlebar-action="open-project-new-tab"
                        :href="projectUrl(item.projectRoot)"
                        target="_blank"
                        rel="noopener noreferrer"
                        :title="`在新标签打开：${item.label}`"
                        :aria-label="`在新标签打开：${item.label}`"
                        @mousedown.prevent
                        @click="open(null)"
                    >
                        <span class="i-lucide-external-link h-3.5 w-3.5 shrink-0"></span>
                    </a>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
/*
 * 尺寸口径分两层，别混：
 * - **主题层**：面 / 线 / 字号 / 字重 / 圆角 / 控件高 / 间距 / 动效全部取 nb-ui 变量
 *   （`packages/nb-ui/src/tokens.css` 与配色契约）。换主题或配色时这里跟着变。
 * - **产品 IA 常量**：窗口高度、窗口按钮 46 满高、断点与量测占位宽度。窗口几何属产品侧，
 *   事实源头是 `app/utils/workbench/layout.ts` 的 `SHELL_TITLEBAR_HEIGHT`——本组件把它喂成
 *   `--workbench-titlebar-height`（外壳的垂直分配与窄屏叶包装读同一个常量），不在这里另写数值；
 *   层级 1000 / 1001 同理——nb-ui 明确「z-index 不是主题语义」。
 */
.desktop-title-bar {
    position: relative;
    z-index: 1000;
    width: 100%;
    height: var(--workbench-titlebar-height);
    flex: 0 0 var(--workbench-titlebar-height);
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
    height: env(titlebar-area-height, var(--workbench-titlebar-height));
    min-height: var(--workbench-titlebar-height);
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
 * .nb-ui-menu-surface），这里只留网格、最小宽度与内边距。
 *
 * 这是 nb-ui 侧的登记处：`src/styles.css` 明确写着「新增浮层组件请消费此类，不要再复制这一组属性」。
 * 复制一份的代价在本文件里是实测过的——原来那两条写死的阴影（0 18px 44px / 0 4px 12px）
 * 在换主题时完全跟不上，而 .nb-ui-popover-surface 取的是主题的 --elevation-popover。
 *
 * 内边距必须等于基座声明的 --nb-popover-pad：浮层里贴边盒子的圆角是由外圈半径、描边与
 * 这个内边距推出来的（同心半径），各写各的数会让弧线在角上不平行。
 *
 * 定位**不在这里**：浮层 Teleport 到主题宿主，fixed 坐标由 `useTitleBarMenuPanel` 按锚点算
 * （见 script 里的说明）——留在原地会被标题栏祖先链上的 overflow: hidden 裁掉。
 */
.desktop-title-bar__dropdown {
    z-index: 1001;
    display: grid;
    min-width: 168px;
    padding: var(--nb-popover-pad);
    /* 最大高度与坐标由脚本按锚点和视口余量给出（见 `useTitleBarMenuPanel`）；超过就在面板里滚，
       菜单项被视口切掉比多一条滚动条更糟。 */
    overflow-y: auto;
    overscroll-behavior: contain;
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

.desktop-title-bar__item:hover,
.desktop-title-bar__item:focus-visible,
.desktop-title-bar__item[aria-current="page"] {
    color: var(--text-main);
    background: var(--overlay-item-active);
    outline: none;
}

/* 禁用项必须能看懂为什么：不吃悬停面、留灰字与 title 里的原因（顺序在悬停规则之后才盖得住）。 */
.desktop-title-bar__item:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
    opacity: 0.55;
}

.desktop-title-bar__item:disabled:hover {
    background: transparent;
}

/* Project 行：本标签打开的菜单项 + 新标签打开的链接并排，中间不换行。 */
.desktop-title-bar__project-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.desktop-title-bar__project-item {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-4);
}

.desktop-title-bar__new-tab {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--text-muted);
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

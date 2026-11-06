<script setup lang="ts">
/** 标题栏（同名 .md）：品牌标志、项目切换、应用菜单、命令搜索、布局按钮与条目区；只发事件。 */
import {Button, DropdownMenu, IconButton, Menubar} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import {useElementSize} from "@vueuse/core";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import NeuroBookLockup from "nbook/ui/brand/NeuroBookLockup.vue";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import {useWorkbenchText} from "../text";
import type {WorkbenchTextKey} from "../../shared/text";
import type {StripEntry} from "../items/registry";
import {withNativeEditing} from "../titlebar/menu-model";
import type {MenuEntry, MenuGroup} from "../titlebar/menu-model";
import {titlebarLevel} from "../titlebar/yield";
import type {TitlebarWidths} from "../titlebar/yield";
import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";

type Part = "sidebar" | "panel" | "auxiliarybar";
type LayoutButton = {readonly pressed: boolean; readonly disabled: boolean};

defineOptions({name: "WorkbenchTitleBar"});

const props = defineProps<{
    project: string | null;
    menus: MenuGroup[];
    searchShortcut: string | null;
    layout: Readonly<Record<Part, LayoutButton>>;
    items: StripEntry[];
}>();

const emit = defineEmits<{
    (event: "run", command: string, args: Readonly<Record<string, unknown>>): void;
    (event: "search"): void;
    (event: "toggle-part", part: Part): void;
    (event: "open-project"): void;
    (event: "run-item", itemId: string): void;
}>();

/** 布局按钮的名字（目录里 `titlebar.toggle` 下的键）。 */
const TOGGLE_KEYS: Readonly<Record<Part, WorkbenchTextKey>> = {sidebar: "titlebar.toggle.sidebar", panel: "titlebar.toggle.panel", auxiliarybar: "titlebar.toggle.auxiliarybar"};

/**
 * 判定让位时搜索要留的宽度（外壳四输出 30）：两侧先让，搜索留着这么宽；全部收完以后搜索才继续收窄，网格保证它最窄
 * 120px、仍是一条带文字的长条。取值按第一轮让位表（中文、项目名两个字时约 1040、900、760、640、520 处切换）反推。
 */
const SEARCH_COMFORT = 480;
/** 条目区收到最少时只剩“更多”，与条目同高的方形按钮。 */
const ITEMS_MORE = 28;
const PART_ICONS: Readonly<Record<Part, string>> = {sidebar: "i-lucide-panel-left", panel: "i-lucide-panel-bottom", auxiliarybar: "i-lucide-panel-right"};
const PARTS: ReadonlyArray<Part> = ["sidebar", "panel", "auxiliarybar"];
const OPEN_PROJECT = "open-project";
const GROUP_PREFIX = "group:";

const text = useWorkbenchText();

const root = ref<HTMLElement | null>(null);
const measureEl = ref<HTMLElement | null>(null);
// 按边框盒量：让位看的是标题栏自己的宽度，含左右内边距。
const {width} = useElementSize(root, undefined, {box: "border-box"});
const {width: measuredWidth} = useElementSize(measureEl, undefined, {box: "border-box"});

/**
 * 逐级让位（外壳四输出 30，`titlebar/yield.ts`）：0 全部展开，往上依次收起横排标志、菜单栏、快捷键提示、布局按钮、项目名。
 * 各部件的宽度从测量层量（语言、项目名、快捷键变了随之变），没量到之前（首帧、测试环境）按全部展开。
 */
const level = ref(0);

function outer(element: Element | null): number {
    if (!(element instanceof HTMLElement)) return 0;
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().width + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
}

function measuredWidths(): TitlebarWidths | null {
    const bar = root.value;
    const layer = measureEl.value;
    if (bar === null || layer === null) return null;
    const part = (name: string): number => outer(layer.querySelector(`[data-measure="${name}"]`));
    const barStyle = getComputedStyle(bar);
    const startStyle = getComputedStyle(bar.querySelector(".workbench-titlebar__start") ?? bar);
    const gap = Number.parseFloat(startStyle.columnGap) || 0;
    const search = bar.querySelector("[data-titlebar-search]");
    const shortcut = props.searchShortcut === null ? 0 : part("shortcut") + (search === null ? 0 : Number.parseFloat(getComputedStyle(search).columnGap) || 0);
    return {
        lockup: part("lockup"),
        mark: part("mark"),
        project: part("project"),
        projectIcon: part("project-icon"),
        divider: part("divider"),
        menubar: part("menubar"),
        menuIcon: part("menu-icon"),
        shortcut,
        layout: part("layout"),
        items: props.items.length > 0 ? ITEMS_MORE : 0,
        gap,
        chrome: (Number.parseFloat(barStyle.paddingLeft) || 0) + (Number.parseFloat(barStyle.paddingRight) || 0) + 2 * (Number.parseFloat(barStyle.columnGap) || 0),
        search: SEARCH_COMFORT,
    };
}

watch([width, measuredWidth], () => {
    const widths = width.value > 0 ? measuredWidths() : null;
    if (widths !== null) level.value = titlebarLevel(widths, width.value, level.value);
});

const showLockup = computed(() => level.value < 1);
const showMenubar = computed(() => level.value < 2);
const showShortcut = computed(() => level.value < 3);
const showLayout = computed(() => level.value < 4);
const showProjectName = computed(() => level.value < 5);

/** 菜单打开前焦点在原生输入框里：撤销、重做不代替它（外壳四输出 29）。 */
const nativeEditing = ref(false);
const menus = computed(() => (nativeEditing.value ? withNativeEditing(props.menus, text("titlebar.nativeEditing")) : props.menus));
const entries = computed(() => new Map(menus.value.flatMap((group) => group.sections.flat().map((entry) => [entry.id, entry] as const))));

function itemOf(entry: MenuEntry): MenubarItemData {
    return {
        label: entry.label,
        id: entry.id,
        disabled: !entry.enabled,
        ...(entry.reason === null ? {} : {title: entry.reason}),
        ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
        ...(entry.checked === null ? {} : {type: "checkbox" as const, checked: entry.checked}),
    };
}

function dropdownItemOf(entry: MenuEntry): DropdownMenuItemData {
    return {
        label: entry.label,
        id: entry.id,
        disabled: !entry.enabled,
        ...(entry.reason === null ? {} : {title: entry.reason}),
        ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
        ...(entry.checked === null ? {} : {type: "checkbox" as const, checked: entry.checked}),
    };
}

/** 节与节之间放一条分隔线；节本身不会为空（`arrangeMenu` 不给出空节）。 */
function sectioned<T>(sections: ReadonlyArray<ReadonlyArray<MenuEntry>>, map: (entry: MenuEntry) => T, separator: (index: number) => T): T[] {
    return sections.flatMap((section, index) => [...(index === 0 ? [] : [separator(index)]), ...section.map(map)]);
}

const menubar = computed<MenubarMenuData[]>(() => menus.value.map((group) => ({
    id: group.id,
    label: group.label,
    items: sectioned(group.sections, itemOf, (index) => ({label: "", id: `${group.id}-sep-${String(index)}`, separator: true})),
})));

/** 收成 ≡ 后（M1）：一组一行，悬停或方向键展开它的子菜单，同完整菜单栏的分组。 */
const compactItems = computed<DropdownMenuItemData[]>(() => menus.value.map((group) => ({
    label: group.label,
    id: `${GROUP_PREFIX}${group.id}`,
    children: sectioned(group.sections, dropdownItemOf, (index) => ({label: "", id: `${group.id}-sep-${String(index)}`, separator: true})),
})));

const projectItems = computed<DropdownMenuItemData[]>(() => [{label: text("titlebar.openProject"), id: OPEN_PROJECT}]);

function select(value: string): void {
    if (value === OPEN_PROJECT) {
        emit("open-project");
        return;
    }
    const entry = entries.value.get(value);
    if (entry !== undefined && entry.enabled) emit("run", entry.command, entry.args);
}

/**
 * 菜单会话（外壳四输出 29、31）：从 F10/Alt 聚焦菜单入口或任一菜单打开起，到菜单关闭、焦点交还为止。记下打开前标题栏之外
 * 的焦点与它是不是原生输入框：输入框自己处理撤销、重做，菜单里的这两项禁用；菜单关闭后焦点落回入口（Escape、选中一项）时
 * 还给打开前的位置，用户点了别处则不还。Alt 单独按下再松开，或 F10，开始一次会话；Alt 与别的键一起按（Alt+方向键这类组合）不算。
 */
interface MenuSession {
    readonly from: HTMLElement | null;
}
let altAlone = false;
let session: MenuSession | null = null;
/** 最近一次落在标题栏（与菜单浮层）之外的焦点：菜单用指针点开时，打开前的焦点已经不在 activeElement 上了。 */
let lastOutsideFocus: HTMLElement | null = null;
const menubarOpen = ref("");
const dropdownOpen = ref(false);
const menuOpen = computed(() => menubarOpen.value !== "" || dropdownOpen.value);

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", "date", "datetime-local", "month", "week", "time"]);

/** 原生输入框：`input`、`textarea`，编辑器区里的除外（源码编辑器用隐藏的 textarea 收输入，它的撤销归编辑器命令）。 */
function isNativeEditable(element: HTMLElement | null): boolean {
    if (element === null || element.closest("[data-editor-group]") !== null) return false;
    if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type);
    return element instanceof HTMLTextAreaElement;
}

function menuEntry(): HTMLElement | null {
    return root.value?.querySelector<HTMLElement>("[data-titlebar-menu-entry] [role='menuitem'], [data-titlebar-menu-entry][role='menuitem'], button[data-titlebar-menu-entry]") ?? null;
}

function beginSession(): void {
    if (session !== null) return;
    const from = lastOutsideFocus !== null && lastOutsideFocus.isConnected ? lastOutsideFocus : null;
    session = {from};
    nativeEditing.value = isNativeEditable(from);
}

function endSession(restore: boolean): void {
    const ended = session;
    session = null;
    nativeEditing.value = false;
    if (restore && ended !== null && ended.from !== null && ended.from.isConnected) ended.from.focus();
}

function focusMenu(): void {
    const target = menuEntry();
    if (target === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !root.value?.contains(active)) lastOutsideFocus = active;
    beginSession();
    target.focus();
}

/** 菜单刚关闭、还在等 nb-ui 把焦点还到入口（浮层退场后才还）：焦点一到入口就交回打开前的位置。 */
let restoreOnEntryFocus = false;

function finishClose(): void {
    if (!restoreOnEntryFocus) return;
    restoreOnEntryFocus = false;
    endSession(true);
}

/** 焦点去了标题栏与菜单浮层之外（用户点了别处）：记下位置；菜单关着时会话随之结束，不再还焦点。 */
function onFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest("[role='menu']") !== null) return;
    if (root.value?.contains(target) === true) {
        if (target.closest("[data-titlebar-menu-entry]") !== null) finishClose();
        return;
    }
    lastOutsideFocus = target;
    restoreOnEntryFocus = false;
    if (session !== null && !menuOpen.value) endSession(false);
}

// 菜单打开即开始会话；关闭后焦点落回入口（Escape、选中一项）就还给打开前的位置，点了别处则不还。
watch(menuOpen, (open) => {
    if (open) {
        restoreOnEntryFocus = false;
        beginSession();
        return;
    }
    if (session === null) return;
    restoreOnEntryFocus = true;
    // 没有退场动画时焦点此刻已经在入口上；有的话等 focusin。
    void nextTick(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && root.value?.contains(active) === true) finishClose();
    });
});

function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Alt") {
        altAlone = !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        return;
    }
    altAlone = false;
    if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        focusMenu();
    }
}

function onKeyup(event: KeyboardEvent): void {
    if (event.key !== "Alt" || !altAlone) return;
    altAlone = false;
    event.preventDefault();
    focusMenu();
}

function onRootKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || session === null || menuOpen.value) return;
    const target = event.target;
    // 只有菜单入口上的 Escape 还焦点：焦点挪到搜索、布局按钮等别的控件后按 Escape，与会话无关。菜单开着时 Escape 归菜单。
    if (!(target instanceof HTMLElement) || target.closest("[data-titlebar-menu-entry]") === null || target.getAttribute("aria-expanded") === "true") return;
    void nextTick(() => endSession(true));
}

onMounted(() => {
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("keyup", onKeyup, true);
    document.addEventListener("focusin", onFocusIn, true);
});
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("keyup", onKeyup, true);
    document.removeEventListener("focusin", onFocusIn, true);
});
</script>

<template>
    <header ref="root" class="workbench-titlebar" :aria-label="text('titlebar.label')" data-workbench-titlebar :data-titlebar-level="level" :data-titlebar-native-editing="nativeEditing ? '' : undefined" @keydown="onRootKeydown">
        <div class="workbench-titlebar__start">
            <NeuroBookLockup v-if="showLockup" class="workbench-titlebar__brand" />
            <NeuroBookMark v-else class="workbench-titlebar__mark" />
            <DropdownMenu v-if="project !== null" :items="projectItems" align="start" @select="select">
                <Button variant="ghost" size="sm" class="workbench-titlebar__button workbench-titlebar__project" :title="project" :aria-label="text('titlebar.projectButton', {name: project})" data-titlebar-project>
                    <span class="i-lucide-book-open workbench-titlebar__project-icon h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                    <span v-if="showProjectName" class="workbench-titlebar__project-name">{{ project }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                </Button>
            </DropdownMenu>
            <Button v-else variant="ghost" size="sm" class="workbench-titlebar__button" :title="text('titlebar.openProject')" :aria-label="text('titlebar.openProject')" data-titlebar-project @click="emit('open-project')">
                <span class="i-lucide-book-open workbench-titlebar__project-icon h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                <span v-if="showProjectName">{{ text('titlebar.openProject') }}</span>
            </Button>
            <span class="workbench-titlebar__divider" aria-hidden="true"></span>
            <Menubar v-if="showMenubar" v-model="menubarOpen" :menus="menubar" size="sm" variant="flat" data-titlebar-menu-entry @select="(item) => select(item.id)" />
            <DropdownMenu v-else :items="compactItems" align="start" @select="select" @update:open="(open: boolean) => { dropdownOpen = open; }">
                <IconButton size="sm" icon-class="i-lucide-menu" :aria-label="text('titlebar.menuButton')" :title="text('titlebar.menuButton')" class="workbench-titlebar__button" data-titlebar-menu-entry />
            </DropdownMenu>
        </div>

        <div class="workbench-titlebar__center">
            <Button
                variant="secondary"
                size="sm"
                class="workbench-titlebar__search"
                :aria-label="searchShortcut === null ? text('titlebar.search') : text('titlebar.searchWithShortcut', {shortcut: searchShortcut})"
                data-titlebar-search
                @click="emit('search')"
            >
                <span class="i-lucide-search h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                <span class="workbench-titlebar__search-label">{{ text('titlebar.search') }}</span>
                <kbd v-if="showShortcut && searchShortcut !== null" class="workbench-titlebar__kbd">{{ searchShortcut }}</kbd>
            </Button>
        </div>

        <div class="workbench-titlebar__end">
            <template v-if="showLayout">
                <IconButton
                    v-for="part in PARTS"
                    :key="part"
                    size="sm"
                    :icon-class="PART_ICONS[part]"
                    :aria-label="text(TOGGLE_KEYS[part])"
                    :title="text(TOGGLE_KEYS[part])"
                    :aria-pressed="layout[part].pressed"
                    :disabled="layout[part].disabled"
                    :class="{'workbench-titlebar__layout--pressed': layout[part].pressed}"
                    :data-titlebar-layout="part"
                    @click="emit('toggle-part', part)"
                />
            </template>
            <WorkbenchItemStrip v-if="items.length > 0" class="workbench-titlebar__items" :entries="items" :item-height="28" align="end" @run="(id) => emit('run-item', id)" />
        </div>

        <!--
            测量层：各部件在各种样子下的宽度（逐级让位按它算），不可见、不占位、不进无障碍树与 Tab 顺序。复本只复刻样子：不带角色、
            id 与真元素的类名（样式由下面的选择器套上），按类名、角色或文字找真元素的地方不会碰到它。
        -->
        <div ref="measureEl" class="workbench-titlebar__measure" aria-hidden="true" inert>
            <NeuroBookLockup class="workbench-titlebar__measure-lockup" data-measure="lockup" />
            <NeuroBookMark class="workbench-titlebar__measure-mark" data-measure="mark" />
            <Button variant="ghost" size="sm" class="workbench-titlebar__button workbench-titlebar__project" data-measure="project">
                <span class="i-lucide-book-open h-3.5 w-3.5 shrink-0"></span>
                <span class="workbench-titlebar__measure-name">{{ project ?? text('titlebar.openProject') }}</span>
                <span v-if="project !== null" class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0"></span>
            </Button>
            <Button variant="ghost" size="sm" class="workbench-titlebar__button" data-measure="project-icon">
                <span class="i-lucide-book-open h-3.5 w-3.5 shrink-0"></span>
                <span v-if="project !== null" class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0"></span>
            </Button>
            <span class="workbench-titlebar__measure-divider" data-measure="divider"></span>
            <!-- 菜单栏的复本：与 nb-ui Menubar 的 sm、flat 触发器同样的间距、内边距与字号；那边改了这里要跟着改。 -->
            <span class="inline-flex items-center gap-0.5" data-measure="menubar">
                <span v-for="group in menubar" :key="group.id" class="px-2 py-0.5 text-[length:var(--text-xs)] font-medium">{{ group.label }}</span>
            </span>
            <IconButton size="sm" icon-class="i-lucide-menu" aria-label="" class="workbench-titlebar__button" data-measure="menu-icon" />
            <kbd class="workbench-titlebar__kbd" data-measure="shortcut">{{ searchShortcut }}</kbd>
            <span class="workbench-titlebar__measure-group" data-measure="layout"><IconButton v-for="part in PARTS" :key="part" size="sm" :icon-class="PART_ICONS[part]" aria-label="" /></span>
        </div>
    </header>
</template>

<style scoped>
.workbench-titlebar {
    display: grid;
    /*
     * 左右两栏等分，搜索才在整条标题栏的正中；左组（标志、项目、菜单）放不进一半时左栏按内容撑开，搜索往右让。
     * 两边都不让挤掉：左右栏最小取内容宽（项目名有上限、会截断，条目区有上限、多的收进“更多”），空间不够时收窄的是
     * 中间的搜索，最宽 560px、最窄 120px；再不够就按 `level` 逐级收起两侧的项（外壳四输出 30）。
     */
    position: relative;
    grid-template-columns: minmax(max-content, 1fr) minmax(120px, 560px) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 36px;
    min-width: 0;
    padding-inline: var(--space-2);
    /* 卡片外壳里标题栏落在窗体底上、不画底线（ui/workbench-shell.md 输出 38）：两者都是主题变量，缺省是平铺的样子。 */
    background: var(--shell-chrome-surface, var(--bg-panel));
    border-bottom: var(--border-w) solid var(--shell-chrome-line, var(--divider));
    color: var(--text-main);
    font-size: var(--text-xs);
    user-select: none;
}

.workbench-titlebar__start,
.workbench-titlebar__end,
.workbench-titlebar__measure-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
}

.workbench-titlebar__end {
    justify-content: flex-end;
}

.workbench-titlebar__center {
    display: flex;
    justify-content: center;
    min-width: 0;
}

/* 横排标志（标志 + 字标，墨色跟随文字色）；放不下时先换成单独的图形标志。测量层的复本同样的盒子。 */
.workbench-titlebar__brand,
.workbench-titlebar__measure-lockup {
    flex: 0 0 auto;
    height: 17px;
    margin-inline: var(--space-1) var(--space-2);
}

.workbench-titlebar__mark,
.workbench-titlebar__measure-mark {
    flex: 0 0 auto;
    height: 18px;
    margin-inline: var(--space-1);
}

/* 项目切换与菜单之间的短分隔。 */
.workbench-titlebar__divider,
.workbench-titlebar__measure-divider {
    flex: 0 0 auto;
    width: var(--border-w);
    height: 16px;
    margin-inline: var(--space-1);
    background: var(--divider);
}

.workbench-titlebar__project-icon {
    color: var(--text-muted);
}

.workbench-titlebar__button {
    flex: 0 0 auto;
    height: 28px;
    gap: var(--space-1);
    font-size: inherit;
}

.workbench-titlebar__search {
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    height: 26px;
    justify-content: flex-start;
    color: var(--text-secondary);
    font-size: inherit;
}

.workbench-titlebar__search-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-titlebar__kbd {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
}

.workbench-titlebar__project {
    min-width: 0;
    max-width: 220px;
}

.workbench-titlebar__project-name,
.workbench-titlebar__measure-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-titlebar__layout--pressed {
    color: var(--accent-main);
}

.workbench-titlebar__items {
    flex: 0 1 auto;
    max-width: 320px;
}

/* 测量层：叠在标题栏下面，不可见、不接指针、不撑高度；子元素按内容宽度排开，量得出各自的宽度。 */
.workbench-titlebar__measure {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
}
</style>

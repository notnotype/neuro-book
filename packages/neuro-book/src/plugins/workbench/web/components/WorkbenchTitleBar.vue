<script setup lang="ts">
/** 标题栏（同名 .md）：品牌、应用菜单、命令搜索、项目切换、布局按钮与条目区；只发事件。 */
import {Button, Dropdown, IconButton, Menubar} from "@notnotype/nb-ui/components";
import type {DropdownItem, MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import {useElementSize} from "@vueuse/core";
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {StripEntry} from "../items/registry";
import type {MenuEntry, MenuGroup} from "../titlebar/menu-model";
import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";

type Part = "sidebar" | "panel" | "auxiliarybar";
type LayoutButton = {readonly pressed: boolean; readonly disabled: boolean};

defineOptions({name: "WorkbenchTitleBar"});

const props = defineProps<{
    locale: DisplayLocale;
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

const TEXT = {
    label: {"zh-CN": "标题栏", "en-US": "Title bar"},
    menu: {"zh-CN": "菜单", "en-US": "Menu"},
    search: {"zh-CN": "搜索命令", "en-US": "Search commands"},
    openProject: {"zh-CN": "打开项目…", "en-US": "Open Project…"},
    project: {"zh-CN": "项目", "en-US": "Project"},
    sidebar: {"zh-CN": "切换侧栏", "en-US": "Toggle Sidebar"},
    panel: {"zh-CN": "切换面板", "en-US": "Toggle Panel"},
    auxiliarybar: {"zh-CN": "切换右栏", "en-US": "Toggle Auxiliary Bar"},
} satisfies Record<string, LocalizedText>;

/** 宽度三档的边界（外壳四输出 30）：按四组菜单、居中搜索与项目名的实际宽度估算。 */
const FULL_WIDTH = 960;
const COMPACT_WIDTH = 600;
const PART_ICONS: Readonly<Record<Part, string>> = {sidebar: "i-lucide-panel-left", panel: "i-lucide-panel-bottom", auxiliarybar: "i-lucide-panel-right"};
const PARTS: ReadonlyArray<Part> = ["sidebar", "panel", "auxiliarybar"];
const OPEN_PROJECT = "open-project";
const GROUP_PREFIX = "group:";

const text = (value: LocalizedText): string => localize(value, props.locale);

const root = ref<HTMLElement | null>(null);
// 按边框盒量：三档的边界是标题栏自己的宽度，含左右内边距。
const {width} = useElementSize(root, undefined, {box: "border-box"});
/** 没量到宽度之前（首帧、测试环境）按完整呈现。 */
const mode = computed<"full" | "compact" | "minimal">(() => {
    if (width.value <= 0 || width.value >= FULL_WIDTH) return "full";
    return width.value >= COMPACT_WIDTH ? "compact" : "minimal";
});

const entries = computed(() => new Map(props.menus.flatMap((group) => group.sections.flat().map((entry) => [entry.id, entry] as const))));

function itemOf(entry: MenuEntry): MenubarItemData {
    return {
        label: entry.label,
        value: entry.id,
        disabled: !entry.enabled,
        ...(entry.reason === null ? {} : {title: entry.reason}),
        ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
        ...(entry.checked === null ? {} : {type: "checkbox" as const, checked: entry.checked}),
    };
}

function dropdownItemOf(entry: MenuEntry): DropdownItem {
    return {
        label: entry.label,
        value: entry.id,
        disabled: !entry.enabled,
        ...(entry.reason === null ? {} : {title: entry.reason}),
        ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
        ...(entry.checked === null ? {} : {type: "checkbox" as const, checked: entry.checked}),
    };
}

/** 节与节之间放一条分隔线；节本身不会为空（能力模型已裁掉）。 */
function sectioned<T>(sections: ReadonlyArray<ReadonlyArray<MenuEntry>>, map: (entry: MenuEntry) => T, separator: (index: number) => T): T[] {
    return sections.flatMap((section, index) => [...(index === 0 ? [] : [separator(index)]), ...section.map(map)]);
}

const menubar = computed<MenubarMenuData[]>(() => props.menus.map((group) => ({
    id: group.id,
    label: group.label,
    items: sectioned(group.sections, itemOf, (index) => ({label: "", value: `${group.id}-sep-${String(index)}`, separator: true})),
})));

const compactItems = computed<DropdownItem[]>(() => props.menus.flatMap((group, groupIndex) => [
    ...(groupIndex === 0 ? [] : [{label: "", value: `sep-${group.id}`, separator: true}]),
    {label: group.label, value: `${GROUP_PREFIX}${group.id}`, disabled: true},
    ...sectioned(group.sections, dropdownItemOf, (index) => ({label: "", value: `${group.id}-sep-${String(index)}`, separator: true})),
]));

const projectItems = computed<DropdownItem[]>(() => [{label: text(TEXT.openProject), value: OPEN_PROJECT}]);

function select(value: string): void {
    if (value === OPEN_PROJECT) {
        emit("open-project");
        return;
    }
    const entry = entries.value.get(value);
    if (entry !== undefined && entry.enabled) emit("run", entry.command, entry.args);
}

/**
 * Alt 单独按下再松开，或 F10：聚焦菜单入口并记下之前的焦点。Alt 与别的键一起按（Alt+方向键这类组合）不算。
 * 焦点在菜单入口、菜单都关着时按 Escape，把焦点还回去。
 */
let altAlone = false;
let returnFocus: HTMLElement | null = null;

function menuEntry(): HTMLElement | null {
    return root.value?.querySelector<HTMLElement>("[data-titlebar-menu-entry] [role='menuitem'], [data-titlebar-menu-entry][role='menuitem'], button[data-titlebar-menu-entry]") ?? null;
}

function focusMenu(): void {
    const target = menuEntry();
    if (target === null) return;
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && !root.value?.contains(active) ? active : returnFocus;
    target.focus();
}

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
    if (event.key !== "Escape" || returnFocus === null) return;
    const target = event.target as HTMLElement | null;
    // 菜单开着时 Escape 归菜单（关闭并把焦点还给组标题）；关着、焦点在入口上时才还给之前的位置。
    if (target === null || target.getAttribute("aria-expanded") === "true" || document.querySelector("[role='menu'][data-state='open']") !== null) return;
    const back = returnFocus;
    returnFocus = null;
    void nextTick(() => back.focus());
}

onMounted(() => {
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("keyup", onKeyup, true);
});
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("keyup", onKeyup, true);
});
</script>

<template>
    <header ref="root" class="workbench-titlebar" :class="`workbench-titlebar--${mode}`" :aria-label="text(TEXT.label)" data-workbench-titlebar :data-titlebar-mode="mode" @keydown="onRootKeydown">
        <div class="workbench-titlebar__start">
            <span v-if="mode !== 'minimal'" class="workbench-titlebar__brand">NeuroBook</span>
            <Menubar v-if="mode === 'full'" :menus="menubar" size="sm" variant="flat" data-titlebar-menu-entry @select="(item) => select(item.value)" />
            <Dropdown v-else :items="compactItems" align="start" @select="select">
                <Button variant="ghost" size="sm" class="workbench-titlebar__button" data-titlebar-menu-entry>
                    <span class="i-lucide-menu h-4 w-4" aria-hidden="true"></span>
                    <span v-if="mode === 'compact'">{{ text(TEXT.menu) }}</span>
                    <span v-else class="sr-only">{{ text(TEXT.menu) }}</span>
                </Button>
            </Dropdown>
        </div>

        <div class="workbench-titlebar__center">
            <Button
                variant="secondary"
                size="sm"
                class="workbench-titlebar__search"
                :aria-label="searchShortcut === null ? text(TEXT.search) : `${text(TEXT.search)}（${searchShortcut}）`"
                data-titlebar-search
                @click="emit('search')"
            >
                <span class="i-lucide-search h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                <span v-if="mode !== 'minimal'" class="workbench-titlebar__search-label">{{ text(TEXT.search) }}</span>
                <kbd v-if="mode !== 'minimal' && searchShortcut !== null" class="workbench-titlebar__kbd">{{ searchShortcut }}</kbd>
            </Button>
        </div>

        <div class="workbench-titlebar__end">
            <Dropdown v-if="project !== null" :items="projectItems" align="end" @select="select">
                <Button variant="ghost" size="sm" class="workbench-titlebar__button workbench-titlebar__project" :title="project" :aria-label="`${text(TEXT.project)}：${project}`" data-titlebar-project>
                    <span class="workbench-titlebar__project-name">{{ project }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                </Button>
            </Dropdown>
            <Button v-else variant="ghost" size="sm" class="workbench-titlebar__button" data-titlebar-project @click="emit('open-project')">{{ text(TEXT.openProject) }}</Button>
            <template v-if="mode !== 'minimal'">
                <IconButton
                    v-for="part in PARTS"
                    :key="part"
                    size="sm"
                    :icon-class="PART_ICONS[part]"
                    :aria-label="text(TEXT[part])"
                    :title="text(TEXT[part])"
                    :aria-pressed="layout[part].pressed"
                    :disabled="layout[part].disabled"
                    :class="{'workbench-titlebar__layout--pressed': layout[part].pressed}"
                    :data-titlebar-layout="part"
                    @click="emit('toggle-part', part)"
                />
            </template>
            <WorkbenchItemStrip v-if="items.length > 0" class="workbench-titlebar__items" :locale="locale" :entries="items" :item-height="28" align="end" @run="(id) => emit('run-item', id)" />
        </div>
    </header>
</template>

<style scoped>
.workbench-titlebar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 36px;
    min-width: 0;
    padding-inline: var(--space-2);
    background: var(--bg-panel);
    border-bottom: var(--border-w) solid var(--divider);
    color: var(--text-main);
    font-size: var(--text-xs);
    user-select: none;
}

.workbench-titlebar__start,
.workbench-titlebar__end {
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

.workbench-titlebar__brand {
    flex: 0 0 auto;
    padding-inline: var(--space-1);
    font-weight: 600;
}

.workbench-titlebar__button {
    flex: 0 0 auto;
    height: 28px;
    gap: var(--space-1);
    font-size: inherit;
}

.workbench-titlebar__search {
    gap: var(--space-2);
    width: clamp(36px, 32vw, 360px);
    height: 26px;
    justify-content: flex-start;
    color: var(--text-secondary);
    font-size: inherit;
}

.workbench-titlebar--minimal .workbench-titlebar__search {
    width: 32px;
    justify-content: center;
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

.workbench-titlebar__project-name {
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
</style>

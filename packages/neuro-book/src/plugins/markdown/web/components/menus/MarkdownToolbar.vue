<script setup lang="ts">
/** Markdown 编辑器的固定工具栏（同名 .md）。 */
import {DropdownMenu, IconButton, Toolbar} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, useTemplateRef} from "vue";

import {EDITING_ACTIONS, EDITOR_TOOLBAR_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownColorButton from "./MarkdownColorButton.vue";
import {HIGHLIGHT_COLORS, LINK_COMMAND, TEXT_COLORS} from "./palette";
import type {PaletteColor} from "./palette";

const props = defineProps<{editing: EditorEditing; menus: EditorMenus; readonly: boolean}>();
const emit = defineEmits<{(event: "prompt", action: "ruby" | "bilingual"): void; (event: "refocus"): void}>();

/** 版面用的定值：`IconButton` 的 `sm` 是 26px，按钮之间 gap 2px，分隔线连两侧 9px，“⋯”占一个按钮。 */
const BUTTON = 28;
const COLOR = 28;
const BLOCK = 78;
const ALIGN = 42;
const SEPARATOR = 11;

type Item =
    | {readonly kind: "action"; readonly action: EditingActionId}
    | {readonly kind: "command"; readonly id: string; readonly command: string; readonly icon: string; readonly title: string; readonly enabled: boolean}
    | {readonly kind: "block"}
    | {readonly kind: "color"; readonly action: "text-color" | "highlight"}
    | {readonly kind: "align"}
    | {readonly kind: "contributed"; readonly id: string; readonly label: string; readonly icon: string; readonly enabled: boolean}
    | {readonly kind: "separator"};

const widthOf = (item: Item): number => {
    if (item.kind === "separator") return SEPARATOR;
    if (item.kind === "block") return BLOCK;
    if (item.kind === "align") return ALIGN;
    if (item.kind === "color") return COLOR;
    return BUTTON;
};

const separator: Item = {kind: "separator"};
const action = (id: EditingActionId): Item => ({kind: "action", action: id});
const history = (command: "undo" | "redo", icon: string): Item => ({kind: "command", id: command, command: `nbook.edit.${command}`, icon, title: props.menus.title(command), enabled: props.editing.enabled(command)});

/** 决定 6 的顺序；链接等 t09 登记命令后才有（决定 15）。 */
const items = computed<ReadonlyArray<Item>>(() => {
    const link: Item[] = props.menus.has(LINK_COMMAND)
        ? [{kind: "command", id: "link", command: LINK_COMMAND, icon: "i-lucide-link", title: props.menus.title("link"), enabled: props.editing.enabled("link")}, separator]
        : [];
    const contributed = props.menus.contributed(EDITOR_TOOLBAR_POINT).flat().filter((entry) => entry.placement === "inline");
    return [
        history("undo", "i-lucide-undo-2"),
        history("redo", "i-lucide-redo-2"),
        separator,
        {kind: "block"},
        separator,
        action("bold"), action("italic"), action("strike"), action("code"),
        separator,
        {kind: "color", action: "text-color"}, {kind: "color", action: "highlight"},
        separator,
        ...link,
        action("bullet-list"), action("ordered-list"), action("task-list"),
        separator,
        action("quote"), action("callout"), action("code-block"),
        separator,
        {kind: "align"}, action("clear-format"),
        ...contributed.map((entry): Item => ({kind: "contributed", id: entry.id, label: entry.label, icon: entry.icon ?? "", enabled: entry.enabled})),
    ];
});

const bar = useTemplateRef<HTMLElement>("bar");
const available = ref(Number.POSITIVE_INFINITY);
let observer: ResizeObserver | null = null;
onMounted(() => {
    if (bar.value === null) return;
    observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) available.value = entry.contentRect.width;
    });
    observer.observe(bar.value);
});
onBeforeUnmount(() => observer?.disconnect());

/** 从左往右放，放不下的都收进“⋯”；末尾留一个“⋯”的宽度。分隔线不留在收起处的末尾。 */
const fit = computed(() => {
    const room = available.value - BUTTON;
    let used = 0;
    let count = 0;
    for (const item of items.value) {
        used += widthOf(item);
        if (used > room) break;
        count += 1;
    }
    const visible = items.value.slice(0, count);
    while (visible.at(-1)?.kind === "separator") visible.pop();
    return {visible, hidden: items.value.slice(count)};
});

const blockActions: ReadonlyArray<EditingActionId> = ["paragraph", "heading-1", "heading-2", "heading-3"];
const currentBlock = computed(() => blockActions.find((id) => props.editing.active(id)) ?? "paragraph");
const blockMenu = computed<DropdownMenuItemData[]>(() => blockActions.map((id) => ({
    id,
    label: props.menus.title(id),
    iconClass: EDITING_ACTIONS[id].icon,
    type: "checkbox",
    checked: currentBlock.value === id,
    disabled: props.readonly || !props.editing.enabled(id),
})));

const ALIGNS = ["left", "center", "right", "justify"] as const;
const alignMenu = computed<DropdownMenuItemData[]>(() => ALIGNS.map((value) => ({
    id: value,
    label: props.menus.label(`align-${value}`),
    iconClass: `i-lucide-align-${value === "justify" ? "justify" : value}`,
    disabled: props.readonly || !props.editing.enabled("align"),
})));

const itemOf = (id: EditingActionId): DropdownMenuItemData => ({
    id,
    label: props.menus.title(id),
    iconClass: EDITING_ACTIONS[id].icon,
    disabled: props.readonly || !props.editing.enabled(id),
    ...(props.menus.shortcut(id) === null ? {} : {shortcut: props.menus.shortcut(id) as string}),
});

/** “⋯”：收起来的项，加上决定 6 里常驻“⋯”的那几个（上标、下标、分割线、注音、双语）与贡献的 `menu` 项。 */
const moreMenu = computed<DropdownMenuItemData[]>(() => {
    const hidden = fit.value.hidden.flatMap((item): DropdownMenuItemData[] => {
        switch (item.kind) {
            case "action": return [itemOf(item.action)];
            case "command": return [{id: `command:${item.command}`, label: item.title, iconClass: item.icon, disabled: props.readonly || !item.enabled}];
            case "block": return blockMenu.value;
            case "align": return alignMenu.value.map((entry) => ({...entry, id: `align:${entry.id}`}));
            case "color": return [{
                id: item.action,
                label: props.menus.title(item.action),
                iconClass: EDITING_ACTIONS[item.action].icon,
                disabled: props.readonly || !props.editing.enabled(item.action),
                children: [{id: `color:${item.action}:`, label: props.menus.label("colorNone")}, ...colors(item.action).map((color) => ({id: `color:${item.action}:${color.value}`, label: props.menus.label(`color-${color.id}`)}))],
            }];
            case "contributed": return [{id: `contributed:${item.id}`, label: item.label, iconClass: item.icon, disabled: !item.enabled}];
            case "separator": return [];
        }
    });
    const always = (["superscript", "subscript", "divider", "ruby", "bilingual"] as const).map(itemOf);
    const menuEntries = props.menus.contributed(EDITOR_TOOLBAR_POINT).flat().filter((entry) => entry.placement === "menu").map((entry): DropdownMenuItemData => ({id: `contributed:${entry.id}`, label: entry.label, ...(entry.icon === null ? {} : {iconClass: entry.icon}), disabled: !entry.enabled}));
    const sections = [hidden, always, menuEntries].filter((section) => section.length > 0);
    return sections.flatMap((section, index) => (index === 0 ? section : [{id: `sep-${String(index)}`, label: "", separator: true}, ...section]));
});

/**
 * 菜单关闭时原语把焦点还给触发按钮，而且在动画之后：选了一项时要留在正文（输出 5），不能让它抢走用户接着点进正文的焦点。
 * 选了要输入的项时焦点在输入框上，也不动。没选（Esc、点外面）时按原语的规则。
 */
let afterSelect: "refocus" | "keep" | null = null;
const dropdownProps = {
    onCloseAutoFocus: (event: Event): void => {
        if (afterSelect === null) return;
        event.preventDefault();
        if (afterSelect === "refocus") emit("refocus");
        afterSelect = null;
    },
};
function onBlockSelect(id: string): void {
    afterSelect = "refocus";
    props.menus.run(id as EditingActionId);
}
function onAlignSelect(value: string): void {
    afterSelect = "refocus";
    props.menus.run("align", {value});
}

function onMore(id: string): void {
    afterSelect = id === "ruby" || id === "bilingual" ? "keep" : "refocus";
    if (id.startsWith("command:")) props.menus.execute(id.slice("command:".length));
    else if (id.startsWith("contributed:")) props.menus.runContributed(EDITOR_TOOLBAR_POINT, id.slice("contributed:".length));
    else if (id.startsWith("align:")) props.menus.run("align", {value: id.slice("align:".length)});
    else if (id.startsWith("color:")) {
        const [, action, color] = id.split(":") as [string, "text-color" | "highlight", string];
        props.menus.run(action, {color: color === "" ? null : color});
    }
    else if (id === "ruby" || id === "bilingual") emit("prompt", id);
    else props.menus.run(id as EditingActionId);
}

const buttonTitle = (id: EditingActionId): string => {
    const shortcut = props.menus.shortcut(id);
    return shortcut === null ? props.menus.title(id) : `${props.menus.title(id)} (${shortcut})`;
};

const colors = (id: "text-color" | "highlight"): ReadonlyArray<PaletteColor> => (id === "text-color" ? TEXT_COLORS : HIGHLIGHT_COLORS);
</script>

<template>
    <div ref="bar" class="markdown-toolbar" @mousedown.prevent>
        <Toolbar variant="flat" :aria-label="props.menus.label('toolbar')" class="markdown-toolbar__row">
            <template v-for="(item, index) in fit.visible" :key="index">
                <span v-if="item.kind === 'separator'" class="mx-1 h-4 w-px shrink-0 bg-[var(--divider)]" aria-hidden="true" />
                <IconButton
                    v-else-if="item.kind === 'action'"
                    size="sm"
                    :variant="props.editing.active(item.action) ? 'accent' : 'default'"
                    :title="buttonTitle(item.action)"
                    :aria-label="props.menus.title(item.action)"
                    :aria-pressed="'format' in EDITING_ACTIONS[item.action] ? props.editing.active(item.action) : undefined"
                    :icon-class="EDITING_ACTIONS[item.action].icon"
                    :disabled="props.readonly || !props.editing.enabled(item.action)"
                    @click="props.menus.run(item.action)"
                />
                <IconButton
                    v-else-if="item.kind === 'command'"
                    size="sm"
                    :title="item.title"
                    :icon-class="item.icon"
                    :disabled="props.readonly || !item.enabled"
                    @click="props.menus.execute(item.command)"
                />
                <DropdownMenu v-else-if="item.kind === 'block'" :items="blockMenu" :content-props="dropdownProps" @select="onBlockSelect">
                    <button type="button" class="markdown-toolbar__block nb-ui-focus-ring" :disabled="props.readonly" :title="props.menus.label('blockType')" :aria-label="`${props.menus.label('blockType')}：${props.menus.title(currentBlock)}`">
                        <span class="truncate">{{ props.menus.title(currentBlock) }}</span>
                        <span class="i-lucide-chevron-down h-3 w-3 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                    </button>
                </DropdownMenu>
                <MarkdownColorButton v-else-if="item.kind === 'color'" :action="item.action" :editing="props.editing" :menus="props.menus" :readonly="props.readonly" />
                <DropdownMenu v-else-if="item.kind === 'align'" :items="alignMenu" :content-props="dropdownProps" @select="onAlignSelect">
                    <button type="button" class="markdown-toolbar__align nb-ui-focus-ring" :disabled="props.readonly || !props.editing.enabled('align')" :title="props.menus.title('align')" :aria-label="props.menus.title('align')">
                        <span class="i-lucide-align-left h-4 w-4" aria-hidden="true" />
                        <span class="i-lucide-chevron-down h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
                    </button>
                </DropdownMenu>
                <IconButton
                    v-else-if="item.kind === 'contributed'"
                    size="sm"
                    :title="item.label"
                    :icon-class="item.icon"
                    :disabled="!item.enabled"
                    @click="props.menus.runContributed(EDITOR_TOOLBAR_POINT, item.id)"
                />
            </template>
            <DropdownMenu root-class="ml-auto" :items="moreMenu" align="end" :content-props="dropdownProps" @select="onMore">
                <IconButton size="sm" icon-class="i-lucide-ellipsis" :title="props.menus.label('more')" :aria-label="props.menus.label('more')" />
            </DropdownMenu>
        </Toolbar>
    </div>
</template>

<style scoped>
.markdown-toolbar {
    box-sizing: border-box;
    flex-shrink: 0;
    width: 100%;
    max-width: var(--markdown-measure);
    margin-inline: auto;
    /* 图标在按钮里有内边距：按钮往外让这么多，图标才与正文左边缘对齐。 */
    padding-inline: calc(var(--markdown-padding-inline) - 6px);
    border-bottom: var(--border-w, 1px) solid var(--divider);
}

.markdown-toolbar__row {
    height: 36px;
    flex-wrap: nowrap;
    overflow: hidden;
}

.markdown-toolbar__block,
.markdown-toolbar__align {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    height: 26px;
    border-radius: var(--radius-control);
    color: var(--text-main);
    font-size: var(--text-sm);
    transition: background-color var(--motion-fast) var(--ease-standard);
}

.markdown-toolbar__block {
    width: 76px;
    justify-content: space-between;
    padding-inline: 8px;
}

.markdown-toolbar__align {
    width: 40px;
    justify-content: center;
    color: var(--text-secondary);
}

.markdown-toolbar__block:not(:disabled):hover,
.markdown-toolbar__align:not(:disabled):hover {
    background: var(--bg-hover);
}

.markdown-toolbar__block:disabled,
.markdown-toolbar__align:disabled {
    cursor: not-allowed;
    opacity: 0.4;
}
</style>

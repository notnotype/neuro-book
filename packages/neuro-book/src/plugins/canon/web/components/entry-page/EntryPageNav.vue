<script setup lang="ts">
/**
 * 条目页的竖排分页（docs/specs/canon/author-ui.md 输出 9；同名 .md）：编辑区够宽时代替页头下面的横排分页，放在内容左边。两段：
 * 设定组与文字（末尾“添加一组设定”），不对应设定组的看法（附加分页与“情节”）。受控：选中哪一页由宿主给，交互时发出。
 */
import {computed, nextTick, ref} from "vue";

import {useCanonText} from "../../text";
import type {EntryTab} from "./entry-tabs";

const props = withDefaults(defineProps<{
    items: readonly EntryTab[];
    modelValue: string;
    /** 有能加的设定组、条目可写：出“添加一组设定”。默认 false。 */
    canAdd?: boolean;
    /** 添加不可用的原因；默认空。 */
    addReason?: string;
    /** 分页项的 id 与内容面板的 id（`aria-controls`）。 */
    tabId: (value: string) => string;
    panelId: string;
    /** 有几种看法可换（输出 9、54）：带 `looks` 的行留箭头格，选中的那一行再点发 `menu`。默认 false。 */
    menus?: boolean;
    /** 看法菜单开着（归宿主 `EntryPage`）：选中那一行的箭头转半圈、`aria-expanded`。默认 false。 */
    menuOpen?: boolean;
    /** 选中那一行的附注（不在缺省看法时写看法名）；默认空。 */
    note?: string;
}>(), {canAdd: false, addReason: "", menus: false, menuOpen: false, note: ""});

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
    /** 点了“添加一组设定”：宿主开“添加设定组”的对话框。 */
    (event: "add-toggle"): void;
    /** 在一页上右键：宿主给这一页的菜单。 */
    (event: "context", value: string, at: {readonly x: number; readonly y: number}): void;
    /** 选中的、能换看法的那一行再被点（含 Enter、Space 触发的点击）：宿主把看法菜单贴着这一行开或关。 */
    (event: "menu", value: string, row: HTMLElement): void;
}>();

const text = useCanonText();
const hasMenu = (item: EntryTab): boolean => props.menus && item.looks === true;
const selected = (item: EntryTab): boolean => item.value === props.modelValue;
/** 第一次点是选中，选中以后再点才是看法菜单（同横排 `Tabs` 的 `menu`）。 */
const pick = (item: EntryTab, event: MouseEvent): void => {
    if (selected(item) && hasMenu(item)) emit("menu", item.value, event.currentTarget as HTMLElement);
    else emit("update:modelValue", item.value);
};
/** 看法一段的第一页，前面有设定组或文字时在它上面画分隔（不另放元素：列表里只有分页，增减的过渡按分页算）。 */
const segmentStart = computed(() => {
    const at = props.items.findIndex((item) => item.segment === "view");
    return at > 0 ? props.items[at]!.value : null;
});

// 方向键在全部分页之间移动并选中（与横排的 Tabs 相同：自动激活、两端绕回）。
const list = ref<HTMLElement | null>(null);
const move = async (step: number | "first" | "last"): Promise<void> => {
    const all = props.items;
    if (all.length === 0) return;
    const at = all.findIndex((item) => item.value === props.modelValue);
    const next = step === "first" ? 0 : step === "last" ? all.length - 1 : (Math.max(at, 0) + step + all.length) % all.length;
    emit("update:modelValue", all[next]!.value);
    await nextTick();
    list.value?.querySelector<HTMLElement>(`[data-tab-value="${CSS.escape(all[next]!.value)}"]`)?.focus();
};
// 去掉的一页脱离排布、钉在原处淡出，后面的行才有位移可补（`entry-page-nav-row-move`）。
const pinLeaving = (element: Element): void => {
    const row = element as HTMLElement;
    row.style.top = `${String(row.offsetTop)}px`;
    row.style.left = `${String(row.offsetLeft)}px`;
    row.style.width = `${String(row.offsetWidth)}px`;
    row.style.position = "absolute";
};
const onKey = (event: KeyboardEvent): void => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "Home" ? "first" : event.key === "End" ? "last" : null;
    if (step === null) return;
    event.preventDefault();
    void move(step);
};
</script>

<template>
    <nav class="entry-page-nav" data-entry-page-nav>
        <div ref="list" role="tablist" aria-orientation="vertical" :aria-label="text('entry.tabs.label')" @keydown="onKey">
            <TransitionGroup name="entry-page-nav-row" @before-leave="pinLeaving">
                <button
                    v-for="item in props.items"
                    :id="props.tabId(item.value)"
                    :key="item.value"
                    type="button"
                    role="tab"
                    class="entry-page-nav__item"
                    :data-segment-start="item.value === segmentStart ? '' : undefined"
                    :aria-selected="item.value === props.modelValue ? 'true' : 'false'"
                    :aria-controls="props.panelId"
                    :tabindex="item.value === props.modelValue ? 0 : -1"
                    :data-tab-value="item.value"
                    :aria-haspopup="selected(item) && hasMenu(item) ? 'menu' : undefined"
                    :aria-expanded="selected(item) && hasMenu(item) ? props.menuOpen : undefined"
                    @click="(event: MouseEvent) => pick(item, event)"
                    @contextmenu.prevent="(event: MouseEvent) => emit('context', item.value, {x: event.clientX, y: event.clientY})"
                >
                    <span :class="item.iconClass" class="entry-page-nav__icon" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                    <!-- 看法名不进标题：标题先截，看法名留着（它在的唯一理由就是告诉作者这一页不在缺省的看法）。 -->
                    <Transition name="entry-page-nav-note"><span v-if="hasMenu(item) && selected(item) && props.note !== ''" class="entry-page-nav__note"><span class="entry-page-nav__note-text"><span class="sr-only">，</span>{{ props.note }}</span></span></Transition>
                    <span v-if="item.count !== undefined" class="entry-page-nav__count">{{ item.count }}</span>
                    <span v-if="hasMenu(item)" class="entry-page-nav__menu i-lucide-chevron-down" :data-shown="selected(item) ? '' : undefined" :data-open="selected(item) && props.menuOpen ? '' : undefined" aria-hidden="true" />
                </button>
            </TransitionGroup>
        </div>
        <button
            v-if="props.canAdd"
            type="button"
            class="entry-page-nav__item entry-page-nav__add"
            :disabled="props.addReason !== ''"
            :title="props.addReason !== '' ? props.addReason : undefined"
            aria-haspopup="dialog"
            data-add-component
            @click="emit('add-toggle')"
        >
            <span class="i-lucide-plus entry-page-nav__icon" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ text("entry.addComponentShort") }}</span>
        </button>
    </nav>
</template>

<style scoped>
.entry-page-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.entry-page-nav [role="tablist"] {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.entry-page-nav__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 2rem;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.entry-page-nav__item:hover:not(:disabled) {
    background: var(--bg-hover);
}
.entry-page-nav__item[aria-selected="true"] {
    background: var(--overlay-item-active);
    color: var(--text-main);
    font-weight: 500;
}
.entry-page-nav__item:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: -2px;
}
.entry-page-nav__icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
}
.entry-page-nav__item[aria-selected="true"] .entry-page-nav__icon {
    color: var(--accent-main);
}
.entry-page-nav__count {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}
.entry-page-nav__add {
    color: var(--text-muted);
}
/* 看法名：出现时宽度从 0 过渡到字宽（grid 0fr 到 1fr），消失时反过来，同横排 `Tabs` 的附注。不收缩，标题先截。与标题的间隔
   在它自己的内边距里（抵掉行的 gap），收着时一起收掉。 */
.entry-page-nav__note {
    display: inline-grid;
    flex-shrink: 0;
    grid-template-columns: 1fr;
    margin-left: -8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 400;
}
.entry-page-nav-note-enter-active,
.entry-page-nav-note-leave-active {
    transition: grid-template-columns var(--motion-base) var(--ease-layout), opacity var(--motion-base) var(--ease-layout);
}
.entry-page-nav-note-enter-from,
.entry-page-nav-note-leave-to {
    grid-template-columns: 0fr;
    opacity: 0;
}
.entry-page-nav__note-text {
    min-width: 0;
    overflow: hidden;
    padding-left: 8px;
    white-space: nowrap;
}
/* 看法菜单的箭头：能换看法的行总留这一格，选中时显出，菜单开着时转半圈。 */
.entry-page-nav__menu {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout), transform var(--motion-fast) var(--ease-layout);
}
.entry-page-nav__menu[data-shown] {
    opacity: 0.7;
}
.entry-page-nav__menu[data-open] {
    transform: rotate(180deg);
}
/* 两段之间的分隔画在看法的第一页上面。 */
.entry-page-nav__item[data-segment-start] {
    position: relative;
    margin-top: 17px;
}
.entry-page-nav__item[data-segment-start]::before {
    content: "";
    position: absolute;
    top: -10px;
    right: 2px;
    left: 2px;
    height: 1px;
    background: var(--divider);
}
/* 分页增减：新的一页淡入，去掉的淡出，其余的滑到新位置。 */
.entry-page-nav-row-enter-active,
.entry-page-nav-row-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}
.entry-page-nav-row-enter-from,
.entry-page-nav-row-leave-to {
    opacity: 0;
}
.entry-page-nav-row-move {
    transition: transform var(--motion-move) var(--ease-layout);
}
@media (prefers-reduced-motion: reduce) {
    .entry-page-nav-row-enter-active,
    .entry-page-nav-row-leave-active,
    .entry-page-nav-row-move {
        transition: none;
    }
}
</style>

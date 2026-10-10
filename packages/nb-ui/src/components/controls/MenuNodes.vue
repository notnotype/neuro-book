<script setup lang="ts" generic="T extends {label?: string; title?: string; disabled?: boolean; separator?: boolean; iconClass?: string; shortcut?: string; tone?: 'default' | 'danger'; checked?: boolean; type?: string}">
import type {Component} from "vue";

/**
 * 一级菜单的条目，Dropdown、Menubar 与右键菜单共用。
 *
 * 在 reka 的菜单内容里，宿主传入对应的菜单项原语（`DropdownMenuItem`、`MenubarItem`）：条目成为 reka 集合里的项，
 * 上下键、Home、End、首字母跳转、高亮与跳过禁用项都由 reka 负责。手工级联面板与右键菜单不在 reka 的菜单内容里
 * （注入不到菜单上下文），不传原语，渲染为普通按钮，键盘由宿主自己处理。
 */
const props = defineProps<{
    items: readonly T[];
    active?: T | null;
    itemClass?: (item: T) => string | (string | Record<string, boolean>)[];
    /** reka 的菜单项原语；只在 reka 的菜单内容里传。 */
    itemComponent?: Component;
}>();

const emit = defineEmits<{
    (e: "select", item: T): void;
    (e: "hover", item: T | null, trigger: HTMLElement, immediate: boolean): void;
}>();

const DEFAULT_ITEM_CLASS = "nb-ui-popover-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40";

function hasChildren(item: T): boolean {
    return "children" in item && Array.isArray(item.children) && item.children.length > 0;
}
function role(item: T): string {
    if (item.type === "radio") return "menuitemradio";
    if (item.type === "checkbox") return "menuitemcheckbox";
    return "menuitem";
}
function onKeydown(item: T, event: KeyboardEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!hasChildren(item) || event.key !== "ArrowRight" || !target || !("getBoundingClientRect" in target)) return;
    event.preventDefault();
    target.setAttribute("aria-expanded", "true");
    emit("hover", item, target, true);
}
/** reka 的选择（点击、Enter、空格）：级联父项阻止默认的关闭，改为展开下一级。 */
function onRekaSelect(item: T, event: Event): void {
    if (hasChildren(item)) {
        event.preventDefault();
        emit("hover", item, event.currentTarget as HTMLElement, true);
        return;
    }
    emit("select", item);
}
function onButtonClick(item: T, event: MouseEvent): void {
    if (hasChildren(item)) emit("hover", item, event.currentTarget as HTMLElement, true);
    else emit("select", item);
}
/** 两种形态共用的属性：语义、勾选、级联、说明（禁用原因经 `title` 给出，也作读屏的描述）。 */
function common(item: T): Record<string, unknown> {
    return {
        "role": role(item),
        "aria-checked": item.type === "radio" || item.type === "checkbox" ? item.checked === true : undefined,
        "aria-haspopup": hasChildren(item) ? "menu" : undefined,
        "aria-expanded": hasChildren(item) ? props.active === item : undefined,
        "title": item.title,
        "aria-description": item.title,
        "class": props.itemClass?.(item) ?? DEFAULT_ITEM_CLASS,
    };
}
</script>

<template>
    <template v-for="(item, index) in items" :key="index">
        <div v-if="item.separator" role="separator" class="my-1 h-px bg-[var(--divider)]"></div>
        <component
            :is="itemComponent"
            v-else-if="itemComponent"
            v-bind="common(item)"
            :disabled="item.disabled"
            :text-value="item.label"
            @select="onRekaSelect(item, $event)"
            @pointerenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @mouseenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @keydown="onKeydown(item, $event)"
        >
            <span class="inline-flex min-w-0 items-center gap-2">
                <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0']"></span>
                <slot name="item" :item="item"><span class="truncate" :class="item.tone === 'danger' ? 'text-[var(--status-danger)]' : ''">{{ item.label }}</span></slot>
            </span>
            <span v-if="hasChildren(item)" class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0"></span>
            <span v-else-if="item.checked" class="i-lucide-check h-3.5 w-3.5 shrink-0"></span>
            <slot v-else name="item-right" :item="item"><span v-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)]">{{ item.shortcut }}</span></slot>
        </component>
        <button
            v-else
            type="button"
            v-bind="common(item)"
            :disabled="item.disabled"
            @pointerenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @mouseenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @click="onButtonClick(item, $event)"
            @keydown="onKeydown(item, $event)"
        >
            <span class="inline-flex min-w-0 items-center gap-2">
                <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0']"></span>
                <slot name="item" :item="item"><span class="truncate" :class="item.tone === 'danger' ? 'text-[var(--status-danger)]' : ''">{{ item.label }}</span></slot>
            </span>
            <span v-if="hasChildren(item)" class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0"></span>
            <span v-else-if="item.checked" class="i-lucide-check h-3.5 w-3.5 shrink-0"></span>
            <slot v-else name="item-right" :item="item"><span v-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)]">{{ item.shortcut }}</span></slot>
        </button>
    </template>
</template>

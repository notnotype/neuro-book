<script setup lang="ts" generic="T extends {label?: string; disabled?: boolean; separator?: boolean; iconClass?: string; shortcut?: string; tone?: 'default' | 'danger'; checked?: boolean; type?: string}">
defineProps<{
    items: readonly T[];
    active?: T | null;
    itemClass?: (item: T) => string | (string | Record<string, boolean>)[];
}>();

const emit = defineEmits<{
    (e: "select", item: T): void;
    (e: "hover", item: T | null, trigger: HTMLElement, immediate: boolean): void;
}>();

function hasChildren(item: T): boolean {

    return "children" in item && Array.isArray(item.children) && item.children.length > 0;
}
function role(item: T): string {
    if (item.type === "radio") return "menuitemradio";
    if (item.type === "checkbox") return "menuitemcheckbox";
    return "menuitem";
}
function onKeydown(item: T, event: KeyboardEvent): void {
    if (!hasChildren(item) || event.key !== "ArrowRight" || !event.currentTarget || !("getBoundingClientRect" in event.currentTarget)) return;
    event.preventDefault();
    event.currentTarget.setAttribute("aria-expanded", "true");
    emit("hover", item, event.currentTarget, true);
}
</script>

<template>
    <template v-for="(item, index) in items" :key="index">
        <div v-if="item.separator" role="separator" class="my-1 h-px bg-[var(--divider)]"></div>
        <button
            v-else
            type="button"
            :role="role(item)"
            :aria-checked="item.type === 'radio' || item.type === 'checkbox' ? item.checked === true : undefined"
            :aria-haspopup="hasChildren(item) ? 'menu' : undefined"
            :aria-expanded="hasChildren(item) ? active === item : undefined"
            :disabled="item.disabled"
            :class="itemClass?.(item) ?? 'nb-ui-popover-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40'"
            @pointerenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @mouseenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @click="hasChildren(item) ? emit('hover', item, $event.currentTarget as HTMLElement, true) : emit('select', item)"
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

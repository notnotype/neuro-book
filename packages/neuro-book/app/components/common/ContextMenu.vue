<template>
    <Teleport v-if="isMounted" :to="THEME_HOST_SELECTOR">
        <Transition name="fade">
            <div
                v-if="visible"
                ref="menuRef"
                class="fixed z-[9100] min-w-[170px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 text-[var(--text-main)] shadow-xl"
                :style="{top: `${adjustedY}px`, left: `${adjustedX}px`}"
                @click.stop
                @contextmenu.prevent
            >
                <template v-for="(item, index) in items" :key="index">
                    <div v-if="item.separator" class="mx-1 my-1 h-px bg-[var(--border-color)]/50" @mouseenter="activeSubmenuIndex = null"></div>
                    <button
                        v-else
                        :ref="(element) => setItemRef(index, element)"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                        :class="[
                            item.danger ? 'hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] disabled:hover:bg-transparent disabled:hover:text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)]',
                            activeSubmenuIndex === index ? item.danger ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'bg-[var(--bg-hover)]' : '',
                        ]"
                        :disabled="item.disabled"
                        @mouseenter="openSubmenu(index, item)"
                        @focus="openSubmenu(index, item)"
                        @click="handleItemClick(item)"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0"></span>
                        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                        <span v-if="item.shortcut" class="ml-4 shrink-0 text-[11px] text-[var(--text-muted)]">{{ item.shortcut }}</span>
                        <span v-if="item.children?.length" class="i-lucide-chevron-right ml-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    </button>
                    <div
                        v-if="item.children?.length && activeSubmenuIndex === index"
                        :ref="setSubmenuRef"
                        class="fixed z-[9101] min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 text-[var(--text-main)] shadow-xl"
                        :style="{top: `${submenuTop}px`, left: `${submenuLeft}px`}"
                    >
                        <template v-for="(child, childIndex) in item.children" :key="childIndex">
                            <div v-if="child.separator" class="mx-1 my-1 h-px bg-[var(--border-color)]/50"></div>
                            <button
                                v-else
                                type="button"
                                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                                :class="child.danger ? 'hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] disabled:hover:bg-transparent disabled:hover:text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)]'"
                                :disabled="child.disabled"
                                @click="handleItemClick(child)"
                            >
                                <span v-if="child.iconClass" :class="child.iconClass" class="h-4 w-4 shrink-0"></span>
                                <span class="min-w-0 flex-1 truncate">{{ child.label }}</span>
                                <span v-if="child.shortcut" class="ml-4 shrink-0 text-[11px] text-[var(--text-muted)]">{{ child.shortcut }}</span>
                            </button>
                        </template>
                    </div>
                </template>
            </div>
        </Transition>
    </Teleport>
</template>

<script lang="ts">
export interface ContextMenuItem {
    label?: string;
    iconClass?: string;
    shortcut?: string;
    action?: () => void;
    children?: ContextMenuItem[];
    disabled?: boolean;
    danger?: boolean;
    separator?: boolean;
}
</script>

<script setup lang="ts">
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";
import type {ComponentPublicInstance} from "vue";

const props = defineProps<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const submenuRef = ref<HTMLElement | null>(null);
const itemRefs = ref<Record<number, HTMLElement>>({});
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);
const submenuLeft = ref(0);
const submenuTop = ref(0);
const activeSubmenuIndex = ref<number | null>(null);
const isMounted = ref(false);
const VIEWPORT_PADDING = 8;
const SUBMENU_OVERLAP = 1;

/**
 * 执行菜单动作并关闭菜单。
 */
const handleItemClick = (item: ContextMenuItem): void => {
    if (item.disabled) {
        return;
    }
    if (item.children?.length) {
        return;
    }
    item.action?.();
    emit("close");
};

/**
 * 记录菜单项元素，用于计算子菜单位置。
 */
const setItemRef = (index: number, element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLElement) {
        itemRefs.value[index] = element;
        return;
    }
    delete itemRefs.value[index];
};

/**
 * 记录当前展开的子菜单元素。
 */
const setSubmenuRef = (element: Element | ComponentPublicInstance | null): void => {
    submenuRef.value = element instanceof HTMLElement ? element : null;
};

/**
 * 展开子菜单。
 */
const openSubmenu = (index: number, item: ContextMenuItem): void => {
    if (item.disabled || !item.children?.length) {
        activeSubmenuIndex.value = null;
        return;
    }

    activeSubmenuIndex.value = index;
};

/**
 * 根据视口边界修正子菜单位置。
 */
const adjustSubmenuPosition = async (): Promise<void> => {
    await nextTick();
    if (activeSubmenuIndex.value === null || !menuRef.value || !submenuRef.value) {
        return;
    }

    const itemElement = itemRefs.value[activeSubmenuIndex.value];
    if (!itemElement) {
        return;
    }

    const itemRect = itemElement.getBoundingClientRect();
    const submenuRect = submenuRef.value.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    let nextLeft = itemRect.right - SUBMENU_OVERLAP;
    let nextTop = itemRect.top - 4;
    if (nextLeft + submenuRect.width > winWidth - VIEWPORT_PADDING) {
        nextLeft = itemRect.left - submenuRect.width + SUBMENU_OVERLAP;
    }
    if (nextTop + submenuRect.height > winHeight - VIEWPORT_PADDING) {
        nextTop = winHeight - submenuRect.height - VIEWPORT_PADDING;
    }

    submenuLeft.value = Math.max(VIEWPORT_PADDING, nextLeft);
    submenuTop.value = Math.max(VIEWPORT_PADDING, nextTop);
};

/**
 * 点击或右键到菜单外部时关闭菜单。
 */
const closeMenu = (event: MouseEvent): void => {
    if (menuRef.value?.contains(event.target as Node)) {
        return;
    }
    emit("close");
};

onMounted(() => {
    isMounted.value = true;
    document.addEventListener("click", closeMenu, true);
    document.addEventListener("contextmenu", closeMenu, true);
});

onUnmounted(() => {
    document.removeEventListener("click", closeMenu, true);
    document.removeEventListener("contextmenu", closeMenu, true);
});

watch(() => [props.visible, props.x, props.y], async ([visible, x, y]) => {
    if (!visible) {
        activeSubmenuIndex.value = null;
        return;
    }

    activeSubmenuIndex.value = null;
    adjustedX.value = x as number;
    adjustedY.value = y as number;
    await nextTick();

    if (!menuRef.value) {
        return;
    }

    const rect = menuRef.value.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    if ((x as number) + rect.width > winWidth) {
        adjustedX.value = Math.max(8, winWidth - rect.width - 8);
    }
    if ((y as number) + rect.height > winHeight) {
        adjustedY.value = Math.max(8, winHeight - rect.height - 8);
    }
});

watch(activeSubmenuIndex, () => {
    void adjustSubmenuPosition();
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: scale(0.96);
}
</style>

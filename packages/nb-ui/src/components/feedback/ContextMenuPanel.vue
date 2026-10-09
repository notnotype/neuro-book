<script setup lang="ts">
import {nextTick, ref, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useMenuCascade} from "../../composables/useMenuCascade";
import MenuNodes from "../controls/MenuNodes.vue";
import type {ContextMenuItem} from "./context-menu.types";

const props = defineProps<{
    items: ContextMenuItem[];
    depth: number;
}>();

const emit = defineEmits<{
    (e: "select"): void;
}>();

const cascade = useMenuCascade<ContextMenuItem>();

function selectItem(item: ContextMenuItem): void {
    if (item.disabled || item.children?.length) return;
    item.action?.();
    emit("select");
}
const root = ref<HTMLElement | null>(null);
/** 键盘展开了子菜单：它出现后把焦点放到它的第一项。 */
let focusNewLevel = false;

/** 一级菜单里可用的项，按显示顺序。 */
function itemsIn(container: Element | null): HTMLElement[] {
    return container === null ? [] : [...container.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([disabled])")];
}

function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const container = target.closest(".nb-menu-level-content");
    const items = itemsIn(container);
    const index = items.indexOf(target);
    if (index < 0) return;
    const move = (next: HTMLElement | undefined): void => {
        event.preventDefault();
        next?.focus();
    };
    switch (event.key) {
        case "ArrowDown":
            move(items[(index + 1) % items.length]);
            return;
        case "ArrowUp":
            move(items[(index - 1 + items.length) % items.length]);
            return;
        case "Home":
            move(items[0]);
            return;
        case "End":
            move(items[items.length - 1]);
            return;
        case "ArrowRight":
            if (target.getAttribute("aria-haspopup") === "menu") focusNewLevel = true;
            return;
        case "ArrowLeft": {
            // 在子菜单里：收起这一级，焦点回到展开它的那一项。
            const level = container?.closest<HTMLElement>("[data-menu-level]");
            if (level === null || level === undefined) return;
            const depth = Number(level.dataset.menuLevel);
            const parent = depth === 0 ? root.value?.querySelector(".nb-menu-level-content") : root.value?.querySelector(`[data-menu-level="${String(depth - 1)}"] .nb-menu-level-content`);
            const trigger = parent?.querySelector<HTMLElement>(":scope > [aria-expanded='true']") ?? null;
            event.preventDefault();
            if (trigger !== null) cascade.schedule(null, trigger, depth, true, false);
            trigger?.focus();
            return;
        }
    }
}

watch(() => cascade.levels.value.length, async (length, previous) => {
    if (!focusNewLevel || length <= (previous ?? 0)) return;
    focusNewLevel = false;
    await nextTick();
    itemsIn(root.value?.querySelector(`[data-menu-level="${String(length - 1)}"] .nb-menu-level-content`) ?? null)[0]?.focus();
});

function itemClass(item: ContextMenuItem): string {
    const base = "nb-ui-popover-item flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-45";
    return item.tone === "danger" ? `${base} nb-ui-menu-item-danger` : base;
}
</script>

<template>
    <div
        ref="root"
        data-menu-panel
        :data-menu-depth="props.depth"
        role="menu"
        class="nb-ui-popover-surface nb-ui-menu-surface fixed min-w-[170px] p-1.5 text-[var(--text-main)]"
        :style="{zIndex: NB_Z_INDEX.contextMenu + props.depth}"
        @click.stop
        @contextmenu.prevent
        @keydown="onKeydown"
    >
        <div class="nb-menu-level-content">
            <MenuNodes
                :items="props.items"
                :active="cascade.levels.value[0]?.value"
                :item-class="itemClass"
                @select="selectItem"
                @hover="(item, trigger, immediate) => cascade.schedule(item, trigger, 0, immediate, Boolean(item?.children?.length))"
            />
        </div>
        <div
            v-for="(level, depth) in cascade.levels.value"
            :key="depth"
            :ref="(element) => cascade.setPanel(depth, element)"
            role="menu"
            :data-menu-level="depth"
            class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level fixed overflow-hidden p-1.5"
            :data-switching="level.switching"
            :style="{...level.style, zIndex: NB_Z_INDEX.contextMenu + props.depth + depth + 1}"
        >
            <div class="nb-menu-level-content">
                <MenuNodes
                    :items="level.value.children ?? []"
                    :active="cascade.levels.value[depth + 1]?.value"
                    :item-class="itemClass"
                    @select="selectItem"
                    @hover="(item, trigger, immediate) => cascade.schedule(item, trigger, depth + 1, immediate, Boolean(item?.children?.length))"
                />
            </div>
        </div>
    </div>
</template>

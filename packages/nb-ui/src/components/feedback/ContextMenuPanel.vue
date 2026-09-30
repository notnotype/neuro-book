<script setup lang="ts">
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
function itemClass(item: ContextMenuItem): string {
    const base = "nb-ui-popover-item flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-45";
    return item.tone === "danger" ? `${base} nb-ui-menu-item-danger` : base;
}
</script>

<template>
    <div
        data-menu-panel
        :data-menu-depth="props.depth"
        role="menu"
        class="nb-ui-popover-surface nb-ui-menu-surface fixed min-w-[170px] p-1.5 text-[var(--text-main)]"
        :style="{zIndex: NB_Z_INDEX.contextMenu + props.depth}"
        @click.stop
        @contextmenu.prevent
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

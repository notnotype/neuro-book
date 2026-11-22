<script setup lang="ts">
import {inject} from "vue";

import {useBook, type Tab} from "../host/book";
import {NAME_MENU} from "../host/name-menu";

/** 人名：点开人物卡，不离开当前页（viewer 输出 20）；Ctrl（macOS 上 ⌘）点与右键“在旁边打开”开在另一半（输出 67）。 */
const props = withDefaults(defineProps<{id: string; label: string; tab?: Tab; strong?: boolean}>(), {tab: "summary", strong: false});
const book = useBook();
const menu = inject(NAME_MENU, null);

function onClick(event: MouseEvent): void {
    // macOS 上 Ctrl 点是右键，到不了这里，⌘ 点走这条。在旁边打开不传页签：另一张里已开着的人只激活，不改它的页签。
    if (event.ctrlKey || event.metaKey) book.openBeside({kind: "card", entity: props.id});
    else book.openCard(props.id, props.tab);
}
function onContextMenu(event: MouseEvent): void {
    if (menu?.open({x: event.clientX, y: event.clientY}, {kind: "card", entity: props.id}) === true) event.preventDefault();
}
</script>

<template>
    <button type="button" class="name-link" :class="strong ? 'is-strong' : ''" @click.stop="onClick" @contextmenu.stop="onContextMenu">{{ label }}</button>
</template>

<style scoped>
.name-link {
    display: inline;
    text-align: inherit;
    color: inherit;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    padding: 0 2px;
}
.name-link:hover {
    background: color-mix(in srgb, var(--accent-main) 24%, transparent);
}
.name-link.is-strong {
    font-weight: var(--weight-strong);
}
</style>

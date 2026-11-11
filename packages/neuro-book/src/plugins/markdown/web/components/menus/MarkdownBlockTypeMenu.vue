<script setup lang="ts">
/** 块类型下拉（同名 .md）：工具栏与选区菜单共用。 */
import {DropdownMenu} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {blockMenuItems, currentBlock} from "./block-menu";

const props = defineProps<{editing: EditorEditing; menus: EditorMenus; readonly: boolean; inSelectionMenu?: boolean}>();
const emit = defineEmits<{(event: "refocus"): void}>();

const items = computed(() => blockMenuItems(props.editing, props.menus, props.readonly));
const current = computed(() => currentBlock(props.editing));

/**
 * 原语在关闭动画之后把焦点还给触发按钮：选了一项时要留在正文，不能让它抢走用户接着点进正文的焦点。没选（Esc、点外面）时
 * 按原语的规则。
 */
let selected = false;
const contentProps = computed(() => ({
    ...(props.inSelectionMenu === true ? {"data-markdown-menu-layer": ""} : {}),
    onCloseAutoFocus: (event: Event): void => {
        if (!selected) return;
        selected = false;
        event.preventDefault();
        emit("refocus");
    },
}));

function onSelect(id: string): void {
    selected = true;
    props.menus.run(id as EditingActionId);
}
</script>

<template>
    <DropdownMenu :items="items" :content-props="contentProps" @select="onSelect">
        <button type="button" class="markdown-block-type nb-ui-focus-ring" :disabled="props.readonly" :title="props.menus.label('blockType')" :aria-label="`${props.menus.label('blockType')}：${props.menus.title(current)}`">
            <span class="truncate">{{ props.menus.title(current) }}</span>
            <span class="i-lucide-chevron-down h-3 w-3 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        </button>
    </DropdownMenu>
</template>

<style scoped>
.markdown-block-type {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    width: 76px;
    height: 26px;
    padding-inline: 8px;
    border-radius: var(--radius-control);
    color: var(--text-main);
    font-size: var(--text-sm);
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.markdown-block-type:not(:disabled):hover {
    background: var(--bg-hover);
}

.markdown-block-type:disabled {
    cursor: not-allowed;
    opacity: 0.4;
}
</style>

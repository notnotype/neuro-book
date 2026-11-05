<script setup lang="ts">
/** 文字颜色或高亮的按钮：点了开色板（同名 .md）。工具栏与选区菜单共用。 */
import {ColorSwatches, IconButton, Popover} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {EDITING_ACTIONS} from "nbook/plugins/editor/shared/contracts";
import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {HIGHLIGHT_COLORS, TEXT_COLORS} from "./palette";

const props = defineProps<{action: "text-color" | "highlight"; editing: EditorEditing; menus: EditorMenus; readonly: boolean}>();

const open = ref(false);
const colors = computed(() => (props.action === "text-color" ? TEXT_COLORS : HIGHLIGHT_COLORS).map((color) => color.value));

function pick(color: string | null): void {
    props.menus.run(props.action, {color});
    open.value = false;
}
</script>

<template>
    <Popover :open="open" side="bottom" @update:open="(next: boolean) => { open = next; }">
        <template #trigger>
            <IconButton
                size="sm"
                :title="props.menus.title(props.action)"
                :aria-label="props.menus.title(props.action)"
                :icon-class="EDITING_ACTIONS[props.action].icon"
                :disabled="props.readonly || !props.editing.enabled(props.action)"
            />
        </template>
        <div class="p-2" data-markdown-menu-layer>
            <ColorSwatches
                :model-value="null"
                :colors="colors"
                :auto-label="props.menus.label('colorNone')"
                :columns="5"
                size="sm"
                :label="props.menus.title(props.action)"
                @update:model-value="pick"
            />
        </div>
    </Popover>
</template>

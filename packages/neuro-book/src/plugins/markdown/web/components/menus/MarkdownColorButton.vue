<script setup lang="ts">
/** 文字颜色或高亮的拆分按钮（同名 .md）：左半边用上次的颜色，箭头开色板。工具栏与选区菜单共用。 */
import {ColorSwatches, IconButton, Popover} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {EDITING_ACTIONS} from "nbook/plugins/editor/shared/contracts";
import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {useMarkdownColors} from "../../colors";
import {HIGHLIGHT_COLORS, TEXT_COLORS} from "./palette";

/** `inSelectionMenu`：放在选区菜单里；色板开着时选区菜单留着（它按 `data-markdown-menu-layer` 认自己的浮层）。 */
const props = defineProps<{action: "text-color" | "highlight"; editing: EditorEditing; menus: EditorMenus; readonly: boolean; inSelectionMenu?: boolean}>();

const remembered = useMarkdownColors();
const open = ref(false);
const colors = computed(() => (props.action === "text-color" ? TEXT_COLORS : HIGHLIGHT_COLORS).map((color) => color.value));
const last = computed(() => remembered.last(props.action));
const disabled = computed(() => props.readonly || !props.editing.enabled(props.action));
const pickLabel = computed(() => props.menus.label(props.action === "text-color" ? "pickTextColor" : "pickHighlight"));

function pick(color: string | null): void {
    props.menus.run(props.action, {color});
    if (color !== null) remembered.remember(props.action, color);
    open.value = false;
}
</script>

<template>
    <span class="markdown-color-button">
        <span class="markdown-color-button__main">
            <IconButton
                size="sm"
                :title="props.menus.title(props.action)"
                :aria-label="props.menus.title(props.action)"
                :icon-class="EDITING_ACTIONS[props.action].icon"
                :disabled="disabled"
                @click="props.menus.run(props.action, {color: last})"
            />
            <span class="markdown-color-button__bar" :class="{'markdown-color-button__bar--light': props.action === 'highlight', 'markdown-color-button__bar--disabled': disabled}" :style="{background: last}" data-markdown-color-bar aria-hidden="true" />
        </span>
        <Popover :open="open" side="bottom" @update:open="(next: boolean) => { open = next; }">
            <template #trigger>
                <button type="button" class="markdown-color-button__arrow nb-ui-focus-ring" :title="pickLabel" :aria-label="pickLabel" :disabled="disabled">
                    <span class="i-lucide-chevron-down h-3 w-3" aria-hidden="true" />
                </button>
            </template>
            <div class="p-2" v-bind="props.inSelectionMenu === true ? {'data-markdown-menu-layer': ''} : {}">
                <ColorSwatches
                    :model-value="last"
                    :colors="colors"
                    :auto-label="props.menus.label('colorNone')"
                    :columns="5"
                    size="sm"
                    :label="props.menus.title(props.action)"
                    @pick="pick"
                />
            </div>
        </Popover>
    </span>
</template>

<style scoped>
.markdown-color-button {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
}

.markdown-color-button__main {
    position: relative;
    display: inline-flex;
}

/* 色条盖在图标的底线上：点左半边用的就是这个颜色。 */
.markdown-color-button__bar {
    position: absolute;
    right: 6px;
    bottom: 4px;
    left: 6px;
    height: 3px;
    border-radius: 1px;
    pointer-events: none;
}

.markdown-color-button__bar--light {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-main) 18%, transparent);
}

.markdown-color-button__bar--disabled {
    opacity: 0.4;
}

.markdown-color-button__arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 26px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

/* 与旁边的 `IconButton`（default）同一组状态色：两半看起来是一个按钮的两部分。 */
.markdown-color-button__arrow:not(:disabled):hover {
    background: color-mix(in srgb, var(--text-main) 15%, transparent);
    color: var(--text-main);
}

.markdown-color-button__arrow:not(:disabled):active {
    background: color-mix(in srgb, var(--text-main) 24%, transparent);
}

.markdown-color-button__arrow:disabled {
    cursor: not-allowed;
    opacity: 0.4;
}
</style>

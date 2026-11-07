<script setup lang="ts">
/**
 * 单选色板（同名 .md）：一组色块，可带“自动”（值为 null）与“自定义”（旁边打开取色面板）。
 * 底座是 reka 的 ColorSwatchPicker（Listbox 语义）。“自动”“自定义”不是颜色，用哨兵值占位：reka 只在取英文颜色名时
 * 尝试解析它们，解析失败就退回原值，可访问名称由这里覆盖。
 * 选择从每个色块的 `select` 事件取，不听根上的 `update:modelValue`：受控时 reka 的根会把一次选择发两遍。
 */
import {ColorSwatchPickerItem, ColorSwatchPickerRoot, injectListboxRootContext, PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot} from "reka-ui";
import {computed, defineComponent, onBeforeUnmount, ref, watchEffect} from "vue";

import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {useUiText} from "../../text-port";
import Tooltip from "../feedback/Tooltip.vue";
import ColorPickerPanel from "./ColorPickerPanel.vue";
import type {ControlSize} from "../shared-types";

export type ColorSwatchesSize = Extract<ControlSize, "sm" | "md">;

const props = withDefaults(defineProps<{
    modelValue: string | null;
    colors: ReadonlyArray<string>;
    autoLabel?: string;
    autoColor?: string;
    customLabel?: string;
    columns?: number;
    size?: ColorSwatchesSize;
    disabled?: boolean;
    label?: string;
}>(), {
    autoLabel: "",
    autoColor: "",
    customLabel: "",
    columns: 0,
    size: "md",
    disabled: false,
});

const text = useUiText();
const labelText = computed(() => props.label ?? text("colorSwatches.label"));

const emit = defineEmits<{
    (event: "update:modelValue", value: string | null): void;
}>();

const AUTO = "auto";
const CUSTOM = "custom";

// 取色面板与下拉选择同一种浮层面：材质来自外框的两个类，这里只绑层级；内边距按面板自己的。
const popoverStyle = {zIndex: usePopoverLayer().zIndex};

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const listed = (value: string): string | undefined => props.colors.find((color) => same(color, value));

/** 当前值不在色板里时就是自定义色，“自定义”色块显示它。 */
const customColor = computed(() => (props.modelValue !== null && listed(props.modelValue) === undefined ? props.modelValue : null));
const selected = computed(() => {
    if (props.modelValue === null) return props.autoLabel !== "" ? AUTO : "";
    return listed(props.modelValue) ?? (props.customLabel !== "" ? CUSTOM : "");
});
const customOpen = ref(false);

/** 选中一个色块；与当前值相同时不发（再点已选的色块不算一次修改）。 */
function choose(value: string | null): void {
    if (props.disabled) return;
    const unchanged = value === null ? props.modelValue === null : props.modelValue !== null && same(props.modelValue, value);
    if (!unchanged) emit("update:modelValue", value);
}

/** 选中“自定义”不改值，改为在旁边打开取色面板，值由面板发出。 */
function onCustomSelect(event: Event): void {
    event.preventDefault();
    if (!props.disabled) customOpen.value = true;
}

/*
 * 取色面板开着时，色板（reka 的 Listbox）不许抢焦点。面板第一次改值会让选中项从别的色块变成“自定义”，Listbox 见到
 * 不是在它里面点出来的改动，就把焦点移到选中项上；焦点离开面板，面板随即关掉（拖色相条拖到一半面板没了）。
 * reka 自己的 ListboxFilter 用的也是这个 `focusable` 开关。必须是色板根的后代才拿得到它的上下文，所以是一个子组件。
 */
const HoldListboxFocus = defineComponent({
    props: {hold: {type: Boolean, required: true}},
    setup(holdProps) {
        const listbox = injectListboxRootContext();
        watchEffect(() => {
            listbox.focusable.value = !holdProps.hold;
        });
        onBeforeUnmount(() => {
            listbox.focusable.value = true;
        });
        return () => null;
    },
});

const rootRef = ref<HTMLElement | null>(null);

/** 面板关上时焦点回到“自定义”色块（面板挂在锚点而不是触发器上，reka 不会还焦点）；点到别处关上的不抢回来。 */
function onPanelCloseAutoFocus(event: Event): void {
    event.preventDefault();
    const active = document.activeElement;
    const nobodyTookFocus = active === null || active === document.body || !active.isConnected || active.closest("[data-color-swatches-panel]") !== null;
    if (nobodyTookFocus) rootRef.value?.querySelector<HTMLElement>("[data-color-swatch='custom']")?.focus({preventScroll: true});
}

/** 固定列数时撑满整行：列宽就是色块，多出的宽度均分到列之间（间距至少 --nb-swatch-gap），右边不留一截空。 */
const layout = computed(() => (props.columns > 0 ? {gridTemplateColumns: `repeat(${String(props.columns)}, var(--nb-swatch))`, justifyContent: "space-between"} : undefined));
</script>

<template>
    <!-- 尺寸变量放在自己的这层上：reka 的色板根经 as-child 渲染，带不上本组件的作用域属性，作用域样式落不到它身上。 -->
    <div ref="rootRef" class="nb-swatches" :class="`nb-swatches--${props.size}`" data-color-swatches>
        <ColorSwatchPickerRoot
            :model-value="selected"
            orientation="horizontal"
            selection-behavior="replace"
            :disabled="props.disabled"
            class="outline-none"
            :class="props.columns > 0 ? 'grid' : 'flex flex-wrap'"
            :style="[{gap: 'var(--nb-swatch-gap)'}, layout ?? {}]"
            :aria-label="labelText"
        >
            <Tooltip v-if="props.autoLabel !== ''" :text="props.autoLabel">
                <ColorSwatchPickerItem :value="AUTO" :aria-label="props.autoLabel" class="nb-swatches__item nb-swatches__item--auto" data-color-swatch="auto" @select="choose(null)">
                    <span class="nb-swatches__fill" :style="props.autoColor !== '' ? {background: props.autoColor} : undefined" />
                    <span class="nb-swatches__mark i-lucide-sparkles" aria-hidden="true" />
                </ColorSwatchPickerItem>
            </Tooltip>
            <ColorSwatchPickerItem
                v-for="color in props.colors"
                :key="color"
                :value="color"
                :aria-label="color.toLowerCase()"
                class="nb-swatches__item"
                :data-color-swatch="color.toLowerCase()"
                @select="choose(color)"
            >
                <span class="nb-swatches__fill" :style="{background: color}" />
            </ColorSwatchPickerItem>
            <HoldListboxFocus :hold="customOpen" />
            <PopoverRoot v-if="props.customLabel !== ''" v-model:open="customOpen">
                <PopoverAnchor as-child>
                    <Tooltip :text="props.customLabel" :disabled="customOpen">
                        <ColorSwatchPickerItem
                            :value="CUSTOM"
                            :aria-label="customColor === null ? props.customLabel : `${props.customLabel} ${customColor.toLowerCase()}`"
                            class="nb-swatches__item nb-swatches__item--custom"
                            data-color-swatch="custom"
                            @select="onCustomSelect"
                        >
                            <span v-if="customColor !== null" class="nb-swatches__fill" :style="{background: customColor}" />
                            <span v-else class="nb-swatches__mark nb-swatches__mark--plain i-lucide-pipette" aria-hidden="true" />
                        </ColorSwatchPickerItem>
                    </Tooltip>
                </PopoverAnchor>
                <PopoverPortal>
                    <PopoverContent
                        side="bottom"
                        align="start"
                        :side-offset="6"
                        :style="popoverStyle"
                        class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion [--menu-pad:var(--space-5)] text-[var(--text-main)] outline-none select-none"
                        data-color-swatches-panel
                        @close-auto-focus="onPanelCloseAutoFocus"
                    >
                        <ColorPickerPanel :model-value="customColor ?? props.colors[0] ?? ''" :disabled="props.disabled" @update:model-value="(value: string) => emit('update:modelValue', value)" />
                    </PopoverContent>
                </PopoverPortal>
            </PopoverRoot>
        </ColorSwatchPickerRoot>
    </div>
</template>

<style scoped>
.nb-swatches {
    --nb-swatch: 22px;
    --nb-swatch-gap: 8px;
}

.nb-swatches--sm {
    --nb-swatch: 18px;
    --nb-swatch-gap: 6px;
}

.nb-swatches__item {
    position: relative;
    display: inline-grid;
    width: var(--nb-swatch);
    height: var(--nb-swatch);
    place-items: center;
    border-radius: 999px;
    cursor: pointer;
    outline: none;
    transition: box-shadow var(--motion-fast) var(--ease-layout);
}

.nb-swatches__fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-main) 14%, transparent);
}

/* 自动色块没给颜色、自定义色块还没有颜色时：控件底色加一圈虚线，图标说明它是什么。 */
.nb-swatches__item--auto .nb-swatches__fill:not([style]),
.nb-swatches__item--custom:not(:has(.nb-swatches__fill)) {
    background: var(--control-surface);
    box-shadow: inset 0 0 0 1px var(--control-outline);
}

.nb-swatches__mark {
    position: relative;
    width: 12px;
    height: 12px;
    color: var(--text-inverse);
}

.nb-swatches__mark--plain {
    color: var(--text-muted);
}

.nb-swatches__item[data-state="checked"] {
    box-shadow: 0 0 0 2px var(--bg-panel), 0 0 0 3.5px var(--text-main);
}

.nb-swatches__item:focus-visible {
    box-shadow: 0 0 0 2px var(--bg-panel), var(--focus-ring);
}

.nb-swatches__item[data-state="checked"]:focus-visible {
    box-shadow: 0 0 0 2px var(--bg-panel), 0 0 0 3.5px var(--text-main), var(--focus-ring);
}

.nb-swatches__item[data-disabled] {
    cursor: not-allowed;
    opacity: 0.5;
}
</style>

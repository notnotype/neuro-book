<script setup lang="ts">
/** 一个配色变量的一行（同名 .md）：色块取色器、色值输入、对比度比值与“手改过”标记；改动防抖后交给模型。 */
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {IconButton, Input} from "@notnotype/nb-ui/components";

import {formatColor, parseColor} from "nbook/ui/theme/color";
import type {ContrastCheck} from "nbook/ui/theme/contrast-checks";

import {useWorkbenchText} from "../../text";

defineOptions({name: "ColorField"});

const props = defineProps<{
    /** CSS 变量名。 */
    name: string;
    /** 标题；省略时用变量名（等宽字）。 */
    label?: string;
    value: string;
    check?: ContrastCheck | null;
    touched?: boolean;
    /** 能不能“还原为推导值”（有手改标记时才有意义）。 */
    resettable?: boolean;
    /** 取值不是颜色（例如阴影、`color-scheme`）：只显示文字，不画取色器。 */
    plain?: boolean;
}>();

const emit = defineEmits<{
    (event: "change", value: string): void;
    (event: "reset"): void;
}>();

const text = useWorkbenchText();

/** 输入的本地值：外面的值变了（别处改、换了主题）就跟过来；自己输入时先留在本地，停手后再交出去。 */
const draft = ref(props.value);
watch(() => props.value, (value) => {
    draft.value = value;
});

let timer: ReturnType<typeof setTimeout> | null = null;
const commit = (value: string): void => {
    draft.value = value;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        if (value !== props.value) emit("change", value);
    }, 250);
};
/** 焦点离开这一行时立刻交出还在等的值：输入完马上点“推导整套”，推导读到的必须是刚输入的主色，不是 250ms 前的。 */
const flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    if (draft.value !== props.value) emit("change", draft.value);
};
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
});

/** 取色器只认不透明的 `#rrggbb`；半透明与别的写法只显示色块，改色值用右边的输入。 */
const pickable = computed(() => {
    const color = parseColor(draft.value);
    return color !== null && color.a >= 1 ? formatColor(color) : null;
});

const checkText = computed(() => {
    const check = props.check;
    if (check === undefined || check === null) return null;
    if (check.ratio === null) return {label: "–", title: text("themeEditor.contrast.unknown"), tone: "muted"};
    const ratio = check.ratio.toFixed(2);
    return {
        label: ratio,
        title: `${text("themeEditor.contrast.ratio", {ratio})}${check.ok === false ? `，${text("themeEditor.contrast.low")}` : ""}，${text("themeEditor.contrast.against", {surface: check.against ?? ""})}`,
        tone: check.ok === false ? "bad" : "ok",
    };
});
</script>

<template>
    <div class="color-field" :data-color-field="name" :data-touched="touched === true ? '' : undefined" @focusout="flush">
        <code v-if="label === undefined" class="color-field__name">{{ name }}</code>
        <span v-else class="color-field__name color-field__name--label" :title="name">{{ label }}</span>
        <span v-if="plain !== true" class="color-field__swatch" :style="{background: draft}">
            <input
                v-if="pickable !== null"
                type="color"
                class="color-field__picker"
                :value="pickable"
                :aria-label="`${name} ${text('themeEditor.colors.pick')}`"
                @input="commit(($event.target as HTMLInputElement).value)"
            />
        </span>
        <Input
            class="color-field__input"
            size="sm"
            :model-value="draft"
            :aria-label="`${name} ${text('themeEditor.colors.value')}`"
            @update:model-value="commit($event)"
        />
        <span v-if="checkText !== null" class="color-field__check" :data-tone="checkText.tone" :title="checkText.title" data-color-check>{{ checkText.label }}</span>
        <span v-if="touched === true" class="color-field__touched" :title="text('themeEditor.colors.touched')" aria-hidden="true">●</span>
        <IconButton
            v-if="touched === true && resettable === true"
            size="xs"
            icon-class="i-lucide-rotate-ccw"
            :title="text('themeEditor.colors.reset')"
            @click="emit('reset')"
        />
    </div>
</template>

<style scoped>
.color-field {
    display: grid;
    grid-template-columns: minmax(150px, 190px) 24px minmax(0, 1fr) 44px 12px 24px;
    align-items: center;
    gap: var(--space-3);
    min-height: 32px;
}

.color-field__name {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.color-field__name--label {
    color: var(--text-main);
    font-family: inherit;
    font-size: var(--text-sm);
}

.color-field__swatch {
    position: relative;
    display: block;
    width: 24px;
    height: 24px;
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-control);
    overflow: hidden;
}

.color-field__picker {
    position: absolute;
    inset: -4px;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
}

.color-field__check {
    font-size: var(--text-xs);
    text-align: end;
    font-variant-numeric: tabular-nums;
}

.color-field__check[data-tone="ok"] {
    color: var(--status-success);
}

.color-field__check[data-tone="bad"] {
    color: var(--status-danger);
    font-weight: 600;
}

.color-field__check[data-tone="muted"] {
    color: var(--text-muted);
}

.color-field__touched {
    color: var(--accent-main);
    font-size: 8px;
    text-align: center;
}

/* 窄屏：变量名单独占一行，色值输入才有地方放下完整的色值。 */
@container (max-width: 520px) {
    .color-field {
        grid-template-columns: 24px minmax(0, 1fr) 44px 12px 24px;
        row-gap: var(--space-1);
        padding-block: var(--space-1);
    }

    .color-field__name {
        grid-column: 1 / -1;
    }
}
</style>

<script setup lang="ts">
import type {TextareaHTMLAttributes} from "vue";
import {computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch} from "vue";
import {useFieldContext} from "./field-context";

/** `bare`：放在已有外框的容器里原地编辑，没有字段的外框（同名 .md 的“布局”）。 */
export type TextareaVariant = "default" | "bare";

const props = withDefaults(defineProps<{
    modelValue?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    required?: boolean;
    autofocus?: boolean;
    rows?: number;
    variant?: TextareaVariant;
    /** 高度随内容增减，不出现拖拽把手；至多 `maxRows` 行，再多在里面滚动。 */
    autosize?: boolean;
    maxRows?: number;
    minlength?: number;
    maxlength?: number;
} & /* @vue-ignore */ TextareaHTMLAttributes>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
    autofocus: false,
    rows: 4,
    variant: "default",
    autosize: false,
    maxRows: 12,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const field = useFieldContext();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);
const isBare = computed(() => props.variant === "bare");
const frameClass = computed(() => {
    if (isBare.value) return "bg-transparent p-0";
    return ["nb-ui-control rounded-[var(--radius-control)] border bg-[var(--control-surface)] px-3 py-2", isInvalid.value ? "nb-ui-control-invalid" : ""];
});

/*
 * 自动长高：先把高度放开量内容高度，再按 `maxRows` 夹住；夹住时在里面滚动。行高取计算样式（行高是 `normal` 时按字号的 1.2 倍估），
 * 换字号、换宽度（折行变了）都要重量，所以观察元素自己的宽度。`border-box` 时 `height` 含边框与内边距：量到的 `scrollHeight` 含
 * 内边距、不含边框，上限是行高乘行数再加内边距与边框；`content-box` 时 `height` 只是内容区。
 */
const box = useTemplateRef<HTMLTextAreaElement>("box");
function fit(): void {
    const element = box.value;
    if (!props.autosize || element === null) return;
    const style = getComputedStyle(element);
    const parsedLine = Number.parseFloat(style.lineHeight);
    const line = Number.isFinite(parsedLine) ? parsedLine : (Number.parseFloat(style.fontSize) || 16) * 1.2;
    const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    const border = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    const borderBox = style.boxSizing === "border-box";
    element.style.height = "auto";
    const needed = borderBox ? element.scrollHeight + border : element.scrollHeight - padding;
    const limit = line * props.maxRows + (borderBox ? padding + border : 0);
    element.style.height = `${Math.min(needed, limit)}px`;
    element.style.overflowY = needed > limit ? "auto" : "hidden";
}
let observer: ResizeObserver | null = null;
let width = 0;
onMounted(() => {
    fit();
    if (typeof ResizeObserver === "undefined" || box.value === null) return;
    width = box.value.clientWidth;
    // 不论 `autosize` 初值：之后才打开的也要跟着宽度重量（`fit` 自己判断开没开）。
    observer = new ResizeObserver(() => {
        // 只看宽度：高度是自己设的，不能因为高度变化再量一次。
        const next = box.value?.clientWidth ?? 0;
        if (next === width) return;
        width = next;
        fit();
    });
    observer.observe(box.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => [props.modelValue, props.autosize, props.maxRows], () => void nextTick(fit));
</script>

<template>
    <textarea
        ref="box"
        :value="props.modelValue"
        :id="props.id || field?.inputId.value || undefined"
        :name="props.name || undefined"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :required="props.required || field?.required.value"
        :autofocus="props.autofocus"
        :rows="props.rows"
        :minlength="props.minlength"
        :maxlength="props.maxlength"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="isInvalid || undefined"
        class="w-full text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        :class="[frameClass, props.autosize || isBare ? 'resize-none' : 'resize-y']"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
</template>

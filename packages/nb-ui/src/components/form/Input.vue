<script setup lang="ts">
import type {InputHTMLAttributes} from "vue";
import {computed, mergeProps, useAttrs} from "vue";
import {useUiText} from "../../text-port";
import {useFieldContext} from "./field-context";
import type {ControlSize} from "../shared-types";

export type InputType = "text" | "search" | "password" | "number";
export type InputSize = Extract<ControlSize, "sm" | "md">;

const props = withDefaults(defineProps<{
    modelValue?: string;
    id?: string;
    name?: string;
    type?: InputType;
    placeholder?: string;
    size?: InputSize;
    disabled?: boolean;
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 清空按钮的读屏名称，按显示语言覆盖。 */
    clearLabel?: string;
    required?: boolean;
    autofocus?: boolean;
    autocomplete?: string;
    iconClass?: string;
    clearable?: boolean;
    inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
    minlength?: number;
    maxlength?: number;
    step?: string;
    min?: string;
    max?: string;
} & /* @vue-ignore */ InputHTMLAttributes>(), {
    modelValue: "",
    id: "",
    name: "",
    type: "text",
    placeholder: "",
    size: "md",
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
    autofocus: false,
    autocomplete: "",
    iconClass: "",
    clearable: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
    (e: "clear"): void;
}>();

const field = useFieldContext();
const text = useUiText();
const clearText = computed(() => props.clearLabel ?? text("input.clear"));
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[length:var(--text-xs)]"
    : "nb-ui-control-h-md nb-ui-control-px text-[length:var(--text-sm)]");

// prefix 与裸 input 两个分支共享同一份属性绑定，排除组件层 size prop 避免原生 HTMLInputElement size 属性类型冲突
const inputAttrs = computed(() => ({
    value: props.modelValue,
    id: props.id || field?.inputId.value || undefined,
    name: props.name || undefined,
    type: props.type,
    placeholder: props.placeholder,
    disabled: props.disabled,
    readonly: props.readonly,
    required: props.required || field?.required.value,
    autofocus: props.autofocus,
    autocomplete: props.autocomplete || undefined,
    inputmode: props.inputmode,
    minlength: props.minlength,
    maxlength: props.maxlength,
    step: props.step,
    min: props.min,
    max: props.max,
    "aria-describedby": field?.ariaDescribedby.value,
    "aria-invalid": isInvalid.value || undefined,
}));

/*
 * 透传属性分两处落：读屏属性（`aria-*`、`role`）落在输入框上——装饰过的输入框（图标、清除按钮、前后缀）根是外层控件，
 * 名字写在外层上读屏读不到；其余（class、style、`data-*`、监听）落在外层控件上，宿主的选择器与尺寸测量按外层写。
 * 没有装饰时输入框自己就是根，全部落在它上面。
 */
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const splitAttrs = computed(() => {
    const aria: Record<string, unknown> = {};
    const root: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) (key.startsWith("aria-") || key === "role" ? aria : root)[key] = value;
    return {aria, root};
});

function handleClear(): void {
    emit("update:modelValue", "");
    emit("clear");
}
</script>

<template>
    <div
        v-if="$slots.prefix || $slots.suffix || props.iconClass || props.clearable"
        v-bind="splitAttrs.root"
        class="nb-ui-control flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] focus-within:outline-none"
        :class="[controlSizeClass, isInvalid ? 'nb-ui-control-invalid' : '']"
    >
        <span v-if="props.iconClass" :class="props.iconClass" class="h-4 w-4 shrink-0 text-[var(--text-muted)] flex items-center justify-center self-center" aria-hidden="true" />
        <div v-if="$slots.prefix" class="inline-flex items-center self-center shrink-0 leading-none">
            <slot name="prefix"></slot>
        </div>
        <input
            v-bind="mergeProps(inputAttrs, splitAttrs.aria)"
            class="nb-ui-native-input min-w-0 flex-1 h-full bg-transparent text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            @focus="emit('focus', $event)"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
        <button
            v-if="props.clearable && props.modelValue && !props.disabled && !props.readonly"
            type="button"
            class="i-lucide-x h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer flex items-center justify-center self-center transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)]"
            :aria-label="clearText"
            @click="handleClear"
        />
        <div v-if="$slots.suffix" class="inline-flex items-center self-center shrink-0 leading-none">
            <slot name="suffix"></slot>
        </div>
    </div>
    <input
        v-else
        v-bind="mergeProps(inputAttrs, $attrs)"
        class="nb-ui-native-input nb-ui-control w-full rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        :class="[controlSizeClass, isInvalid ? 'nb-ui-control-invalid' : '']"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
</template>

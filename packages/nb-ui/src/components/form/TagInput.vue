<script setup lang="ts">
/** 一组短文字的输入（同名 .md）：加删与键盘由 reka-ui 的 TagsInput 承担，本组件管分隔符、去空白、去重与外观。 */
import {TagsInputInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText, TagsInputRoot} from "reka-ui";
import type {AcceptableInputValue} from "reka-ui";
import {computed, ref, useAttrs, watch} from "vue";

import {useUiText} from "../../text-port";
import type {ControlSize} from "../shared-types";
import {useFieldContext} from "./field-context";

export type TagInputSize = Extract<ControlSize, "sm" | "md">;
export type TagInputVariant = "default" | "bare";

const props = withDefaults(defineProps<{
    modelValue?: string[];
    id?: string;
    size?: TagInputSize;
    variant?: TagInputVariant;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
    removeLabel?: string;
}>(), {
    modelValue: () => [],
    id: "",
    size: "md",
    variant: "default",
    placeholder: "",
    disabled: false,
    readonly: false,
    invalid: false,
    removeLabel: undefined,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string[]): void;
}>();

defineOptions({inheritAttrs: false});

const attrs = useAttrs();
const field = useFieldContext();
const text = useUiText();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

/** 半角逗号、全角逗号与顿号都分隔：中文作者打“青石镇、北山”与英文的 “a, b” 一样拆。 */
const DELIMITER = /[,，、]/u;

/**
 * 交给 reka 的值。reka 自己记一份（passive），加项时先把打的字原样放进去再通知：空白项、重复项要在这里清掉，
 * 并且换一个新数组交回，即使清完与原值相同，它才会丢掉自己记着的那一项。
 */
const items = ref<string[]>([...props.modelValue]);
watch(() => props.modelValue, (next) => {
    items.value = [...next];
});

function clean(values: ReadonlyArray<AcceptableInputValue>): string[] {
    const seen = new Set<string>();
    for (const value of values) {
        const item = String(value).trim();
        if (item !== "") seen.add(item);
    }
    return [...seen];
}

function onUpdate(next: AcceptableInputValue[]): void {
    const cleaned = clean(next);
    items.value = cleaned;
    if (cleaned.length !== props.modelValue.length || cleaned.some((item, index) => item !== props.modelValue[index])) emit("update:modelValue", cleaned);
}

function removeText(item: string): string {
    return props.removeLabel === undefined ? text("tagInput.remove", {item}) : props.removeLabel.replaceAll("{{item}}", item);
}

const frameClass = computed(() => {
    const size = props.size === "sm" ? "min-h-[var(--control-h-sm)] text-[length:var(--text-xs)]" : "min-h-[var(--control-h-md)] text-[length:var(--text-sm)]";
    if (props.variant === "bare") return [size, "bg-transparent"];
    return [size, "nb-ui-control px-[calc(var(--control-px)*0.5)] py-[3px] rounded-[var(--radius-control)] border bg-[var(--control-surface)]", isInvalid.value ? "nb-ui-control-invalid" : ""];
});
const chipClass = computed(() => (props.size === "sm" ? "h-5 px-[5px]" : "h-[22px] px-[7px]"));

/** 读屏属性落在末尾的输入上（名字写在外层读屏读不到），其余落在根上；只读时没有输入，全部落在根上。 */
const splitAttrs = computed(() => {
    const aria: Record<string, unknown> = {};
    const root: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) (!props.readonly && (key.startsWith("aria-") || key === "role") ? aria : root)[key] = value;
    return {aria, root};
});
</script>

<template>
    <TagsInputRoot
        v-bind="splitAttrs.root"
        :model-value="items"
        :delimiter="DELIMITER"
        add-on-paste
        add-on-blur
        :disabled="props.disabled"
        class="flex w-full flex-wrap items-center gap-[4px] text-[var(--text-main)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
        :class="frameClass"
        @update:model-value="onUpdate"
    >
        <TagsInputItem
            v-for="item in items"
            :key="item"
            :value="item"
            class="inline-flex max-w-full items-center gap-[2px] rounded-[max(2px,calc(var(--radius-control)-4px))] bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] outline-none data-[state=active]:shadow-[0_0_0_1px_var(--accent-main)]"
            :class="chipClass"
        >
            <TagsInputItemText class="min-w-0 break-all" />
            <TagsInputItemDelete
                v-if="!props.readonly"
                class="inline-flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[2px] text-[var(--text-muted)] hover:text-[var(--text-main)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                v-bind="{title: removeText(item)}"
                :aria-label="removeText(item)"
            >
                <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
            </TagsInputItemDelete>
        </TagsInputItem>
        <TagsInputInput
            v-if="!props.readonly"
            v-bind="{...splitAttrs.aria, id: props.id || field?.inputId.value || undefined}"
            :placeholder="items.length === 0 ? props.placeholder : ''"
            :aria-invalid="isInvalid || undefined"
            :aria-describedby="field?.ariaDescribedby.value"
            class="nb-ui-native-input min-w-[4em] flex-1 bg-transparent text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
        />
    </TagsInputRoot>
</template>

<script setup lang="ts">
/** 日期输入（同名 .md）：段输入与日历都由 reka-ui 的 DatePicker 承担，本组件只换值的形状（`YYYY-MM-DD` 字符串）与外观。 */
import {CalendarDate} from "@internationalized/date";
import type {DateValue} from "@internationalized/date";
import {
    DatePickerCalendar,
    DatePickerCell,
    DatePickerCellTrigger,
    DatePickerContent,
    DatePickerField,
    DatePickerGrid,
    DatePickerGridBody,
    DatePickerGridHead,
    DatePickerGridRow,
    DatePickerHeadCell,
    DatePickerHeader,
    DatePickerHeading,
    DatePickerInput,
    DatePickerNext,
    DatePickerPrev,
    DatePickerRoot,
    DatePickerTrigger,
} from "reka-ui";
import {computed} from "vue";

import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {useText, useUiText} from "../../text-port";
import IconButton from "../controls/IconButton.vue";
import type {ControlSize} from "../shared-types";
import {useFieldContext} from "./field-context";

export type DateInputSize = Extract<ControlSize, "sm" | "md">;
export type DateInputVariant = "default" | "bare";

const props = withDefaults(defineProps<{
    modelValue?: string | null;
    id?: string;
    size?: DateInputSize;
    variant?: DateInputVariant;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
    required?: boolean;
    openLabel?: string;
}>(), {
    modelValue: null,
    id: "",
    size: "md",
    variant: "default",
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
    openLabel: undefined,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

defineOptions({inheritAttrs: false});

const field = useFieldContext();
const port = useText();
const text = useUiText();
const {zIndex} = usePopoverLayer();

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** `YYYY-MM-DD` → 日期；月日越界（`2025-02-30`）的不算，按没有值显示。 */
function toDate(value: string | null): CalendarDate | undefined {
    const match = value === null ? null : ISO_DATE.exec(value);
    if (match === null) return undefined;
    const date = new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return toIso(date) === value ? date : undefined;
}

function toIso(date: DateValue): string {
    return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

const value = computed(() => toDate(props.modelValue));
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);
const openText = computed(() => props.openLabel ?? text("dateInput.open"));

/** reka 在三段没填满时给 undefined：对调用方就是没有日期。与当前值相同时不发，受控值回写不成为一次修改。 */
function onUpdate(next: DateValue | undefined): void {
    const iso = next === undefined ? null : toIso(next);
    if (iso !== props.modelValue) emit("update:modelValue", iso);
}

const frameClass = computed(() => {
    const size = props.size === "sm" ? "nb-ui-control-h-sm text-[length:var(--text-xs)]" : "nb-ui-control-h-md text-[length:var(--text-sm)]";
    if (props.variant === "bare") return [size, "bg-transparent"];
    return [size, "nb-ui-control px-[calc(var(--control-px)*0.75)] rounded-[var(--radius-control)] border bg-[var(--control-surface)]", isInvalid.value ? "nb-ui-control-invalid" : ""];
});
</script>

<template>
    <DatePickerRoot
        :id="props.id || field?.inputId.value || undefined"
        :model-value="value"
        :locale="port.locale.value"
        granularity="day"
        close-on-select
        prevent-deselect
        :disabled="props.disabled"
        :readonly="props.readonly"
        :required="props.required || field?.required.value"
        @update:model-value="onUpdate"
    >
        <DatePickerField
            v-slot="{segments}"
            v-bind="$attrs"
            class="inline-flex w-fit items-center gap-[2px] whitespace-nowrap text-[var(--text-main)] tabular-nums data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
            :class="frameClass"
            :aria-invalid="isInvalid || undefined"
            :aria-describedby="field?.ariaDescribedby.value"
        >
            <template v-for="segment in segments" :key="segment.part">
                <DatePickerInput
                    v-if="segment.part === 'literal'"
                    :part="segment.part"
                    class="text-[var(--text-muted)]"
                >
                    {{ segment.value }}
                </DatePickerInput>
                <DatePickerInput
                    v-else
                    :part="segment.part"
                    class="rounded-[3px] px-[1px] outline-none focus:bg-[var(--accent-bg)] focus:text-[var(--accent-text)] data-[placeholder]:text-[var(--text-muted)]"
                >
                    {{ segment.value }}
                </DatePickerInput>
            </template>
            <DatePickerTrigger v-if="!props.readonly" as-child>
                <IconButton size="xs" icon-class="i-lucide-calendar" :title="openText" :aria-label="openText" :disabled="props.disabled" class="ml-1" />
            </DatePickerTrigger>
        </DatePickerField>

        <DatePickerContent
            side="bottom"
            align="start"
            :side-offset="6"
            :style="{zIndex}"
            class="nb-ui-popover-surface nb-ui-popover-motion w-[15rem] max-w-[calc(100vw-32px)] p-2 text-[var(--text-main)] outline-none select-none"
        >
            <DatePickerCalendar v-slot="{weekDays, grid}" class="flex flex-col gap-1">
                <DatePickerHeader class="flex items-center justify-between">
                    <DatePickerPrev as-child>
                        <IconButton size="xs" icon-class="i-lucide-chevron-left" :title="text('dateInput.previousMonth')" :aria-label="text('dateInput.previousMonth')" />
                    </DatePickerPrev>
                    <DatePickerHeading class="text-[length:var(--text-sm)] font-medium" />
                    <DatePickerNext as-child>
                        <IconButton size="xs" icon-class="i-lucide-chevron-right" :title="text('dateInput.nextMonth')" :aria-label="text('dateInput.nextMonth')" />
                    </DatePickerNext>
                </DatePickerHeader>
                <DatePickerGrid v-for="month in grid" :key="month.value.toString()" class="w-full border-collapse select-none">
                    <DatePickerGridHead>
                        <DatePickerGridRow class="grid grid-cols-7">
                            <DatePickerHeadCell v-for="day in weekDays" :key="day" class="h-7 text-center text-[length:var(--text-xs)] font-normal text-[var(--text-muted)]">
                                {{ day }}
                            </DatePickerHeadCell>
                        </DatePickerGridRow>
                    </DatePickerGridHead>
                    <DatePickerGridBody>
                        <DatePickerGridRow v-for="(week, index) in month.rows" :key="index" class="grid grid-cols-7">
                            <DatePickerCell v-for="day in week" :key="day.toString()" :date="day" class="flex justify-center p-0">
                                <DatePickerCellTrigger
                                    :day="day"
                                    :month="month.value"
                                    class="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[length:var(--text-sm)] tabular-nums outline-none hover:bg-[var(--overlay-item-active)] focus-visible:shadow-[var(--focus-ring)] data-[today]:shadow-[inset_0_0_0_1px_var(--accent-main)] data-[outside-view]:text-[var(--text-muted)] data-[outside-view]:opacity-60 data-[selected]:bg-[var(--accent-main)] data-[selected]:text-[var(--text-inverse)]"
                                />
                            </DatePickerCell>
                        </DatePickerGridRow>
                    </DatePickerGridBody>
                </DatePickerGrid>
            </DatePickerCalendar>
        </DatePickerContent>
    </DatePickerRoot>
</template>

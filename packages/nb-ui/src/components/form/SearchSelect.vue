<script setup lang="ts">
import type {HTMLAttributes} from "vue";
/**
 * 可搜索的下拉（同名 .md，docs/specs/ui/forms.md 输出 30）：一个 combobox 输入框加 `SuggestionMenu`。输入的文字只是
 * 搜索词，只有选中选项才改值；Escape 与失焦都恢复显示已选项。列表的样子、截断与滚动就是 `SuggestionMenu` 的，与
 * nb-ui 的其它弹出列表一致。
 *
 * 焦点一直在输入框里：`SuggestionMenu` 按下时不夺焦点，所以点选项不会先触发失焦；高亮经 `aria-activedescendant` 交给读屏。
 */
import {computed, ref, useAttrs, useId, watch} from "vue";

import SuggestionMenu from "../popup/SuggestionMenu.vue";
import {suggestionMenuOptions, suggestionOptionId} from "../popup/suggestion-menu";
import type {SuggestionMenuGroup} from "../popup/suggestion-menu";
import {useUiText} from "../../text-port";
import {useFieldContext} from "./field-context";
import {moveRoving, type RovingMove} from "../../utils/roving";
import type {ControlSize} from "../shared-types";

export type SearchSelectOption = {
    value: string;
    label: string;
    /** 右侧的一句说明；放不下时先截它。 */
    description?: string;
    iconClass?: string;
    disabled?: boolean;
};

export type SearchSelectSize = Extract<ControlSize, "sm" | "md">;

const props = withDefaults(defineProps<{
    modelValue?: string;
    options: readonly SearchSelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    /** 没有匹配的选项时列表里的一行字，按显示语言传入。 */
    emptyText?: string;
    /** 选项列表的可访问名称；缺省时读屏用输入框的名字。 */
    listLabel?: string;
    size?: SearchSelectSize;
    disabled?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，不打开列表（输出 28）。 */
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    required?: boolean;
} & /* @vue-ignore */ HTMLAttributes>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    listLabel: undefined,
    size: "md",
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

/**
 * 根是外框 `div`：`class`、`style` 留在外框，其余属性（`aria-label` 这类）转给输入框。否则 Vue 把它们落到没有角色的外框
 * 上，combobox 没有名字（同 `Select` 的转发）。
 */
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const inputAttrs = computed(() => {
    const {class: _class, style: _style, ...rest} = attrs;
    return rest;
});

const field = useFieldContext();
const generatedId = useId();
const text = useUiText();
const emptyLabel = computed(() => props.emptyText ?? text("searchSelect.empty"));
const controlId = computed(() => props.id || field?.inputId.value || `nb-search-select-${generatedId}`);
const menuId = computed(() => `${controlId.value}-listbox`);
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

const anchor = ref<HTMLElement | null>(null);
const inputElement = ref<HTMLInputElement | null>(null);
/** 输入法组字中：拼音字母不当搜索词，Enter 与方向键交给输入法。 */
const composing = ref(false);
const open = ref(false);
/** 用户在输入框里打的字；没在搜索时为 null，输入框显示已选项的名字。 */
const query = ref<string | null>(null);
const activeId = ref<string | null>(null);

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const display = computed(() => query.value ?? selected.value?.label ?? "");

const filtered = computed(() => {
    const needle = (query.value ?? "").trim().toLocaleLowerCase();
    if (needle === "") return props.options;
    return props.options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
});
const groups = computed((): SuggestionMenuGroup[] => [{
    id: "options",
    items: filtered.value.map((option) => ({id: option.value, label: option.label, hint: option.description, iconClass: option.iconClass, disabled: option.disabled, checked: option.value === props.modelValue})),
}]);
const choosable = computed(() => suggestionMenuOptions(groups.value));
const activeDescendant = computed(() => {
    const index = choosable.value.findIndex((item) => item.id === activeId.value);
    return open.value && index >= 0 ? suggestionOptionId(menuId.value, index) : undefined;
});

/** 列表变了（换了搜索词或选项）：高亮还在就留着，不在了落到第一个可选项。 */
watch(choosable, (items) => {
    if (!items.some((item) => item.id === activeId.value)) activeId.value = items[0]?.id ?? null;
});

/** 列表的名字：给了 `listLabel` 用它，否则指向字段的标签。 */
const listLabelledby = computed(() => (props.listLabel === undefined ? field?.labelId.value : undefined));

/**
 * 打开列表。点击与方向键打开时全选已选项的名字：接着打的第一个字替换它，不会接在名字后面成为搜索词。
 */
function openMenu(selectText = true): void {
    if (props.disabled || props.readonly || open.value) return;
    if (selectText) inputElement.value?.select();
    open.value = true;
    activeId.value = selected.value !== undefined && selected.value.disabled !== true ? selected.value.value : choosable.value[0]?.id ?? null;
}

/** 关掉列表、丢掉搜索词：输入框回到显示已选项。 */
function closeMenu(): void {
    open.value = false;
    query.value = null;
}

function choose(value: string): void {
    const option = props.options.find((candidate) => candidate.value === value);
    if (option === undefined || option.disabled === true) return;
    closeMenu();
    if (value !== props.modelValue) emit("update:modelValue", value);
}

function move(action: RovingMove): void {
    const items = choosable.value;
    const next = moveRoving(items, items.findIndex((item) => item.id === activeId.value), action, (item) => item.disabled === true);
    activeId.value = next < 0 ? null : items[next]!.id;
}

function onInput(event: Event): void {
    if (props.readonly || props.disabled || composing.value) return;
    query.value = (event.target as HTMLInputElement).value;
    if (!open.value) openMenu(false);
}

function onCompositionEnd(event: CompositionEvent): void {
    composing.value = false;
    onInput(event);
}

function onKeydown(event: KeyboardEvent): void {
    // 组字中的 Enter 是上屏、方向键是翻候选词（Chrome 给的 keyCode 是 229），同 `QuickPick`。
    if (props.readonly || props.disabled || event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open.value) openMenu();
        else move(event.key === "ArrowDown" ? "next" : "prev");
    } else if (event.key === "Enter" && open.value) {
        event.preventDefault();
        if (activeId.value !== null) choose(activeId.value);
    } else if (event.key === "Escape" && open.value) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
    }
}

/**
 * 外框上放大镜与箭头的位置也算控件：按下不让输入框失焦，聚焦它并开合列表（同 `Select` 整个外框都是触发器）。
 */
function onFrameMousedown(event: MouseEvent): void {
    if (event.target === inputElement.value) return;
    event.preventDefault();
    if (props.disabled) return;
    inputElement.value?.focus();
    if (open.value) closeMenu();
    else openMenu();
}

const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[length:var(--text-xs)]"
    : "nb-ui-control-h-md nb-ui-control-px text-[length:var(--text-sm)]");
</script>

<template>
    <div
        ref="anchor"
        class="nb-ui-control flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)]"
        :class="[controlSizeClass, isInvalid ? 'nb-ui-control-invalid' : '', props.disabled ? 'opacity-60' : '', attrs.class]"
        :style="attrs.style as never"
        data-nb-search-select
        @mousedown="onFrameMousedown"
    >
        <!-- 表单提交的是值，不是输入框里的文字。 -->
        <input v-if="props.name" type="hidden" :name="props.name" :value="props.modelValue">
        <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        <input
            v-bind="inputAttrs"
            :id="controlId"
            ref="inputElement"
            :value="display"
            :placeholder="props.placeholder"
            :disabled="props.disabled"
            :readonly="props.readonly"
            :required="props.required || field?.required.value"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-autocomplete="list"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="open ? menuId : undefined"
            :aria-activedescendant="activeDescendant"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            :aria-readonly="props.readonly || undefined"
            class="nb-ui-native-input min-w-0 flex-1 h-full bg-transparent font-medium text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
            @focus="emit('focus', $event)"
            @click="openMenu()"
            @input="onInput"
            @compositionstart="composing = true"
            @compositionend="onCompositionEnd"
            @keydown="onKeydown"
            @blur="closeMenu"
        >
        <span
            class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-move)] [transition-timing-function:var(--ease-layout)]"
            :class="[isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4', open ? 'rotate-180' : '']"
            aria-hidden="true"
        ></span>
        <SuggestionMenu
            :id="menuId"
            :groups="groups"
            :active-id="activeId"
            :anchor="open ? anchor : null"
            :label="props.listLabel"
            :labelledby="listLabelledby"
            :empty-text="emptyLabel"
            match-anchor-width
            @highlight="(id: string) => (activeId = id)"
            @select="choose"
        />
    </div>
</template>

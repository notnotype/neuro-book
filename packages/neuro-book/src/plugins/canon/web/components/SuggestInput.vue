<script setup lang="ts">
/**
 * 有建议值的文字（同名 .md）：输入框加一张候选列表，值始终是输入框里的字。受控。
 */
import {computed, ref, shallowRef, useId, watch} from "vue";

import {Input, SuggestionMenu, suggestionMenuOptions, suggestionOptionId} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    modelValue: string;
    suggestions: readonly string[];
    label: string;
    placeholder?: string;
}>(), {placeholder: ""});

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
}>();

const root = ref<HTMLElement | null>(null);
const menu = ref<{contains(node: Node | null): boolean} | null>(null);
const focused = shallowRef(false);
const dismissed = shallowRef(false);
const activeId = shallowRef<string | null>(null);
const menuId = `canon-suggest-${useId()}`;

const groups = computed<SuggestionMenuGroup[]>(() => {
    const typed = props.modelValue.trim();
    const shown = props.suggestions.filter((item) => typed === "" || item.includes(typed) || item === props.modelValue);
    return [{id: "suggestions", items: shown.map((item) => ({id: item, label: item, checked: item === props.modelValue}))}];
});
const options = computed(() => suggestionMenuOptions(groups.value));
const open = computed(() => focused.value && !dismissed.value && options.value.length > 0);
const activeIndex = computed(() => options.value.findIndex((item) => item.id === activeId.value));

// 列表换了内容：高亮不在里面就清掉（不自动高亮第一条，回车才不会悄悄换掉作者写的字）。
watch(options, (next) => {
    if (!next.some((item) => item.id === activeId.value)) activeId.value = null;
});

const choose = (id: string): void => {
    emit("update:modelValue", id);
    dismissed.value = true;
    activeId.value = null;
};

const move = (step: number): void => {
    const list = options.value;
    if (list.length === 0) return;
    const current = activeIndex.value;
    activeId.value = list[current < 0 ? (step > 0 ? 0 : list.length - 1) : (current + step + list.length) % list.length]!.id;
};

const onKeydown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        dismissed.value = false;
        move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && open.value && activeId.value !== null) {
        event.preventDefault();
        choose(activeId.value);
    } else if (event.key === "Escape" && open.value) {
        // 只收起列表：外面的浮层（就地改）不因为这一下就关掉。
        event.preventDefault();
        event.stopPropagation();
        dismissed.value = true;
    }
};

const onFocusout = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (root.value?.contains(next) === true || menu.value?.contains(next) === true) return;
    focused.value = false;
};
</script>

<template>
    <div ref="root" class="min-w-0 w-full" data-suggest-input @focusin="focused = true; dismissed = false" @focusout="onFocusout" @keydown="onKeydown">
        <Input
            size="sm"
            :model-value="props.modelValue"
            :aria-label="props.label"
            :placeholder="props.placeholder"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="open"
            :aria-controls="menuId"
            :aria-activedescendant="open && activeIndex >= 0 ? suggestionOptionId(menuId, activeIndex) : undefined"
            @update:model-value="(value: string) => { dismissed = false; emit('update:modelValue', value); }"
        />
        <SuggestionMenu ref="menu" :id="menuId" :groups="groups" :active-id="activeId" :anchor="open ? root : null" :label="props.label" match-anchor-width @select="choose" @highlight="(id: string) => (activeId = id)" />
    </div>
</template>

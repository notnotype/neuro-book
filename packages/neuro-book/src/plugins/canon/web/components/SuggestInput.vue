<script setup lang="ts">
/**
 * 有建议值的文字（同名 .md）：输入框加一张候选列表，值始终是输入框里的字。受控。打开时列出全部建议值（当前值打勾），作者打了字
 * 才按字筛。`inline` 时列表嵌在输入框下面、一直在（就地改的编辑卡里），不另弹一层；否则是获得焦点时弹出的列表。
 */
import {computed, nextTick, ref, shallowRef, useId, watch} from "vue";

import {Input, SuggestionMenu, suggestionMenuOptions, suggestionOptionId} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    modelValue: string;
    suggestions: readonly string[];
    label: string;
    placeholder?: string;
    /** 列表嵌在输入框下面（编辑卡里）；默认 false（弹出）。 */
    inline?: boolean;
}>(), {placeholder: "", inline: false});

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
}>();

const root = ref<HTMLElement | null>(null);
const menu = ref<{contains(node: Node | null): boolean} | null>(null);
const focused = shallowRef(false);
const dismissed = shallowRef(false);
const activeId = shallowRef<string | null>(null);
/** 作者在这一次里打过字：打过才按字筛，刚打开时输入框里是当前值，按它筛就只剩它自己。 */
const typed = shallowRef(false);
const menuId = `canon-suggest-${useId()}`;

const groups = computed<SuggestionMenuGroup[]>(() => {
    const words = props.modelValue.trim();
    const shown = !typed.value || words === "" ? props.suggestions : props.suggestions.filter((item) => item.includes(words) || item === props.modelValue);
    return [{id: "suggestions", items: shown.map((item) => ({id: item, label: item, checked: item === props.modelValue}))}];
});
const options = computed(() => suggestionMenuOptions(groups.value));
const open = computed(() => options.value.length > 0 && (props.inline || (focused.value && !dismissed.value)));
const activeIndex = computed(() => options.value.findIndex((item) => item.id === activeId.value));

// 列表换了内容：高亮不在里面就清掉（不自动高亮第一条，回车才不会悄悄换掉作者写的字）。
watch(options, (next) => {
    if (!next.some((item) => item.id === activeId.value)) activeId.value = null;
});

const choose = (id: string): void => {
    // 选了一条：输入框里就是它，列表回到全部（不按刚填进去的字筛）。
    typed.value = false;
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
    } else if (event.key === "Escape" && open.value && !props.inline) {
        // 只收起列表：外面的浮层（就地改）不因为这一下就关掉。
        event.preventDefault();
        event.stopPropagation();
        dismissed.value = true;
    }
};

/** 从外面进来（不是在输入框与列表之间挪）：这一次还没打过字，列表回到全部。 */
const onFocusin = (): void => {
    if (!focused.value) typed.value = false;
    focused.value = true;
    dismissed.value = false;
};

/**
 * 嵌在编辑卡里的列表有高度上限：方向键走到看不见的那一项时，列表自己滚到露出它。只动列表的 scrollTop，不用 `scrollIntoView`
 * （它会连带滚动编辑卡外面的页面）。
 */
const list = ref<HTMLElement | null>(null);
watch(activeId, async (id) => {
    if (!props.inline || id === null) return;
    await nextTick();
    const box = list.value;
    const item = box?.querySelector<HTMLElement>("[data-highlighted]");
    if (box == null || item == null) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
});

const onFocusout = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (root.value?.contains(next) === true || menu.value?.contains(next) === true) return;
    focused.value = false;
};
</script>

<template>
    <div ref="root" class="min-w-0 w-full" data-suggest-input @focusin="onFocusin" @focusout="onFocusout" @keydown="onKeydown">
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
            @update:model-value="(value: string) => { dismissed = false; typed = true; emit('update:modelValue', value); }"
        />
        <!-- 嵌在编辑卡里：一直列着；按下不抢输入框的焦点，点了填进去、焦点留在输入框。 -->
        <ul v-if="props.inline && open" :id="menuId" ref="list" class="suggest-input__list" role="listbox" :aria-label="props.label">
            <li
                v-for="(item, index) in options"
                :id="suggestionOptionId(menuId, index)"
                :key="item.id"
                class="nb-ui-menu-item"
                role="option"
                :aria-selected="item.id === props.modelValue"
                :data-highlighted="item.id === activeId ? '' : undefined"
                @mousedown.prevent
                @click="choose(item.id)"
                @pointermove="activeId = item.id"
            >
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                <span v-if="item.id === props.modelValue" class="i-lucide-check size-3.5 shrink-0" aria-hidden="true" />
            </li>
        </ul>
        <SuggestionMenu v-if="!props.inline" ref="menu" :id="menuId" :groups="groups" :active-id="activeId" :anchor="open ? root : null" :label="props.label" match-anchor-width @select="choose" @highlight="(id: string) => (activeId = id)" />
    </div>
</template>

<style scoped>
/* 编辑卡里的建议值：约 6 行高，在里面滚。 */
.suggest-input__list {
    /* 定位：各项的 offsetTop 按列表自己算，滚到高亮项时用。 */
    position: relative;
    max-height: 13rem;
    margin: 6px 0 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
}
</style>

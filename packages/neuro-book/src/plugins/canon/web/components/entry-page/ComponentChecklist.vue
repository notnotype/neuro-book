<script setup lang="ts">
/**
 * 设定组的勾选列表（同名 .md，docs/specs/canon/author-ui.md 输出 4、38）：搜索框、预设一排、按组列出的勾选行。焦点一直留在搜索框里，
 * 高亮靠 `aria-activedescendant`（同“添加一组设定”原来的浮层与条目选择器）：中文输入法下打字、Space 打空格都不用把焦点挪来挪去。
 */
import {computed, nextTick, ref, shallowRef, useId, watch} from "vue";

import {Button, Input} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";
import {CHECKLIST_GROUPS, squeeze, withPreset} from "./component-checklist";
import type {ChecklistItem, ChecklistPreset} from "./component-checklist";

const props = withDefaults(defineProps<{
    items: readonly ChecklistItem[];
    /** 选定的种类；空串时没有“适用于”一组。默认空串。 */
    kind?: string;
    presets?: readonly ChecklistPreset[];
    /** 勾着的类型 id（不含已添加的）；受控。 */
    modelValue: readonly string[];
    /** 列表封顶的高度（CSS 长度）；不给时不封顶。 */
    maxHeight?: string;
}>(), {kind: "", presets: () => [], maxHeight: undefined});

const emit = defineEmits<{
    /** `via`：作者点的是一行还是一个预设（新建对话框据此不把预设算作动过勾选）。 */
    (event: "update:modelValue", value: readonly string[], via: "row" | "preset"): void;
    (event: "present", type: string): void;
    (event: "submit"): void;
}>();

const text = useCanonText();
const query = shallowRef("");
const activeId = shallowRef<string | null>(null);
const listId = `canon-checklist-${useId()}`;
const optionId = (value: string): string => `${listId}-${value.replace(/[^\w-]/gu, "_")}`;
const search = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

const checked = (item: ChecklistItem): boolean => item.present || props.modelValue.includes(item.value);
const fits = (item: ChecklistItem): boolean => props.kind.trim() !== "" && item.kinds.includes(props.kind.trim());
const labelOf = (item: ChecklistItem): string => (item.restore ? text("entry.restoreGroup", {name: item.label}) : item.label);

interface Group {
    readonly id: string;
    readonly label: string | null;
    readonly items: readonly ChecklistItem[];
}
/** 没打字：适用于这个种类的在前，其余按登记它的插件分组；打了字：只按名字筛、不分组。 */
const groups = computed<readonly Group[]>(() => {
    const words = squeeze(query.value);
    if (words !== "") return [{id: "hits", label: null, items: props.items.filter((item) => squeeze(item.label).includes(words))}];
    const fitting = props.items.filter(fits);
    const rest = props.items.filter((item) => !fits(item));
    return [
        ...(fitting.length > 0 ? [{id: "fits", label: text("entry.addGroup.fits", {kind: props.kind.trim()}), items: fitting}] : []),
        ...CHECKLIST_GROUPS.map((group) => ({id: group, label: text(`entry.addGroup.${group}`), items: rest.filter((item) => item.group === group)})).filter((group) => group.items.length > 0),
    ];
});
const options = computed(() => groups.value.flatMap((group) => group.items));

// 列表换了内容（打字、宿主给的变了）：高亮不在里面就换到第一项还没添加的（都添加了就第一项）。
watch(options, (next) => {
    if (!next.some((item) => item.value === activeId.value)) activeId.value = (next.find((item) => !item.present) ?? next[0])?.value ?? null;
}, {immediate: true});
// 高亮走到看不见的行：列表滚到露出它（只滚列表自己）。
watch(activeId, async (id) => {
    if (id === null) return;
    await nextTick();
    list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(id))}`)?.scrollIntoView?.({block: "nearest"});
});

const toggle = (item: ChecklistItem): void => {
    activeId.value = item.value;
    if (item.present) {
        emit("present", item.value);
        return;
    }
    emit("update:modelValue", props.modelValue.includes(item.value) ? props.modelValue.filter((value) => value !== item.value) : [...props.modelValue, item.value], "row");
};
const presetUseful = (preset: ChecklistPreset): boolean => withPreset(props.modelValue, preset, props.items).length > props.modelValue.length;
// 点预设不让焦点离开搜索框（按钮上 `mousedown.prevent`）；用键盘按的，按完把焦点交回搜索框：这个预设随即不可用，焦点不能留在
// 一个被禁用的按钮上。
const applyPreset = (preset: ChecklistPreset): void => {
    emit("update:modelValue", withPreset(props.modelValue, preset, props.items), "preset");
    search.value?.querySelector("input")?.focus();
};

const move = (step: number): void => {
    const all = options.value;
    if (all.length === 0) return;
    const at = all.findIndex((item) => item.value === activeId.value);
    activeId.value = all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length]!.value;
};
const onKeydown = (event: KeyboardEvent): void => {
    // 组字中的按键不处理；WebKit 在组字结束后才发选词的那次 Enter，`isComposing` 已是假，要再看 keyCode 229（同 nb-ui SearchSelect）。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            emit("submit");
            return;
        }
        const item = options.value.find((candidate) => candidate.value === activeId.value);
        if (item !== undefined) toggle(item);
    }
};
const activeOption = computed(() => (activeId.value !== null && options.value.some((item) => item.value === activeId.value) ? optionId(activeId.value) : undefined));
/**
 * 高亮只在作者正对着列表时画：焦点在搜索框里，或指针在列表上。新建对话框里焦点先在名字上，列表第一行不该一直亮着一块底色；
 * 高亮记着的那一行不变，焦点回来接着从它走。
 */
const searching = shallowRef(false);
const pointing = shallowRef(false);
const engaged = computed(() => searching.value || pointing.value);
/** 选定的种类变了（新建对话框里换种类）：列表淡出淡入地换成新的分组，不瞬间重排。打字筛选时不换。 */
const groupsKey = computed(() => (squeeze(query.value) === "" ? `kind:${props.kind.trim()}` : "search"));

defineExpose({focus: () => search.value?.querySelector("input")?.focus()});
</script>

<template>
    <div class="component-checklist" data-component-checklist>
        <div ref="search" @keydown="onKeydown" @focusin="searching = true" @focusout="searching = false">
            <Input
                size="sm"
                :model-value="query"
                :aria-label="text('entry.addGroup.search')"
                :placeholder="text('entry.addGroup.search')"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                :aria-controls="listId"
                :aria-activedescendant="activeOption"
                @update:model-value="(value: string) => (query = value)"
            />
        </div>
        <!-- 预设一排随种类出现、消失时收放（新建对话框里换种类），不顶着下面的列表跳。 -->
        <Transition name="component-checklist-presets">
            <div v-if="props.presets.length > 0" class="component-checklist__presets-wrap">
                <div class="component-checklist__presets" role="group" :aria-label="text('entry.addGroup.presets')" data-checklist-presets>
                    <Button v-for="preset in props.presets" :key="preset.id" size="sm" variant="secondary" :disabled="!presetUseful(preset)" :data-preset="preset.id" @mousedown.prevent @click="applyPreset(preset)">{{ preset.label }}</Button>
                </div>
            </div>
        </Transition>
        <div :id="listId" ref="list" class="component-checklist__list" role="listbox" @pointerleave="pointing = false" aria-multiselectable="true" :aria-label="text('entry.addGroup.list')" :style="props.maxHeight === undefined ? undefined : {maxHeight: props.maxHeight}">
            <Transition name="nb-ui-switch" mode="out-in">
            <div :key="groupsKey">
            <div v-for="group in groups" :key="group.id" role="group" :aria-label="group.label ?? undefined">
                <div v-if="group.label !== null" class="nb-ui-menu-label" aria-hidden="true">{{ group.label }}</div>
                <div
                    v-for="item in group.items"
                    :id="optionId(item.value)"
                    :key="item.value"
                    role="option"
                    class="nb-ui-menu-item component-checklist__row"
                    :aria-selected="checked(item)"
                    :data-highlighted="engaged && activeId === item.value ? '' : undefined"
                    :data-present="item.present ? '' : undefined"
                    :data-checklist-item="item.value"
                    @click="toggle(item)"
                    @mousedown.prevent
                    @pointermove="activeId = item.value; pointing = true"
                >
                    <span class="component-checklist__box" :data-checked="checked(item) ? '' : undefined" aria-hidden="true"><span class="i-lucide-check component-checklist__check" /></span>
                    <span :class="item.iconClass" class="size-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ labelOf(item) }}</span>
                    <span v-if="item.present" class="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("entry.addGroup.added") }}</span>
                </div>
            </div>
            </div>
            </Transition>
            <p v-if="options.length === 0" class="component-checklist__empty">{{ text("entry.addGroup.none", {query: query.trim()}) }}</p>
        </div>
    </div>
</template>

<style scoped>
.component-checklist {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    min-width: 0;
}
.component-checklist__presets-wrap {
    display: grid;
    grid-template-rows: 1fr;
}
.component-checklist__presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    min-height: 0;
    overflow: hidden;
    /* 按钮的焦点环画在外面（主题 --focus-ring 实色那圈外扩 3.5px），收放用的 overflow 不能把它裁掉。 */
    padding: 4px;
    margin: -4px;
}
.component-checklist-presets-enter-active,
.component-checklist-presets-leave-active {
    transition: grid-template-rows var(--motion-fast) var(--ease-layout), opacity var(--motion-fast) var(--ease-layout), margin-bottom var(--motion-fast) var(--ease-layout);
}
/* 收起时连同它与列表之间的间隔一起收（外层 flex 的 gap 由负的下边距抵掉）。 */
.component-checklist-presets-enter-from,
.component-checklist-presets-leave-to {
    grid-template-rows: 0fr;
    opacity: 0;
    margin-bottom: -0.625rem;
}
/* 列表的内容随打字增减、在溢出与不溢出之间换：滚动条的位置一直留着，宽度不跳（nb-ui 界面开发规范“滚动条”）。 */
.component-checklist__list {
    overflow-y: auto;
    scrollbar-gutter: stable;
    margin-inline: -0.25rem;
    padding-inline: 0.25rem;
}
.component-checklist__row {
    --nb-popover-inner-radius: var(--radius-control);
}
/*
 * 勾的方框，画法同 nb-ui 的 `Checkbox`（这一行是 `option`，里面不能再放一个能操作的勾选框，所以只画样子）：勾着时底色换成强调色、
 * 勾淡入；已添加的整格淡一些（勾着、不能取消）。
 */
.component-checklist__box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: var(--border-w) solid color-mix(in srgb, var(--text-main) 20%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--bg-panel) 90%, transparent);
    transition: background-color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}
.component-checklist__box[data-checked] {
    border-color: var(--accent-main);
    background: var(--accent-main);
}
.component-checklist__check {
    width: 0.75rem;
    height: 0.75rem;
    color: var(--text-inverse);
    opacity: 0;
    transform: scale(0.6);
    transition: opacity var(--motion-fast) var(--ease-layout), transform var(--motion-fast) var(--ease-layout);
}
.component-checklist__box[data-checked] .component-checklist__check {
    opacity: 1;
    transform: scale(1);
}
.component-checklist__row[data-present] .component-checklist__box {
    opacity: 0.5;
}
.component-checklist__empty {
    margin: 0;
    padding: 0.5rem 0.625rem;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

/* 减弱动效：勾直接出现在原尺寸，只淡入（nb-ui 设计语言“六、无障碍”）。 */
@media (prefers-reduced-motion: reduce) {
    .component-checklist__check,
    .component-checklist__box[data-checked] .component-checklist__check {
        transform: none;
    }
}
</style>

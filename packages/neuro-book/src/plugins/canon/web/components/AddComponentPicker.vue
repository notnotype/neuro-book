<script setup lang="ts">
/**
 * “添加一组设定”的浮层（同名 .md，docs/specs/canon/author-ui.md 输出 38）：搜索框加按组列出的设定组，键盘在这里处理，列表是 nb-ui
 * 的 `SuggestionMenu`（它不管键盘、不抢焦点）。受控：开关由 `anchor` 定，选了什么发事件，加上、切页由宿主做。
 */
import {computed, onBeforeUnmount, ref, shallowRef, useId, watch} from "vue";

import {Input, SuggestionMenu, suggestionMenuOptions, suggestionOptionId} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup, SuggestionMenuItem} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import {ADD_COMPONENT_GROUPS} from "./add-component-picker";
import type {AddComponentItem} from "./add-component-picker";

const props = withDefaults(defineProps<{
    /** 锚（分页条后面的“＋”或竖排导航里那一行）；null 时关着。默认 null。 */
    anchor?: HTMLElement | null;
    items: readonly AddComponentItem[];
    /** 条目的种类；空串时没有“适用于”那一组。默认空串。 */
    kind?: string;
}>(), {anchor: null, kind: ""});

const emit = defineEmits<{
    (event: "add", type: string): void;
    (event: "show", type: string): void;
    /** 要关上；`refocus` 为真时宿主把焦点放回锚（Escape、选了一项）。 */
    (event: "close", refocus: boolean): void;
}>();

const text = useCanonText();
const query = shallowRef("");
const activeId = shallowRef<string | null>(null);
const menuId = `canon-add-component-${useId()}`;
const search = ref<HTMLElement | null>(null);
const menu = ref<{contains(node: Node | null): boolean} | null>(null);

/** 比名字时不分大小写、不管空格：“物品 栏”也找得到“物品栏”。 */
const squeeze = (value: string): string => value.replace(/\s+/gu, "").toLowerCase();

const itemOf = (item: AddComponentItem): SuggestionMenuItem => ({
    id: item.value,
    label: item.restore ? text("entry.restoreGroup", {name: item.label}) : item.label,
    iconClass: item.iconClass,
    ...(item.present ? {hint: text("entry.addGroup.added")} : {}),
});

/** 没打字：按组列出还没有的（适用的在最前）；打了字：只按名字筛，已添加的也列出来（选了是切过去）。 */
const groups = computed<SuggestionMenuGroup[]>(() => {
    const words = squeeze(query.value);
    if (words !== "") return [{id: "hits", items: props.items.filter((item) => squeeze(item.label).includes(words)).map(itemOf)}];
    const open = props.items.filter((item) => !item.present);
    const fits = props.kind === "" ? [] : open.filter((item) => item.fits);
    const rest = open.filter((item) => !fits.includes(item));
    const result: SuggestionMenuGroup[] = [];
    if (fits.length > 0) result.push({id: "fits", label: text("entry.addGroup.fits", {kind: props.kind}), items: fits.map(itemOf)});
    for (const group of ADD_COMPONENT_GROUPS) {
        const members = rest.filter((item) => item.group === group);
        if (members.length > 0) result.push({id: group, label: text(`entry.addGroup.${group}`), items: members.map(itemOf)});
    }
    return result;
});
const options = computed(() => suggestionMenuOptions(groups.value));
const activeIndex = computed(() => options.value.findIndex((item) => item.id === activeId.value));

// 列表换了内容（打字、宿主给的变了）：高亮不在里面就换到第一项。
watch(options, (next) => {
    if (!next.some((item) => item.id === activeId.value)) activeId.value = next[0]?.id ?? null;
});

const choose = (id: string): void => {
    const item = props.items.find((candidate) => candidate.value === id);
    if (item === undefined) return;
    if (item.present) emit("show", id);
    else emit("add", id);
    emit("close", true);
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
        move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeId.value !== null) choose(activeId.value);
    } else if (event.key === "Escape") {
        // 只关这一层：条目页、编辑区不因为这一下做别的。
        event.preventDefault();
        event.stopPropagation();
        emit("close", true);
    } else if (event.key === "Tab") emit("close", false);
};

/** 开着时按在浮层与锚以外的地方：关上，焦点不动（按在锚上由宿主的开关处理）。 */
const onPointerdown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (props.anchor?.contains(target) === true || menu.value?.contains(target) === true) return;
    emit("close", false);
};

/** 刚打开、焦点还没放进搜索框：浮层的内容比 `anchor` 晚挂上，等搜索框出现再放（下面第二个 watch）。 */
const focusPending = shallowRef(false);
// 打开：清空搜索、高亮第一项、焦点进搜索框；开着时听按在外面的指针。
watch(() => props.anchor, (anchor, before) => {
    if (anchor === null) {
        document.removeEventListener("pointerdown", onPointerdown, true);
        focusPending.value = false;
        return;
    }
    if (before === null || before === undefined) {
        query.value = "";
        activeId.value = options.value[0]?.id ?? null;
        document.addEventListener("pointerdown", onPointerdown, true);
    }
    focusPending.value = true;
}, {immediate: true});
watch([search, focusPending], ([element, pending]) => {
    if (element === null || !pending) return;
    element.querySelector("input")?.focus();
    focusPending.value = false;
}, {flush: "post"});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerdown, true));
</script>

<template>
    <SuggestionMenu
        :id="menuId"
        ref="menu"
        :groups="groups"
        :active-id="activeId"
        :anchor="props.anchor"
        :label="text('entry.addComponentShort')"
        :empty-text="text('entry.addGroup.none', {query: query.trim()})"
        side="bottom"
        @select="choose"
        @highlight="(id: string) => (activeId = id)"
    >
        <template #header>
            <div ref="search" class="p-1.5 pb-1" @keydown="onKeydown">
                <Input
                    size="sm"
                    :model-value="query"
                    :aria-label="text('entry.addGroup.search')"
                    :placeholder="text('entry.addGroup.search')"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    :aria-controls="menuId"
                    :aria-activedescendant="activeIndex >= 0 ? suggestionOptionId(menuId, activeIndex) : undefined"
                    @update:model-value="(value: string) => (query = value)"
                />
            </div>
        </template>
    </SuggestionMenu>
</template>

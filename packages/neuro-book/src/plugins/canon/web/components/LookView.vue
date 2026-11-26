<script setup lang="ts">
/**
 * 形象分页（同名 .md，docs/specs/canon/author-ui.md 输出 50、51）：把 `context` 折成 `LookCard` 的属性，把它的事件翻成就地改、换装、
 * 衣柜的加改去这些写入。现在穿的的建议值是衣柜里各套的名字；“换上”打开它的编辑，锚在点的那个按钮上，预选“从这一章起”。
 */
import {computed, inject, onMounted, shallowRef, watch} from "vue";

import {Popover} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import type {ComponentViewContext} from "../component-views";
import {LOOK_PICK_KEY} from "../look-handoff";
import {fieldRows} from "../rows";
import {useCanonText} from "../text";
import LookCard from "./LookCard.vue";
import type {CardFact, CardOutfit, CardPassage} from "./character-card";

const props = defineProps<{context: ComponentViewContext}>();

const text = useCanonText();
const port = useText();
const context = props.context;

/** 形象的固定字段（components.ts 的 `LOOK_COMPONENT`）。 */
const PORTRAIT = "立绘";
const APPEARANCE = "外貌";
const OUTFITS = "服装";
const WEARING = "现在穿的";

const rows = computed(() => new Map(fieldRows(context.namespace, context.fields, context.declarations, context.place, text).map((row) => [row.path.slice(context.namespace.length + 1), row])));
const declarationOf = (id: string) => context.declarations.find((item) => item.id === id);
const shownText = (id: string): string | null => {
    const row = rows.value.get(id);
    return row === undefined || row.unknown ? null : row.display;
};
const markOf = (id: string): {mark?: string} => {
    const mark = rows.value.get(id)?.mark;
    return mark === null || mark === undefined ? {} : {mark};
};
const imageOf = (value: unknown): {readonly path: string; readonly alt: string} | null => {
    const image = value as {readonly 图片?: unknown; readonly 说明?: unknown} | null | undefined;
    return typeof image?.["图片"] === "string" && image["图片"] !== "" ? {path: image["图片"], alt: typeof image["说明"] === "string" ? image["说明"] : ""} : null;
};

const portrait = computed(() => imageOf(context.fields[PORTRAIT]?.value));
/** 自己加的项（形象允许实例字段）卡片不画：嵌一节通用字段表，不让它从这一页消失。 */
const FIXED = new Set([PORTRAIT, APPEARANCE, OUTFITS, WEARING]);
const others = computed(() => context.declarations.filter((item) => !FIXED.has(item.id)).map((item) => item.id));
const appearance = computed<CardPassage | null>(() => (declarationOf(APPEARANCE) === undefined ? null : {id: APPEARANCE, label: declarationOf(APPEARANCE)!.label, text: shownText(APPEARANCE), hint: port.t(text("look.hint.appearance")), ...markOf(APPEARANCE)}));
const wearing = computed<CardFact | null>(() => (declarationOf(WEARING) === undefined ? null : {id: WEARING, label: declarationOf(WEARING)!.label, text: shownText(WEARING), ...markOf(WEARING)}));
const outfits = computed<CardOutfit[]>(() => {
    const value = context.fields[OUTFITS]?.value;
    const now = context.fields[WEARING]?.value;
    return (Array.isArray(value) ? value : []).map((item) => {
        const element = item as {readonly id?: unknown; readonly label?: unknown; readonly 样子?: unknown; readonly 图片?: unknown};
        const name = typeof element.label === "string" ? element.label : "";
        return {id: String(element.id ?? ""), name, look: typeof element["样子"] === "string" ? element["样子"] : "", image: imageOf(element["图片"])?.path ?? null, wearing: name !== "" && name === now};
    });
});
const names = computed(() => outfits.value.map((outfit) => outfit.name).filter((name) => name !== ""));
const editReason = computed(() => (context.blocked === null ? "" : port.t(context.blocked)));

/* ---------- 就地改、换装、来历 ---------- */

/** 现在穿的的编辑器锚在哪：点了某一套的“换上”时是那个按钮，否则是这一项的值。编辑结束就清掉。 */
const wearAnchor = shallowRef<HTMLElement | null>(null);
watch(() => context.editing, (editing) => {
    if (editing !== WEARING) wearAnchor.value = null;
});
const edit = (id: string): void => {
    wearAnchor.value = null;
    context.edit(id, {inline: true});
};
const putOn = (name: string, anchor: HTMLElement): void => {
    wearAnchor.value = anchor;
    context.edit(WEARING, {inline: true, value: name, intent: "story"});
};
// 人物分页的“添加立绘”切过来时（输出 49）：挂上就打开立绘的选图，标记用一次就放倒。
const lookPick = inject(LOOK_PICK_KEY, null);
onMounted(() => {
    if (lookPick?.value !== true) return;
    lookPick.value = false;
    if (context.blocked === null) edit(PORTRAIT);
});
const detailAnchor = shallowRef<HTMLElement | null>(null);
const originsOpen = computed(() => context.detail !== undefined && context.detail !== null && detailAnchor.value !== null);
const showOrigins = (id: string, anchor: HTMLElement): void => {
    detailAnchor.value = anchor;
    context.showDetail?.(id);
};
</script>

<template>
    <div class="min-w-0" data-look-view>
        <LookCard
            :portrait="portrait"
            :portrait-mark="markOf(PORTRAIT).mark"
            :appearance="appearance"
            :wearing="wearing"
            :outfits="outfits"
            :edit-reason="editReason"
            :namespace="context.namespace"
            @edit="edit"
            @origins="showOrigins"
            @put-on="putOn"
            @outfit-edit="(id: string) => context.listEdit?.(OUTFITS, id)"
            @outfit-remove="(id: string) => context.listRemove?.(OUTFITS, id)"
            @outfit-add="context.listAdd?.(OUTFITS)"
        >
            <template #editor="{id, anchor}">
                <component
                    :is="context.FieldEditor"
                    v-if="context.FieldEditor !== undefined"
                    :path="id"
                    :anchor="id === WEARING ? wearAnchor ?? anchor : anchor"
                    :suggestions="id === WEARING ? names : undefined"
                />
            </template>
            <template #passage-editor="{id}">
                <component :is="context.FieldEditor" v-if="context.FieldEditor !== undefined" :path="id" layout="block" />
            </template>
        </LookCard>
        <component :is="context.FieldTable" v-if="others.length > 0" class="mt-6" :fields="others" />
        <Popover :open="originsOpen" :anchor="detailAnchor" side="bottom" align="start" content-class="w-[34rem] max-w-[calc(100vw-32px)] select-text" @update:open="(open: boolean) => { if (!open) context.showDetail?.(null); }">
            <component :is="context.FieldDetail" v-if="originsOpen && context.FieldDetail !== undefined" :path="context.detail!" />
        </Popover>
    </div>
</template>

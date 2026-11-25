<script setup lang="ts">
/**
 * 人物分页（同名 .md，docs/specs/canon/author-ui.md 输出 49、51、52）：把 `context` 折成 `CharacterCard` 的属性，把它的事件翻成
 * 就地改、看来历、加一项这些写入。立绘读自同一条目上的形象这一组（`context.other`）。
 */
import {computed, shallowRef, watch} from "vue";

import type {FieldDraft} from "@notnotype/nb-canon";
import {Button, Dialog, Input, Popover} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {LOOK_COMPONENT} from "../../shared/components";
import type {ComponentViewContext} from "../component-views";
import {fieldRows} from "../rows";
import {useCanonText} from "../text";
import CharacterCard from "./CharacterCard.vue";
import type {CardFact, CardPassage, CardPortrait} from "./character-card";

const props = defineProps<{context: ComponentViewContext}>();

const text = useCanonText();
const port = useText();
const context = props.context;

/** 人物的固定字段怎么排（components.ts 的 `PERSON_COMPONENT`）：短资料一行一项，现在的状态与三段文字在下面。 */
const SHORT = ["性别", "年龄", "身份", "所属", "现在在哪", "生死"];
const CONDITION = "现在的状态";
const PASSAGES: Readonly<Record<string, "temper" | "speech" | "background">> = {性格: "temper", 说话方式: "speech", 背景: "background"};
const FIXED = new Set([...SHORT, CONDITION, ...Object.keys(PASSAGES)]);

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

const facts = computed<CardFact[]>(() => {
    // 自己加的各项排在固定的后面，按声明的顺序。
    const own = context.declarations.filter((item) => !FIXED.has(item.id) && item.kind !== "list").map((item) => item.id);
    return [...SHORT.filter((id) => declarationOf(id) !== undefined), ...own].map((id) => ({
        id,
        label: declarationOf(id)?.label ?? id,
        text: shownText(id),
        ...(declarationOf(id)?.kind === "ref" ? {link: true} : {}),
        ...markOf(id),
        ...(FIXED.has(id) ? {} : {own: true}),
    }));
});
const passageOf = (id: string, hint: string): CardPassage => ({id, label: declarationOf(id)?.label ?? id, text: shownText(id), hint, ...markOf(id)});
const condition = computed(() => (declarationOf(CONDITION) === undefined ? null : passageOf(CONDITION, port.t(text("character.hint.condition")))));
const passages = computed(() => Object.entries(PASSAGES).filter(([id]) => declarationOf(id) !== undefined).map(([id, hint]) => passageOf(id, port.t(text(`character.hint.${hint}`)))));

/** 立绘那一格（输出 49）：按形象这一组的五种情况；宿主不给 `other` 时这一格空着。 */
const portrait = computed<CardPortrait>(() => {
    const other = context.other?.(LOOK_COMPONENT) ?? {status: "unavailable" as const};
    if (other.status === "present") {
        const value = other.peer.fields["立绘"]?.value as {readonly 图片?: unknown; readonly 说明?: unknown} | null | undefined;
        return typeof value?.["图片"] === "string" && value["图片"] !== "" ? {status: "image", path: value["图片"], alt: typeof value["说明"] === "string" ? value["说明"] : ""} : {status: "no-image"};
    }
    return other.status === "later" ? {status: "later", from: other.from} : {status: other.status};
});
const editReason = computed(() => (context.blocked === null ? "" : port.t(context.blocked)));

/* ---------- 就地改与细节 ---------- */

const edit = (id: string): void => context.edit(id, {inline: true});
/** 看来历的浮层贴着点的那个“第 N 章改过”；现在的状态的细节展开在它下面，不用浮层。 */
const detailAnchor = shallowRef<HTMLElement | null>(null);
const originsOpen = computed(() => context.detail !== undefined && context.detail !== null && context.detail !== CONDITION && detailAnchor.value !== null);
const showOrigins = (id: string, anchor: HTMLElement): void => {
    detailAnchor.value = anchor;
    context.showDetail?.(id);
};
const toggleCondition = (): void => context.showDetail?.(context.detail === CONDITION ? null : CONDITION);

const onPortrait = (): void => {
    const status = portrait.value.status;
    if (status === "image" || status === "no-image") context.showTab?.(LOOK_COMPONENT);
    else if (status === "absent" || status === "removed") void context.addComponent?.(LOOK_COMPONENT);
};

/* ---------- 添加一项资料、改名、去掉（输出 52） ---------- */

const addOpen = shallowRef(false);
const adding = shallowRef(false);
const addError = shallowRef("");
const card = shallowRef<{clearOwn(): void} | null>(null);
watch(addOpen, () => {
    addError.value = "";
});
const taken = computed(() => new Set([...context.declarations.map((item) => item.id), ...(context.removedFields ?? []).map((item) => item.id)]));
const presets = computed(() => (context.presets ?? []).filter((preset) => !context.declarations.some((item) => item.id === preset.id || item.label === preset.label) && !(context.removedFields ?? []).some((item) => item.id === preset.id)).map((preset) => ({id: preset.id, label: preset.label})));
const run = async (write: () => Promise<{readonly ok: boolean; readonly reason?: unknown}> | undefined): Promise<boolean> => {
    const pending = write();
    if (pending === undefined) return false;
    adding.value = true;
    const result = await pending;
    adding.value = false;
    if (!result.ok) addError.value = port.t(result.reason as never);
    return result.ok;
};
const addField = async (field: FieldDraft): Promise<void> => {
    if (await run(() => context.fieldAdd?.(field))) {
        card.value?.clearOwn();
        addOpen.value = false;
    }
};
const addPreset = (id: string): void => {
    const preset = context.presets?.find((item) => item.id === id);
    if (preset === undefined) return;
    // 预设的 id 在这个条目上已经占着（去掉过、改过名的同 id 一项）时不给 id，按显示名生成（给的 id 占着会被拒）。
    const {id: presetId, ...rest} = preset;
    void addField(taken.value.has(presetId) ? rest : preset);
};
const restore = async (id: string): Promise<void> => {
    if (await run(() => context.fieldRestore?.(id))) addOpen.value = false;
};

const renaming = shallowRef<{id: string; label: string} | null>(null);
const newName = shallowRef("");
const removing = shallowRef<{id: string; label: string} | null>(null);
const dialogError = shallowRef("");
const busy = shallowRef(false);
const openRename = (id: string): void => {
    renaming.value = {id, label: declarationOf(id)?.label ?? id};
    newName.value = renaming.value.label;
    dialogError.value = "";
};
const openRemove = (id: string): void => {
    removing.value = {id, label: declarationOf(id)?.label ?? id};
    dialogError.value = "";
};
const confirm = async (write: () => Promise<{readonly ok: boolean; readonly reason?: unknown}> | undefined, done: () => void): Promise<void> => {
    const pending = write();
    if (pending === undefined) return;
    busy.value = true;
    const result = await pending;
    busy.value = false;
    if (result.ok) done();
    else dialogError.value = port.t(result.reason as never);
};
</script>

<template>
    <div class="min-w-0" data-character-view>
        <CharacterCard
            ref="card"
            :facts="facts"
            :condition="condition"
            :passages="passages"
            :portrait="portrait"
            :edit-reason="editReason"
            :namespace="context.namespace"
            :condition-open="context.detail === CONDITION"
            :can-add="context.fieldAdd !== undefined"
            :presets="presets"
            :removed="context.removedFields ?? []"
            :add-error="addError"
            :adding="adding"
            :add-open="addOpen"
            @update:add-open="(value: boolean) => (addOpen = value)"
            @edit="edit"
            @origins="showOrigins"
            @toggle-condition="toggleCondition"
            @portrait="onPortrait"
            @add-preset="addPreset"
            @restore="restore"
            @add-own="(label: string) => addField({label, kind: 'text'})"
            @rename="openRename"
            @remove="openRemove"
        >
            <template #editor="{id, anchor}">
                <component :is="context.FieldEditor" v-if="context.FieldEditor !== undefined" :path="id" :anchor="anchor" />
            </template>
            <template #passage-editor="{id}">
                <component :is="context.FieldEditor" v-if="context.FieldEditor !== undefined" :path="id" layout="block" />
            </template>
            <template #condition-detail="{id}">
                <component :is="context.FieldDetail" v-if="context.FieldDetail !== undefined" :path="id" />
            </template>
        </CharacterCard>
        <Popover :open="originsOpen" :anchor="detailAnchor" side="bottom" align="start" content-class="w-[34rem] max-w-[calc(100vw-32px)] select-text" @update:open="(open: boolean) => { if (!open) context.showDetail?.(null); }">
            <component :is="context.FieldDetail" v-if="originsOpen && context.FieldDetail !== undefined" :path="context.detail!" />
        </Popover>
        <Dialog :open="renaming !== null" size="sm" :title="text('card.renameTitle', {label: renaming?.label ?? ''})" show-cancel :busy="busy" @update:open="(open: boolean) => { if (!open) renaming = null; }">
            <form class="flex flex-col gap-2" @submit.prevent="confirm(() => context.fieldRename?.(renaming!.id, newName.trim()), () => (renaming = null))">
                <Input v-model="newName" size="sm" :aria-label="text('card.newName')" autofocus />
                <p v-if="dialogError !== ''" role="alert" class="text-[length:var(--text-xs)] text-[var(--status-danger)]">{{ dialogError }}</p>
            </form>
            <template #footer="{cancel}">
                <Button variant="ghost" :disabled="busy" @click="cancel()">{{ text("edit.cancel") }}</Button>
                <Button :disabled="busy || newName.trim() === '' || newName.trim() === renaming?.label" @click="confirm(() => context.fieldRename?.(renaming!.id, newName.trim()), () => (renaming = null))">{{ text("card.rename") }}</Button>
            </template>
        </Dialog>
        <Dialog :open="removing !== null" size="sm" :title="text('card.removeTitle', {label: removing?.label ?? ''})" show-cancel :busy="busy" @update:open="(open: boolean) => { if (!open) removing = null; }">
            <p class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("card.removeDescription") }}</p>
            <p v-if="dialogError !== ''" role="alert" class="text-[length:var(--text-xs)] text-[var(--status-danger)]">{{ dialogError }}</p>
            <template #footer="{cancel}">
                <Button variant="ghost" :disabled="busy" @click="cancel()">{{ text("edit.cancel") }}</Button>
                <Button variant="danger" :disabled="busy" @click="confirm(() => context.fieldRemove?.(removing!.id), () => (removing = null))">{{ text("card.remove") }}</Button>
            </template>
        </Dialog>
    </div>
</template>

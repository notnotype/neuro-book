<script setup lang="ts">
/**
 * 新建条目的对话框（docs/specs/canon/author-ui.md 输出 4）：名字、种类、分组、放在谁下面、启用哪些数据、它是谁的另一个身份、
 * 从哪里出场。受控：填的东西与各个选项由宿主给（`entries-view.ts`），确认后由宿主发布；结果回来之前对话框不关。
 * 选定种类（点种类的按钮、种类的输入框失焦）时按 `withKind` 套这个种类的默认设定组，打字时不套；勾选列表的“适用于”与预设也只跟着
 * 选定的种类（草稿的 `kindChosen`）换，打字时列表不跳。
 */
import {computed} from "vue";

import {Button, Dialog, Field, Input, Select} from "@notnotype/nb-ui/components";

import {byKind, withKind} from "../new-entry";
import type {NewEntryDraft} from "../new-entry";
import {useCanonText} from "../text";
import ComponentChecklist from "./ComponentChecklist.vue";
import type {ChecklistItem, ChecklistPreset} from "./component-checklist";

const props = withDefaults(defineProps<{
    open: boolean;
    draft: NewEntryDraft;
    /** 种类的候选：登记的在前，已有条目用过的接在后面。 */
    kinds?: readonly string[];
    /** 登记的种类默认带的设定组（类型 id，只含登记了的类型）；没登记的种类不在里面。 */
    kindDefaults?: Readonly<Record<string, readonly string[]>>;
    /** 可以放在下面的条目（已读到的），也是“另一个身份”的候选。 */
    entries?: readonly {readonly id: string; readonly name: string}[];
    /** 登记的类型：勾选列表的各行（没有“已添加”）。 */
    items?: readonly ChecklistItem[];
    /** 每个登记的种类的预设（`kindPresets`）；没登记的种类不在里面。 */
    kindPresets?: Readonly<Record<string, readonly ChecklistPreset[]>>;
    /** 章表：出场位置的选项。 */
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    error?: string;
}>(), {kinds: () => [], kindDefaults: () => ({}), entries: () => [], items: () => [], kindPresets: () => ({}), chapters: () => [], saving: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: NewEntryDraft): void;
    (event: "confirm"): void;
}>();

const text = useCanonText();
const ROOT = "\u0000root";
const NONE = "\u0000none";
const START = "\u0000start";

const patch = (change: Partial<NewEntryDraft>): void => emit("update:draft", {...props.draft, ...change});
const chooseKind = (kind: string): void => {
    const next = withKind(props.draft, kind, props.kindDefaults);
    if (next !== props.draft) emit("update:draft", next);
};
const ready = computed(() => props.draft.name.trim() !== "" && !props.saving);
const entryOptions = computed(() => props.entries.map((entry) => ({value: entry.id, label: entry.name})));
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="text('newEntry.title')"
        show-cancel
        :busy="props.saving"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
    >
        <div class="flex flex-col gap-3" data-new-entry>
            <Field :label="text('newEntry.name')" required>
                <Input :model-value="props.draft.name" @update:model-value="(value: string) => patch({name: value})" />
            </Field>
            <Field :label="text('newEntry.kind')">
                <!-- 失焦算选定种类：focusout 会冒泡，挂在外面一层，不靠 Input 透传原生事件。 -->
                <div @focusout="chooseKind(props.draft.kind)">
                    <Input :model-value="props.draft.kind" :placeholder="text('newEntry.kindPlaceholder')" @update:model-value="(value: string) => patch({kind: value, ...(props.draft.folderTouched ? {} : {folder: value})})" />
                </div>
            </Field>
            <div v-if="props.kinds.length > 0" class="-mt-2 flex flex-wrap gap-1.5" data-new-entry-kinds>
                <Button v-for="kind in props.kinds" :key="kind" size="sm" variant="ghost" @click="chooseKind(kind)">{{ kind }}</Button>
            </div>
            <Field :label="text('newEntry.folder')">
                <Input :model-value="props.draft.folderTouched ? props.draft.folder : props.draft.kind" @update:model-value="(value: string) => patch({folder: value, folderTouched: true})" />
            </Field>
            <Field :label="text('newEntry.parent')">
                <Select :options="[{value: ROOT, label: text('newEntry.root')}, ...entryOptions]" :model-value="props.draft.parent ?? ROOT" @update:model-value="(value: string) => patch({parent: value === ROOT ? null : value})" />
            </Field>
            <Field v-if="props.items.length > 0" :label="text('newEntry.types')" group>
                <!-- 点预设不算作者动过勾选：之后换种类，勾选照旧跟着种类的默认换（输出 4）。列表不封顶，由对话框统一滚。 -->
                <ComponentChecklist
                    :items="props.items"
                    :kind="props.draft.kindChosen"
                    :presets="byKind(props.kindPresets, props.draft.kindChosen) ?? []"
                    :model-value="props.draft.types"
                    @update:model-value="(value: readonly string[], via: 'row' | 'preset') => patch({types: [...value], ...(via === 'preset' ? {} : {typesTouched: true})})"
                />
            </Field>
            <Field :label="text('newEntry.sameAs')">
                <!-- 选了本体以后“放在谁下面”缺省变成它（输出 4）；作者之后还能改。 -->
                <Select :options="[{value: NONE, label: text('newEntry.none')}, ...entryOptions]" :model-value="props.draft.sameAs ?? NONE" @update:model-value="(value: string) => patch(value === NONE ? {sameAs: null} : {sameAs: value, parent: value})" />
            </Field>
            <Field :label="text('newEntry.appears')">
                <Select :options="[{value: START, label: text('newEntry.fromStart')}, ...props.chapters.map((chapter) => ({value: chapter.id, label: text('newEntry.chapterStart', {index: chapter.index})}))]" :model-value="props.draft.appears ?? START" @update:model-value="(value: string) => patch({appears: value === START ? null : value})" />
            </Field>
            <p v-if="props.error !== ''" role="alert" class="text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ props.error }}</p>
        </div>
        <template #footer="{cancel}">
            <Button variant="ghost" :disabled="props.saving" @click="cancel()">{{ text("edit.cancel") }}</Button>
            <Button variant="primary" :disabled="!ready" @click="emit('confirm')">{{ text("newEntry.confirm") }}</Button>
        </template>
    </Dialog>
</template>

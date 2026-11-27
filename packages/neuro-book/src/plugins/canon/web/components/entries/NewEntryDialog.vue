<script setup lang="ts">
/**
 * 新建条目的对话框（docs/specs/canon/author-ui.md 输出 4）：横版两栏。左栏是条目本身（名字、种类、“位置与出场”一段），右栏是设定组的
 * 勾选列表；窄时上下排。受控：填的东西与各个选项由宿主给（`entries-view.ts`），确认后由宿主发布；结果回来之前对话框不关。
 * 选定种类（点种类的按钮、种类的输入框失焦）时按 `withKind` 套这个种类的默认设定组，打字时不套；勾选列表的“适用于”与预设也只跟着
 * 选定的种类（草稿的 `kindChosen`）换，打字时列表不跳。
 */
import {computed, ref, useId} from "vue";

import {Button, Collapsible, Dialog, Field, Input, SearchSelect} from "@notnotype/nb-ui/components";

import {byKind, restoreDefaults, withKind} from "../../new-entry";
import type {NewEntryDraft} from "../../new-entry";
import {useCanonText} from "../../text";
import ComponentChecklist from "../entry-page/ComponentChecklist.vue";
import type {ChecklistItem, ChecklistPreset} from "../entry-page/component-checklist";
import SuggestInput from "../editing/SuggestInput.vue";
import EntryPicker from "./EntryPicker.vue";
import type {EntryResults} from "./entry-picker";

const props = withDefaults(defineProps<{
    open: boolean;
    draft: NewEntryDraft;
    /** 种类的候选：登记的在前，已有条目用过的接在后面。 */
    kinds?: readonly string[];
    /** 登记的种类默认带的设定组（类型 id，只含登记了的类型）；没登记的种类不在里面。 */
    kindDefaults?: Readonly<Record<string, readonly string[]>>;
    /** 已有的分组：分组一项的候选（也能新写）。 */
    folders?: readonly string[];
    /** 上级条目、是谁的马甲两个选择器的查找结果（`useEntryFind`）；不给时是没查过。 */
    parentResults?: EntryResults;
    sameAsResults?: EntryResults;
    /** 登记的类型：勾选列表的各行（没有“已添加”）。 */
    items?: readonly ChecklistItem[];
    /** 每个登记的种类的预设（`kindPresets`）；没登记的种类不在里面。 */
    kindPresets?: Readonly<Record<string, readonly ChecklistPreset[]>>;
    /** 章表：出场的选项。 */
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    /** 失败的原因，写在页脚的状态行；默认空。 */
    error?: string;
}>(), {kinds: () => [], kindDefaults: () => ({}), folders: () => [], parentResults: () => ({kind: "idle"}), sameAsResults: () => ({kind: "idle"}), items: () => [], kindPresets: () => ({}), chapters: () => [], saving: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: NewEntryDraft): void;
    (event: "confirm"): void;
    /** 上级条目、是谁的马甲的选择器要查（打开列表、打字）：宿主经 `useEntryFind` 查，结果从对应的 `*Results` 回来。 */
    (event: "search-parent", query: string): void;
    (event: "search-same-as", query: string): void;
}>();

const text = useCanonText();
const START = "start";
const groupsLabel = `new-entry-groups-${useId()}`;

const patch = (change: Partial<NewEntryDraft>): void => emit("update:draft", {...props.draft, ...change});
const chooseKind = (kind: string): void => {
    const next = withKind(props.draft, kind, props.kindDefaults);
    if (next !== props.draft) emit("update:draft", next);
};
const ready = computed(() => props.draft.name.trim() !== "" && !props.saving);
/** 名字框里回车即新建（输入法组字时的回车只是选字）。 */
const onNameEnter = (event: KeyboardEvent): void => {
    if (event.isComposing || !ready.value) return;
    event.preventDefault();
    emit("confirm");
};

/** 勾选作者动过、又与选定种类的默认不同：出“恢复某某的默认”（没登记默认的种类，默认是一组都不勾）。 */
const defaults = computed(() => byKind(props.kindDefaults, props.draft.kindChosen) ?? []);
const differs = computed(() => props.draft.typesTouched && [...props.draft.types].sort().join(",") !== [...defaults.value].sort().join(","));

/* ---------- 位置与出场 ---------- */

const placeOpen = ref(false);
const following = computed(() => props.draft.sameAs !== null);
/** 分组：作者没改过时跟着种类；候选是已有的分组，也能新写。 */
const shownFolder = computed(() => (props.draft.folderTouched ? props.draft.folder : props.draft.kind).trim());
const folderSuggestions = computed(() => props.folders.filter((folder) => folder !== ""));
/** 选择器只交回 id：名字从这一次查找的结果里取（段头的摘要与“跟着本体”要写名字）。 */
const nameIn = (results: EntryResults, id: string): string => (results.kind === "done" ? (results.items.find((item) => item.id === id)?.name ?? "") : "");
const pickSameAs = (value: string | null): void => {
    if (value === null) patch({sameAs: null, sameAsName: "", parent: null, parentName: ""});
    else {
        const name = nameIn(props.sameAsResults, value);
        patch({sameAs: value, sameAsName: name, parent: value, parentName: name});
    }
};
/** 收起时段头写的现在的值：分组、马甲或上级、出场。 */
const placeSummary = computed(() => {
    const parts = [shownFolder.value === "" ? text("newEntry.noFolder") : shownFolder.value];
    if (following.value) parts.push(text("newEntry.sameAsOf", {name: props.draft.sameAsName}));
    else if (props.draft.parent !== null) parts.push(text("newEntry.under", {name: props.draft.parentName}));
    const chapter = props.chapters.find((item) => item.id === props.draft.appears);
    parts.push(chapter === undefined ? text("newEntry.fromStart") : text("newEntry.appearsAt", {index: chapter.index}));
    return parts.join(" · ");
});
const appearsOptions = computed(() => [{value: START, label: text("newEntry.fromStart")}, ...props.chapters.map((chapter) => ({value: chapter.id, label: text("newEntry.chapterStart", {index: chapter.index})}))]);
</script>

<template>
    <Dialog
        :open="props.open"
        size="lg"
        :title="props.draft.startKind === '' ? text('newEntry.title') : text('newEntry.titleKind', {kind: props.draft.startKind})"
        show-cancel
        :busy="props.saving"
        :status="props.error"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
    >
        <div class="new-entry-frame">
        <div class="new-entry" data-new-entry>
            <div class="new-entry__self">
                <Field :label="text('newEntry.name')" required>
                    <Input :model-value="props.draft.name" @update:model-value="(value: string) => patch({name: value})" @keydown.enter="onNameEnter" />
                </Field>
                <Field :label="text('newEntry.kind')">
                    <!-- 失焦算选定种类：focusout 会冒泡，挂在外面一层，不靠 Input 透传原生事件。 -->
                    <div class="flex flex-col gap-2" @focusout="(event: FocusEvent) => (event.target as HTMLElement).tagName === 'INPUT' && chooseKind(props.draft.kind)">
                        <Input :model-value="props.draft.kind" :placeholder="text('newEntry.kindPlaceholder')" @update:model-value="(value: string) => patch({kind: value, ...(props.draft.folderTouched ? {} : {folder: value})})" />
                        <div v-if="props.kinds.length > 0" class="flex flex-wrap gap-1.5" role="group" :aria-label="text('newEntry.commonKinds')" data-new-entry-kinds>
                            <!-- 候选是看得出能点的按钮；选定的那个用强调色浅底（选中、当前是强调色的分工）。 -->
                            <Button
                                v-for="kind in props.kinds"
                                :key="kind"
                                size="sm"
                                variant="subtle"
                                class="new-entry__kind"
                                :aria-pressed="props.draft.kindChosen === kind"
                                @click="chooseKind(kind)"
                            >{{ kind }}</Button>
                        </div>
                    </div>
                </Field>
                <div class="new-entry__section">
                    <Collapsible :open="placeOpen" @update:open="(value: boolean) => (placeOpen = value)">
                        <template #trigger>
                            <button type="button" class="new-entry__section-head" data-new-entry-place>
                                <span class="i-lucide-chevron-right new-entry__chevron" :data-open="placeOpen ? '' : undefined" aria-hidden="true" />
                                <span class="new-entry__section-label">{{ text("newEntry.place") }}</span>
                                <span class="new-entry__section-summary" data-new-entry-place-summary>{{ placeSummary }}</span>
                            </button>
                        </template>
                        <div class="new-entry__section-body">
                            <Field :label="text('newEntry.folder')">
                                <SuggestInput
                                    size="md"
                                    :model-value="shownFolder"
                                    :suggestions="folderSuggestions"
                                    :label="text('newEntry.folder')"
                                    :placeholder="text('newEntry.noFolder')"
                                    @update:model-value="(value: string) => patch({folder: value, folderTouched: true})"
                                />
                            </Field>
                            <Field :label="text('newEntry.sameAs')" data-new-entry-same-as>
                                <!-- 选了本体以后上级跟着它（输出 4），下面那一项写成“某某（跟着本体）”。 -->
                                <EntryPicker
                                    :model-value="props.draft.sameAs"
                                    :selected-name="props.draft.sameAsName"
                                    :results="props.sameAsResults"
                                    :placeholder="text('newEntry.none')"
                                    clearable
                                    @search="(query: string) => emit('search-same-as', query)"
                                    @update:model-value="pickSameAs"
                                />
                            </Field>
                            <Field :label="text('newEntry.parent')" data-new-entry-parent>
                                <p v-if="following" class="new-entry__following" data-new-entry-following>
                                    <span class="i-lucide-link-2 size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />{{ text("newEntry.followsSameAs", {name: props.draft.sameAsName}) }}
                                </p>
                                <EntryPicker
                                    v-else
                                    :model-value="props.draft.parent"
                                    :selected-name="props.draft.parentName"
                                    :results="props.parentResults"
                                    :placeholder="text('newEntry.root')"
                                    clearable
                                    @search="(query: string) => emit('search-parent', query)"
                                    @update:model-value="(value: string | null) => patch({parent: value, parentName: value === null ? '' : nameIn(props.parentResults, value)})"
                                />
                            </Field>
                            <Field :label="text('newEntry.appears')">
                                <SearchSelect :options="appearsOptions" :model-value="props.draft.appears ?? START" @update:model-value="(value: string) => patch({appears: value === START ? null : value})" />
                            </Field>
                        </div>
                    </Collapsible>
                </div>
            </div>
            <!-- 右栏不撑高这一行：高度跟左栏走（窄时上下排，按自己的高度），列表在栏里滚，右下不留空白。 -->
            <div v-if="props.items.length > 0" class="new-entry__groups">
                <div class="new-entry__groups-inner" role="group" :aria-labelledby="groupsLabel" data-nb-field-group>
                    <!-- 标题这一行定高：“恢复某某的默认”只在动过勾选、又与默认不同时出现，淡入淡出，不推动列表。 -->
                    <div class="new-entry__groups-head">
                        <span :id="groupsLabel" class="text-[length:var(--text-sm)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">{{ text("newEntry.types") }}</span>
                        <Transition name="new-entry-restore">
                            <Button v-if="differs" size="sm" variant="ghost" data-new-entry-restore @click="emit('update:draft', restoreDefaults(props.draft, props.kindDefaults))">
                                <span class="i-lucide-rotate-ccw size-3.5" aria-hidden="true" />{{ text("newEntry.restore", {kind: props.draft.kindChosen}) }}
                            </Button>
                        </Transition>
                    </div>
                    <!-- 点预设不算作者动过勾选：之后换种类，勾选照旧跟着种类的默认换（输出 4）。 -->
                    <ComponentChecklist
                        fill
                        :items="props.items"
                        :kind="props.draft.kindChosen"
                        :presets="byKind(props.kindPresets, props.draft.kindChosen) ?? []"
                        :model-value="props.draft.types"
                        @update:model-value="(value: readonly string[], via: 'row' | 'preset') => patch({types: [...value], ...(via === 'preset' ? {} : {typesTouched: true})})"
                    />
                </div>
            </div>
        </div>
        </div>
        <template #footer="{cancel}">
            <Button variant="ghost" :disabled="props.saving" @click="cancel()">{{ text("edit.cancel") }}</Button>
            <Button variant="primary" :disabled="!ready" @click="emit('confirm')">{{ text("newEntry.confirm") }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
/*
 * 两栏各一半，行高取两栏里高的那个：右栏的勾选列表封顶 24rem、在里面滚，左栏展开“位置与出场”变高时右栏跟着拉长，两边都不留大块空白。
 * 按对话框自己的宽度（容器查询）决定窄时上下排：对话框在窄的编辑区或窗口里都按它自己量。
 */
.new-entry-frame {
    container-type: inline-size;
}
.new-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px 32px;
}
.new-entry__self {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 12px;
}
.new-entry__groups {
    display: flex;
    min-width: 0;
    max-height: 24rem;
    flex-direction: column;
}
.new-entry__groups-inner {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 6px;
}
.new-entry__groups-head {
    display: flex;
    height: 24px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
@container (max-width: 560px) {
    .new-entry {
        grid-template-columns: minmax(0, 1fr);
    }
    .new-entry__groups {
        max-height: 20rem;
    }
}
.new-entry__kind[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
    color: var(--accent-main);
}
.new-entry__section {
    border-block: var(--border-w) solid var(--divider);
}
.new-entry__section-head {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    gap: 8px;
    padding-inline: 2px;
    border-radius: var(--radius-control);
    text-align: left;
    font-size: var(--text-sm);
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.new-entry__section-head:hover,
.new-entry__section-head:focus-visible {
    background: var(--bg-hover);
}
.new-entry__chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform var(--motion-fast) var(--ease-layout);
}
.new-entry__chevron[data-open] {
    transform: rotate(90deg);
}
.new-entry__section-label {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--text-main);
}
/* 现在的值单行截断、靠右：长短不推动段头。 */
.new-entry__section-summary {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--text-secondary);
}
.new-entry__section-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 2px 12px 24px;
}
.new-entry__following {
    display: flex;
    height: var(--control-h-md);
    margin: 0;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}
.new-entry-restore-enter-active,
.new-entry-restore-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.new-entry-restore-enter-from,
.new-entry-restore-leave-to {
    opacity: 0;
}
</style>

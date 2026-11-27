<script setup lang="ts">
/**
 * w00055 t04 第 1 轮静态稿：新建条目对话框改版。第一眼只有名字与种类；设定组、位置与出场各收成一段，收起时标题行写出现在的值；
 * 本体与上级挨着，选了本体以后上级跟着它、写明是跟着的。数据都是本地的样本，点了能换状态，不建东西。
 */
import {computed, ref} from "vue";

import {Button, Collapsible, Dialog, Field, Input, SearchSelect} from "@notnotype/nb-ui/components";

import ComponentChecklist from "nbook/plugins/canon/web/components/entry-page/ComponentChecklist.vue";
import type {ChecklistItem, ChecklistPreset} from "nbook/plugins/canon/web/components/entry-page/component-checklist";

const props = withDefaults(defineProps<{
    /** 从哪个入口打开：`plain` 是设定树的“新建条目”，`person` 是“新建人物”（种类已选好）。 */
    start: "plain" | "person";
    /** 预先填的名字。默认空。 */
    name?: string;
    /** 一开始展开“设定组”。默认 false。 */
    groupsOpen?: boolean;
    /** 一开始展开“位置与出场”。默认 false。 */
    placeOpen?: boolean;
    /** 一开始就选了本体（马甲）。默认 false。 */
    sameAs?: boolean;
    /** 一开始就动过勾选（不再跟着种类换，出“恢复默认”）。默认 false。 */
    customized?: boolean;
    /** 从设定树里选中的条目上新建：上级预先填好。默认 false。 */
    underSelected?: boolean;
}>(), {name: "", groupsOpen: false, placeOpen: false, sameAs: false, customized: false, underSelected: false});

const KINDS = ["人物", "组织", "地点", "物品"];
const DEFAULTS: Readonly<Record<string, readonly string[]>> = {人物: ["nbook.canon.person", "nbook.canon.look"]};
const ITEMS: ChecklistItem[] = [
    {value: "nbook.canon.person", label: "人物", iconClass: "i-lucide-user-round", group: "canon", kinds: ["人物"], present: false, restore: false},
    {value: "nbook.canon.look", label: "形象", iconClass: "i-lucide-shirt", group: "canon", kinds: ["人物"], present: false, restore: false},
    {value: "nbook.canon.panel", label: "数值", iconClass: "i-lucide-gauge", group: "canon", kinds: [], present: false, restore: false},
    {value: "nbook.plot.knowing", label: "知情", iconClass: "i-lucide-key-round", group: "plot", kinds: ["人物"], present: false, restore: false},
    {value: "nbook.plot.attitude", label: "态度", iconClass: "i-lucide-target", group: "plot", kinds: ["人物"], present: false, restore: false},
];
const LABELS = new Map(ITEMS.map((item) => [item.value, item.label]));
const PRESETS: Readonly<Record<string, readonly ChecklistPreset[]>> = {人物: [{id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]}, {id: "main", label: "主要角色", components: ITEMS.map((item) => item.value)}]};
const ENTRIES = [{value: "xingxia", label: "星瑕"}, {value: "academy", label: "第三魔法学院"}, {value: "council", label: "对策委员会"}];
const CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => ({value: String(index), label: `第 ${index} 章开头`}));
const FOLDERS = ["人物", "地点", "组织"].map((folder) => ({value: folder, label: folder}));
const NO_ONE = "none";
const FROM_START = "start";

const name = ref(props.name);
const kind = ref(props.start === "person" ? "人物" : "");
const types = ref<readonly string[]>(props.customized ? ["nbook.canon.person"] : (DEFAULTS[kind.value] ?? []));
const touched = ref(props.customized);
const folder = ref("");
const folderTouched = ref(false);
const sameAs = ref(props.sameAs ? "xingxia" : NO_ONE);
const parent = ref(props.underSelected ? "academy" : NO_ONE);
const appears = ref(FROM_START);
const groupsOpen = ref(props.groupsOpen);
const placeOpen = ref(props.placeOpen);

const chooseKind = (value: string): void => {
    kind.value = value;
    if (!folderTouched.value) folder.value = value;
    if (!touched.value) types.value = DEFAULTS[value] ?? [];
};
if (kind.value !== "") folder.value = kind.value;
const kindDefaults = computed(() => DEFAULTS[kind.value] ?? []);
/** 勾选与这个种类的默认不同：出“恢复默认”。 */
const differs = computed(() => touched.value && [...types.value].sort().join() !== [...kindDefaults.value].sort().join());
const restore = (): void => {
    types.value = kindDefaults.value;
    touched.value = false;
};
const nameOf = (options: readonly {value: string; label: string}[], value: string): string => options.find((option) => option.value === value)?.label ?? "";
/** 选了本体以后上级跟着本体：上级一项写“跟着本体”，不可改（真实对话框里作者之后仍能在条目页移动）。 */
const following = computed(() => sameAs.value !== NO_ONE);
const shownParent = computed(() => (following.value ? sameAs.value : parent.value));

const groupsSummary = computed(() => (types.value.length === 0 ? "不加" : types.value.map((value) => LABELS.get(value) ?? value).join("、")));
const placeSummary = computed(() => {
    const parts = [folder.value === "" ? "不分组" : folder.value];
    if (following.value) parts.push(`${nameOf(ENTRIES, sameAs.value)}的马甲`);
    else if (parent.value !== NO_ONE) parts.push(`在${nameOf(ENTRIES, parent.value)}下面`);
    parts.push(appears.value === FROM_START ? "一开始就在" : `第 ${appears.value} 章出场`);
    return parts.join(" · ");
});
const ready = computed(() => name.value.trim() !== "");
</script>

<template>
    <Dialog :open="true" size="md" :title="props.start === 'person' ? '新建人物' : '新建条目'" show-cancel>
        <div class="flex flex-col gap-3" data-new-entry-draft>
            <Field label="名字" required>
                <Input v-model="name" placeholder="" />
            </Field>
            <Field label="种类">
                <div class="flex flex-col gap-2">
                    <Input :model-value="kind" placeholder="比如：人物、地点、物品" @update:model-value="(value: string) => chooseKind(value)" />
                    <div class="flex flex-wrap gap-1.5" role="group" aria-label="常用种类">
                        <!-- 候选做成看得出能点的按钮；选中的用强调色的浅底与字（“选中、当前”是强调色的分工）。 -->
                        <Button v-for="item in KINDS" :key="item" size="sm" variant="subtle" :class="kind === item ? 'draft-kind--on' : ''" :aria-pressed="kind === item" @click="chooseKind(item)">{{ item }}</Button>
                    </div>
                </div>
            </Field>

            <div class="draft-sections">
                <Collapsible :open="groupsOpen" @update:open="(value: boolean) => (groupsOpen = value)">
                    <template #trigger>
                        <button type="button" class="draft-section-head" :aria-expanded="groupsOpen">
                            <span class="i-lucide-chevron-right draft-section-head__chevron" :class="groupsOpen ? 'rotate-90' : ''" aria-hidden="true" />
                            <span class="draft-section-head__label">设定组</span>
                            <span class="draft-section-head__summary">{{ groupsSummary }}</span>
                        </button>
                    </template>
                    <div class="draft-section-body">
                        <div v-if="differs" class="mb-2 flex justify-end">
                            <Button size="sm" variant="ghost" @click="restore()"><span class="i-lucide-rotate-ccw size-3.5" aria-hidden="true" />恢复{{ kind }}的默认</Button>
                        </div>
                        <ComponentChecklist
                            :items="ITEMS"
                            :kind="kind"
                            :presets="PRESETS[kind] ?? []"
                            :model-value="types"
                            max-height="16rem"
                            @update:model-value="(value: readonly string[], via: 'row' | 'preset') => { types = value; if (via === 'row') touched = true; }"
                        />
                    </div>
                </Collapsible>
                <Collapsible :open="placeOpen" @update:open="(value: boolean) => (placeOpen = value)">
                    <template #trigger>
                        <button type="button" class="draft-section-head" :aria-expanded="placeOpen">
                            <span class="i-lucide-chevron-right draft-section-head__chevron" :class="placeOpen ? 'rotate-90' : ''" aria-hidden="true" />
                            <span class="draft-section-head__label">位置与出场</span>
                            <span class="draft-section-head__summary">{{ placeSummary }}</span>
                        </button>
                    </template>
                    <div class="draft-section-body flex flex-col gap-3">
                        <Field label="分组">
                            <SearchSelect :options="FOLDERS" :model-value="folder" placeholder="不分组" @update:model-value="(value: string) => { folder = value; folderTouched = true; }" />
                        </Field>
                        <Field label="是谁的马甲">
                            <SearchSelect :options="[{value: NO_ONE, label: '不是马甲'}, ...ENTRIES]" :model-value="sameAs" @update:model-value="(value: string) => (sameAs = value)" />
                        </Field>
                        <Field label="上级条目">
                            <SearchSelect v-if="!following" :options="[{value: NO_ONE, label: '无'}, ...ENTRIES]" :model-value="shownParent" @update:model-value="(value: string) => (parent = value)" />
                            <!-- 马甲挂在本体下面：写明是跟着本体的，不给一个看起来能改却会被改回去的框。 -->
                            <p v-else class="m-0 flex h-[var(--control-h-md)] items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                                <span class="i-lucide-link-2 size-3.5 text-[var(--text-muted)]" aria-hidden="true" />{{ nameOf(ENTRIES, shownParent) }}（跟着本体）
                            </p>
                        </Field>
                        <Field label="出场">
                            <SearchSelect :options="[{value: FROM_START, label: '一开始就在'}, ...CHAPTERS]" :model-value="appears" @update:model-value="(value: string) => (appears = value)" />
                        </Field>
                    </div>
                </Collapsible>
            </div>
        </div>
        <template #footer="{cancel}">
            <Button variant="ghost" @click="cancel()">取消</Button>
            <Button variant="primary" :disabled="!ready">新建</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.draft-kind--on {
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
    color: var(--accent-main);
}
/* 两段折叠区上下各一条发丝线，和上面的字段分开；段头整行可点。 */
.draft-sections {
    border-top: var(--border-w) solid var(--divider);
}
.draft-sections > * {
    border-bottom: var(--border-w) solid var(--divider);
}
.draft-section-head {
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
.draft-section-head:hover,
.draft-section-head:focus-visible {
    background: var(--bg-hover);
}
.draft-section-head__chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform var(--motion-fast) var(--ease-layout);
}
.draft-section-head__label {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--text-main);
}
/* 摘要单行截断、靠右：定宽的那一格，长短不推动段头。 */
.draft-section-head__summary {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--text-secondary);
}
.draft-section-body {
    padding: 4px 2px 12px 24px;
}
</style>

<script setup lang="ts">
/**
 * 条目页的骨架（docs/specs/canon/author-ui.md 输出 6 到 9、27）：页头、几行状态说明、分页条；分页的内容由宿主放进默认插槽。
 * 受控：位置、“按计划”、当前分页都由宿主给，交互时发出新值。
 */
import {computed, nextTick, ref, useId} from "vue";

import {Button, DropdownMenu, IconButton, Input, Select, Switch, Tabs} from "@notnotype/nb-ui/components";
import type {SelectOption, TabsItem} from "@notnotype/nb-ui/components";

import type {LineOption} from "../../shared/reads";
import {useCanonText} from "../text";
import LineSelect from "./LineSelect.vue";
import WorldBanners from "./WorldBanners.vue";

export type EntryPageStatus = "loading" | "failed" | "missing" | "deleted" | "normal";

const props = withDefaults(defineProps<{
    status: EntryPageStatus;
    name?: string;
    summary?: string;
    /** 马甲条目的本体（输出 6 的“是谁：某某”）。 */
    sameAs?: {readonly id: string; readonly name: string} | null;
    positions?: readonly SelectOption[];
    /** 位置选择的值（`positions.ts` 的 `positionValue`）。 */
    position?: string;
    planned?: boolean;
    /** 在所选位置上还没出场时，所选位置的文字（输出 8）。 */
    notAppeared?: string;
    /** 选过的那一章被删掉了，位置已经回到缺省（输出 7）。 */
    positionGone?: boolean;
    disconnected?: boolean;
    /** 世界只读的原因（输出 28）；可以写时为空。 */
    readOnly?: string;
    tabs?: readonly TabsItem[];
    tab?: string;
    /** 页头“更多”里的“删除条目”可用（输出 19）；写不了时不可用。 */
    deletable?: boolean;
    /** 可选的线（输出 34）；只有主线时不画线选择。 */
    lineOptions?: readonly LineOption[];
    /** 窗口在看的线；空串是跟着章。 */
    line?: string;
    /** 这一页按自己的位置实际读的线。 */
    resolvedLine?: string;
    /** 页头的写入入口（名字、简介、别名、移动、加或去设定组、恢复）都出；默认 false。 */
    editable?: boolean;
    /** 写入入口现在不可用的原因（按计划开着、世界只读、别人独占）：入口禁用、悬停提示是它。默认空（可用）。 */
    editReason?: string;
    /** 读取位置上的别名。 */
    aliases?: readonly string[];
    /** 当前是一个数据分页时，这组设定的名字：“更多”里多一项“去掉这组设定”。默认空。 */
    removableGroup?: string;
    /** 页头写入失败的原因，写在页头下面。默认空。 */
    actionError?: string;
}>(), {deletable: false, name: "", summary: "", sameAs: null, positions: () => [], position: "", planned: false, notAppeared: "", positionGone: false, disconnected: false, readOnly: "", tabs: () => [], tab: "", lineOptions: () => [], line: "", resolvedLine: "main", editable: false, editReason: "", aliases: () => [], removableGroup: "", actionError: ""});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
    (event: "update:tab", value: string): void;
    (event: "update:line", value: string): void;
    (event: "open-entry", id: string): void;
    (event: "retry"): void;
    /** 选了“更多”里的“删除条目”。 */
    (event: "delete"): void;
    /** 名字、简介旁的“改”：宿主打开确认条。 */
    (event: "edit-name"): void;
    (event: "edit-summary"): void;
    /** 加一个别名（输入框里回车）或去掉一个（标签上的 ×）。 */
    (event: "aliases", change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}): void;
    /** “更多”里的“移动到……”“添加一组设定……”“去掉这组设定”。 */
    (event: "move"): void;
    (event: "add-component"): void;
    (event: "remove-component"): void;
    /** 已删除页上的“恢复”。 */
    (event: "restore"): void;
}>();

defineSlots<{
    /** 当前分页的内容。 */
    default?(): unknown;
    /** 页头之下、分页内容之上：确认条（各分页共用这一处）。 */
    bar?(): unknown;
}>();

const blockedReason = computed(() => (props.editReason === "" ? undefined : props.editReason));
const menuItems = computed(() => [
    ...(props.editable
        ? [
              {id: "move", label: text("entry.moveTo"), iconClass: "i-lucide-folder-input", disabled: blockedReason.value !== undefined},
              {id: "add-component", label: text("entry.addComponent"), iconClass: "i-lucide-plus", disabled: blockedReason.value !== undefined},
              ...(props.removableGroup === "" ? [] : [{id: "remove-component", label: text("entry.removeComponent", {name: props.removableGroup}), iconClass: "i-lucide-minus", disabled: blockedReason.value !== undefined}]),
          ]
        : []),
    {id: "delete", label: text("entry.delete"), iconClass: "i-lucide-trash-2", tone: "danger" as const, disabled: !props.deletable},
]);
const onMenu = (id: string): void => {
    if (id === "delete") emit("delete");
    else if (id === "move") emit("move");
    else if (id === "add-component") emit("add-component");
    else if (id === "remove-component") emit("remove-component");
};

// 加别名：点“＋”出一个输入框，回车加上，Escape 或失焦收起。
const adding = ref(false);
const aliasDraft = ref("");
const aliasBox = ref<HTMLElement | null>(null);
const startAlias = async (): Promise<void> => {
    adding.value = true;
    aliasDraft.value = "";
    await nextTick();
    aliasBox.value?.querySelector("input")?.focus();
};
const commitAlias = (): void => {
    const alias = aliasDraft.value.trim();
    adding.value = false;
    if (alias !== "" && !props.aliases.includes(alias)) emit("aliases", {add: [alias]});
};

const text = useCanonText();
// 同一窗口里可能挂着几个条目页（拆分以后），id 要各不相同。
const PANEL_ID = `canon-entry-panel-${useId()}`;
const tabId = (value: string): string => `${PANEL_ID}-tab-${value}`;
</script>

<template>
    <article class="min-h-full" data-entry-page>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <p v-if="props.status === 'loading'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">{{ text("entries.loading") }}</p>
        <p v-else-if="props.status === 'failed'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ text("world.failed") }}</p>
        <p v-else-if="props.status === 'missing'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.missing") }}</p>
        <div v-else-if="props.status === 'deleted'" class="mx-auto max-w-[760px] px-8 py-6">
            <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-secondary)]">{{ props.name }}</h1>
            <p class="mt-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.deleted") }}</p>
            <Button v-if="props.editable" class="mt-3" size="sm" :disabled="blockedReason !== undefined" :title="blockedReason" data-entry-restore @click="emit('restore')">{{ text("entry.restore") }}</Button>
            <p v-if="props.actionError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ props.actionError }}</p>
        </div>
        <template v-else>
            <!-- 窄屏上页头换成几行，吸顶会占掉大半个视口，只在宽屏吸顶。 -->
            <header class="z-[1] border-b border-[var(--divider)] bg-[var(--panel-surface)] px-8 pt-5 min-[481px]:sticky min-[481px]:top-0 max-[480px]:px-4">
                <div class="mx-auto flex max-w-[760px] flex-wrap items-start gap-x-4 gap-y-2">
                    <div class="min-w-0 flex-1 basis-64">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">{{ props.name }}</h1>
                            <Button v-if="props.editable" size="sm" variant="ghost" :disabled="blockedReason !== undefined" :title="blockedReason" :aria-label="text('entry.editName')" data-edit="entry.name" @click="emit('edit-name')">{{ text("edit.button") }}</Button>
                            <span v-if="props.sameAs !== null" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                                {{ text("entry.sameAs") }}<button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open-entry', props.sameAs.id)">{{ props.sameAs.name }}</button>
                            </span>
                        </div>
                        <div v-if="props.summary !== '' || props.editable" class="mt-1 flex flex-wrap items-baseline gap-x-2">
                            <p v-if="props.summary !== ''" class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ props.summary }}</p>
                            <Button v-if="props.editable" size="sm" variant="ghost" :disabled="blockedReason !== undefined" :title="blockedReason" :aria-label="text('entry.editSummary')" data-edit="entry.summary" @click="emit('edit-summary')">{{ props.summary === "" ? text("entry.addSummary") : text("edit.button") }}</Button>
                        </div>
                        <ul v-if="props.aliases.length > 0 || props.editable" class="mt-1 flex flex-wrap items-center gap-1.5" :aria-label="text('entry.aliases')" data-entry-aliases>
                            <li v-for="alias in props.aliases" :key="alias" class="flex items-center gap-0.5 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                                {{ alias }}
                                <IconButton v-if="props.editable" size="xs" icon-class="i-lucide-x" :disabled="blockedReason !== undefined" :aria-label="text('entry.removeAlias', {alias})" :title="blockedReason ?? text('entry.removeAlias', {alias})" @click="emit('aliases', {remove: [alias]})" />
                            </li>
                            <li v-if="props.editable" ref="aliasBox">
                                <Input v-if="adding" v-model="aliasDraft" size="sm" class="w-32" :aria-label="text('entry.newAlias')" :placeholder="text('entry.newAlias')" @keydown.enter.prevent="commitAlias()" @keydown.escape.prevent="adding = false" @blur="adding = false" />
                                <Button v-else size="sm" variant="ghost" :disabled="blockedReason !== undefined" :title="blockedReason" @click="startAlias()">{{ text("entry.addAlias") }}</Button>
                            </li>
                        </ul>
                    </div>
                    <div class="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                        <LineSelect :options="props.lineOptions" :line="props.line" :resolved="props.resolvedLine" @update:line="(value: string) => emit('update:line', value)" />
                        <Select class="w-52 max-w-full" size="sm" :aria-label="text('entry.position')" :options="[...props.positions]" :model-value="props.position" @update:model-value="(value: string) => emit('update:position', value)" />
                        <label class="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                            <Switch size="sm" :model-value="props.planned" :aria-label="text('entry.planned')" @update:model-value="(value: boolean) => emit('update:planned', value)" />{{ text("entry.planned") }}
                        </label>
                        <DropdownMenu align="end" :items="menuItems" @select="onMenu">
                            <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('entry.more')" :title="text('entry.more')" />
                        </DropdownMenu>
                    </div>
                </div>
                <Tabs class="mx-auto mt-3 max-w-[760px]" size="sm" :baseline="false" :aria-label="text('entry.tabs.label')" :items="props.tabs.map((item) => ({...item, id: tabId(item.value), controls: PANEL_ID}))" :model-value="props.tab" @update:model-value="(value: string) => emit('update:tab', value)" />
            </header>
            <div class="mx-auto max-w-[760px] px-8 py-5 max-[480px]:px-4">
                <p v-if="props.actionError !== ''" role="alert" class="mb-3 text-[length:var(--text-sm)] text-[var(--status-danger)]" data-entry-action-error>{{ props.actionError }}</p>
                <slot name="bar" />
                <p v-if="props.positionGone" role="status" class="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.positionGone") }}</p>
                <p v-if="props.notAppeared !== ''" class="mb-3 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.notAppeared", {position: props.notAppeared}) }}</p>
                <div :id="PANEL_ID" role="tabpanel" :aria-labelledby="tabId(props.tab)">
                    <slot />
                </div>
            </div>
        </template>
    </article>
</template>

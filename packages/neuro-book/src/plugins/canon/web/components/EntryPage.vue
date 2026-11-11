<script setup lang="ts">
/**
 * 条目页的骨架（docs/specs/canon/author-ui.md 输出 6 到 9、27）：页头、几行状态说明、分页条；分页的内容由宿主放进默认插槽。
 * 受控：位置、“按计划”、当前分页都由宿主给，交互时发出新值。
 */
import {useId} from "vue";

import {Banner, Button, DropdownMenu, IconButton, Select, Switch, Tabs} from "@notnotype/nb-ui/components";
import type {SelectOption, TabsItem} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

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
    tabs?: readonly TabsItem[];
    tab?: string;
    /** 页头“更多”里的“删除条目”可用（输出 19）；写不了时不可用。 */
    deletable?: boolean;
}>(), {deletable: false, name: "", summary: "", sameAs: null, positions: () => [], position: "", planned: false, notAppeared: "", positionGone: false, disconnected: false, tabs: () => [], tab: ""});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
    (event: "update:tab", value: string): void;
    (event: "open-entry", id: string): void;
    (event: "retry"): void;
    /** 选了“更多”里的“删除条目”。 */
    (event: "delete"): void;
}>();

defineSlots<{
    /** 当前分页的内容。 */
    default?(): unknown;
}>();

const text = useCanonText();
// 同一窗口里可能挂着几个条目页（拆分以后），id 要各不相同。
const PANEL_ID = `canon-entry-panel-${useId()}`;
const tabId = (value: string): string => `${PANEL_ID}-tab-${value}`;
</script>

<template>
    <article class="min-h-full" data-entry-page>
        <Banner v-if="props.disconnected" tone="warning" role="status" class="m-3" :message="text('world.disconnected')">
            <template #actions><Button size="sm" @click="emit('retry')">{{ text("world.retry") }}</Button></template>
        </Banner>
        <p v-if="props.status === 'loading'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">{{ text("entries.loading") }}</p>
        <p v-else-if="props.status === 'failed'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ text("world.failed") }}</p>
        <p v-else-if="props.status === 'missing'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.missing") }}</p>
        <div v-else-if="props.status === 'deleted'" class="mx-auto max-w-[760px] px-8 py-6">
            <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-secondary)]">{{ props.name }}</h1>
            <p class="mt-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.deleted") }}</p>
        </div>
        <template v-else>
            <!-- 窄屏上页头换成几行，吸顶会占掉大半个视口，只在宽屏吸顶。 -->
            <header class="z-[1] border-b border-[var(--divider)] bg-[var(--panel-surface)] px-8 pt-5 min-[481px]:sticky min-[481px]:top-0 max-[480px]:px-4">
                <div class="mx-auto flex max-w-[760px] flex-wrap items-start gap-x-4 gap-y-2">
                    <div class="min-w-0 flex-1 basis-64">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">{{ props.name }}</h1>
                            <span v-if="props.sameAs !== null" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                                {{ text("entry.sameAs") }}<button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open-entry', props.sameAs.id)">{{ props.sameAs.name }}</button>
                            </span>
                        </div>
                        <p v-if="props.summary !== ''" class="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ props.summary }}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-3">
                        <Select class="w-52" size="sm" :aria-label="text('entry.position')" :options="[...props.positions]" :model-value="props.position" @update:model-value="(value: string) => emit('update:position', value)" />
                        <label class="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                            <Switch size="sm" :model-value="props.planned" :aria-label="text('entry.planned')" @update:model-value="(value: boolean) => emit('update:planned', value)" />{{ text("entry.planned") }}
                        </label>
                        <DropdownMenu align="end" :items="[{id: 'delete', label: text('entry.delete'), iconClass: 'i-lucide-trash-2', tone: 'danger', disabled: !props.deletable}]" @select="(id: string) => id === 'delete' && emit('delete')">
                            <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('entry.more')" :title="text('entry.more')" />
                        </DropdownMenu>
                    </div>
                </div>
                <Tabs class="mx-auto mt-3 max-w-[760px]" size="sm" :baseline="false" :aria-label="text('entry.tabs.label')" :items="props.tabs.map((item) => ({...item, id: tabId(item.value), controls: PANEL_ID}))" :model-value="props.tab" @update:model-value="(value: string) => emit('update:tab', value)" />
            </header>
            <div class="mx-auto max-w-[760px] px-8 py-5 max-[480px]:px-4">
                <p v-if="props.positionGone" role="status" class="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.positionGone") }}</p>
                <p v-if="props.notAppeared !== ''" class="mb-3 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.notAppeared", {position: props.notAppeared}) }}</p>
                <div :id="PANEL_ID" role="tabpanel" :aria-labelledby="tabId(props.tab)">
                    <slot />
                </div>
            </div>
        </template>
    </article>
</template>

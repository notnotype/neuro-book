<script setup lang="ts">
import type {ModelRow, SnapshotProvider} from "@notnotype/nb-models/contract";
import {IconButton, Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {tokensText, useModelsText} from "../text";
import CapabilityIcons from "./CapabilityIcons.vue";
import ProviderIcon from "./ProviderIcon.vue";

/**
 * “全部模型”（docs/specs/models/settings-pages.md 输出 11）：每家服务商一节，默认收起、收起的不渲染；展开才读这家的行，每行可打开
 * 编辑对话框。搜索时读全部服务商的行，命中的节展开，最多画 200 行。
 */
const props = withDefaults(defineProps<{
    providers: readonly SnapshotProvider[];
    /** 各家已读到的模型行（`ModelsStore.rowsOf`），按服务商 id；没读到的没有键。 */
    rows?: Readonly<Record<string, readonly ModelRow[]>>;
    checks?: ReadonlyMap<string, CheckState>;
    disabled?: boolean;
}>(), {rows: () => ({}), checks: () => new Map(), disabled: false});

const emit = defineEmits<{
    (e: "edit", provider: string, model: string): void;
    /** 要这家的行（展开、搜索时）；父组件读完行经 `rows` 交回。 */
    (e: "load", provider: string): void;
}>();

const LIMIT = 200;
const text = useModelsText();
const query = ref("");
const needle = computed(() => query.value.trim().toLowerCase());
const expanded = ref(new Set<string>());
function toggle(id: string): void {
    const next = new Set(expanded.value);
    if (!next.delete(id)) {
        next.add(id);
        emit("load", id);
    }
    expanded.value = next;
}
// 开始搜索：读全部服务商的行。
watch(needle, (value, previous) => {
    if (value !== "" && previous === "") for (const provider of props.providers) emit("load", provider.id);
});

const sections = computed(() => {
    let budget = LIMIT;
    return props.providers.map((provider) => {
        const enabled = (props.rows[provider.id] ?? []).filter((row) => row.enabled);
        const matched = needle.value === "" ? enabled : enabled.filter((row) => row.name.toLowerCase().includes(needle.value) || row.id.toLowerCase().includes(needle.value));
        const open = needle.value === "" ? expanded.value.has(provider.id) : matched.length > 0;
        const rows = open ? matched.slice(0, Math.max(0, budget)) : [];
        budget -= rows.length;
        return {provider, open, rows, hidden: open ? matched.length - rows.length : 0};
    }).filter((section) => needle.value === "" || section.open);
});
const hiddenTotal = computed(() => sections.value.reduce((sum, section) => sum + section.hidden, 0));
const nothing = computed(() => props.providers.every((provider) => provider.enabledCount === 0));
</script>

<template>
    <div class="all-models">
        <p v-if="nothing" class="all-models__empty">{{ text("all.empty") }}</p>
        <template v-else>
            <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="text('models.search')" :aria-label="text('models.search')" data-all-models-search />
            <section v-for="section in sections" :key="section.provider.id" class="all-models__section" :data-all-models-provider="section.provider.id">
                <button type="button" class="all-models__title nb-ui-focus-ring" :aria-expanded="section.open" :disabled="needle !== ''" @click="toggle(section.provider.id)">
                    <span :class="section.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
                    <ProviderIcon :icon="section.provider.icon" :template="section.provider.template" :name="section.provider.name" :size="16" />
                    {{ section.provider.name }}<span class="all-models__muted">{{ text("all.collapsed", {count: section.provider.enabledCount}) }}</span>
                </button>
                <table v-if="section.open" class="all-models__table">
                    <thead>
                        <tr>
                            <th scope="col">{{ text("all.model") }}</th>
                            <th scope="col"><span class="sr-only">{{ text("all.capabilities") }}</span></th>
                            <th scope="col"><span class="sr-only">{{ text("edit.contextWindow") }}</span></th>
                            <th scope="col"><span class="sr-only">{{ text("check.ok") }}</span></th>
                            <th scope="col"><span class="sr-only">{{ text("models.editTip") }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in section.rows" :key="row.id" :data-all-models-row="`${section.provider.id}/${row.id}`">
                            <td class="all-models__name">{{ row.name }}</td>
                            <td><CapabilityIcons :vision="row.vision" :reasoning="row.reasoning" :efforts="row.efforts" /></td>
                            <td class="all-models__muted">{{ row.contextWindow === null ? "" : tokensText(row.contextWindow) }}</td>
                            <td>
                                <template v-for="check in [checks.get(checkKey(section.provider.id, row.id))]" :key="row.id">
                                    <span v-if="check?.status === 'done' && check.result.ok" class="i-lucide-circle-check all-models__ok" role="img" :aria-label="text('check.ok')" />
                                    <span v-else-if="check?.status === 'done'" class="i-lucide-circle-alert all-models__failed" role="img" :aria-label="text('check.failed')" />
                                </template>
                            </td>
                            <td>
                                <Tooltip :text="text('models.editTip')">
                                    <IconButton size="xs" icon-class="i-lucide-settings-2" :aria-label="text('models.edit', {name: row.name})" :disabled="disabled" @click="emit('edit', section.provider.id, row.id)" />
                                </Tooltip>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <p v-if="hiddenTotal > 0" class="all-models__muted" data-all-models-more>{{ text("models.more", {count: hiddenTotal}) }}</p>
        </template>
    </div>
</template>

<style scoped>
.all-models {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.all-models__empty,
.all-models__muted {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.all-models__title {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    border: 0;
    background: none;
    color: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: left;
    cursor: pointer;
}

.all-models__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
}

.all-models__table th,
.all-models__table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    text-align: left;
    vertical-align: middle;
}

.all-models__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.all-models__ok {
    color: var(--status-success);
}

.all-models__failed {
    color: var(--status-danger);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
}
</style>

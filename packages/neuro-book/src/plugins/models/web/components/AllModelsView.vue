<script setup lang="ts">
import {IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {SnapshotProvider} from "../../shared/contracts";
import type {CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {tokensText, useModelsText} from "../text";
import CapabilityIcons from "./CapabilityIcons.vue";

/** “全部模型”（docs/specs/models/settings-pages.md 输出 11）：所有服务商启用的模型一张表，可从这里打开编辑对话框。 */
const props = withDefaults(defineProps<{
    providers: readonly SnapshotProvider[];
    checks?: ReadonlyMap<string, CheckState>;
    disabled?: boolean;
}>(), {checks: () => new Map(), disabled: false});

const emit = defineEmits<{
    (e: "edit", provider: string, model: string): void;
}>();

const text = useModelsText();
const rows = computed(() => props.providers.flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({provider, model, check: props.checks.get(checkKey(provider.id, model.id))}))));
</script>

<template>
    <div class="all-models">
        <p v-if="rows.length === 0" class="all-models__empty">{{ text("all.empty") }}</p>
        <table v-else class="all-models__table">
            <thead>
                <tr>
                    <th scope="col">{{ text("all.model") }}</th>
                    <th scope="col">{{ text("all.provider") }}</th>
                    <th scope="col"><span class="sr-only">{{ text("all.capabilities") }}</span></th>
                    <th scope="col"><span class="sr-only">{{ text("edit.contextWindow") }}</span></th>
                    <th scope="col"><span class="sr-only">{{ text("check.ok") }}</span></th>
                    <th scope="col"><span class="sr-only">{{ text("models.editTip") }}</span></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row in rows" :key="`${row.provider.id}/${row.model.id}`" :data-all-models-row="`${row.provider.id}/${row.model.id}`">
                    <td class="all-models__name">{{ row.model.name }}</td>
                    <td class="all-models__muted">{{ row.provider.name }}</td>
                    <td><CapabilityIcons :vision="row.model.vision" :reasoning="row.model.reasoning" :efforts="row.model.efforts" /></td>
                    <td class="all-models__muted">{{ row.model.contextWindow === null ? "" : tokensText(row.model.contextWindow) }}</td>
                    <td>
                        <span v-if="row.check?.status === 'done' && row.check.result.ok" class="i-lucide-circle-check all-models__ok" role="img" :aria-label="text('check.ok')" />
                        <span v-else-if="row.check?.status === 'done'" class="i-lucide-circle-alert all-models__failed" role="img" :aria-label="text('check.failed')" />
                    </td>
                    <td>
                        <Tooltip :text="text('models.editTip')">
                            <IconButton size="xs" icon-class="i-lucide-settings-2" :aria-label="text('models.edit', {name: row.model.name})" :disabled="disabled" @click="emit('edit', row.provider.id, row.model.id)" />
                        </Tooltip>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.all-models__empty {
    margin: var(--space-4) 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.all-models__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
}

.all-models__table th {
    padding: 0 var(--space-3) var(--space-2) 0;
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-align: left;
    color: var(--text-secondary);
}

.all-models__table td {
    padding: var(--space-2) var(--space-3) var(--space-2) 0;
    border-bottom: var(--border-w) solid var(--divider);
    vertical-align: middle;
}

.all-models__name {
    font-weight: var(--weight-medium);
}

.all-models__muted {
    font-size: var(--text-xs);
    color: var(--text-muted);
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
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>

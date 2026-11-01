<script setup lang="ts">
import {Badge, Button, Dialog, IconButton, Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {seriesOf} from "../../shared/rules";
import {useModelsText} from "../text";
import CapabilityIcons from "./CapabilityIcons.vue";

/**
 * “管理模型”对话框（docs/specs/models/settings-pages.md 输出 10）：目录服务商列目录里这家的模型，自定义服务商列 `/models` 拉取的
 * 结果（可“重新拉取”）。每行“加入列表”或“从列表移出”，改动留在对话框里，“完成”时一次交出。移出被角色用着的模型先在行内确认。
 */
export interface ModelCandidate {
    readonly id: string;
    readonly name: string;
    readonly vision: boolean;
    readonly reasoning: boolean;
    /** 加入后要补字段（自定义服务商拉取的结果不报上下文窗口时）。 */
    readonly incomplete: boolean;
}

const props = withDefaults(defineProps<{
    open: boolean;
    providerName: string;
    /** 自定义服务商才有“重新拉取”。 */
    discoverable?: boolean;
    /** 候选；null 是还在读。 */
    candidates: readonly ModelCandidate[] | null;
    /** 列表里已有的模型 id。 */
    current: readonly string[];
    /** 模型 id → 绑着它的角色名。 */
    roleUsage?: ReadonlyMap<string, readonly string[]>;
    /** 读候选或写入失败的原因。 */
    error?: string;
    busy?: boolean;
}>(), {discoverable: false, roleUsage: () => new Map(), error: "", busy: false});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "refetch"): void;
    /** 与打开时相比加入的候选与移出的 id；都没有时直接关掉，不发。 */
    (e: "done", change: {add: ModelCandidate[]; remove: string[]}): void;
}>();

const text = useModelsText();
const query = ref("");
const added = ref(new Set<string>());
const confirming = ref<string | null>(null);

watch(() => props.open, (open) => {
    if (!open) return;
    query.value = "";
    confirming.value = null;
    added.value = new Set(props.current);
}, {immediate: true});

const groups = computed(() => {
    const needle = query.value.trim().toLowerCase();
    const byGroup = new Map<string, ModelCandidate[]>();
    for (const item of props.candidates ?? []) {
        if (needle !== "" && !item.name.toLowerCase().includes(needle) && !item.id.toLowerCase().includes(needle)) continue;
        const group = seriesOf(item.id);
        byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
    }
    return [...byGroup].map(([group, items]) => ({group, items}));
});

function toggle(item: ModelCandidate): void {
    const next = new Set(added.value);
    if (next.has(item.id)) {
        if ((props.roleUsage.get(item.id) ?? []).length > 0 && confirming.value !== item.id) {
            confirming.value = item.id;
            return;
        }
        next.delete(item.id);
    } else next.add(item.id);
    confirming.value = null;
    added.value = next;
}

function done(): void {
    const before = new Set(props.current);
    const add = (props.candidates ?? []).filter((item) => added.value.has(item.id) && !before.has(item.id));
    const remove = props.current.filter((id) => !added.value.has(id));
    if (add.length === 0 && remove.length === 0) {
        emit("update:open", false);
        return;
    }
    emit("done", {add, remove});
}
</script>

<template>
    <Dialog
        :model-value="open"
        size="md"
        :title="text('manage.title', {name: providerName})"
        closable
        :confirm-label="text('manage.done')"
        :busy="busy"
        :status="candidates === null ? '' : error"
        data-manage-models-dialog
        @update:model-value="(value: boolean) => emit('update:open', value)"
        @confirm="done"
    >
        <div class="manage-models">
            <div class="manage-models__bar">
                <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="text('manage.search')" :aria-label="text('manage.search')" />
                <Button v-if="discoverable" size="sm" variant="secondary" icon-class="i-lucide-refresh-cw" :disabled="busy || candidates === null && error === ''" data-manage-refetch @click="emit('refetch')">{{ text("manage.refetch") }}</Button>
            </div>
            <p v-if="candidates === null && error !== ''" class="manage-models__error" role="alert" data-manage-error>{{ error }}</p>
            <p v-else-if="candidates === null" class="manage-models__muted">{{ text("manage.loading") }}</p>
            <p v-else-if="candidates.length === 0" class="manage-models__muted">{{ text("manage.empty") }}</p>
            <p v-else-if="groups.length === 0" class="manage-models__muted">{{ text("manage.noMatch") }}</p>
            <div v-else class="manage-models__list">
                <section v-for="group in groups" :key="group.group" class="manage-models__group">
                    <h4 class="manage-models__group-title">{{ group.group }}<span>{{ group.items.length }}</span></h4>
                    <ul>
                        <li v-for="item in group.items" :key="item.id" class="manage-models__item" :data-manage-item="item.id">
                            <div class="manage-models__row">
                                <span class="manage-models__name">{{ item.name }}<span v-if="item.name !== item.id" class="manage-models__id">{{ item.id }}</span></span>
                                <Badge v-if="item.incomplete" size="sm" variant="soft" tone="warning">{{ text("manage.incomplete") }}</Badge>
                                <CapabilityIcons :vision="item.vision" :reasoning="item.reasoning" />
                                <Tooltip :text="added.has(item.id) ? text('manage.removeTip') : text('manage.addTip')">
                                    <IconButton
                                        size="xs"
                                        :icon-class="added.has(item.id) ? 'i-lucide-minus' : 'i-lucide-plus'"
                                        :aria-label="added.has(item.id) ? text('manage.remove', {name: item.name}) : text('manage.add', {name: item.name})"
                                        :aria-pressed="added.has(item.id)"
                                        :disabled="busy"
                                        @click="toggle(item)"
                                    />
                                </Tooltip>
                            </div>
                            <p v-if="confirming === item.id" class="manage-models__confirm" role="alert">
                                {{ text("manage.confirmRemove", {roles: (roleUsage.get(item.id) ?? []).join("、")}) }}
                                <Button size="sm" variant="danger" @click="toggle(item)">{{ text("manage.removeTip") }}</Button>
                            </p>
                        </li>
                    </ul>
                </section>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.manage-models {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.manage-models__bar {
    display: flex;
    gap: var(--space-2);
}

.manage-models__bar > :first-child {
    flex: 1;
}

.manage-models__muted {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.manage-models__error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--status-danger);
}

.manage-models__list {
    max-height: 420px;
    /* 自己滚动：两侧留一点内边距，行尾按钮的焦点环不被裁掉。 */
    padding-inline: var(--space-2);
    overflow-y: auto;
}

.manage-models__group-title {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
}

.manage-models__group-title span {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.manage-models__group ul {
    margin: 0;
    padding: 0;
    list-style: none;
}

.manage-models__item {
    border-bottom: var(--border-w) solid var(--divider);
}

.manage-models__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-2);
}

.manage-models__name {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    overflow: hidden;
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.manage-models__id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.manage-models__confirm {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--status-warning);
}
</style>

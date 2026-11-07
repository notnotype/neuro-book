<script setup lang="ts">
import {Dialog, IconButton, Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, shallowRef, watch} from "vue";

import type {ProfileToolCandidate, ProfileToolCandidateGroup, ToolChange} from "../profile-view";
import {useAgentPageText} from "../text";

/** “添加工具”对话框（同名 .md）。 */
const props = withDefaults(defineProps<{
    open: boolean;
    candidates: readonly ProfileToolCandidateGroup[];
    busy?: boolean;
    status?: string;
}>(), {busy: false, status: ""});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "done", change: ToolChange): void;
}>();

const text = useAgentPageText();
const query = ref("");
const picked = ref(new Set<string>());
/** 打开时定下：开着的时候目录变了不刷新，用户正在看的行不跳。 */
const shown = shallowRef<readonly ProfileToolCandidateGroup[]>(props.candidates);

watch(() => props.open, (open) => {
    if (!open) return;
    shown.value = props.candidates;
    query.value = "";
    picked.value = new Set();
}, {immediate: true});

const groups = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (needle === "") return shown.value;
    const matches = (tool: ProfileToolCandidate): boolean => [tool.name, tool.id, tool.summary].some((value) => value.toLowerCase().includes(needle));
    return shown.value.map((group) => ({provider: group.provider, tools: group.tools.filter(matches)})).filter((group) => group.tools.length > 0);
});
const all = computed(() => shown.value.flatMap((group) => group.tools));

function toggle(tool: ProfileToolCandidate): void {
    const next = new Set(picked.value);
    if (next.has(tool.id)) next.delete(tool.id);
    else {
        // 同名的只能选一个：内核只留先出现的，两个都写进绑定就有一个白写。
        for (const other of all.value) if (other.providerName === tool.providerName) next.delete(other.id);
        next.add(tool.id);
    }
    picked.value = next;
}

function done(): void {
    if (picked.value.size === 0) {
        emit("update:open", false);
        return;
    }
    const add = all.value.filter((tool) => picked.value.has(tool.id));
    emit("done", {add: add.map((tool) => tool.id), remove: add.flatMap((tool) => (tool.replaces === undefined ? [] : [tool.replaces]))});
}
</script>

<template>
    <Dialog
        :open="open"
        size="md"
        :title="text('profiles.tools.add.title')"
        closable
        :confirm-label="text('profiles.tools.add.done')"
        :busy="busy"
        :status="status"
        data-profile-add-tools
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="done"
    >
        <div class="add-tools">
            <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="text('profiles.tools.add.search')" :aria-label="text('profiles.tools.add.search')" />
            <p v-if="all.length === 0" class="add-tools__muted">{{ text("profiles.tools.add.empty") }}</p>
            <p v-else-if="groups.length === 0" class="add-tools__muted">{{ text("profiles.tools.add.noMatch") }}</p>
            <div v-else class="add-tools__list">
                <section v-for="group in groups" :key="group.provider">
                    <h4 class="add-tools__group">{{ group.provider }}<span>{{ group.tools.length }}</span></h4>
                    <ul>
                        <li v-for="tool in group.tools" :key="tool.id" class="add-tools__row" :data-add-tool="tool.id">
                            <div class="add-tools__text">
                                <div class="add-tools__name"><code>{{ tool.name }}</code><span :class="{'is-danger': tool.danger}">{{ tool.effect }}</span></div>
                                <Tooltip :text="tool.blocked ? text('profiles.tools.add.blocked') : tool.detail">
                                    <div class="add-tools__summary" tabindex="0">
                                        <template v-if="tool.blocked">{{ text("profiles.tools.add.blocked") }}</template>
                                        <template v-else>{{ tool.summary }}<span v-if="tool.replaces !== undefined" class="add-tools__replaces" data-add-tool-replaces> {{ text("profiles.tools.add.replaces") }}</span></template>
                                    </div>
                                </Tooltip>
                            </div>
                            <IconButton
                                size="xs"
                                :icon-class="picked.has(tool.id) ? 'i-lucide-minus' : 'i-lucide-plus'"
                                :aria-label="text(picked.has(tool.id) ? 'profiles.tools.add.unjoin' : 'profiles.tools.add.join', {name: tool.name, id: tool.id})"
                                :disabled="tool.blocked || busy"
                                data-add-tool-toggle
                                @click="toggle(tool)"
                            />
                        </li>
                    </ul>
                </section>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.add-tools {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.add-tools__muted {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

/* 自己滚动：两侧留一点内边距，行尾按钮的焦点环不被裁掉。 */
.add-tools__list {
    max-height: 420px;
    padding-inline: var(--space-2);
    overflow-y: auto;
}

.add-tools__list ul {
    margin: 0;
    padding: 0;
    list-style: none;
}

.add-tools__group {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
}

.add-tools__group span {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.add-tools__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
}

.add-tools__text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}

.add-tools__name {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-sm);
}

.add-tools__name code {
    font-family: var(--font-mono);
}

.add-tools__name span {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.add-tools__name span.is-danger {
    color: var(--status-warning);
}

.add-tools__summary {
    overflow: hidden;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.add-tools__replaces {
    color: var(--status-warning);
}
</style>

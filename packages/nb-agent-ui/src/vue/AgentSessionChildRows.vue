<script setup lang="ts">
/**
 * 会话面板里挂在父会话下的子会话（见同名 `.md`）。递归：子会话还有子会话时再往里缩一层。展开记录在面板那里，这里只发 `toggle`。
 */
import {Spinner} from "@notnotype/nb-ui/components";

import type {SessionNode} from "../session-nesting";
import {useAgentText} from "./text";

defineOptions({name: "AgentSessionChildRows"});

const props = defineProps<{
    nodes: readonly SessionNode[];
    selectedId: string | null;
    expanded: Readonly<Record<string, boolean>>;
    /** 组的读屏名称：父会话的标题。 */
    label: string;
    /** 组元素的 id：父会话行的开关用 `aria-controls` 指它。 */
    listId: string;
    /** 面板给的 id 前缀，往里一层的组接着用。 */
    idPrefix: string;
}>();

const emit = defineEmits<{select: [id: string]; toggle: [id: string]}>();

const {t} = useAgentText();

const STATE_ICON = {interrupted: "i-lucide-circle-pause", error: "i-lucide-circle-x"} as const;
const countOf = (node: SessionNode): number => node.item.childCount ?? node.children.length;
</script>

<template>
    <div :id="props.listId" class="acv-children" role="group" :aria-label="t('panel.childrenOf', {title: props.label})" data-panel-children-list>
        <div v-for="node in props.nodes" :key="node.item.id" class="acv-children__node">
            <div class="acv-children__row" :class="{'is-current': node.item.id === props.selectedId, 'is-dimmed': node.item.dimmed === true}">
                <button type="button" class="acv-children__open" :aria-current="node.item.id === props.selectedId ? 'true' : undefined" data-panel-child @click="emit('select', node.item.id)">
                    <span :class="[node.item.icon ?? 'i-lucide-bot', 'acv-children__icon']" :title="node.item.iconTitle" aria-hidden="true" />
                    <span class="acv-children__title">{{ node.item.title || t("header.untitled") }}</span>
                    <span class="acv-children__note">{{ node.item.description }}</span>
                    <span v-if="node.item.dimmed === true" class="sr-only">{{ t("panel.ancestor") }}</span>
                    <Spinner v-if="node.item.status === 'running'" size="sm" class="acv-children__state" :label="t('panel.state.running')" />
                    <span v-else-if="node.item.status === 'waiting'" class="acv-children__state acv-children__waiting">{{ t("panel.state.waiting") }}</span>
                    <span v-else-if="node.item.status === 'interrupted' || node.item.status === 'error'" :class="[STATE_ICON[node.item.status], 'acv-children__state acv-children__state-icon']" :data-state="node.item.status" :title="t(`panel.state.${node.item.status}`)" />
                </button>
                <button
                    v-if="node.children.length > 0"
                    type="button"
                    class="acv-children__kids"
                    :aria-expanded="props.expanded[node.item.id] === true"
                    :aria-controls="props.expanded[node.item.id] === true ? `${props.idPrefix}-children-${node.item.id}` : undefined"
                    data-panel-children
                    @click="emit('toggle', node.item.id)"
                >
                    {{ t("panel.children", {count: countOf(node)}) }}<span :class="props.expanded[node.item.id] === true ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" aria-hidden="true" />
                </button>
            </div>
            <AgentSessionChildRows
                v-if="props.expanded[node.item.id] === true && node.children.length > 0"
                :list-id="`${props.idPrefix}-children-${node.item.id}`"
                :id-prefix="props.idPrefix"
                :nodes="node.children"
                :selected-id="props.selectedId"
                :expanded="props.expanded"
                :label="node.item.title || t('header.untitled')"
                @select="emit('select', $event)"
                @toggle="emit('toggle', $event)"
            />
        </div>
    </div>
</template>

<style scoped>
/* 图标与父会话的标题对齐（父会话的图标 16px、间隔 8px），左边一条细线把这一组挂在父会话下。 */
.acv-children {
    margin-left: 22px;
    border-left: var(--border-w) solid var(--border-color);
}

.acv-children__row {
    display: flex;
    align-items: center;
    border-radius: 6px;
}

.acv-children__row:hover {
    background: var(--bg-hover);
}

.acv-children__row.is-current {
    background: var(--accent-bg);
}

.acv-children__open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
}

.acv-children__row.is-dimmed .acv-children__open {
    color: var(--text-muted);
}

.acv-children__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.acv-children__title {
    flex-shrink: 1;
    min-width: 2em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-children__note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-children__state {
    flex-shrink: 0;
}

.acv-children__waiting {
    color: var(--status-warning);
    font-size: var(--text-2xs);
}

.acv-children__state-icon {
    width: 12px;
    height: 12px;
    color: var(--text-muted);
}

.acv-children__state-icon[data-state="error"] {
    color: var(--status-danger);
}

.acv-children__kids {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    margin-right: 4px;
    padding: 0 4px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-2xs);
    cursor: pointer;
}

.acv-children__kids:hover {
    background: var(--bg-hover);
}
</style>

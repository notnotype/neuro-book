<script setup lang="ts">
/**
 * 状态栏设置页（见同名 `.md`，conversation.md 输出 46）。只吃普通的属性，写入由包装交给配置服务，所以能在 Lab 里直接摆。
 * 预览用 nb-agent-ui 的状态栏组件加样本数据，显隐、次序与窄宽收起都是它自己的算法，不在这里再写一份。
 */
import {computed, ref} from "vue";
import {Badge, Checkbox, IconButton} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {createAgentContext, createAgentViewRegistry, resolveStatusLine, statusLineCatalog} from "@notnotype/nb-agent-ui";
import type {StatusLineItem, StatusLineSetting} from "@notnotype/nb-agent-ui";
import {AgentStatusBar} from "@notnotype/nb-agent-ui/vue";
import {defineComponent, h} from "vue";

import {useAgentPageText} from "../text";

const props = withDefaults(defineProps<{
    /** 插件加的项（声明）；内置四项页面自己知道。 */
    pluginItems?: readonly StatusLineItem[];
    setting: StatusLineSetting;
    writable?: boolean;
}>(), {pluginItems: () => [], writable: true});

const emit = defineEmits<{
    toggle: [id: string];
    /** 把一项移到它那一侧的第 `to` 位（拖动与上移下移共用）。 */
    move: [id: string, to: number];
    /** 上移、下移：在这一侧里挪几位；位置由写入时按最新的次序算。 */
    shift: [id: string, delta: number];
}>();

const t = useAgentPageText();
const port = useText();

const catalog = computed(() => statusLineCatalog(props.pluginItems));
const resolved = computed(() => resolveStatusLine(catalog.value, props.setting));
const groups = computed(() => [
    {side: "left" as const, title: t("statusLine.left"), rows: resolved.value.left},
    {side: "right" as const, title: t("statusLine.right"), rows: resolved.value.right},
]);

// ─── 预览 ───────────────────────────────────────────────────────────────

const SAMPLE_USAGE = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 162_400, input: 101_200, output: 3_100, cacheRead: 58_100, cacheWrite: 0, cacheHitRate: 0.62, cost: 0.07, currency: "USD" as const};
const sampleContext = createAgentContext({
    session: {id: "sample", title: "", summary: "", profileName: "", profileIcon: "i-lucide-bot", archived: false, summaryState: "idle"},
    usage: SAMPLE_USAGE,
    composer: {effectiveModel: "Claude Sonnet", thinking: "low", thinkingLevels: ["low", "medium", "high"]},
});
/** 插件的项在预览里不跑插件的代码：画一枚写着标题的占位。 */
const previewRegistry = computed(() => createAgentViewRegistry([{
    source: "status-line-page",
    statusItems: props.pluginItems.map((item) => ({
        id: item.id,
        side: item.side,
        title: item.title,
        defaultVisible: item.defaultVisible,
        component: defineComponent({setup: () => () => h("span", {class: "status-line-page__chip"}, port.t(item.title))}),
    })),
}]));

// ─── 拖动 ───────────────────────────────────────────────────────────────

const dragging = ref<{id: string; side: "left" | "right"} | null>(null);
const overIndex = ref<number | null>(null);

function dragStart(event: DragEvent, id: string, side: "left" | "right"): void {
    if (!props.writable) return;
    dragging.value = {id, side};
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
    }
}
function dragOver(event: DragEvent, side: "left" | "right", index: number): void {
    // 只在同一侧内排序：别的一侧的行不是落点。
    if (dragging.value === null || dragging.value.side !== side) return;
    event.preventDefault();
    overIndex.value = index;
}
function drop(side: "left" | "right", index: number): void {
    const from = dragging.value;
    dragging.value = null;
    overIndex.value = null;
    if (from === null || from.side !== side) return;
    emit("move", from.id, index);
}
/** 落点线：向上拖画在目标行上沿，向下拖画在下沿（落下后拖的这一项排在目标行的位置）。 */
function isOver(group: {side: "left" | "right"; rows: readonly {id: string}[]}, index: number, edge: "before" | "after"): boolean {
    const from = dragging.value;
    if (from === null || from.side !== group.side || overIndex.value !== index || from.id === group.rows[index]?.id) return false;
    const fromIndex = group.rows.findIndex((row) => row.id === from.id);
    return (fromIndex > index) === (edge === "before");
}
function dragEnd(): void {
    dragging.value = null;
    overIndex.value = null;
}
</script>

<template>
    <div class="status-line-page" data-status-line-page>
        <!-- 预览只读：inert 去掉它的右键菜单、tab 停靠点与悬停提示。 -->
        <div class="status-line-page__preview" data-status-line-preview inert>
            <span class="status-line-page__label">{{ t("statusLine.preview") }}</span>
            <AgentStatusBar :ctx="sampleContext" :registry="previewRegistry" :status-line="props.setting" />
        </div>
        <section v-for="group in groups" :key="group.side" class="status-line-page__group" :data-status-group="group.side">
            <h4 class="status-line-page__group-title">{{ group.title }}</h4>
            <ul class="status-line-page__list">
                <li
                    v-for="(row, index) in group.rows"
                    :key="row.id"
                    class="status-line-page__row"
                    :class="{'is-dragging': dragging?.id === row.id, 'is-over': isOver(group, index, 'before'), 'is-over-after': isOver(group, index, 'after')}"
                    :data-status-row="row.id"
                    :draggable="props.writable"
                    @dragstart="dragStart($event, row.id, group.side)"
                    @dragover="dragOver($event, group.side, index)"
                    @drop.prevent="drop(group.side, index)"
                    @dragend="dragEnd"
                >
                    <span class="i-lucide-grip-vertical status-line-page__grip" aria-hidden="true" />
                    <Checkbox
                        class="status-line-page__check"
                        :model-value="row.visible"
                        :label="port.t(row.title)"
                        :description="row.description === undefined ? undefined : port.t(row.description)"
                        :disabled="!props.writable"
                        @update:model-value="emit('toggle', row.id)"
                    />
                    <Badge v-if="row.source !== undefined" size="sm" variant="outline">{{ t("statusLine.plugin") }}</Badge>
                    <span class="status-line-page__moves">
                        <IconButton
                            size="xs"
                            icon-class="i-lucide-arrow-up"
                            :title="t('statusLine.moveUp')"
                            :aria-label="t('statusLine.moveUpOf', {name: port.t(row.title)})"
                            :disabled="!props.writable || index === 0"
                            data-status-move-up
                            @click="emit('shift', row.id, -1)"
                        />
                        <IconButton
                            size="xs"
                            icon-class="i-lucide-arrow-down"
                            :title="t('statusLine.moveDown')"
                            :aria-label="t('statusLine.moveDownOf', {name: port.t(row.title)})"
                            :disabled="!props.writable || index === group.rows.length - 1"
                            data-status-move-down
                            @click="emit('shift', row.id, 1)"
                        />
                    </span>
                </li>
            </ul>
        </section>
    </div>
</template>

<style scoped>
.status-line-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.status-line-page__preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 4px 4px;
    border-radius: var(--radius-panel);
    background: var(--bg-hover);
}

.status-line-page__label {
    padding-inline: 12px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.status-line-page__group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.status-line-page__group-title {
    margin: 0;
    padding-inline: 4px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.status-line-page__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.status-line-page__row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-control);
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.status-line-page__row:hover {
    background: var(--bg-hover);
}

.status-line-page__row.is-dragging {
    opacity: 0.5;
}

/* 落点：落下后这一项排到这一行的位置；向上拖画在上沿，向下拖画在下沿。 */
.status-line-page__row.is-over {
    box-shadow: inset 0 2px 0 0 var(--accent-main);
}

.status-line-page__row.is-over-after {
    box-shadow: inset 0 -2px 0 0 var(--accent-main);
}

.status-line-page__grip {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    cursor: grab;
}

.status-line-page__check {
    min-width: 0;
    flex: 1 1 auto;
}

.status-line-page__moves {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
}

.status-line-page__chip {
    white-space: nowrap;
}
</style>

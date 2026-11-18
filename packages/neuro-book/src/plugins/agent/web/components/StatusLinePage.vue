<script setup lang="ts">
/**
 * 状态栏设置页（见同名 `.md`，conversation.md 输出 46）。只吃普通的属性，写入由包装交给配置服务，所以能在 Lab 里直接摆。
 * 预览用 nb-agent-ui 的状态栏组件加样本数据，显隐、次序、分边与窄宽收起都是它自己的算法，不在这里再写一份。排序用 nb-layout 的
 * `SortableList`（docs/specs/ui/sortable-list.md）：拖动的手感、跨组、键盘都在那里。
 */
import {computed, defineComponent, h} from "vue";
import {Badge, Checkbox, IconButton} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {SortableList} from "@notnotype/nb-layout/vue";
import type {SortableMove} from "@notnotype/nb-layout/vue";
import {createAgentContext, createAgentViewRegistry, resolveStatusLine, statusLineCatalog} from "@notnotype/nb-agent-ui";
import type {ResolvedStatusItem, StatusLineItem, StatusLineSetting, StatusLineSide, StatusLineSlot} from "@notnotype/nb-agent-ui";
import {AgentStatusBar} from "@notnotype/nb-agent-ui/vue";

import {useAgentPageText} from "../text";

const props = withDefaults(defineProps<{
    /** 插件加的项（声明）；内置四项页面自己知道。 */
    pluginItems?: readonly StatusLineItem[];
    setting: StatusLineSetting;
    writable?: boolean;
    /**
     * 拖动放下：把一项移到哪一边的第几位。是属性不是事件：返回写入的 Promise 时，放下后的次序留到它 settle，不闪回旧次序
     * （模板里照常写 `@move`）。
     */
    onMove?: (id: string, to: StatusLineSlot) => void | PromiseLike<unknown>;
}>(), {pluginItems: () => [], writable: true, onMove: undefined});

const emit = defineEmits<{
    toggle: [id: string];
    /** 上移、下移：在“左边接右边”这一串里挪一位；位置由写入时按最新的次序算。 */
    shift: [id: string, delta: -1 | 1];
}>();

const t = useAgentPageText();
const port = useText();

const catalog = computed(() => statusLineCatalog(props.pluginItems));
const resolved = computed(() => resolveStatusLine(catalog.value, props.setting));
const items = computed(() => new Map<string, ResolvedStatusItem>([...resolved.value.left, ...resolved.value.right].map((item) => [item.id, item])));
const sections = computed(() => [
    {id: "left", title: t("statusLine.left"), keys: resolved.value.left.map((item) => item.id)},
    {id: "right", title: t("statusLine.right"), keys: resolved.value.right.map((item) => item.id)},
]);
/** 只有左边第一项不能上移、右边最后一项不能下移：右边第一项上移到左边最后，左边最后一项下移到右边第一。 */
const first = computed(() => resolved.value.left[0]?.id ?? null);
const last = computed(() => resolved.value.right.at(-1)?.id ?? null);
const titleOf = (id: string): string => {
    const item = items.value.get(id);
    return item === undefined ? id : port.t(item.title);
};

function onSorted(move: SortableMove): void | PromiseLike<unknown> {
    return props.onMove?.(move.key, {side: move.to.section as StatusLineSide, index: move.to.index});
}

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

</script>

<template>
    <div class="status-line-page" data-status-line-page>
        <!-- 预览只读：inert 去掉它的右键菜单、tab 停靠点与悬停提示。 -->
        <div class="status-line-page__preview" data-status-line-preview inert>
            <span class="status-line-page__label">{{ t("statusLine.preview") }}</span>
            <AgentStatusBar :ctx="sampleContext" :registry="previewRegistry" :status-line="props.setting" />
        </div>
        <SortableList class="status-line-page__list" :sections="sections" :label="titleOf" :disabled="!props.writable" @move="onSorted">
            <template #item="{itemKey}">
                <div class="status-line-page__row" :data-status-row="itemKey">
                    <Checkbox
                        class="status-line-page__check"
                        :model-value="items.get(itemKey)?.visible ?? false"
                        :label="titleOf(itemKey)"
                        :description="items.get(itemKey)?.description === undefined ? undefined : port.t(items.get(itemKey)!.description!)"
                        :disabled="!props.writable"
                        @update:model-value="emit('toggle', itemKey)"
                    />
                    <span v-if="items.get(itemKey)?.source !== undefined" class="status-line-page__line">
                        <Badge size="sm" variant="outline">{{ t("statusLine.plugin") }}</Badge>
                    </span>
                    <span class="status-line-page__line status-line-page__moves">
                        <IconButton
                            size="xs"
                            icon-class="i-lucide-arrow-up"
                            :title="t('statusLine.moveUp')"
                            :aria-label="t('statusLine.moveUpOf', {name: titleOf(itemKey)})"
                            :disabled="!props.writable || itemKey === first"
                            data-status-move-up
                            @click="emit('shift', itemKey, -1)"
                        />
                        <IconButton
                            size="xs"
                            icon-class="i-lucide-arrow-down"
                            :title="t('statusLine.moveDown')"
                            :aria-label="t('statusLine.moveDownOf', {name: titleOf(itemKey)})"
                            :disabled="!props.writable || itemKey === last"
                            data-status-move-down
                            @click="emit('shift', itemKey, 1)"
                        />
                    </span>
                </div>
            </template>
        </SortableList>
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

/* 行的字号同勾选的标签：把手、插件标记与上移下移按 1lh 对齐的就是标签那一行。 */
.status-line-page__list {
    font-size: var(--text-sm);
}

.status-line-page__row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.status-line-page__check {
    min-width: 0;
    flex: 1 1 auto;
}

.status-line-page__line {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    height: 1lh;
}

.status-line-page__moves {
    gap: 2px;
}

.status-line-page__chip {
    white-space: nowrap;
}
</style>

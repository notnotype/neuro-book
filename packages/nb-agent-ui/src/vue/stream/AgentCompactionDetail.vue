<script setup lang="ts">
import {computed} from "vue";

import {formatCost, formatTokens} from "../../process-summary";
import type {CompactionView} from "../../types";
import {useAgentText} from "../host";

const props = defineProps<{
    detail: CompactionView;
    currency: "USD" | "CNY";
}>();

const {t} = useAgentText();

/** 方法名的末一段：内置的有自己的叫法，别的（插件贡献的）原样显示。 */
const methodName = computed(() => {
    const name = props.detail.method.slice(props.detail.method.lastIndexOf(".") + 1);
    switch (name) {
        case "shake": return t("compactionDetail.methods.shake");
        case "inplace": return t("compactionDetail.methods.inplace");
        case "summary": return t("compactionDetail.methods.summary");
        default: return name;
    }
});
const cost = computed(() => {
    const model = props.detail.model;
    if (model === null) return null;
    return model.cost === null ? t("compactionDetail.costUnknown") : formatCost(model.cost, props.currency);
});
const kind = (value: "file" | "plan" | "log"): string => t(`compactionDetail.kinds.${value}`);
</script>

<template>
    <dl class="acv-compaction" data-compaction-detail>
        <dt>{{ t("compactionDetail.method") }}</dt>
        <dd>{{ methodName }}</dd>

        <dt>{{ t("compactionDetail.model") }}</dt>
        <dd>{{ detail.model === null ? t("compactionDetail.noModel") : detail.model.name }}</dd>

        <dt>{{ t("compactionDetail.context") }}</dt>
        <dd>{{ t("compactionDetail.contextValue", {before: formatTokens(detail.tokensBefore), after: formatTokens(detail.tokensAfter)}) }}</dd>

        <template v-if="detail.model !== null">
            <dt>{{ t("compactionDetail.usage") }}</dt>
            <dd>{{ t("compactionDetail.usageValue", {input: formatTokens(detail.model.input), output: formatTokens(detail.model.output)}) }}<template v-if="cost !== null"> · {{ cost }}</template></dd>
        </template>

        <template v-if="detail.require.length > 0">
            <dt>{{ t("compactionDetail.require") }}</dt>
            <dd><span v-for="(item, index) in detail.require" :key="index" class="acv-compaction__line">{{ item }}</span></dd>
        </template>

        <template v-if="detail.keptTurns !== null || detail.omitted > 0">
            <dt>{{ t("compactionDetail.kept") }}</dt>
            <dd>
                <span v-if="detail.keptTurns !== null" class="acv-compaction__line">{{ t("compactionDetail.keptTurns", {count: detail.keptTurns}) }}</span>
                <span v-if="detail.omitted > 0" class="acv-compaction__line">{{ t("compactionDetail.omitted", {count: detail.omitted}) }}</span>
            </dd>
        </template>

        <template v-if="detail.restored.length > 0">
            <dt>{{ t("compactionDetail.restored") }}</dt>
            <dd>
                <span v-for="item in detail.restored" :key="`${item.kind}:${item.target}`" class="acv-compaction__line">
                    <span class="acv-compaction__kind">{{ kind(item.kind) }}</span>
                    <code class="acv-compaction__target">{{ item.target }}</code>
                    <template v-if="item.tokens > 0"> · {{ formatTokens(item.tokens) }}</template>
                    <template v-if="item.truncated"> · {{ t("compactionDetail.truncated") }}</template>
                </span>
            </dd>
        </template>
    </dl>
</template>

<style scoped>
.acv-compaction {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 2px 12px;
    margin: 2px 0 4px 5px;
    padding: 2px 8px;
    border-left: var(--border-w, 1px) solid var(--divider);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-compaction dt {
    color: var(--text-secondary);
}

.acv-compaction dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.acv-compaction__line {
    display: block;
}

.acv-compaction__kind {
    margin-right: 4px;
    color: var(--text-secondary);
}

.acv-compaction__target {
    font-family: var(--font-mono);
}
</style>

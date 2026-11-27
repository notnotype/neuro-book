<script setup lang="ts">
/**
 * 条目页的情节分页（docs/specs/canon/author-ui.md 输出 15）：涉及这个条目、在所选位置上已经算进去的剧情变更，从新到旧。受控。
 */
import {Badge, Button} from "@notnotype/nb-ui/components";

import type {PlotRow} from "../../rows";
import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    rows: readonly PlotRow[];
    remaining?: number;
    loading?: boolean;
    /** 读取失败（读到过的行留着）；世界下一次变化时读取层会重读。 */
    failed?: boolean;
}>(), {remaining: 0, loading: false, failed: false});

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "more"): void;
}>();

const text = useCanonText();
const FLAG_TONE = {plan: "neutral", held: "warning", undone: "neutral"} as const;
</script>

<template>
    <div class="min-w-0 text-[length:var(--text-sm)]" data-plot-list>
        <!-- 不给“重试”：读取层在世界下一次变化时照常重读它。 -->
        <p v-if="props.failed" role="alert" class="py-1 text-[var(--status-danger)]">{{ text("world.failed") }}</p>
        <p v-if="props.loading && props.rows.length === 0" class="py-2 text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <p v-else-if="props.rows.length === 0 && !props.failed" class="py-2 text-[var(--text-muted)]">{{ text("plot.empty") }}</p>
        <ol v-else class="m-0 list-none p-0">
            <li v-for="row in props.rows" :key="row.id" class="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--divider)] py-2" :data-change="row.id">
                <span class="w-16 shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ row.where }}</span>
                <span class="min-w-0 flex-1 basis-48">
                    <button type="button" class="text-left hover:underline" :class="row.flags.includes('plan') ? 'text-[var(--text-secondary)]' : 'text-[var(--text-main)]'" @click="emit('open', row.id)">{{ row.text }}</button>
                    <span class="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge v-for="flag in row.flags" :key="flag" :tone="FLAG_TONE[flag]" variant="soft" size="sm">{{ text(`plot.${flag}`) }}</Badge>
                        <span v-for="(patch, index) in row.patches" :key="index" class="font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ patch }}</span>
                    </span>
                </span>
            </li>
        </ol>
        <Button v-if="props.remaining > 0" class="mt-1" size="sm" variant="ghost" @click="emit('more')">{{ text("entries.more", {count: props.remaining}) }}</Button>
    </div>
</template>

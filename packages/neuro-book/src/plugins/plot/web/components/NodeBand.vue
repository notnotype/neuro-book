<script setup lang="ts">
/**
 * 伏笔账本的节点带（docs/specs/plot/author-ui.md 输出 12）：只画有节点的章，按章序；中间跳过的章收成一个省略格；每格写章号与一个字
 * （埋、应、误、部、收），写了的实心、打算写的虚线框；所选位置所在的章有标记。受控，节点与章表由页面给。
 */
import {computed} from "vue";

import type {Role} from "../../core/foreshadowing";
import type {ChapterIndex} from "../labels";
import {usePlotText} from "../text";

const props = defineProps<{
    nodes: readonly {readonly role: Role; readonly chapter: string; readonly written: boolean}[];
    chapters: ChapterIndex;
    /** 所选位置所在章的序号（初值是 0）。 */
    now: number;
}>();

const text = usePlotText();
const SHORT = {plant: "ledger.roleShort.plant", echo: "ledger.roleShort.echo", mislead: "ledger.roleShort.mislead", partial: "ledger.roleShort.partial", payoff: "ledger.roleShort.payoff"} as const;
const ROLE = {plant: "ledger.role.plant", echo: "ledger.role.echo", mislead: "ledger.role.mislead", partial: "ledger.role.partial", payoff: "ledger.role.payoff"} as const;
type Cell = {readonly kind: "node"; readonly key: string; readonly index: number; readonly role: Role; readonly written: boolean} | {readonly kind: "gap"; readonly key: string};
/**
 * 同一章有几个节点时各占一格，写了的在前；相邻的两格章号差 1 以上时中间插一个省略格。章表里没有的章（读取与章表之间章被删了）
 * 排不进章序，不画。同一章同一角色可以有几格，键带上排序后的下标。
 */
const cells = computed<Cell[]>(() => {
    const nodes = props.nodes
        .flatMap((node) => {
            const index = props.chapters.get(node.chapter);
            return index === undefined ? [] : [{index, role: node.role, written: node.written}];
        })
        .sort((a, b) => a.index - b.index || Number(b.written) - Number(a.written));
    const result: Cell[] = [];
    for (const [at, node] of nodes.entries()) {
        const before = nodes[at - 1];
        if (before !== undefined && node.index - before.index > 1) result.push({kind: "gap", key: `gap-${String(at)}`});
        result.push({kind: "node", key: `node-${String(at)}`, ...node});
    }
    return result;
});
const label = (cell: Extract<Cell, {kind: "node"}>): string => text("ledger.nodeLabel", {chapter: text("chapter.of", {index: cell.index}), role: text(ROLE[cell.role]), state: text(cell.written ? "ledger.legendWritten" : "ledger.legendPlanned")});
</script>

<template>
    <ol class="flex flex-wrap items-center gap-1" :aria-label="text('ledger.columns.band')" data-node-band>
        <li v-for="cell in cells" :key="cell.key" class="flex items-center">
            <span v-if="cell.kind === 'gap'" class="px-0.5 text-[var(--text-muted)]" aria-hidden="true">…</span>
            <span
                v-else
                class="flex h-7 min-w-7 flex-col items-center justify-center rounded-[var(--radius-control)] px-1 text-[length:var(--text-xs)] leading-none"
                :class="[cell.written ? 'bg-[var(--text-main)] text-[var(--panel-surface)]' : 'border border-dashed border-[var(--text-muted)] text-[var(--text-secondary)]', cell.index === props.now ? 'ring-2 ring-[var(--accent-main)]' : '']"
                :aria-label="label(cell)"
                :title="label(cell)"
                data-node
            >
                <span>{{ text(SHORT[cell.role]) }}</span>
                <span class="opacity-70">{{ cell.index }}</span>
            </span>
        </li>
    </ol>
</template>

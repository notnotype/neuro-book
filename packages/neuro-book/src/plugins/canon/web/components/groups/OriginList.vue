<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {nextTick, useTemplateRef, watch} from "vue";

import type {OriginRow} from "../../rows";
import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    rows: readonly OriginRow[];
    /** 列表上方的一句，例如“存款是怎么来的”；不写时没有。 */
    caption?: string;
    /** 还有几步没读；大于 0 时末尾有“再显示更早的”。 */
    remaining?: number;
    loading?: boolean;
    failed?: boolean;
    /** 失败时服务给的说明；没有时不写。 */
    reason?: string;
}>(), {caption: "", remaining: 0, loading: false, failed: false, reason: ""});

const emit = defineEmits<{
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
}>();

const text = useCanonText();

/**
 * 点“再显示更早的”以后焦点留在列表里（输出 11）：还有更早的时按钮还在，焦点留在它上面；读完最后一页按钮卸掉，焦点交给列表自己，
 * 不掉到 body（浮层里焦点没了，键盘用户就出不去也回不来）。
 */
const root = useTemplateRef<HTMLElement>("root");
let askedMore = false;
const more = (): void => {
    askedMore = true;
    emit("more");
};
watch(() => [props.remaining, props.loading] as const, ([remaining, loading]) => {
    if (!askedMore || loading) return;
    askedMore = false;
    // 等按钮真的卸掉以后再看焦点在哪（这里还在更新之前）。
    if (remaining === 0) void nextTick(() => {
        if (root.value?.contains(document.activeElement) !== true) root.value?.focus({preventScroll: true});
    });
});
</script>

<template>
    <div ref="root" class="min-w-0 text-[length:var(--text-sm)] outline-none" tabindex="-1" data-origin-list>
        <p v-if="props.caption !== ''" class="mb-1 font-semibold text-[var(--text-main)]">{{ props.caption }}</p>
        <p v-if="props.failed" role="alert" class="flex flex-wrap items-center gap-2 py-1 text-[var(--status-danger)]">
            {{ text("origin.failed") }}<span v-if="props.reason !== ''">{{ props.reason }}</span>
            <Button size="sm" variant="ghost" @click="emit('retry')">{{ text("world.retry") }}</Button>
        </p>
        <p v-if="props.loading && props.rows.length === 0" class="py-1 text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <!--
            一步两行，不要表头：第一行是位置、变化、结果与“改这一笔”，第二行是发生了什么（与依据）。变化、结果、按钮各占固定宽的一列，
            各行的数对得齐；发生了什么独占第二行整行，窄的流水（面板分页右边一栏）里也不挤成几个字一行。初值一行没有位置：第一行左边
            写“最初”这一句，第二行只剩依据。
        -->
        <ol v-else-if="props.rows.length > 0" class="origin-list__rows m-0 list-none p-0">
            <li v-for="row in props.rows" :key="row.key" class="origin-list__row border-t border-[var(--divider)] py-1.5" data-origin-row>
                <span class="origin-list__where" :class="row.where === '' ? 'text-[var(--text-main)]' : 'text-[length:var(--text-xs)] text-[var(--text-muted)]'">{{ row.where === "" ? row.what : row.where }}</span>
                <span class="origin-list__delta font-mono text-[var(--text-secondary)]"><span v-if="row.delta !== undefined" class="sr-only">{{ text("origin.delta") }}</span>{{ row.delta ?? "" }}</span>
                <span class="origin-list__result font-mono" :class="row.check === 'mismatch' ? 'text-[var(--status-danger)]' : 'text-[var(--text-main)]'">
                    <span v-if="row.delta !== undefined" class="i-lucide-arrow-right mr-1 size-3 align-[-1px] text-[var(--text-muted)]" aria-hidden="true" />
                    <span v-if="row.result !== ''" class="sr-only">{{ text("origin.result") }}</span>{{ row.result }}
                </span>
                <span class="origin-list__action">
                    <Button v-if="row.change !== undefined" size="sm" variant="ghost" @click="emit('change', row.change)">{{ text("origin.editStep") }}</Button>
                </span>
                <span v-if="row.where !== '' || row.basis !== undefined" class="origin-list__what">
                    <span v-if="row.where !== ''" class="text-[var(--text-main)]">{{ row.what }}</span>
                    <span v-if="row.basis !== undefined" class="block text-[length:var(--text-xs)]" :class="row.basis.estimate ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'">{{ row.basis.text }}</span>
                </span>
            </li>
        </ol>
        <Button v-if="props.remaining > 0" class="mt-1" size="sm" variant="ghost" @click="more">{{ text("origin.more", {count: props.remaining}) }}</Button>
    </div>
</template>

<style scoped>
/*
 * 列定在整张表上，每行用 subgrid 接过去：变化、结果、按钮三列按所有行里最宽的那格定宽，各行的数上下对齐；位置一列拿剩下的。
 * 不写死三列的宽：窄屏（390）上写死的宽占掉大半行，位置只剩 40 像素、折成几行，英文的按钮又放不下。发生了什么从第二行起占满整行。
 */
.origin-list__rows {
    display: grid;
    grid-template-columns: minmax(4em, 1fr) auto auto auto;
    column-gap: 0.75rem;
}
.origin-list__row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    row-gap: 0.125rem;
    align-items: baseline;
}
.origin-list__where {
    grid-area: 1 / 1;
    min-width: 0;
}
.origin-list__delta {
    grid-area: 1 / 2;
    text-align: right;
}
.origin-list__result {
    grid-area: 1 / 3;
    text-align: right;
}
.origin-list__action {
    grid-area: 1 / 4;
    text-align: right;
}
.origin-list__what {
    grid-area: 2 / 1 / 3 / 5;
}
</style>

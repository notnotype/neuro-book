<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";

import type {OriginRow} from "../rows";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    rows: readonly OriginRow[];
    /** 列表上方的一句，例如“存款是怎么来的”；不写时没有。 */
    caption?: string;
    /** 还有几步没读；大于 0 时末尾有“再显示更早的”。 */
    remaining?: number;
    loading?: boolean;
    failed?: boolean;
}>(), {caption: "", remaining: 0, loading: false, failed: false});

const emit = defineEmits<{
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
}>();

const text = useCanonText();
</script>

<template>
    <div class="min-w-0 text-[length:var(--text-sm)]" data-origin-list>
        <p v-if="props.caption !== ''" class="mb-1 font-semibold text-[var(--text-main)]">{{ props.caption }}</p>
        <p v-if="props.failed" role="alert" class="flex items-center gap-2 py-1 text-[var(--status-danger)]">
            {{ text("origin.failed") }}
            <Button size="sm" variant="ghost" @click="emit('retry')">{{ text("world.retry") }}</Button>
        </p>
        <p v-else-if="props.loading && props.rows.length === 0" class="py-1 text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <ol v-else class="m-0 list-none p-0">
            <li v-for="row in props.rows" :key="row.key" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-[var(--divider)] py-1.5 first:border-t-0" data-origin-row>
                <span class="w-16 shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ row.where }}</span>
                <span class="min-w-0 flex-1 basis-48 text-[var(--text-main)]">
                    {{ row.what }}
                    <span v-if="row.basis !== undefined" class="block text-[length:var(--text-xs)]" :class="row.basis.estimate ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'">{{ row.basis.text }}</span>
                </span>
                <span class="w-20 shrink-0 text-right font-mono text-[var(--text-secondary)]">{{ row.delta ?? "" }}</span>
                <span class="w-24 shrink-0 text-right font-mono" :class="row.check === 'mismatch' ? 'text-[var(--status-danger)]' : 'text-[var(--text-main)]'">{{ row.result }}</span>
                <Button v-if="row.change !== undefined" size="sm" variant="ghost" @click="emit('change', row.change)">{{ text("origin.editStep") }}</Button>
            </li>
        </ol>
        <Button v-if="!props.failed && props.remaining > 0" class="mt-1" size="sm" variant="ghost" @click="emit('more')">{{ text("origin.more", {count: props.remaining}) }}</Button>
    </div>
</template>

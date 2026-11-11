<script setup lang="ts">
/**
 * 面板的数据分页（docs/specs/canon/author-ui.md 输出 14）：一列值卡，选中一张，旁边是它的流水（来历）。受控：值卡、选中哪张、
 * 流水的各行都由宿主给。宽度不够时流水换到值卡下面。
 */
import type {FieldRow, OriginRow} from "../rows";
import {useCanonText} from "../text";
import OriginList from "./OriginList.vue";

const props = withDefaults(defineProps<{
    cards: readonly FieldRow[];
    /** 选中的值卡（字段路径）；没有时不写。 */
    selected?: string;
    ledger?: readonly OriginRow[];
    ledgerRemaining?: number;
    ledgerLoading?: boolean;
    ledgerFailed?: boolean;
    ledgerReason?: string;
}>(), {selected: undefined, ledger: () => [], ledgerRemaining: 0, ledgerLoading: false, ledgerFailed: false, ledgerReason: ""});

const emit = defineEmits<{
    (event: "select", path: string): void;
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
}>();

defineSlots<{
    /** 流水上面的输入（记一笔，S5）。 */
    record?(): unknown;
}>();

const text = useCanonText();
const selectedCard = (): FieldRow | undefined => props.cards.find((card) => card.path === props.selected);
</script>

<template>
    <p v-if="props.cards.length === 0" class="py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]" data-panel-view>{{ text("panel.empty") }}</p>
    <div v-else class="flex min-w-0 flex-wrap gap-6 text-[length:var(--text-sm)]" data-panel-view>
        <div class="flex w-full flex-col gap-2 sm:w-52 sm:shrink-0" role="group" :aria-label="text('panel.cards')">
            <button
                v-for="card in props.cards"
                :key="card.path"
                type="button"
                :aria-pressed="props.selected === card.path"
                class="rounded-[var(--radius-control)] border px-3 py-2 text-left"
                :class="props.selected === card.path ? 'border-[var(--accent-main)]' : 'border-[var(--divider)]'"
                :data-card="card.path"
                @click="emit('select', card.path)"
            >
                <span class="flex items-baseline justify-between gap-2">
                    <span class="shrink-0 text-[var(--text-secondary)]">{{ card.label }}</span>
                    <span v-if="card.mark !== null" class="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ card.mark }}</span>
                </span>
                <span v-if="card.items !== undefined" class="mt-1 block">
                    <span v-for="(item, index) in card.items" :key="index" class="block">{{ item }}</span>
                </span>
                <span v-else class="mt-0.5 block font-mono text-[length:var(--text-lg)]" :class="card.unknown || card.incomplete ? 'text-[var(--status-warning)]' : 'text-[var(--text-main)]'">{{ card.display }}</span>
            </button>
        </div>
        <section v-if="selectedCard() !== undefined" class="min-w-64 flex-1 basis-80">
            <h3 class="mb-2 text-[length:var(--text-sm)] font-semibold">{{ text("panel.ledger", {label: selectedCard()!.label}) }}</h3>
            <slot name="record" />
            <OriginList :rows="props.ledger" :remaining="props.ledgerRemaining" :loading="props.ledgerLoading" :failed="props.ledgerFailed" :reason="props.ledgerReason" @more="emit('more')" @retry="emit('retry')" @change="(id: string) => emit('change', id)" />
        </section>
    </div>
</template>

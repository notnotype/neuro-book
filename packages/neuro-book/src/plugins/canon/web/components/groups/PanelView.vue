<script setup lang="ts">
/**
 * 面板的数据分页（docs/specs/canon/author-ui.md 输出 14）：一列值卡，选中一张，旁边是它的流水（来历）。受控：值卡、选中哪张、
 * 流水的各行都由宿主给。宽度不够时流水换到值卡下面。
 */
import {Button} from "@notnotype/nb-ui/components";

import type {FieldRow, OriginRow} from "../../rows";
import {useCanonText} from "../../text";
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
    /** 值卡旁显示“改”按钮（可改的卡）；默认 false。 */
    editing?: boolean;
    /** “改”不可用时的原因；可用时不写。 */
    editReason?: string;
}>(), {selected: undefined, ledger: () => [], ledgerRemaining: 0, ledgerLoading: false, ledgerFailed: false, ledgerReason: "", editing: false, editReason: ""});

const emit = defineEmits<{
    (event: "select", path: string): void;
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
    (event: "edit", path: string): void;
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
        <div class="panel-view__cards w-full sm:w-52 sm:shrink-0" :class="props.editing ? 'panel-view__cards--editing' : ''" role="group" :aria-label="text('panel.cards')">
            <div v-for="card in props.cards" :key="card.path" class="panel-view__card">
                <button
                    type="button"
                    :aria-pressed="props.selected === card.path"
                    class="min-w-0 flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-left"
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
                <!-- “改”那一格每张卡都留着（不能改的空着）：卡片等宽，按钮上下对齐（nb-ui 界面开发规范“几何、排版与动效”第 6 条）。 -->
                <span v-if="props.editing" class="flex justify-end">
                    <Button
                        v-if="card.editable"
                        size="sm"
                        variant="ghost"
                        :data-edit="card.path"
                        :disabled="props.editReason !== ''"
                        :title="props.editReason !== '' ? props.editReason : undefined"
                        :aria-label="text('edit.label', {label: card.label})"
                        @click="emit('edit', card.path)"
                    >{{ text("edit.button") }}</Button>
                </span>
            </div>
        </div>
        <section v-if="selectedCard() !== undefined" class="min-w-64 flex-1 basis-80">
            <h3 class="mb-2 text-[length:var(--text-sm)] font-semibold">{{ text("panel.ledger", {label: selectedCard()!.label}) }}</h3>
            <slot name="record" />
            <OriginList :rows="props.ledger" :remaining="props.ledgerRemaining" :loading="props.ledgerLoading" :failed="props.ledgerFailed" :reason="props.ledgerReason" @more="emit('more')" @retry="emit('retry')" @change="(id: string) => emit('change', id)" />
        </section>
    </div>
</template>

<style scoped>
/*
 * 卡片一列、“改”一列定在整组上，每张卡用 subgrid 接过去：“改”那一列按最宽的按钮定宽（英文的 Edit 比“改”宽），各卡仍等宽、按钮上下对齐。
 */
.panel-view__cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem 0.25rem;
}
.panel-view__cards--editing {
    grid-template-columns: minmax(0, 1fr) auto;
}
.panel-view__card {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: start;
}
</style>

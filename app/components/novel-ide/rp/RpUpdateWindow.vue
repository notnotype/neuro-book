<script setup lang="ts">
import {ref, watch} from "vue";
import DialogWindow from "nbook/app/components/common/DialogWindow.vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {RpUpdateDetailDto, RpUpdateListItemDto, RpUpdatePageDto} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{
    modelValue: boolean;
    projectPath: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const items = ref<RpUpdateListItemDto[]>([]);
const total = ref(0);
const listLoading = ref(false);
const detailLoading = ref(false);
const loadError = ref("");
const selectedTurnId = ref<string | null>(null);
const detail = ref<RpUpdateDetailDto | null>(null);

watch(() => props.modelValue, (visible) => {
    if (visible) void loadUpdates(true);
});

watch(() => props.projectPath, () => {
    items.value = [];
    total.value = 0;
    selectedTurnId.value = null;
    detail.value = null;
    if (props.modelValue) void loadUpdates(true);
});

/** 分页加载世界更新摘要；重置时从最新记录开始。 */
async function loadUpdates(reset: boolean): Promise<void> {
    if (listLoading.value || !props.projectPath) return;
    listLoading.value = true;
    loadError.value = "";
    try {
        const offset = reset ? 0 : items.value.length;
        const page = await $fetch<RpUpdatePageDto>("/api/projects/rp/updates", {
            query: {projectPath: props.projectPath, offset, limit: 20},
        });
        items.value = reset ? page.items : [...items.value, ...page.items];
        total.value = page.total;
        if (reset && page.items[0]) await selectUpdate(page.items[0].turnId);
    } catch (error) {
        loadError.value = resolveApiErrorMessage(error, "世界更新列表加载失败");
    } finally {
        listLoading.value = false;
    }
}

/** 点击摘要后才读取该回合的完整文件化结算。 */
async function selectUpdate(turnId: string): Promise<void> {
    if (detailLoading.value && selectedTurnId.value === turnId) return;
    selectedTurnId.value = turnId;
    detailLoading.value = true;
    detail.value = null;
    loadError.value = "";
    try {
        detail.value = await $fetch<RpUpdateDetailDto>("/api/projects/rp/update", {
            query: {projectPath: props.projectPath, turnId},
        });
    } catch (error) {
        loadError.value = resolveApiErrorMessage(error, "世界更新详情加载失败");
    } finally {
        detailLoading.value = false;
    }
}

/** 格式化记录时间。 */
function formatDateTime(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** 格式化带正负号的数值变化。 */
function signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}
</script>

<template>
    <!-- 文件化世界更新查看器：列表只含摘要，详情按需读取 -->
    <DialogWindow
        :model-value="modelValue"
        title="世界更新"
        :width="880"
        height="min(720px, calc(100vh - 64px))"
        body-class="min-h-0 overflow-hidden"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="loadError" class="shrink-0 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ loadError }}</div>
        <div class="flex min-h-0 flex-1">
            <!-- 更新摘要列表 -->
            <aside class="flex w-[270px] shrink-0 flex-col border-r border-[var(--border-color)]">
                <div class="shrink-0 border-b border-[var(--border-color)] px-3 py-2 text-[10px] text-[var(--text-muted)]">已提交更新 {{ total }} 条</div>
                <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
                    <div v-if="!items.length && !listLoading" class="py-8 text-center text-[11px] text-[var(--text-muted)]">尚无已提交的世界更新。</div>
                    <button
                        v-for="item in items"
                        :key="item.turnId"
                        type="button"
                        class="mb-1.5 w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                        :class="selectedTurnId === item.turnId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                        @click="void selectUpdate(item.turnId)"
                    >
                        <div class="flex items-center justify-between gap-2"><span class="font-mono text-[10px] text-[var(--accent-text)]">Tick #{{ item.sequence }}</span><span class="text-[9px] text-[var(--text-muted)]">{{ formatDateTime(item.at) }}</span></div>
                        <div class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-main)]">{{ item.summary }}</div>
                        <div class="mt-1 truncate text-[9px] text-[var(--text-muted)]">{{ item.inputSummary }}</div>
                    </button>
                    <button v-if="items.length < total" type="button" class="w-full rounded-md border border-[var(--border-color)] py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" :disabled="listLoading" @click="void loadUpdates(false)">
                        {{ listLoading ? "加载中…" : "加载更多" }}
                    </button>
                </div>
            </aside>

            <!-- 单回合详细结算 -->
            <main class="min-w-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
                <div v-if="detailLoading" class="flex h-full items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]"><span class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>读取结算文件…</div>
                <div v-else-if="!detail" class="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">选择一条更新查看详情。</div>
                <template v-else>
                    <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2.5">
                        <div class="flex items-center justify-between gap-2"><span class="text-[13px] font-semibold text-[var(--text-main)]">Tick #{{ detail.turn.sequence }}</span><span class="text-[10px] text-[var(--text-muted)]">{{ formatDateTime(detail.turn.committedAt) }}</span></div>
                        <div class="mt-1 text-[11px] text-[var(--text-secondary)]">{{ detail.turn.inputSummary }}</div>
                        <div v-if="detail.turn.prosePath" class="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{{ detail.turn.prosePath }}</div>
                    </div>

                    <section v-if="detail.time" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                        <div class="text-[11px] font-semibold text-[var(--text-main)]">时间推进</div>
                        <div class="mt-1 text-[11px] text-[var(--text-secondary)]">{{ detail.time.startTime }} → {{ detail.time.endTime }}<span v-if="detail.time.longJump" class="ml-1 rounded bg-[var(--status-info-bg)] px-1 py-0.5 text-[9px] text-[var(--status-info)]">长时间跳跃</span></div>
                        <div class="mt-1 text-[10px] text-[var(--text-muted)]">{{ detail.time.summary }}</div>
                    </section>

                    <section v-if="detail.resourceTransactions.length" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                        <div class="mb-1 text-[11px] font-semibold text-[var(--text-main)]">资源变化</div>
                        <div v-for="(transaction, index) in detail.resourceTransactions" :key="`${transaction.accountId}-${index}`" class="flex items-center gap-2 py-0.5 text-[10px]"><span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{{ transaction.reason }}</span><span :class="transaction.delta < 0 ? 'text-[var(--status-danger)]' : 'text-[var(--status-success)]'">{{ signed(transaction.delta) }}</span><span class="font-mono text-[var(--text-muted)]">→ {{ transaction.balance }}</span></div>
                    </section>

                    <section v-if="detail.relationChanges.length" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                        <div class="mb-1 text-[11px] font-semibold text-[var(--text-main)]">关系变化</div>
                        <div v-for="(change, index) in detail.relationChanges" :key="`${change.sourceId}-${change.targetId}-${index}`" class="border-b border-[var(--border-color)] py-1.5 text-[10px] last:border-0"><div class="text-[var(--text-main)]">{{ change.sourceId }} → {{ change.targetId }}</div><div class="mt-0.5 text-[var(--text-secondary)]">{{ change.reason }}</div><div class="mt-0.5 font-mono text-[var(--text-muted)]">{{ Object.entries(change.deltas).map(([key, value]) => `${key} ${signed(value ?? 0)}`).join(" · ") }}</div></div>
                    </section>

                    <section v-if="detail.longJump" class="mb-3 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-2.5">
                        <div class="text-[11px] font-semibold text-[var(--status-info)]">跨时段推演</div>
                        <div class="mt-1 text-[10px] text-[var(--text-secondary)]">{{ detail.longJump.deterministicSummary }}</div>
                        <div class="mt-1 text-[10px] text-[var(--text-secondary)]">角色：{{ detail.longJump.characterSummary }}</div>
                        <div class="mt-1 text-[10px] text-[var(--text-secondary)]">世界：{{ detail.longJump.worldSummary }}</div>
                    </section>

                    <section v-if="detail.stageHistory.length" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                        <div class="mb-1 text-[11px] font-semibold text-[var(--text-main)]">公开运行记录</div>
                        <div v-for="stage in detail.stageHistory" :key="`${stage.stage}-${stage.at}`" class="flex gap-2 py-0.5 text-[10px]"><span class="w-[92px] shrink-0 font-mono text-[var(--text-muted)]">{{ stage.stage }}</span><span class="text-[var(--text-secondary)]">{{ stage.publicSummary }}</span></div>
                    </section>

                    <section>
                        <div class="mb-1.5 text-[11px] font-semibold text-[var(--text-main)]">完整结算</div>
                        <JsonViewer :value="detail.settlement" :max-height="360" />
                    </section>
                </template>
            </main>
        </div>
    </DialogWindow>
</template>

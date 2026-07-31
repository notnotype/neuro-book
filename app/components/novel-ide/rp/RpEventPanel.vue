<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {RpEventActionRequestDto, RpRuntimeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{
    events: RpRuntimeOverviewDto["events"] | null;
    busy: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: RpEventActionRequestDto): void;
}>();

const selectedIds = ref<string[]>([]);
const terminalStatuses = new Set(["resolved", "failed", "missed", "continued_without_player", "expired", "cancelled"]);

const candidates = computed(() => props.events?.items.filter((event) => event.origin === "candidate" && ["available", "saved"].includes(event.status)) ?? []);
const scheduled = computed(() => props.events?.items.filter((event) => event.origin !== "candidate" && ["available", "saved"].includes(event.status)) ?? []);
const ongoing = computed(() => props.events?.items.filter((event) => ["selected", "active", "suspended"].includes(event.status)) ?? []);
const ended = computed(() => props.events?.items.filter((event) => terminalStatuses.has(event.status)).slice(0, 12) ?? []);

watch(candidates, (items) => {
    const selectable = new Set(items.filter((event) => event.availability === "available").map((event) => event.id));
    selectedIds.value = selectedIds.value.filter((id) => selectable.has(id));
});

const toneLabels: Record<string, string> = {calm: "平淡", exciting: "刺激", dangerous: "危险", unusual: "不寻常"};
const statusLabels: Record<string, string> = {
    available: "待选择", saved: "已保留", selected: "已选择", active: "进行中", suspended: "已暂停",
    resolved: "已解决", failed: "失败", missed: "已错过", continued_without_player: "已自行发展", expired: "已失效", cancelled: "已放弃",
};
const originLabels: Record<string, string> = {opening: "开场事件", hard_schedule: "硬性日程", player: "玩家添加"};

/** 切换随机范围；服务端只接受 1–4 张。 */
function toggleRandomRange(eventId: string): void {
    if (selectedIds.value.includes(eventId)) {
        selectedIds.value = selectedIds.value.filter((id) => id !== eventId);
        return;
    }
    if (selectedIds.value.length < 4) selectedIds.value = [...selectedIds.value, eventId];
}

/** 提交当前随机范围。 */
function randomSelect(): void {
    if (!selectedIds.value.length) return;
    emit("action", {op: "random_select", eventIds: selectedIds.value});
}
</script>

<template>
    <!-- 待选事件与事件进度 -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
            <div class="flex items-center justify-between gap-2"><span>连续平淡回合</span><span class="font-mono text-[var(--text-main)]">{{ events?.calmTickStreak ?? 0 }} / 5</span></div>
            <div v-if="events?.candidateGenerationDue" class="mt-1 text-[var(--status-warning)]">主持人应在下一次合适时机补充候选事件。</div>
        </div>

        <section class="mb-4">
            <div class="mb-2 flex items-center justify-between gap-2">
                <div class="text-[12px] font-semibold text-[var(--text-main)]">待选事件</div>
                <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--accent-text)] disabled:opacity-40" :disabled="busy || !selectedIds.length" @click="randomSelect">
                    <span class="i-lucide-dices mr-1 inline-block h-3 w-3 align-middle"></span>从 {{ selectedIds.length || "1–4" }} 张随机
                </button>
            </div>
            <div v-if="!candidates.length" class="rounded-md border border-dashed border-[var(--border-color)] px-3 py-6 text-center text-[11px] text-[var(--text-muted)]">当前没有待选事件。进入新地点、开始新活动或经历多个平淡回合后，主持人会主动补充。</div>
            <article v-for="event in candidates" :key="event.id" class="mb-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5">
                <div class="flex items-start gap-2">
                    <button
                        type="button"
                        class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--border-strong)] text-[var(--accent-text)] disabled:opacity-40"
                        :class="selectedIds.includes(event.id) ? 'bg-[var(--accent-bg)]' : ''"
                        :disabled="busy || event.availability !== 'available'"
                        title="加入随机范围"
                        @click="toggleRandomRange(event.id)"
                    >
                        <span v-if="selectedIds.includes(event.id)" class="i-lucide-check h-3 w-3"></span>
                    </button>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                            <span class="rounded bg-[var(--accent-bg)] px-1.5 py-0.5 text-[9px] text-[var(--accent-text)]">{{ toneLabels[event.tone] ?? event.tone }}</span>
                            <span v-if="event.status === 'saved'" class="rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[9px] text-[var(--status-warning)]">已保留</span>
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ event.title }}</span>
                        </div>
                        <p class="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ event.playerSummary }}</p>
                        <p v-if="event.availability !== 'available'" class="mt-1 text-[10px] text-[var(--status-warning)]">{{ event.availabilityReason ?? "需要重新确认是否仍可触发" }}</p>
                        <div class="mt-2 flex flex-wrap justify-end gap-1.5">
                            <button v-if="event.status === 'available' && event.availability === 'available'" type="button" class="rounded border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" :disabled="busy" @click="emit('action', {op: 'save', eventId: event.id})">保留</button>
                            <button type="button" class="rounded border border-[var(--status-danger-border)] px-2 py-1 text-[10px] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-40" :disabled="busy" @click="emit('action', {op: 'discard', eventId: event.id})">放弃</button>
                            <button v-if="event.availability === 'available'" type="button" class="rounded bg-[var(--accent-main)] px-2 py-1 text-[10px] text-[var(--text-inverse)] disabled:opacity-40" :disabled="busy" @click="emit('action', {op: 'select', eventId: event.id})">选择入口</button>
                        </div>
                    </div>
                </div>
            </article>
        </section>

        <section v-if="scheduled.length" class="mb-4">
            <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">已知日程与计划</div>
            <article v-for="event in scheduled" :key="event.id" class="mb-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2.5">
                <div class="flex items-center justify-between gap-2"><span class="truncate text-[12px] font-medium text-[var(--text-main)]">{{ event.title }}</span><span class="shrink-0 text-[9px] text-[var(--status-warning)]">{{ originLabels[event.origin] ?? event.origin }}</span></div>
                <div class="mt-1 text-[11px] text-[var(--text-secondary)]">{{ event.playerSummary }}</div>
                <div v-if="event.dueAt" class="mt-1 font-mono text-[9px] text-[var(--text-muted)]">预定：{{ event.dueAt }}</div>
            </article>
        </section>

        <section v-if="ongoing.length" class="mb-4">
            <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">正在发展</div>
            <article v-for="event in ongoing" :key="event.id" class="mb-2 rounded-md border border-[var(--border-color)] p-2.5">
                <div class="flex items-center justify-between gap-2"><span class="truncate text-[12px] font-medium text-[var(--text-main)]">{{ event.title }}</span><span class="shrink-0 text-[10px] text-[var(--accent-text)]">{{ statusLabels[event.status] ?? event.status }}</span></div>
                <div class="mt-1 text-[11px] text-[var(--text-secondary)]">{{ event.playerSummary }}</div>
                <button v-if="event.origin === 'candidate' && event.status === 'selected'" type="button" class="mt-2 text-[10px] text-[var(--status-danger)] hover:underline disabled:opacity-40" :disabled="busy" @click="emit('action', {op: 'discard', eventId: event.id})">放弃尚未开始的入口</button>
            </article>
        </section>

        <details v-if="ended.length" class="rounded-md border border-[var(--border-color)] p-2.5">
            <summary class="cursor-pointer text-[12px] font-semibold text-[var(--text-main)]">最近结束（{{ ended.length }}）</summary>
            <div v-for="event in ended" :key="event.id" class="mt-2 border-t border-[var(--border-color)] pt-2">
                <div class="flex items-center justify-between gap-2 text-[11px]"><span class="truncate text-[var(--text-secondary)]">{{ event.title }}</span><span class="shrink-0 text-[var(--text-muted)]">{{ statusLabels[event.status] ?? event.status }}</span></div>
            </div>
        </details>
    </div>
</template>

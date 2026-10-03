<script setup lang="ts">
import type {LiveCardVm} from "nbook/server/agent/workflow/workflow-run-vm";

/**
 * Agent 直播卡片：每个参与者一张卡——名字 + 状态（💭 思考中 / ✔ 空闲）+ 最近一问一答。
 * 「聊天室成员列表」式的最直觉视角。
 */
defineProps<{cards: LiveCardVm[]}>();
</script>

<template>
    <!-- 直播卡片网格 -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
        <div v-if="!cards.length" class="col-span-full py-4 text-center text-xs text-[var(--text-muted)]">还没有参与者</div>
        <div v-for="card in cards" :key="card.sessionId"
            class="rounded-lg border p-2.5 text-xs transition-colors"
            :class="card.busy
                ? 'wf-card-busy border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]'
                : 'border-[var(--border-color)] bg-[var(--bg-main)]'">
            <div class="mb-1 flex items-center justify-between gap-2">
                <span class="font-semibold text-[var(--text-main)]">{{ card.name }}</span>
                <span :class="card.busy ? 'text-[var(--status-warning)]' : 'text-[var(--status-success)]'">{{ card.busy ? "💭 思考中" : "✔ 空闲" }}</span>
            </div>
            <div v-if="card.lastAction" class="truncate text-[var(--text-muted)]" :title="card.lastAction">收到：{{ card.lastAction }}</div>
            <div v-if="card.lastReply" class="truncate text-[var(--text-secondary)]" :title="card.lastReply">回复：{{ card.lastReply }}</div>
            <div v-if="!card.lastAction && !card.lastReply" class="text-[var(--text-muted)]">尚未被调用</div>
        </div>
    </div>
</template>

<style scoped>
/* 思考中卡片呼吸边框 */
.wf-card-busy { animation: wf-card-breathe 1.2s ease-in-out infinite; }
@keyframes wf-card-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
</style>

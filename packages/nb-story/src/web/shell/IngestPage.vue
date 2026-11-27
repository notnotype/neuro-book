<script setup lang="ts">
/**
 * 进度页 `/ingest/<书 id>`（docs/specs/story/viewer.md 输出 38、40）：一本书的 `ingest.status` 全部内容，独立服务里
 * 运行时可以停止，停下时可以继续。打开着时每 2 秒查一次（输出 38 要求运行中 5 秒内跟上）。
 *
 * 停止只是请求：任务在抽取线程里收尾（可能正卡在一次长的编译里）后才报“已停下”，在那之前按钮显示“正在停止”。
 */
import {Button, Progress, Table} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import {useRoute, useRouter} from "vue-router";

import type {IngestStatusView} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";
import {formatCosts, formatDuration, formatTokens, nextStepText, STEP_LABELS, STEPS, stopText} from "../host/ingest";
import IngestBadge from "../parts/IngestBadge.vue";
import ThemeMenu from "../parts/ThemeMenu.vue";

const client = useStoryClient();
const route = useRoute();
const router = useRouter();
const bookId = computed(() => String(route.params.id ?? ""));
const status = shallowRef<IngestStatusView | null>(null);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const stopping = ref(false);
const resuming = ref(false);
const shownRows = ref(10);

// 手机宽度（与书的外壳同一个界线，720 以下）：四格排成两列，章明细只留章、用时、费用三列（输出 40）。
const narrowQuery = window.matchMedia("(max-width: 719.98px)");
const narrow = ref(narrowQuery.matches);
const onNarrow = (event: MediaQueryListEvent): void => {
    narrow.value = event.matches;
};
narrowQuery.addEventListener("change", onNarrow);

const COLUMNS = [
    {key: "chapter" as const, label: "章", width: "56px", align: "right" as const},
    {key: "title" as const, label: "标题"},
    {key: "time" as const, label: "用时", width: "96px", align: "right" as const},
    {key: "cost" as const, label: "费用", width: "88px", align: "right" as const},
    {key: "dropped" as const, label: "丢弃记录", width: "84px", align: "right" as const},
];
const columns = computed(() => (narrow.value ? COLUMNS.filter(column => column.key !== "title" && column.key !== "dropped") : COLUMNS));

const rows = computed(() => {
    const chapters = [...(status.value?.chapters ?? [])].reverse();
    return chapters.slice(0, shownRows.value).map(chapter => ({
        chapter: chapter.chapter,
        title: chapter.title,
        time: formatDuration(chapter.ms),
        cost: `${chapter.usage.complete ? "" : "至少 "}${formatCosts(chapter.usage.costs) ?? "—"}`,
        dropped: chapter.dropped,
    }));
});
const hiddenRows = computed(() => Math.max(0, (status.value?.chapters.length ?? 0) - shownRows.value));
const dropped = computed(() => (status.value?.chapters ?? []).reduce((sum, chapter) => sum + chapter.dropped, 0));
/** 这本书关掉了哪几类（ingest.md 输出 18）；两项都开时不写。 */
const settingText = computed(() => {
    const features = status.value?.features;
    const off = features ? [...(features.ledger ? [] : ["数值"]), ...(features.secrets ? [] : ["秘密"])] : [];
    return off.length ? `不记${off.join("、")}` : "";
});
const remainingText = computed(() => {
    const value = status.value;
    if (!value || !value.average || value.state !== "running") return null;
    return `按每章平均估计，剩下的还要约 ${formatDuration(value.average.ms * (value.total - value.committed))}`;
});
const tiles = computed(() => {
    const value = status.value;
    if (!value) return [];
    // 用量拿不到的请求让合计成了下界：已花与每章平均（由历次合计折算）都写“至少”。
    const atLeast = value.allRuns.complete ? "" : "至少 ";
    const spent = formatCosts(value.allRuns.costs);
    const averageCost = value.average ? formatCosts(value.average.costs) : null;
    const average = value.average ? `${formatDuration(value.average.ms)}${averageCost ? ` · ${atLeast}${averageCost}` : ""}` : "—";
    // 有了 token 却没有费用，才是没配价格；一次用量都还没有时写“—”。
    const unpriced = value.allRuns.input + value.allRuns.output > 0 ? "没配价格" : "—";
    return [
        {label: "本次用时", value: formatDuration(value.thisRun.ms)},
        {label: "已花（合计）", value: spent ? `${atLeast}${spent}` : unpriced},
        {label: "每章平均", value: average},
        {label: "丢弃记录", value: `${dropped.value} 条`},
    ];
});
const tokenText = computed(() => {
    const usage = status.value?.allRuns;
    if (!usage) return "";
    const hit = usage.input > 0 ? `（缓存命中 ${Math.round((usage.cacheRead / usage.input) * 100)}%）` : "";
    const price = usage.costs.length ? "价格来自配置文件" : usage.input + usage.output > 0 ? "没配价格，只显示 token" : "";
    return `token：${usage.complete ? "" : "至少 "}输入 ${formatTokens(usage.input)}${hit}、输出 ${formatTokens(usage.output)}。${price ? `${price}。` : ""}`;
});
const currentStep = computed(() => status.value?.current?.step ?? null);
/**
 * 四步（整理时加第五步）与各自的状态：当前一步之前的已做完，之后的还没开始。挑相关说法（在最前）与核对马甲（在四步之后）
 * 开没开，进度里看不出来，所以只在正做的时候列出来；整理时也不补列核对马甲。
 */
const stepStates = computed(() => {
    const step = currentStep.value;
    if (step === null) return [];
    const steps = step === "consolidation" ? [...STEPS, "consolidation" as const] : step === "recall" ? ["recall" as const, ...STEPS] : step === "persona" ? [...STEPS, "persona" as const] : STEPS;
    const index = steps.indexOf(step);
    return steps.map((item, position) => ({step: item, state: position < index ? "done" : position === index ? "current" : "todo"}));
});
const retryText = computed(() => {
    const retry = status.value?.current?.retry;
    if (!retry) return null;
    const left = Math.max(0, Date.parse(retry.until) - now.value);
    return `第 ${retry.attempt} 次请求失败，${formatDuration(left)}后重试（同一次请求至多 6 次）`;
});

async function load(): Promise<void> {
    try {
        status.value = (await client.call("ingest.status", {book: bookId.value})).books[0] ?? null;
        loadError.value = null;
        if (status.value?.state !== "running") stopping.value = false;
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        loadError.value = caught.code === "book_not_found" ? `书 ${bookId.value} 没有抽取记录。` : caught.message;
    }
}

const now = ref(Date.now());
const POLL_MS = 2000;
const timer = setInterval(() => {
    now.value = Date.now();
    void load();
}, POLL_MS);
watch(bookId, () => void load(), {immediate: true});
onBeforeUnmount(() => {
    clearInterval(timer);
    narrowQuery.removeEventListener("change", onNarrow);
});

async function stop(): Promise<void> {
    actionError.value = null;
    stopping.value = true;
    try {
        await client.call("ingest.stop", {book: bookId.value});
        await load();
    } catch (caught) {
        stopping.value = false;
        if (!(caught instanceof StoryCallError)) throw caught;
        actionError.value = caught.message;
    }
}

async function resume(): Promise<void> {
    actionError.value = null;
    resuming.value = true;
    try {
        await client.call("ingest.start", {book: bookId.value});
        await load();
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        actionError.value = caught.code === "qa_unconfigured" ? "还没有配置抽取用的模型：先在终端里运行 nbstory config init。" : caught.message;
    } finally {
        resuming.value = false;
    }
}
</script>

<template>
    <main class="story-scroll-y h-full" data-testid="ingest-page">
        <div class="mx-auto flex max-w-[860px] flex-col gap-4 p-4 sm:p-6">
            <nav class="flex min-w-0 items-center gap-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                <RouterLink to="/" class="flex items-center gap-1 hover:text-[var(--text-secondary)]"><span class="i-lucide-library" />书架</RouterLink>
                <span class="i-lucide-chevron-right shrink-0" /><span class="truncate">{{ status?.title ?? bookId }}</span>
                <span class="i-lucide-chevron-right shrink-0" /><span class="shrink-0">抽取进度</span>
                <ThemeMenu class="ml-auto shrink-0" />
            </nav>
            <p v-if="loadError" class="text-[var(--status-danger)]" role="alert">{{ loadError }}</p>

            <template v-if="status">
                <div class="flex flex-wrap items-center gap-3">
                    <h1 class="min-w-0 truncate text-[length:var(--text-lg)] font-[var(--weight-strong)]">{{ status.title }}</h1>
                    <IngestBadge :status="status" />
                    <span v-if="status.state === 'done'" class="text-[length:var(--text-sm)] text-[var(--status-success)]">已全部抽完</span>
                    <span v-if="settingText" class="text-[length:var(--text-sm)] text-[var(--text-muted)]" data-testid="ingest-features">{{ settingText }}</span>
                    <span class="ml-auto" />
                    <Button v-if="status.committed > 0" size="sm" variant="secondary" icon-class="i-lucide-book-open" data-testid="ingest-open-book" @click="router.push(`/book/${encodeURIComponent(status.id)}`)">打开书（读到第 {{ status.committed }} 章）</Button>
                    <Button v-if="status.state === 'running' && status.runner === 'serve'" size="sm" variant="secondary" icon-class="i-lucide-square" :disabled="stopping" data-testid="ingest-stop" @click="stop">{{ stopping ? "正在停止" : "停止" }}</Button>
                    <Button variant="primary" v-else-if="status.state === 'stopped'" size="sm" icon-class="i-lucide-play" :disabled="resuming" data-testid="ingest-resume" @click="resume">继续</Button>
                </div>
                <p v-if="actionError" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-testid="ingest-action-error">{{ actionError }}</p>

                <section class="flex flex-col gap-2">
                    <div class="flex flex-wrap items-baseline gap-x-2" data-testid="ingest-count" :data-committed="status.committed">
                        <span class="text-[length:var(--text-sm)] text-[var(--text-muted)]">抽完</span><b class="text-[length:var(--text-lg)]">{{ status.committed }}</b><span class="whitespace-nowrap text-[var(--text-muted)]">/ {{ status.total }} 章</span>
                        <span v-if="remainingText" class="ml-auto text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ remainingText }}</span>
                    </div>
                    <Progress :model-value="status.committed" :max="status.total" :tone="status.stopReason?.kind === 'failed' ? 'danger' : 'accent'" />
                </section>

                <section v-if="status.state === 'running'" class="flex flex-col gap-2 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-4 py-3" data-testid="ingest-current">
                    <div class="text-[length:var(--text-sm)]">
                        <template v-if="status.current?.chapter">正在抽 <b>第 {{ status.current.chapter }} 章</b></template>
                        <template v-else>正在准备</template>
                        <template v-if="status.runner === 'cli'">（由命令行运行）</template>
                    </div>
                    <ol v-if="currentStep" class="flex flex-wrap gap-2 text-[length:var(--text-xs)]" data-testid="ingest-steps" :data-step="currentStep">
                        <li v-for="item in stepStates" :key="item.step" class="flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5" :class="item.state === 'current' ? 'step-current' : item.state === 'done' ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)] opacity-60'">
                            <span :class="item.state === 'current' ? 'i-lucide-loader' : item.state === 'done' ? 'i-lucide-check' : 'i-lucide-circle'" />{{ STEP_LABELS[item.step] }}
                        </li>
                    </ol>
                    <div v-if="retryText" class="text-[length:var(--text-xs)] text-[var(--status-warning)]"><span class="i-lucide-refresh-cw mr-1 align-[-2px]" />{{ retryText }}</div>
                    <div v-if="status.runner === 'cli'" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">网页上不能停止它：在运行它的终端里按 Ctrl-C。停下后可以在这里点“继续”。</div>
                </section>
                <section v-else-if="status.state === 'stopped'" class="flex flex-col gap-1 rounded-[var(--radius-control)] px-4 py-3 text-[length:var(--text-sm)]" :class="status.stopReason?.kind === 'failed' ? 'border border-[var(--status-danger)]' : 'bg-[var(--bg-subtle)]'" data-testid="ingest-stopped">
                    <div :class="status.stopReason?.kind === 'failed' ? 'text-[var(--status-danger)]' : ''">
                        <span v-if="status.stopReason?.kind === 'failed'" class="i-lucide-circle-x mr-1 align-[-2px]" />{{ stopText(status) }}。<template v-if="status.committed > 0">抽完的 {{ status.committed }} 章都保留。</template>
                    </div>
                    <div v-if="status.stopReason?.kind === 'failed'" class="break-words text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ status.stopReason.message }}</div>
                    <div class="text-[var(--text-muted)]">{{ nextStepText(status) ?? "点“继续”接着抽。" }}</div>
                </section>

                <section class="grid gap-3" :class="narrow ? 'grid-cols-2' : 'grid-cols-4'" data-testid="ingest-tiles">
                    <div v-for="tile in tiles" :key="tile.label" class="min-w-0 rounded-[var(--radius-control)] border border-[var(--divider)] px-3 py-2">
                        <div class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ tile.label }}</div>
                        <div class="truncate font-[var(--weight-strong)]" :title="tile.value">{{ tile.value }}</div>
                    </div>
                </section>
                <div class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ tokenText }}</div>

                <section v-if="status.chapters.length" class="flex flex-col gap-2">
                    <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">抽完的章 <span class="font-normal text-[var(--text-muted)]">（新的在前）</span></h2>
                    <Table :columns="columns" :rows="rows" row-key="chapter" density="compact" data-testid="ingest-chapters" />
                    <Button v-if="hiddenRows" class="self-start" size="sm" variant="ghost" @click="shownRows += 20">再显示 {{ Math.min(20, hiddenRows) }} 章</Button>
                </section>
            </template>
        </div>
    </main>
</template>

<style scoped>
.step-current {
    background: var(--bg-hover);
    color: var(--accent-text);
}
</style>

<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {daysSince, HERDR_STATUS_LABEL} from "../host/format.js";
import {groupInbox} from "../host/inbox.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {byAttention} from "../host/nav.js";
import {attentionCount} from "../host/notify-actions.js";
import type {NotifyData, Overview, OverviewWork} from "../host/types.js";
import InboxList from "../parts/InboxList.vue";
import ActionLink from "../parts/ActionLink.vue";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import WorkCard from "../parts/WorkCard.vue";

/**
 * 首页（t03 第三轮首页 A）：收件箱在上（上面一行是要处理的通知），Work 卡片在下。只为进行中与未标的 Work 列卡片，
 * 有事等我的在前、其次进行中、再按最近更新（t15 阶段 4 第 2 批）；
 * 超过 30 天没有更新的、done 与 shelved 的收进“其余 N 个”（不做状态推断，见 t09 计划“与 Proposal、实施计划的不一致”）。
 */
const router = useRouter();
const overview = useResource<Overview>(() => "/api/overview", ["records", "activity"]);
const STALE_DAYS = 30;
const showRest = ref(false);

// 有事等我的（有待答题）在前，其次进行中，再按最近更新（与左栏的“有事等我在前”同一个顺序）。
const sorted = computed(() => [...(overview.data.value?.works ?? [])].sort(byAttention));
const notify = useResource<NotifyData>(() => "/api/notify", ["notify"]);
/** 要处理的通知（与顶栏的计数同一个口径）：“等我”的一部分，放在收件箱上面。 */
const attention = computed(() => attentionCount(notify.data.value));
const isCurrent = (work: OverviewWork) => (work.status.value === null || work.status.value === "active") && work.updated.value !== null && daysSince(work.updated.value) <= STALE_DAYS;
const current = computed(() => sorted.value.filter(isCurrent));
const rest = computed(() => sorted.value.filter((work) => !isCurrent(work)));
const sessionLine = computed(() => {
    const sessions = overview.data.value?.sessions;
    if (!sessions) return "";
    const parts = Object.entries(sessions.byStatus).map(([status, count]) => `${HERDR_STATUS_LABEL[status] ?? status} ${count}`);
    return `${sessions.total} 个会话${parts.length > 0 ? `（${parts.join("、")}）` : ""}${sessions.unownedRuns > 0 ? `，${sessions.unownedRuns} 个无主的运行` : ""}`;
});

const navigate = (href: string) => void router.push(href);
</script>

<template>
    <PageShell :crumbs="[{label: '首页'}]" title="首页">
        <LoadState v-bind="loadStateOf(overview)" label="正在读取 Work 与收件箱" @retry="overview.reload()" />
        <template v-if="overview.data.value">
            <section class="nbdev-stack" aria-labelledby="inbox-title">
                <h2 id="inbox-title" class="nbdev-heading flex items-center gap-2">
                    收件箱<span class="nbdev-secondary nbdev-num font-normal">{{ groupInbox(overview.data.value.inbox).length }}</span>
                </h2>
                <p v-if="attention > 0" class="nbdev-hint nbdev-hint-warn flex flex-wrap items-center gap-2">
                    <span class="i-lucide-bell nbdev-warn size-3.5" aria-hidden="true" />通知要处理 {{ attention }} 条（会话换了、找不到要通知的会话，或投递没成功）
                    <ActionLink href="/live/sessions?view=notify" icon="i-lucide-arrow-right" @navigate="navigate">去处理</ActionLink>
                </p>
                <div class="nbdev-surface px-3 py-1">
                    <InboxList :items="overview.data.value.inbox" :session-titles="overview.data.value.sessionTitles" @navigate="navigate" />
                </div>
            </section>
            <section class="nbdev-stack" aria-labelledby="works-title">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="works-title" class="nbdev-heading">Work</h2>
                    <ActionLink href="/live/sessions" icon="i-lucide-terminal" @navigate="navigate">{{ sessionLine }}</ActionLink>
                </div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <WorkCard v-for="work in current" :key="work.workId" :work="work" :session-titles="overview.data.value.sessionTitles" @navigate="navigate" />
                </div>
                <p v-if="current.length === 0" class="nbdev-empty">最近 {{ STALE_DAYS }} 天没有在动的 Work</p>
                <div v-if="rest.length > 0" class="nbdev-stack">
                    <Button variant="ghost" size="sm" :icon-class="showRest ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="self-start" :aria-expanded="showRest" @click="showRest = !showRest">
                        其余 {{ rest.length }} 个 Work（完成、搁置或超过 {{ STALE_DAYS }} 天没有更新）
                    </Button>
                    <div v-if="showRest" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <WorkCard v-for="work in rest" :key="work.workId" :work="work" :session-titles="overview.data.value.sessionTitles" @navigate="navigate" />
                    </div>
                </div>
            </section>
        </template>
    </PageShell>
</template>

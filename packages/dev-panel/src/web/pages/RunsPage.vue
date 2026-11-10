<script setup lang="ts">
import {Badge, Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {useRouter} from "vue-router";
import {loadStateOf, useResource} from "../host/panel-data.js";
import type {RunsData} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import ProcList from "../parts/ProcList.vue";
import RunList from "../parts/RunList.vue";
import SessionLabel from "../parts/SessionLabel.vue";
import {sessionName} from "../host/format.js";

/**
 * “在跑”页（t14，Proposal 第九节“现场”）：经 nbdev 起的服务、会话派出的运行、无主的运行。只读：停服务用 `nbdev dev stop`。
 * 后两块已按登记的 pid 去重（经 nbdev 起的服务不再出现在会话的运行里）。随“活动”这一块刷新。
 */
const runs = useResource<RunsData>(() => "/api/runs", ["activity"]);
const data = computed(() => runs.data.value);
const router = useRouter();
const navigate = (href: string) => void router.push(href);
const STOP_NOTE = "面板这里只看不停：停服务在终端运行 nbdev dev stop（别人起的要加 --force）";
</script>

<template>
    <!-- 现场页整页是临时内容：分区标题旁一个“临时”小徽标，不再整页虚线框（t15 阶段 3g）。 -->
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: '在跑'}]" title="在跑" @navigate="navigate">
        <!-- 怎么停服务是不看也能用这一页的说明：放进标题旁的说明图标，不常驻占一行（t22）。 -->
        <template #meta><Tooltip :text="STOP_NOTE"><button type="button" class="nbdev-hit inline-flex size-5 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)]" :aria-label="STOP_NOTE"><span class="i-lucide-info size-3.5" aria-hidden="true" /></button></Tooltip></template>
        <LoadState v-bind="loadStateOf(runs)" label="正在读取在跑的进程" @retry="runs.reload()" />
        <template v-if="data">
            <section class="nbdev-stack" aria-labelledby="procs-title">
                <h2 id="procs-title" class="nbdev-heading flex items-center gap-2">经 nbdev 起的服务<Badge tone="accent" variant="outline" size="sm">临时</Badge></h2>
                <ProcList :runs="data.procs" :session-titles="data.sessionTitles" @navigate="navigate" />
            </section>
            <section class="nbdev-stack" aria-labelledby="session-runs-title">
                <h2 id="session-runs-title" class="nbdev-heading flex items-center gap-2">会话派出的运行<Badge tone="accent" variant="outline" size="sm">临时</Badge></h2>
                <p v-if="data.sessions.length === 0" class="nbdev-empty">没有</p>
                <section v-for="session in data.sessions" :key="session.key" class="nbdev-stack-tight">
                    <h3 class="nbdev-body flex min-w-0 font-medium" :class="{'line-through': session.alive === false}">
                        <SessionLabel :session="sessionName(session.key, session.label, data.sessionTitles)" />
                    </h3>
                    <RunList :runs="session.runs" show-pane @navigate="navigate" />
                </section>
            </section>
            <section class="nbdev-stack" aria-labelledby="unowned-title">
                <h2 id="unowned-title" class="nbdev-heading flex items-center gap-2">无主的运行<Badge tone="accent" variant="outline" size="sm">临时</Badge></h2>
                <p v-if="data.unownedRuns.length === 0" class="nbdev-empty">没有</p>
                <RunList v-else :runs="data.unownedRuns" show-pane @navigate="navigate" />
            </section>
        </template>
    </PageShell>
</template>

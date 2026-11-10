<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {relativeTime, sessionName} from "../host/format.js";
import {isPlainClick} from "../host/routes.js";
import type {ProcRunView, SessionTitle} from "../host/types.js";
import SessionLabel from "./SessionLabel.vue";

/** 经 nbdev 起的服务（`run/procs/` 的登记加现算的状态）；契约见同名 .md。 */
const props = defineProps<{
    runs: ProcRunView[];
    /** 会话标题（运行页数据的 `sessionTitles`，t17），“谁起的”写标题加短键。 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}>();
const emit = defineEmits<{navigate: [href: string]}>();
const rows = computed(() => props.runs.map((run) => ({run, owner: run.startedBy ? sessionName(run.startedBy.key, run.startedBy.label, props.sessionTitles) : null})));
/** 服务链回它的 checkout 行（分支、worktree 与上面的服务在那一行对得上，后续清单 10-14 的“一一对应”）。 */
const checkoutHref = (key: string) => `/live/checkouts?focus=${encodeURIComponent(key)}`;
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
const TONE: Record<ProcRunView["state"], "accent" | "success" | "warning" | "neutral"> = {starting: "accent", running: "success", orphaned: "warning", ended: "neutral"};
const LABEL: Record<ProcRunView["state"], string> = {starting: "启动中", running: "在跑", orphaned: "没人监管", ended: "已结束"};
const REASON: Record<string, string> = {
    supervisor_gone: "监管进程不在了", leader_exited: "组长已退、还有进程", exited: "自己退出", stopped: "被停掉", supervisor_killed: "监管进程被杀",
    rebooted: "重启过", never_started: "没起来",
};
const safeUrl = (url: string | null) => (url && /^https?:\/\//u.test(url) ? url : null);
</script>

<template>
    <p class="nbdev-empty" v-if="runs.length === 0">没有经 nbdev 起的服务（Agent 用 nbdev dev start 起）</p>
    <ul v-else class="flex flex-col gap-2">
        <li v-for="{run, owner} in rows" :key="run.runId" class="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 nbdev-divider">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
                <Badge :tone="TONE[run.state]" variant="soft" size="sm">{{ LABEL[run.state] }}</Badge>
                <span class="font-medium"><a :href="checkoutHref(run.checkoutKey)" class="hover:underline" @click="follow($event, checkoutHref(run.checkoutKey))">{{ run.checkoutKey }}</a> · {{ run.package }} · {{ run.script }}</span>
                <a v-if="safeUrl(run.url) && run.state !== 'ended'" :href="safeUrl(run.url)!" target="_blank" rel="noopener noreferrer" class="break-all nbdev-small">{{ run.url }}</a>
                <span class="nbdev-empty nbdev-small" v-else-if="run.state !== 'ended'">地址未知</span>
            </div>
            <span class="min-w-0 break-all nbdev-note">
                <template v-if="owner"><SessionLabel :session="owner" /> </template><template v-else>未认出的调用者</template>起 · {{ relativeTime(run.startedAt) }}<template v-if="run.workId && run.taskId"> · {{ run.workId.slice(0, 6) }}/{{ run.taskId.slice(0, run.taskId.indexOf("-")) }}</template><template v-if="run.reason"> · {{ REASON[run.reason] ?? run.reason }}</template><template v-if="run.state === 'ended' && run.exitCode !== null"> · 退出码 {{ run.exitCode }}</template> · 日志 <code>{{ run.logPath }}</code>
            </span>
        </li>
    </ul>
</template>

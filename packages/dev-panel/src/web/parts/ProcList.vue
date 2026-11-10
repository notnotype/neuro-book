<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {relativeTime, sessionName} from "../host/format.js";
import {isPlainClick} from "../host/routes.js";
import type {ProcRunView, SessionTitle} from "../host/types.js";
import SessionLabel from "./SessionLabel.vue";
import TruncatedText from "./TruncatedText.vue";

/** 经 nbdev 起的服务（`run/procs/` 的登记加现算的状态）；契约见同名 .md。 */
const props = defineProps<{
    runs: ProcRunView[];
    /** 会话标题（运行页数据的 `sessionTitles`，t17），“谁起的”写标题加短键。 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}>();
const emit = defineEmits<{navigate: [href: string]}>();
const rows = computed(() => props.runs.map((run) => ({run, owner: run.startedBy ? sessionName(run.startedBy.key, run.startedBy.label, props.sessionTitles) : null})));
/** 还在的（启动中、在跑、没人监管）放前面；已结束的收进“已结束 N 个”，点开才列出（t22，开发者定）。 */
const live = computed(() => rows.value.filter(({run}) => run.state !== "ended"));
const ended = computed(() => rows.value.filter(({run}) => run.state === "ended"));
const showEnded = ref(false);
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
    <div v-else class="flex flex-col gap-2">
        <p v-if="live.length === 0" class="nbdev-empty">现在没有在跑的</p>
        <ul class="flex flex-col gap-2">
            <li v-for="{run, owner} in [...live, ...(showEnded ? ended : [])]" :key="run.runId" class="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 nbdev-divider">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge :tone="TONE[run.state]" variant="soft" size="sm">{{ LABEL[run.state] }}</Badge>
                    <span class="font-medium"><a :href="checkoutHref(run.checkoutKey)" class="hover:underline" @click="follow($event, checkoutHref(run.checkoutKey))">{{ run.checkoutKey }}</a> · {{ run.package }} · {{ run.script }}</span>
                    <a v-if="safeUrl(run.url) && run.state !== 'ended'" :href="safeUrl(run.url)!" target="_blank" rel="noopener noreferrer" class="break-all nbdev-small">{{ run.url }}</a>
                    <span class="nbdev-empty nbdev-small" v-else-if="run.state !== 'ended'">地址未知</span>
                </div>
                <span class="flex min-w-0 flex-wrap items-center gap-x-1 nbdev-note">
                    <template v-if="owner"><SessionLabel :session="owner" /></template><template v-else>未认出的调用者</template>起 · {{ relativeTime(run.startedAt) }}<template v-if="run.workId && run.taskId"> · {{ run.workId.slice(0, 6) }}/{{ run.taskId.slice(0, run.taskId.indexOf("-")) }}</template><template v-if="run.reason"> · {{ REASON[run.reason] ?? run.reason }}</template><template v-if="run.state === 'ended' && run.exitCode !== null"> · 退出码 {{ run.exitCode }}</template> ·
                    <!-- 日志的绝对路径整条摊开占两到五行：只给一个按钮，点了复制全路径，悬停看全文（t22）。 -->
                    <TruncatedText :text="run.logPath" display="复制日志路径" />
                </span>
            </li>
        </ul>
        <Button v-if="ended.length > 0" class="self-start" size="sm" variant="ghost" :icon-class="showEnded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" :aria-expanded="showEnded" @click="showEnded = !showEnded">已结束 {{ ended.length }} 个</Button>
    </div>
</template>

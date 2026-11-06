<script setup lang="ts">
import {Button, Dialog, Textarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {HERDR_STATUS_LABEL, shortSession, taskLabel, workLabel} from "../host/format.js";
import type {NotifyCandidate, NotifyJob} from "../host/types.js";

/** 给不是提问者的会话发一段开发者名义的普通消息之前的小窗；契约见同名 .md。 */
const props = withDefaults(defineProps<{open: boolean; compose: {job: NotifyJob; target: NotifyCandidate; kind: "replaced" | "alternative"} | null; pending?: boolean}>(), {pending: false});
const emit = defineEmits<{send: [job: NotifyJob, target: {paneId: string; sessionKey: string}, text: string]; skip: [job: NotifyJob]; cancel: []}>();

const MAX = 4000;
const draft = ref("");
watch(() => props.compose, (value) => {
    draft.value = value?.job.developerMessage ?? "";
}, {immediate: true});
const problem = computed(() => {
    if (draft.value.trim() === "") return "消息不能为空";
    if (draft.value.length > MAX) return `消息超过 ${MAX} 字`;
    if (draft.value.trimStart().startsWith("[nbdev]")) return "不能以 [nbdev] 开头：那是只给提问者的自动通知";
    return null;
});
const replaced = computed(() => props.compose?.kind === "replaced");
function send(): void {
    const current = props.compose;
    if (!current || problem.value) return;
    emit("send", current.job, {paneId: current.target.paneId, sessionKey: current.target.sessionKey}, draft.value);
}
</script>

<template>
    <Dialog :open="open" :title="replaced ? '提问的会话已经换了' : '通知持有租约的会话'" size="md" :busy="pending" :close-on-overlay="!replaced" :close-on-esc="!replaced" @request-close="!replaced && emit('cancel')">
        <div v-if="compose" class="flex flex-col gap-3">
            <p v-if="replaced">{{ workLabel(compose.job.workId) }}/{{ taskLabel(compose.job.taskId) }} 有新的答复，提问的会话已经不在了，它原来的 pane 上换成了另一个会话。</p>
            <p v-else>{{ workLabel(compose.job.workId) }}/{{ taskLabel(compose.job.taskId) }} 有新的答复，提问的会话不在 herdr 里。下面这个会话持有这个 Task 的租约。</p>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 nbdev-small">
                <dt class="nbdev-secondary">谁问的</dt>
                <dd class="break-all"><code>{{ compose.job.sessionKey }}</code><template v-if="compose.job.askerPaneId">（在 pane {{ compose.job.askerPaneId }}）</template></dd>
                <dt class="nbdev-secondary">发给</dt>
                <dd class="break-all"><code>{{ compose.target.sessionKey }}</code>（pane {{ compose.target.paneId }}，{{ compose.target.agent ?? "Agent" }}，{{ HERDR_STATUS_LABEL[compose.target.status] ?? compose.target.status }}）</dd>
            </dl>
            <p class="nbdev-note">{{ shortSession(compose.target.sessionKey) }} 没有提过这道题，所以不发 [nbdev] 通知（那一句规则只让提问者照做），而是以你的名义发下面这段普通消息，它按普通的用户消息处理。可以先改；发之前同样核对它是否空闲、输入框是否为空。<template v-if="replaced">不通知的话，提问的会话下次读答复时也会看到。</template></p>
            <Textarea v-model="draft" :rows="6" :maxlength="MAX" aria-label="要发的消息" />
            <p class="nbdev-danger nbdev-small" v-if="problem">{{ problem }}</p>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button v-if="replaced" variant="ghost" :disabled="pending || !compose" @click="compose && emit('skip', compose.job)">不通知</Button>
                <Button v-else variant="ghost" :disabled="pending" @click="emit('cancel')">取消</Button>
                <Button variant="primary" :loading="pending" :disabled="!compose || problem !== null" @click="send">{{ replaced ? "发给现在的会话" : "发送" }}</Button>
            </div>
        </template>
    </Dialog>
</template>

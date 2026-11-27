<script setup lang="ts">
/**
 * 书房看板娘入口的 Lab 夹具（agent/conversation.md 输出 54）：一格案头大小的看板娘（150px，圆角 34px，同 ShelfDesk），上面叠
 * `DeskCompanion`；联系人、活动与宿主是按场景造的样本。场景：`unread` 有未读、`waiting` 等你处理、`none` 没有联系人、`failed`
 * 读不到、`unread-english` 英文界面看气泡截断。面板里的对话是一块写着说明的占位（真对话在 e2e 里看）。
 */
import {computed, defineComponent, h, ref, shallowRef} from "vue";

import DeskCompanion from "nbook/plugins/agent/web/components/DeskCompanion.vue";
import type {OwnerContact, OwnerContactsState, SessionOwnerProvider} from "nbook/plugins/agent/shared/contracts";
import type {ActivityItem} from "nbook/plugins/agent/shared/remote";
import NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";
import type {NeuroBookMoodState} from "nbook/ui/brand/neurobook-mood";

import {type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();

const english = props.scene.endsWith("-english");
const last = english ? {text: "I finished counting the genres on the new-release chart. Want to take a look at what changed this week?", at: 1} : {text: "新书榜的类型我数完了，要看看吗？", at: 1};
const contacts: OwnerContact[] = props.scene === "none" || props.scene === "failed" ? [] : [{id: "lyra", name: english ? "Lyra" : "星璃", unread: props.scene === "waiting" ? 0 : 3, seenSeq: 0, last, sessionId: "bot-lyra"}];
const state: OwnerContactsState = props.scene === "failed" ? {kind: "failed", code: "disconnected"} : {kind: "ready"};
const provider: SessionOwnerProvider = {
    contacts: shallowRef(contacts),
    state: shallowRef(state),
    reload: () => undefined,
    open: async (id) => ({ok: true, sessionId: `bot-${id}`}),
    seen: () => undefined,
};
const providers = [{plugin: "nbook.bots", provider}];
const activity: ActivityItem[] = props.scene === "waiting" ? [{id: "bot-lyra", state: "waiting", root: "bot-lyra"}] : [];
const sessionId = ref<string | null>(null);
const host = {
    sessionId,
    owner: computed(() => (sessionId.value === null ? null : {plugin: "nbook.bots", id: "lyra"})),
    shownSeq: ref(0),
    opened: ref(0),
    open: async (id: string) => {
        sessionId.value = id;
    },
    borrow: () => () => undefined,
    markOpened: () => undefined,
};
const Conversation = defineComponent({
    props: {close: {type: Function, required: true}},
    setup(_, {expose}) {
        expose({focusComposer: () => undefined});
        return () => h("p", {class: "p-4 text-sm text-[var(--text-muted)]"}, "面板里是星璃的主对话（Lab 里是占位，真对话见 e2e bots-chat 的书房一组）。");
    },
});
const mood = ref<NeuroBookMoodState>("idle");
</script>

<template>
    <div class="desk-fixture" data-shelf-desk>
        <div class="desk-fixture__cell">
            <NeuroBookMood :state="mood" class="desk-fixture__mood" />
            <DeskCompanion
                class="desk-fixture__mood"
                :providers="providers"
                :activity="activity"
                :has-model="true"
                :host="host"
                :conversation="Conversation"
                :open-model-settings="() => undefined"
                :ensure-started="() => undefined"
                @update:mood="(next: NeuroBookMoodState) => (mood = next)"
            />
        </div>
    </div>
</template>

<style scoped>
/* 同 ShelfDesk：案头是尺寸容器（窄于 720px 时不画气泡），看板娘一格 150px、圆角 34px，猫与入口同在一格。 */
.desk-fixture {
    container-type: inline-size;
    display: flex;
    justify-content: flex-end;
    width: min(760px, 100%);
    padding: var(--space-4) var(--space-6) 64px;
}

.desk-fixture__cell {
    display: grid;
    width: 150px;
    border-radius: 34px;
}

.desk-fixture__mood {
    grid-area: 1 / 1;
    width: 100%;
    border-radius: inherit;
}
</style>

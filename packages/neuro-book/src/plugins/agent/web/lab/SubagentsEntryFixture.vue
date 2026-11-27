<script setup lang="ts">
/**
 * 子代理入口与浮层的 Lab 夹具（conversation.md 输出 43）：注入样本后代与收口结果（`subagent-store.ts`），动作名用与对话位置同一份注册表。
 * 场景 `list` 开着浮层：等你批准、在跑（带孙代理）、完成、出错各一行；`dot` 关着、有没看过的出错；`empty` 没有后代，什么都不画。
 */
import {computed, provide, ref, shallowRef} from "vue";
import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import {builtinContributions} from "@notnotype/nb-agent-ui/vue";

import {type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";

import SubagentCard from "nbook/plugins/agent/web/components/SubagentCard.vue";
import SubagentsEntry from "nbook/plugins/agent/web/components/SubagentsEntry.vue";
import {subagentStoreKey, toolActionKey, toolActionOf} from "nbook/plugins/agent/web/subagent-store";
import type {SubagentStore} from "nbook/plugins/agent/web/subagent-store";
import {subagentContribution} from "nbook/plugins/agent/web/subagent-renderers";
import {createRunResults, createSeenErrors} from "nbook/plugins/agent/web/subagents-panel";

import {ENTRY_NOW, ENTRY_PROFILES, ENTRY_RESULTS, ENTRY_TREE} from "./subagent-samples";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();

const store: SubagentStore = {
    data: shallowRef({sessionId: "p", tree: new Map((props.scene === "empty" ? [] : ENTRY_TREE).map((item) => [item.id, item])), jobs: new Map()}),
    now: ref(ENTRY_NOW),
    tail: async () => null,
    status: async () => null,
    kill: async () => undefined,
    stopRun: async (sessionId) => record("stopRun", {sessionId}),
    runResult: async (sessionId) => ENTRY_RESULTS[sessionId] ?? null,
};
provide(subagentStoreKey, store);
const registry = createAgentViewRegistry([...builtinContributions, subagentContribution({card: SubagentCard})]);
provide(toolActionKey, (tool) => toolActionOf(registry, tool));

// 激活时刻早于样本里的出错：没看过，入口亮红点。
const seen = createSeenErrors(0);
const results = createRunResults((message) => record("report", {message}));
const open = ref(props.input?.model?.open === true);
const profiles = computed(() => (props.input?.props?.profiles ?? ENTRY_PROFILES) as typeof ENTRY_PROFILES);
const label = computed(() => (props.scene === "empty" ? "（没有后代时入口不画）" : ""));
</script>

<template>
    <div class="flex w-full flex-col gap-2">
        <div class="flex h-8 w-full items-center justify-end gap-1 rounded-[var(--radius-control)] bg-[var(--panel-surface)] px-2">
            <SubagentsEntry v-model:open="open" :profiles="profiles" :seen="seen" :results="results" data-lab-subject @select="(sessionId: string) => record('select', {sessionId})" />
        </div>
        <p v-if="label !== ''" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ label }}</p>
    </div>
</template>

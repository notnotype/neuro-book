<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import {StoryCallError, useStoryClient} from "../host/client";

const client = useStoryClient();

const AGENTS = [
    {id: "claude", label: "Claude Code", where: "~/.claude/skills/nbstory"},
    {id: "codex", label: "Codex", where: "~/.agents/skills/nbstory"},
] as const;
type AgentId = (typeof AGENTS)[number]["id"];

const STATE_TEXT = {installed: "已安装", unchanged: "已经是最新的，没有改动", replaced: "已换成随包的内容"} as const;
const busy = ref<AgentId | null>(null);
const results = ref<Partial<Record<AgentId, {ok: boolean; text: string; needsForce?: boolean}>>>({});

async function install(agent: AgentId, force: boolean): Promise<void> {
    busy.value = agent;
    try {
        const result = await client.call("skill.install", {agent, ...(force ? {force: true} : {})});
        results.value = {...results.value, [agent]: {ok: true, text: `${STATE_TEXT[result.state]}：${result.path}${result.leftover === undefined ? "" : `（旧目录没删干净，请手动删除：${result.leftover.path}）`}`}};
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        results.value = {...results.value, [agent]: {ok: false, text: caught.code === "skill_exists" ? "目标位置已有内容不同的 Skill（可能是你改过的）。换成随包的内容会删掉目录里多出的文件。" : caught.message, needsForce: caught.code === "skill_exists"}};
    } finally {
        busy.value = null;
    }
}
</script>

<template>
    <section class="flex flex-col gap-2" data-testid="skill-install">
        <h2 class="text-[length:var(--text-md)] font-[var(--weight-strong)]">给外部 Agent 装 nbstory 的 Skill</h2>
        <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">装好以后，Claude Code 或 Codex 就知道怎么用 nbstory 查这本书（命令行 <code>nbstory skill install</code> 的网页版）。</p>
        <ul class="flex flex-col gap-2">
            <li v-for="agent in AGENTS" :key="agent.id" class="flex flex-col gap-1 rounded-[var(--radius-control)] border border-[var(--divider)] px-3 py-2" :data-agent="agent.id">
                <div class="flex items-center gap-3">
                    <div class="min-w-0 flex-1"><b>{{ agent.label }}</b> <code class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ agent.where }}</code></div>
                    <Button variant="primary" size="sm" :disabled="busy !== null" :data-testid="`skill-install-${agent.id}`" @click="install(agent.id, false)">{{ busy === agent.id ? "安装中…" : "安装 / 更新" }}</Button>
                </div>
                <p v-if="results[agent.id]" class="text-[length:var(--text-sm)]" :class="results[agent.id]!.ok ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'" :data-testid="`skill-result-${agent.id}`">{{ results[agent.id]!.text }}</p>
                <div v-if="results[agent.id]?.needsForce"><Button size="sm" variant="secondary" :disabled="busy !== null" :data-testid="`skill-force-${agent.id}`" @click="install(agent.id, true)">换成随包的内容</Button></div>
            </li>
        </ul>
    </section>
</template>

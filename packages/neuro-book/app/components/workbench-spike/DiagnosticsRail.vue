<script setup lang="ts">
/** 诊断栏：场景按钮 + 当前快照 + issue 列表。只发事件，不改树。 */
import {Button} from "@notnotype/nb-ui/components";

defineProps<{
    snapshotJson: string;
    issues: string[];
    notices: string[];
    context: {project: boolean; selection: boolean; job: boolean};
    panelInFullRow: boolean;
}>();

const emit = defineEmits<{
    (event: "toggle-context", key: "project" | "selection" | "job"): void;
    (event: "move-panel"): void;
    (event: "inject", kind: "unknown-ref" | "version-mismatch" | "duplicate-ref" | "empty-branch"): void;
    (event: "rerun-factories"): void;
    (event: "stale-async"): void;
    (event: "reset"): void;
}>();
</script>

<template>
    <aside class="flex w-[360px] shrink-0 flex-col gap-[var(--space-3)] overflow-y-auto border-l border-[var(--divider)] p-[var(--space-4)]">
        <section class="flex flex-col gap-[var(--space-2)]">
            <h2 class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">上下文键</h2>
            <div class="flex flex-wrap gap-[var(--space-2)]">
                <Button size="sm" variant="secondary" @click="emit('toggle-context', 'project')">项目：{{ context.project ? "开" : "关" }}</Button>
                <Button size="sm" variant="secondary" @click="emit('toggle-context', 'selection')">选中项：{{ context.selection ? "开" : "关" }}</Button>
                <Button size="sm" variant="secondary" @click="emit('toggle-context', 'job')">任务 authority：{{ context.job ? "开" : "关" }}</Button>
            </div>
        </section>

        <section class="flex flex-col gap-[var(--space-2)]">
            <h2 class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">场景</h2>
            <div class="flex flex-wrap gap-[var(--space-2)]">
                <Button size="sm" variant="secondary" @click="emit('move-panel')">
                    {{ panelInFullRow ? "把面板移回编辑器中列" : "把面板移到整行（moveLeaf）" }}
                </Button>
                <Button size="sm" variant="secondary" @click="emit('inject', 'unknown-ref')">注入未知 ref</Button>
                <Button size="sm" variant="secondary" @click="emit('inject', 'version-mismatch')">注入版本不符</Button>
                <Button size="sm" variant="secondary" @click="emit('inject', 'duplicate-ref')">注入重复 ref</Button>
                <Button size="sm" variant="secondary" @click="emit('inject', 'empty-branch')">注入空分支</Button>
                <Button size="sm" variant="secondary" @click="emit('rerun-factories')">重跑 factory（含 spike.broken）</Button>
                <Button size="sm" variant="secondary" @click="emit('stale-async')">模拟迟到结果</Button>
                <Button size="sm" variant="secondary" @click="emit('reset')">重置布局</Button>
            </div>
        </section>

        <section v-if="notices.length > 0" class="flex flex-col gap-[var(--space-1)]">
            <h2 class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">结果</h2>
            <p v-for="(notice, index) in notices" :key="index" class="text-[var(--text-2xs)] text-[var(--text-secondary)]">{{ notice }}</p>
        </section>

        <section v-if="issues.length > 0" class="flex flex-col gap-[var(--space-1)]">
            <h2 class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">布局 issue</h2>
            <p v-for="(issue, index) in issues" :key="index" class="text-[var(--text-2xs)] text-[var(--text-secondary)]">{{ issue }}</p>
        </section>

        <section class="flex min-h-0 flex-col gap-[var(--space-1)]">
            <h2 class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">快照（只含 ref 与尺寸）</h2>
            <pre class="max-h-[280px] overflow-auto rounded-[var(--radius-control)] bg-[var(--bg-subtle)] p-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-secondary)]">{{ snapshotJson }}</pre>
        </section>
    </aside>
</template>

<script setup lang="ts">
/**
 * 一个人的目标与态度（docs/specs/plot/author-ui.md 输出 13、17）：目标表的一组与人物页“目标与态度”共用。态度一行一个“对某某：态度”；
 * 目标一行一个：状态、名字、瞒着别人、和这些打架、因为、右边最近一次动过。受控；点名字发 `open`。
 */
import type {AuthorAttitude, AuthorGoal} from "../../core/author/goals";
import type {AuthorName} from "../../core/author/knowing";
import {chapterLabel} from "../labels";
import type {ChapterIndex} from "../labels";
import {usePlotText} from "../text";

const props = defineProps<{
    goals: readonly AuthorGoal[];
    attitudes: readonly AuthorAttitude[];
    names: Readonly<Record<string, AuthorName>>;
    chapters: ChapterIndex;
}>();

const emit = defineEmits<{(event: "open", id: string): void}>();

const text = usePlotText();
const nameOf = (id: string | null): string => (id === null ? "" : (props.names[id]?.name ?? id));
const STATUS = {active: "goals.status.active", blocked: "goals.status.blocked", achieved: "goals.status.achieved", abandoned: "goals.status.abandoned"} as const;
const status = (goal: AuthorGoal): string => (goal.状态 === null ? "" : text(STATUS[goal.状态]));
const moved = (goal: AuthorGoal): {readonly text: string; readonly warning: boolean} => {
    if (goal.stalled) return {text: text("goals.quiet", {count: goal.quiet}), warning: true};
    if (goal.last === null) return {text: text("goals.neverMoved"), warning: false};
    return {text: text("goals.moved", {chapter: chapterLabel(goal.last.chapter, props.chapters, text)}), warning: false};
};
</script>

<template>
    <div class="flex flex-col gap-2 text-[length:var(--text-sm)]">
        <p v-for="attitude in props.attitudes" :key="attitude.object" class="text-[var(--text-secondary)]" data-attitude>
            {{ text("goals.attitude", {object: nameOf(attitude.object), attitude: attitude.notReduced ? text("goals.notReduced") : (attitude.态度 ?? "")}) }}
        </p>
        <ul class="flex flex-col divide-y divide-[var(--divider)]">
            <li v-for="goal in props.goals" :key="goal.id" class="flex flex-wrap items-start gap-x-3 gap-y-1 py-2" data-goal>
                <span class="w-10 shrink-0 text-[length:var(--text-xs)]" :class="goal.状态 === 'blocked' ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'">{{ status(goal) }}</span>
                <div class="min-w-0 flex-1 basis-64">
                    <button type="button" class="text-left text-[var(--accent-main)] hover:underline" @click="emit('open', goal.id)">{{ goal.name }}</button>
                    <span v-if="goal.隐秘 !== null" class="ml-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("goals.hidden") }}</span>
                    <p v-if="goal.conflicts.length > 0" class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                        {{ text("goals.conflicts") }}<template v-for="(conflict, index) in goal.conflicts" :key="conflict.id"><span v-if="index > 0">；</span>{{ nameOf(conflict.holder) }}：<button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open', conflict.id)">{{ nameOf(conflict.id) }}</button></template>
                    </p>
                    <p v-if="goal.基于.length > 0" class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                        {{ text("goals.basedOn") }}<template v-for="(point, index) in goal.基于" :key="point"><span v-if="index > 0">、</span><button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open', point)">{{ nameOf(point) }}</button></template>
                    </p>
                </div>
                <span class="shrink-0 text-[length:var(--text-xs)]" :class="moved(goal).warning ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'" data-moved>{{ moved(goal).text }}</span>
            </li>
        </ul>
    </div>
</template>

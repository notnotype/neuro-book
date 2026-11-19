<script setup lang="ts">
/**
 * “谁知道什么”的表（docs/specs/plot/author-ui.md 输出 7、8）：一行一个秘密、按主体分组；列是秘密、选中的人、别的人、读者、打算怎么揭。
 * 宽时是表格（表头与行头语义，秘密一列与表头在滚动时固定），`compact` 时是一行一条的列表（只渲染一种）。受控：行、选中的人、名字表、
 * 章表都由页面给；点名字发 `open`。
 */
import {computed} from "vue";

import {Badge} from "@notnotype/nb-ui/components";

import type {SecretRow} from "../../core/author/secrets";
import type {AuthorName} from "../../core/author/knowing";
import {chapterLabel, decisionLabel, degreeLabel, listOf, placeLabel, secrecyLabel} from "../labels";
import type {ChapterIndex} from "../labels";
import {usePlotText} from "../text";

const props = withDefaults(defineProps<{
    rows: readonly SecretRow[];
    /** 选中的人（表的列），按显示的先后。 */
    people: readonly string[];
    names: Readonly<Record<string, AuthorName>>;
    chapters: ChapterIndex;
    /** 所选位置所在章的序号（初值是 0）：到期章不晚于它的决策用警告色。 */
    now?: number;
    /** 窄的版式：一行一条的列表。 */
    compact?: boolean;
}>(), {now: 0, compact: false});

const emit = defineEmits<{(event: "open", id: string): void}>();

const text = usePlotText();
const nameOf = (id: string | null): string => (id === null ? text("secrets.other") : (props.names[id]?.name ?? id));
/** 主体相同、挨着的行是一组（服务已经按主体在条目树里的顺序排好）。 */
const groups = computed(() => {
    const result: {subject: string | null; rows: SecretRow[]}[] = [];
    for (const row of props.rows) {
        const last = result.at(-1);
        if (last !== undefined && last.subject === row.subject) last.rows.push(row);
        else result.push({subject: row.subject, rows: [row]});
    }
    return result;
});
const groupLabel = (subject: string | null): string => (subject === null ? text("secrets.other") : text("secrets.about", {name: nameOf(subject)}));
const isSecret = (row: SecretRow): boolean => row.secrecy === "secret" || row.secrecy === "topSecret";
const others = (row: SecretRow): string => {
    if (row.others.length === 0) return text("secrets.noOne");
    const listed = listOf(row.others.map((other) => text("fmt.withNote", {text: nameOf(other.person), note: degreeLabel(other.degree, isSecret(row), text)})), text);
    return row.othersTotal > row.others.length ? text("secrets.andMore", {list: listed, count: row.othersTotal - row.others.length}) : listed;
};
const reader = (row: SecretRow): string => {
    const degree = degreeLabel(row.reader.degree === "unaware" ? "unaware" : row.reader.degree, true, text);
    const from = row.reader.degree === "knows" ? row.reader.knows : row.reader.degree === "suspects" ? row.reader.suspects : null;
    return from === null ? degree : text("secrets.readerFrom", {degree, place: placeLabel(from, props.chapters, text)});
};
interface PlanLine {
    readonly text: string;
    readonly warning: boolean;
}
const plan = (row: SecretRow): PlanLine[] => {
    const lines: PlanLine[] = row.reveals.map((reveal) => {
        const chapter = reveal.chapter === null ? text("chapter.unscheduled") : chapterLabel(reveal.chapter, props.chapters, text);
        const said = text(reveal.mode === "explicit" ? "secrets.revealExplicit" : "secrets.revealHint", {chapter});
        return {text: reveal.done ? text("fmt.withNote", {text: said, note: text("secrets.written")}) : said, warning: false};
    });
    for (const decision of row.decisions) {
        // 已定的只写结论（输出 8）；待定的写决策、“还没定”与到期章，到期章不晚于所选位置时用警告色。
        if (decision.status === "decided") lines.push({text: decision.conclusion ?? decision.text, warning: false});
        else {
            const index = decision.due === null ? undefined : props.chapters.get(decision.due);
            lines.push({text: decisionLabel(decision, props.chapters, text), warning: index !== undefined && index <= props.now});
        }
    }
    return lines.length === 0 ? [{text: text("secrets.noPlan"), warning: false}] : lines;
};
const cell = (row: SecretRow, person: string): {readonly degree: string; readonly belief: string | null} => {
    const value = row.people[person];
    return {degree: degreeLabel(value?.degree ?? "none", isSecret(row), text), belief: value?.degree === "misbelieves" ? value.belief : null};
};
</script>

<template>
    <div v-if="props.compact" class="flex flex-col gap-4" data-secrets-list>
        <section v-for="group in groups" :key="group.subject ?? ''" class="flex flex-col gap-2">
            <h3 class="text-[length:var(--text-xs)] font-semibold text-[var(--text-muted)]">{{ groupLabel(group.subject) }}</h3>
            <article v-for="row in group.rows" :key="row.point" class="rounded-[var(--radius-control)] border border-[var(--divider)] px-3 py-2 text-[length:var(--text-sm)]" data-secret-row>
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" class="font-medium text-[var(--accent-main)] hover:underline" @click="emit('open', row.point)">{{ nameOf(row.point) }}</button>
                    <Badge size="sm">{{ secrecyLabel(row.secrecy, text) }}</Badge>
                </div>
                <p class="mt-1 text-[var(--text-secondary)]">
                    <span v-for="person in props.people" :key="person" class="mr-3">{{ text("fmt.labeled", {label: nameOf(person), value: cell(row, person).degree}) }}</span>
                </p>
                <p class="text-[var(--text-secondary)]">{{ text("fmt.labeled", {label: text("secrets.columns.others"), value: others(row)}) }}</p>
                <p class="text-[var(--text-secondary)]">{{ text("fmt.labeled", {label: text("secrets.columns.reader"), value: reader(row)}) }}</p>
                <p v-for="(line, index) in plan(row)" :key="index" :class="line.warning ? 'text-[var(--status-warning)]' : 'text-[var(--text-secondary)]'">{{ line.text }}</p>
            </article>
        </section>
    </div>
    <!-- 表格自己不做滚动容器：外面的编辑区滚动，表头（纵向）与秘密一列（横向）才都固定得住（overflow 会把 sticky 关在它里面）。 -->
    <div v-else data-secrets-table>
        <table class="w-full border-collapse text-left text-[length:var(--text-sm)]" :aria-label="text('secrets.tableLabel')">
            <thead>
                <tr class="border-b border-[var(--divider)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    <th scope="col" class="sticky left-0 top-0 z-[2] bg-[var(--panel-surface)] py-2 pr-4 font-normal">{{ text("secrets.columns.secret") }}</th>
                    <th v-for="person in props.people" :key="person" scope="col" class="sticky top-0 z-[1] bg-[var(--panel-surface)] py-2 pr-4 font-normal">
                        <button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open', person)">{{ nameOf(person) }}</button>
                    </th>
                    <th scope="col" class="sticky top-0 z-[1] bg-[var(--panel-surface)] py-2 pr-4 font-normal">{{ text("secrets.columns.others") }}</th>
                    <th scope="col" class="sticky top-0 z-[1] bg-[var(--panel-surface)] py-2 pr-4 font-normal">{{ text("secrets.columns.reader") }}</th>
                    <th scope="col" class="sticky top-0 z-[1] bg-[var(--panel-surface)] py-2 font-normal">{{ text("secrets.columns.plan") }}</th>
                </tr>
            </thead>
            <tbody v-for="group in groups" :key="group.subject ?? ''">
                <tr>
                    <th scope="rowgroup" :colspan="props.people.length + 4" class="sticky left-0 bg-[var(--panel-surface)] pt-4 pb-1 text-[length:var(--text-xs)] font-semibold text-[var(--text-muted)]">{{ groupLabel(group.subject) }}</th>
                </tr>
                <tr v-for="row in group.rows" :key="row.point" class="border-b border-[var(--divider)] align-top" data-secret-row>
                    <th scope="row" class="sticky left-0 bg-[var(--panel-surface)] py-2 pr-4 font-normal">
                        <button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open', row.point)">{{ nameOf(row.point) }}</button>
                        <Badge class="ml-2" size="sm">{{ secrecyLabel(row.secrecy, text) }}</Badge>
                    </th>
                    <td v-for="person in props.people" :key="person" class="py-2 pr-4" :data-cell="person">
                        <!-- 程度至多三个字，不断开：列宽因此至少放得下它，表头的名字也不竖着排。 -->
                        <span class="whitespace-nowrap">{{ cell(row, person).degree }}</span>
                        <span v-if="cell(row, person).belief !== null" class="block text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ cell(row, person).belief }}</span>
                    </td>
                    <td class="py-2 pr-4 text-[var(--text-secondary)]">{{ others(row) }}</td>
                    <td class="py-2 pr-4" data-cell="reader">{{ reader(row) }}</td>
                    <td class="py-2">
                        <span v-for="(line, index) in plan(row)" :key="index" class="block" :class="line.warning ? 'text-[var(--status-warning)]' : ''">{{ line.text }}</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

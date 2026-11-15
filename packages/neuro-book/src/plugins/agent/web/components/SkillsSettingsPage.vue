<script setup lang="ts">
import {Badge, Button, IconButton} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {groupSkills} from "../../shared/skills";
import type {SkillEntry, SkillProblem} from "../../shared/skills";
import {useAgentPageText} from "../text";

/** 设置里的“Skill”页（同名 .md）：按来源分组、整页共用五列。 */
const props = defineProps<{
    entries: readonly SkillEntry[] | null;
}>();

const emit = defineEmits<{
    (e: "init", id: string): void;
    (e: "open", id: string): void;
    (e: "open-folder"): void;
}>();

const text = useAgentPageText();

/** 我的、各插件、内置（skills.md 输出 25、34）；插件组的标题是插件名，没有显示名时写插件 id。 */
const groups = computed(() => groupSkills(props.entries ?? [], (entry) => entry).map((group) => ({
    key: group.key,
    title: group.plugin === undefined ? text(group.source === "user" ? "skills.page.groups.user" : "skills.page.groups.builtin") : (group.plugin.title ?? group.plugin.id),
    rows: group.items,
})));

const expanded = ref(new Set<string>());
function toggle(id: string): void {
    const next = new Set(expanded.value);
    if (!next.delete(id)) next.add(id);
    expanded.value = next;
}

const STATUS = {
    "needs-init": {key: "skills.page.status.needsInit", tone: "warning"},
    "initializing": {key: "skills.page.status.initializing", tone: "neutral"},
    "invalid": {key: "skills.page.status.invalid", tone: "danger"},
} as const;

function problemText(problem: SkillProblem): string {
    switch (problem.code) {
        case "skill-md-missing": return text("skills.page.problem.skillMdMissing");
        case "nested": return text("skills.page.problem.nested", {directory: problem.directory});
        case "frontmatter-unreadable": return text("skills.page.problem.frontmatter", {detail: problem.detail});
        case "field-missing": return text("skills.page.problem.fieldMissing", {field: problem.field});
        case "field-invalid": return text("skills.page.problem.fieldInvalid", {field: problem.field});
        case "name-mismatch": return text("skills.page.problem.nameMismatch", {name: problem.name});
        case "symlink": return text("skills.page.problem.symlink");
        case "plugin-skill-unbuilt": return text("skills.page.problem.pluginSkillUnbuilt");
        case "install-failed": return text("skills.page.problem.installFailed");
        case "interrupted": return text("skills.page.problem.interrupted");
    }
}

/** 第二行：有原因写原因，否则写说明。 */
const secondLine = (entry: SkillEntry): string => (entry.problem === undefined ? entry.description : problemText(entry.problem));

const folderOf = (entry: SkillEntry): string => (entry.source === "user" ? `user://skills/${entry.name}/` : `skills://${entry.id}/`);

/** 展开里的各项；`output` 是上次安装的输出，按原样的行显示。 */
function details(entry: SkillEntry): ReadonlyArray<{readonly term: string; readonly value: string; readonly output?: boolean}> {
    const rows: Array<{readonly term: string; readonly value: string; readonly output?: boolean}> = [];
    if (entry.license !== undefined) rows.push({term: text("skills.page.details.license"), value: entry.license});
    if (entry.external?.compatibility !== undefined) rows.push({term: text("skills.page.details.compatibility"), value: entry.external.compatibility});
    if (entry.external?.python === true) rows.push({term: text("skills.page.details.external"), value: text(entry.external.uvMissing === true ? "skills.page.details.pythonNoUv" : "skills.page.details.python")});
    const metadata = Object.entries(entry.metadata ?? {});
    if (metadata.length > 0) rows.push({term: text("skills.page.details.metadata"), value: metadata.map(([key, value]) => `${key}: ${value}`).join(" · ")});
    if (entry.problem?.code === "install-failed" && entry.problem.detail !== "") rows.push({term: text("skills.page.details.lastOutput"), value: entry.problem.detail, output: true});
    rows.push({term: text("skills.page.details.location"), value: folderOf(entry)});
    return rows;
}
</script>

<template>
    <div class="skills-page" data-skills-page>
        <div class="skills-page__bar">
            <Button size="sm" variant="secondary" icon-class="i-lucide-folder-open" data-skills-open-folder @click="emit('open-folder')">{{ text("skills.page.openFolder") }}</Button>
        </div>
        <div v-if="props.entries === null" class="skills-page__empty" role="status" aria-live="polite" aria-busy="true">
            <span class="i-lucide-loader-2 animate-spin skills-page__empty-icon" aria-hidden="true"></span>
            <p>{{ text("skills.page.loading") }}</p>
        </div>
        <div v-else-if="groups.length === 0" class="skills-page__empty" data-skills-empty>
            <span class="i-lucide-sparkles skills-page__empty-icon" aria-hidden="true"></span>
            <p>{{ text("skills.page.empty") }}</p>
        </div>
        <div v-else class="skills-page__groups">
            <section v-for="group in groups" :key="group.key" class="skills-page__group" :data-skills-group="group.key">
                <h3 class="skills-page__group-title">{{ group.title }}</h3>
                <ul class="skills-page__list">
                    <li v-for="entry in group.rows" :key="entry.id" class="skills-page__item" :data-skill="entry.id">
                        <div class="skills-page__meta">
                            <span class="skills-page__name">{{ entry.name }}</span>
                            <p class="skills-page__second" :class="{'is-problem': entry.problem !== undefined, 'is-danger': entry.status === 'invalid'}" :title="secondLine(entry)">{{ secondLine(entry) }}</p>
                        </div>
                        <div class="skills-page__cell">
                            <Badge v-if="entry.status !== 'ready'" size="sm" variant="soft" :tone="STATUS[entry.status].tone" data-skill-status>
                                <span v-if="entry.status === 'initializing'" class="i-lucide-loader-2 animate-spin skills-page__spin" aria-hidden="true"></span>{{ text(STATUS[entry.status].key) }}
                            </Badge>
                        </div>
                        <div class="skills-page__cell">
                            <Button v-if="entry.status === 'needs-init'" size="sm" variant="secondary" data-skill-init @click="emit('init', entry.id)">{{ text("skills.page.init") }}</Button>
                        </div>
                        <Button size="sm" variant="ghost" :disabled="entry.problem?.code === 'skill-md-missing'" data-skill-open @click="emit('open', entry.id)">{{ text("skills.page.open") }}</Button>
                        <IconButton
                            size="sm"
                            :icon-class="expanded.has(entry.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            :aria-label="text('skills.page.details.toggle', {name: entry.name})"
                            :aria-expanded="expanded.has(entry.id)"
                            data-skill-expand
                            @click="toggle(entry.id)"
                        />
                        <dl v-if="expanded.has(entry.id)" class="skills-page__details" data-skill-details>
                            <template v-for="row in details(entry)" :key="row.term">
                                <dt>{{ row.term }}</dt>
                                <dd :class="{'skills-page__output': row.output === true}">{{ row.value }}</dd>
                            </template>
                        </dl>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>

<style scoped>
.skills-page { display: flex; flex-direction: column; container-type: inline-size; }
.skills-page__bar { display: flex; justify-content: flex-end; }
.skills-page__empty { display: flex; min-height: 160px; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); padding: var(--space-5); font-size: var(--text-sm); line-height: var(--leading-ui); color: var(--text-secondary); text-align: center; }
.skills-page__empty p { max-width: 36em; margin: 0; }
.skills-page__empty-icon { width: 24px; height: 24px; color: var(--text-muted); }
/* 整页一张网格：各组各行经 subgrid 共用这五列，零件每行落在同一列。 */
.skills-page__groups { display: grid; grid-template-columns: minmax(0, 1fr) repeat(4, max-content); column-gap: var(--space-3); row-gap: var(--space-7); margin-top: var(--space-4); }
.skills-page__group, .skills-page__list, .skills-page__item { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
.skills-page__group-title { grid-column: 1 / -1; margin: 0; padding-bottom: var(--space-3); border-bottom: var(--border-w) solid var(--divider); font-size: var(--text-xs); font-weight: var(--weight-strong); line-height: var(--leading-ui); color: var(--text-secondary); }
.skills-page__list { margin: 0; padding: 0; list-style: none; }
.skills-page__item { align-items: center; padding: var(--space-3) 0; border-bottom: var(--border-w) solid var(--divider); }
.skills-page__meta { display: flex; min-width: 0; flex-direction: column; gap: var(--space-1); }
.skills-page__cell { display: flex; align-items: center; }
.skills-page__name { overflow: hidden; font-size: var(--text-sm); color: var(--text-main); white-space: nowrap; text-overflow: ellipsis; }
.skills-page__second { margin: 0; overflow: hidden; font-size: var(--text-xs); line-height: var(--leading-ui); color: var(--text-muted); white-space: nowrap; text-overflow: ellipsis; }
.skills-page__second.is-problem { color: var(--text-secondary); }
.skills-page__second.is-danger { color: var(--status-danger); }
.skills-page__spin { width: 12px; height: 12px; margin-right: var(--space-1); }
.skills-page__details { grid-column: 1 / -1; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-1) var(--space-4); margin: var(--space-3) 0 0; padding: var(--space-3); border-radius: var(--radius-control); background: var(--bg-subtle); font-size: var(--text-xs); line-height: var(--leading-ui); }
.skills-page__details dt { color: var(--text-muted); }
.skills-page__details dd { margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
/* 窄时名字与说明占满第一行，徽标与按钮落到第二行、仍在各自的列里：按钮列不收，名字不被挤成几个字。 */
@container (max-width: 480px) {
    .skills-page__meta { grid-column: 1 / -1; }
    .skills-page__item > :nth-child(2) { grid-column: 2; }
}
.skills-page__details dd.skills-page__output { font-family: var(--font-mono); white-space: pre-wrap; }
</style>

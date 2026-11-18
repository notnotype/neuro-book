<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {SkillInitPlan} from "../../shared/skills";
import type {SkillInitFailure, SkillInitPhase} from "../skill-init";
import {useAgentPageText} from "../text";

/** 初始化 Skill 之前的确认框（同名 .md）。三块区域固定，状态之间只换内容。 */

const props = defineProps<{
    open: boolean;
    name: string;
    phase: SkillInitPhase;
    plan: SkillInitPlan | null;
    failure: SkillInitFailure | null;
}>();

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "confirm"): void;
}>();

const text = useAgentPageText();

const head = computed(() => {
    if (props.phase === "loading") return text("skills.init.head.loading");
    if (props.phase === "installing") return text("skills.init.head.installing");
    if (props.phase === "failed") return text("skills.init.head.failed");
    const plan = props.plan;
    if (plan === null) return text("skills.init.head.loading");
    if (!plan.lock) return text("skills.init.head.direct", {count: plan.dependencies.length});
    return plan.packages === null ? text("skills.init.head.packagesUnknown") : text("skills.init.head.packages", {count: plan.packages});
});

const box = computed(() => {
    if (props.phase === "failed" && props.failure !== null && props.failure.output !== "") return {caption: text("skills.init.box.output"), body: props.failure.output};
    const dependencies = props.plan?.dependencies ?? [];
    return {caption: text("skills.init.box.dependencies"), body: dependencies.length === 0 && props.plan !== null ? text("skills.init.box.none") : dependencies.join("\n")};
});

const FAILURE_NOTE = {"install-failed": "installFailed", busy: "busy", interrupted: "interrupted", unavailable: "unavailable"} as const;
const note = computed((): {readonly text: string; readonly tone: "muted" | "warning" | "danger"} => {
    if (props.phase === "failed") return {text: text(`skills.init.note.${FAILURE_NOTE[props.failure?.code ?? "unavailable"]}`), tone: "danger"};
    if (props.phase === "installing") return {text: text("skills.init.note.installing"), tone: "muted"};
    if (props.plan !== null && !props.plan.lock) return {text: text("skills.init.note.noLock"), tone: "warning"};
    return {text: text("skills.init.note.scripts"), tone: "muted"};
});

const close = (): void => emit("update:open", false);
</script>

<template>
    <Dialog
        :open="props.open"
        size="sm"
        :title="text('skills.init.title', {name: props.name})"
        closable
        initial-focus="[data-skill-init-start]"
        data-skill-init
        @update:open="(value: boolean) => emit('update:open', value)"
    >
        <div class="skill-init" :data-phase="props.phase">
            <p class="skill-init__head" :class="{'is-danger': props.phase === 'failed'}" data-skill-init-head>
                <span v-if="props.phase === 'installing' || props.phase === 'loading'" class="i-lucide-loader-2 animate-spin skill-init__spin" aria-hidden="true"></span>
                <span class="skill-init__head-text">{{ head }}</span>
            </p>
            <div class="skill-init__box">
                <span class="skill-init__caption">{{ box.caption }}</span>
                <pre class="skill-init__output nb-ui-scrollbar-thin" tabindex="0" role="group" :aria-label="box.caption" data-skill-init-box>{{ box.body }}</pre>
            </div>
            <p class="skill-init__note" :class="`is-${note.tone}`" data-skill-init-note>{{ note.text }}</p>
            <span class="skill-init__start" tabindex="-1" data-skill-init-start></span>
        </div>
        <template #footer>
            <template v-if="props.phase === 'installing'">
                <Button variant="secondary" class="flex-1" data-skill-init-background @click="close">{{ text("skills.init.background") }}</Button>
            </template>
            <template v-else-if="props.phase === 'failed'">
                <Button variant="secondary" class="flex-1" data-skill-init-close @click="close">{{ text("skills.init.close") }}</Button>
                <Button variant="primary" class="flex-1" data-skill-init-confirm @click="emit('confirm')">{{ text("skills.init.retry") }}</Button>
            </template>
            <template v-else>
                <Button variant="secondary" class="flex-1" data-skill-init-later @click="close">{{ text("skills.init.later") }}</Button>
                <Button variant="primary" class="flex-1" :disabled="props.phase === 'loading'" data-skill-init-confirm @click="emit('confirm')">{{ text("skills.init.confirm") }}</Button>
            </template>
        </template>
    </Dialog>
</template>

<style scoped>
/* 正文固定高度：几种状态下对话框尺寸不变，中间一块吃掉剩下的高度，内容多了在里面滚动。 */
.skill-init { position: relative; display: flex; height: 236px; flex-direction: column; gap: var(--space-3); font-size: var(--text-sm); line-height: var(--leading-ui); }
.skill-init p { margin: 0; }
/* 状态一行、说明两行，高度固定：哪种状态的文字长短都不挤动中间那块。 */
.skill-init__head { display: flex; flex: none; align-items: center; gap: var(--space-2); height: calc(1em * var(--leading-ui)); min-width: 0; color: var(--text-main); }
.skill-init__head.is-danger { color: var(--status-danger); }
.skill-init__head-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.skill-init__spin { flex: none; width: 14px; height: 14px; color: var(--text-muted); }
.skill-init__box { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-subtle); }
.skill-init__caption { flex: none; font-size: var(--text-xs); color: var(--text-muted); }
/* 命令输出是内容，要能复制（nb-ui 规范的“文字能否选中”）。 */
.skill-init__output { user-select: text; flex: 1 1 auto; min-height: 0; margin: 0; overflow: auto; font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }
.skill-init__note { flex: none; height: calc(2em * var(--leading-ui)); overflow: hidden; font-size: var(--text-xs); color: var(--text-muted); }
.skill-init__note.is-warning { color: var(--status-warning); }
.skill-init__note.is-danger { color: var(--status-danger); }
.skill-init__start { position: absolute; width: 0; height: 0; outline: none; }
</style>

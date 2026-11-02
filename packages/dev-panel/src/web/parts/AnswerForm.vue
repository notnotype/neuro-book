<script setup lang="ts">
import {Badge, Button, Field, Textarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {controlCharProblem} from "../../core/text-rules.js";
import {validateAnswerValue} from "../../core/questions.js";
import {answerText, editingValue, groupQuestions, isBlankAnswer, isNewQuestion, staleText, submittedValue} from "../host/answers.js";
import {relativeTime} from "../host/format.js";
import type {QuestionState} from "../host/types.js";
import QuestionControl from "./QuestionControl.vue";

/**
 * 产物页侧栏的答复表单：待答的题给控件，已答的题只读、点“改答”才给控件；之前几版留下的题不进表单（宿主经 `readonly` 插槽放只读的列表）。
 * 只交改过或新填的题；校验用核心的同一份规则。提交栏贴在侧栏底部。零件不发请求：按“提交”只发 `submit`。契约见同名 .md。
 */
const props = defineProps<{
    questions: QuestionState[];
    /** 最新一版：标“新”用。 */
    latestVersion: number;
    pending: boolean;
    slow: boolean;
    /** 不能答的原因（来自分支、产物已关闭、主工作区不能写、看的不是最新一版）；有值时表单只读。 */
    disabledReason: string | null;
    /** 服务端按题号退回的错误。 */
    errors: Record<string, string>;
    /** 变了就清空本地的填写（提交成功之后）。 */
    resetKey: number;
}>();
const emit = defineEmits<{submit: [answer: {values: Record<string, unknown>; comments: Record<string, string>; note: string | null}]}>();

const groups = computed(() => groupQuestions(props.questions));
const values = ref<Record<string, unknown>>({});
const comments = ref<Record<string, string>>({});
const commenting = ref<Record<string, boolean>>({});
const touched = ref<Record<string, boolean>>({});
/** 已答的题里点了“改答”的。 */
const editing = ref<Record<string, boolean>>({});
const note = ref("");

function reset(): void {
    values.value = {};
    comments.value = {};
    commenting.value = {};
    touched.value = {};
    editing.value = {};
    note.value = "";
}
watch(() => props.resetKey, reset, {immediate: true});

/** 取值照存（文本框里的空白仍显示），清空了的不算改过、不交。 */
function set(id: string, value: unknown): void {
    values.value = {...values.value, [id]: value};
    touched.value = {...touched.value, [id]: !isBlankAnswer(value)};
}
/** 单选组与确认题点了就收不回，待答的题给一个“清除选择”回到没答。 */
const canClear = (state: QuestionState) => (state.question.type === "single" || state.question.type === "confirm") && values.value[state.question.id] !== undefined;
function startEdit(state: QuestionState): void {
    const id = state.question.id;
    values.value = {...values.value, [id]: editingValue(state, values.value, touched.value)};
    editing.value = {...editing.value, [id]: true};
}
/** 取消改答：取值回到已答的那份，说明也丢掉，这道题不再交。 */
function cancelEdit(state: QuestionState): void {
    const id = state.question.id;
    const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
    editing.value = without(editing.value);
    touched.value = without(touched.value);
    comments.value = without(comments.value);
    commenting.value = without(commenting.value);
    values.value = without(values.value);
}

/** 能交的题：待答的，加上点了“改答”的已答题。 */
const editable = computed(() => [...groups.value.pending, ...groups.value.answered.filter((state) => editing.value[state.question.id])]);
/** 只交改过的题（含新填的）与写了说明的题。 */
const chosen = computed(() => editable.value.filter((state) => touched.value[state.question.id] || (comments.value[state.question.id] ?? "").trim() !== ""));
const problems = computed(() => {
    const found: Record<string, string> = {};
    for (const state of chosen.value) {
        const id = state.question.id;
        if (!touched.value[id] && state.answer) continue;
        const reason = validateAnswerValue(state.question, values.value[id]);
        if (reason) found[id] = reason;
        const comment = comments.value[id] ?? "";
        const commentProblem = comment === "" ? null : controlCharProblem(comment, true);
        if (commentProblem) found[id] = `说明${commentProblem}`;
    }
    return found;
});
const noteProblem = computed(() => (note.value === "" ? null : controlCharProblem(note.value, true)));
const ready = computed(() => chosen.value.length > 0 && Object.keys(problems.value).length === 0 && noteProblem.value === null);
/** 还没填好的必答题（填了但不合法的也算没填好）。 */
const requiredLeft = computed(() => groups.value.pending.filter((state) => state.question.required && !(touched.value[state.question.id] && validateAnswerValue(state.question, values.value[state.question.id]) === null)).length);
const hasControls = computed(() => editable.value.length > 0);
const pendingRequired = computed(() => groups.value.pending.filter((state) => state.question.required).length);

function submit(): void {
    if (!ready.value || props.pending || props.disabledReason) return;
    const answer: Record<string, unknown> = {};
    const notes: Record<string, string> = {};
    for (const state of chosen.value) {
        const id = state.question.id;
        // 只写了说明、没改取值的已答题：带上现在的取值，答复文件里这道题仍有取值。
        answer[id] = submittedValue(state, values.value, touched.value);
        if ((comments.value[id] ?? "").trim() !== "") notes[id] = comments.value[id]!;
    }
    emit("submit", {values: answer, comments: notes, note: note.value.trim() === "" ? null : note.value});
}
</script>

<template>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
        <p v-if="disabledReason" class="nbdev-hint">{{ disabledReason }}</p>
        <section class="nbdev-stack" aria-label="待答">
            <!-- 必答与选答分开数：首页收件箱只收必答题，写的是“必答 N”，两边对得上。 -->
            <h3 class="nbdev-card-title">待答 <span class="nbdev-secondary nbdev-num font-normal">必答 {{ pendingRequired }}<template v-if="groups.pending.length > pendingRequired"> · 选答 {{ groups.pending.length - pendingRequired }}</template></span></h3>
            <p v-if="groups.pending.length === 0" class="nbdev-empty">没有待答的题</p>
            <fieldset v-for="state in groups.pending" :key="state.question.id" class="nbdev-stack border-b pb-3 last:border-b-0 nbdev-divider" :disabled="disabledReason !== null || pending">
                <legend class="flex flex-wrap items-center gap-1.5 pb-1">
                    <span class="font-medium">{{ state.question.label }}</span>
                    <Badge v-if="isNewQuestion(state.question, latestVersion)" tone="accent" variant="soft" size="sm">新</Badge>
                    <Badge v-if="state.question.required" tone="warning" variant="soft" size="sm">必答</Badge>
                    <Badge v-else tone="neutral" variant="soft" size="sm">选答</Badge>
                    <span class="nbdev-note">#{{ state.question.id }}</span>
                </legend>
                <p v-if="state.question.about" class="nbdev-note">关于 {{ state.question.about }}</p>
                <p v-if="state.stale" class="nbdev-hint nbdev-hint-warn">{{ staleText(state) }}</p>
                <QuestionControl :question="state.question" :model-value="values[state.question.id]" @update:model-value="(value) => set(state.question.id, value)" />
                <Field v-if="commenting[state.question.id]" label="说明（可选）">
                    <Textarea :model-value="comments[state.question.id] ?? ''" :rows="2" @update:model-value="(value: string) => (comments = {...comments, [state.question.id]: value})" />
                </Field>
                <div v-if="!commenting[state.question.id] || canClear(state)" class="flex flex-wrap items-center gap-3">
                    <button v-if="!commenting[state.question.id]" type="button" class="nbdev-note" @click="commenting = {...commenting, [state.question.id]: true}">加说明</button>
                    <button v-if="canClear(state)" type="button" class="nbdev-note" @click="set(state.question.id, undefined)">清除选择</button>
                </div>
                <p v-if="problems[state.question.id] ?? errors[state.question.id]" class="nbdev-danger nbdev-small" role="alert">{{ problems[state.question.id] ?? errors[state.question.id] }}</p>
            </fieldset>
        </section>
        <section v-if="groups.answered.length > 0" class="nbdev-stack" aria-label="已答">
            <h3 class="nbdev-card-title">已答 <span class="nbdev-secondary nbdev-num font-normal">{{ groups.answered.length }}</span></h3>
            <fieldset v-for="state in groups.answered" :key="state.question.id" class="nbdev-stack border-b pb-3 last:border-b-0 nbdev-divider" :disabled="disabledReason !== null || pending">
                <legend class="flex flex-wrap items-center gap-1.5 pb-1">
                    <span class="font-medium">{{ state.question.label }}</span>
                    <Badge v-if="isNewQuestion(state.question, latestVersion)" tone="accent" variant="soft" size="sm">新</Badge>
                    <span class="nbdev-note">#{{ state.question.id }}</span>
                </legend>
                <template v-if="editing[state.question.id]">
                    <QuestionControl :question="state.question" :model-value="values[state.question.id]" @update:model-value="(value) => set(state.question.id, value)" />
                    <Field v-if="commenting[state.question.id]" label="说明（可选）">
                        <Textarea :model-value="comments[state.question.id] ?? ''" :rows="2" @update:model-value="(value: string) => (comments = {...comments, [state.question.id]: value})" />
                    </Field>
                    <button v-else type="button" class="nbdev-note self-start" @click="commenting = {...commenting, [state.question.id]: true}">加说明</button>
                    <p v-if="problems[state.question.id] ?? errors[state.question.id]" class="nbdev-danger nbdev-small" role="alert">{{ problems[state.question.id] ?? errors[state.question.id] }}</p>
                    <Button class="self-start" size="sm" variant="ghost" icon-class="i-lucide-undo-2" @click="cancelEdit(state)">取消改答</Button>
                </template>
                <template v-else>
                    <p class="break-words">{{ answerText(state.question, state.answer?.value) }}</p>
                    <p class="nbdev-note">v{{ state.answer?.artifactVersion }} 答 · {{ state.answer ? relativeTime(state.answer.submittedAt) : "" }}<template v-if="state.answer?.comment"> · {{ state.answer.comment }}</template></p>
                    <p v-if="errors[state.question.id]" class="nbdev-danger nbdev-small" role="alert">{{ errors[state.question.id] }}</p>
                    <Button v-if="!disabledReason" class="self-start" size="sm" variant="ghost" icon-class="i-lucide-pencil" @click="startEdit(state)">改答</Button>
                </template>
            </fieldset>
        </section>
        <slot name="readonly" />
        <Field v-if="hasControls" label="整份答复的备注（可选）" :error="noteProblem ?? ''">
            <Textarea v-model="note" :rows="2" :disabled="disabledReason !== null || pending" />
        </Field>
        <!-- 提交栏贴在侧栏底部：题多时人在下面填，按钮与结果都要看得到。 -->
        <div v-if="hasControls || $slots.result" class="nbdev-submit-bar nbdev-divider sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t px-4 py-3">
            <!-- 结果与这次答复的通知可能很长：限高、自己滚，按钮总在栏里。 -->
            <div v-if="$slots.result" class="relative flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                <slot name="result" />
            </div>
            <div v-if="hasControls" class="flex flex-wrap items-center gap-2">
                <Button type="submit" :loading="pending" :disabled="!ready || disabledReason !== null">提交 {{ chosen.length }} 题</Button>
                <span v-if="slow" class="nbdev-note">在等别的写入完成…</span>
                <span v-else class="nbdev-note nbdev-num">已改 {{ chosen.length }} 题<template v-if="requiredLeft > 0"> · 还有 {{ requiredLeft }} 道必答没答</template></span>
            </div>
        </div>
    </form>
</template>

<style scoped>
.nbdev-submit-bar {
    background: var(--panel-surface);
}
</style>

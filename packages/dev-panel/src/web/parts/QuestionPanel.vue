<script setup lang="ts">
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {answerText, groupQuestions, isNewQuestion, staleText} from "../host/answers.js";
import {relativeTime} from "../host/format.js";
import type {QuestionState, VersionQuestion} from "../host/types.js";

/**
 * 产物页侧栏里只读的题：之前几版的题、已取代与撤回；没有答复表单时（独立产物、还没发布）也列待答与已答。契约见同名 .md。
 * `answering`：有答复表单时，待答与已答由表单显示，这里只留只读的两组。
 */
const props = withDefaults(defineProps<{questions: QuestionState[]; version: number; latestVersion: number; answering?: boolean}>(), {answering: false});
const answeredOpen = ref(false);
const earlierOpen = ref(false);
const closedOpen = ref(false);

const groups = computed(() => groupQuestions(props.questions));
const pendingRequired = computed(() => groups.value.pending.filter((state) => state.question.required).length);
const TYPE_LABEL: Record<VersionQuestion["type"], string> = {single: "单选", multi: "多选", text: "文字", confirm: "确认"};

function outcomeText(state: QuestionState): string {
    const outcome = state.question.outcome;
    if (!outcome) return "";
    if (outcome.kind === "withdrawn") return outcome.reason === "closed" ? `v${outcome.in} 关闭产物时撤回` : `v${outcome.in} 撤回`;
    if (!outcome.by) return `被 v${outcome.in} 的页面取代`;
    return `被 ${outcome.by.artifactId}#${outcome.by.questionId} 取代（v${outcome.in}）`;
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <p v-if="version !== latestVersion && !answering" class="nbdev-hint">
            看的是 v{{ version }} 的题表（最新是 v{{ latestVersion }}）；状态按全部答复现算
        </p>
        <section v-if="!answering" class="nbdev-stack" aria-label="待答">
            <h3 class="nbdev-card-title">待答 <span class="nbdev-secondary nbdev-num font-normal">{{ groups.pending.length }}<template v-if="pendingRequired > 0"> · 必答 {{ pendingRequired }}</template></span></h3>
            <p v-if="groups.pending.length === 0" class="nbdev-empty">没有待答的题</p>
            <article v-for="state in groups.pending" :key="state.question.id" class="nbdev-stack border-b pb-3 last:border-b-0 nbdev-divider">
                <div class="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" variant="outline" size="sm">{{ TYPE_LABEL[state.question.type] }}</Badge>
                    <Badge v-if="isNewQuestion(state.question, latestVersion)" tone="accent" variant="soft" size="sm">新</Badge>
                    <Badge v-if="state.question.required" tone="warning" variant="soft" size="sm">必答</Badge>
                    <span class="nbdev-note">#{{ state.question.id }} · 自 v{{ state.question.since }}</span>
                </div>
                <p class="font-medium">{{ state.question.label }}</p>
                <ul v-if="state.question.options.length > 0" class="nbdev-note flex flex-col gap-0.5 pl-1">
                    <li v-for="option in state.question.options" :key="option.value" class="flex items-center gap-1.5">
                        <span class="i-lucide-circle size-3" aria-hidden="true" />{{ option.label }}
                        <Badge v-if="state.question.recommend.includes(option.value)" tone="accent" variant="soft" size="sm">推荐</Badge>
                    </li>
                </ul>
                <p v-if="state.question.about" class="nbdev-note">关于 {{ state.question.about }}</p>
                <p v-if="state.stale" class="nbdev-hint nbdev-hint-warn">{{ staleText(state) }}</p>
            </article>
        </section>
        <Collapsible v-if="!answering && groups.answered.length > 0" v-model:open="answeredOpen">
            <template #trigger>
                <button type="button" class="nbdev-card-title flex items-center gap-1" :aria-expanded="answeredOpen">
                    <span :class="answeredOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" aria-hidden="true" />已答 {{ groups.answered.length }}
                </button>
            </template>
            <div class="mt-2 flex flex-col gap-2">
                <article v-for="state in groups.answered" :key="state.question.id" class="flex flex-col gap-0.5">
                    <p class="font-medium">{{ state.question.label }}</p>
                    <p class="break-words">{{ answerText(state.question, state.answer?.value) }}</p>
                    <p class="nbdev-note">v{{ state.answer?.artifactVersion }} 答 · {{ state.answer ? relativeTime(state.answer.submittedAt) : "" }}<template v-if="state.answer?.comment"> · {{ state.answer.comment }}</template></p>
                </article>
            </div>
        </Collapsible>
        <Collapsible v-if="groups.earlier.length > 0" v-model:open="earlierOpen">
            <template #trigger>
                <button type="button" class="nbdev-card-title flex items-center gap-1 text-left" :aria-expanded="earlierOpen">
                    <span :class="earlierOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0" aria-hidden="true" />之前几版的题 {{ groups.earlier.length }}
                    <span class="nbdev-note font-normal">（这一版页面上已没有，只读）</span>
                </button>
            </template>
            <div class="mt-2 flex flex-col gap-2">
                <article v-for="state in groups.earlier" :key="state.question.id" class="flex flex-col gap-0.5">
                    <p class="font-medium">{{ state.question.label }} <span class="nbdev-note font-normal">#{{ state.question.id }} · v{{ state.question.since }} 的题</span></p>
                    <template v-if="state.answer">
                        <p class="break-words">{{ answerText(state.question, state.answer.value) }}</p>
                        <p class="nbdev-note">v{{ state.answer.artifactVersion }} 答 · {{ relativeTime(state.answer.submittedAt) }}<template v-if="state.answer.comment"> · {{ state.answer.comment }}</template></p>
                    </template>
                    <p v-else-if="state.stale" class="nbdev-note">{{ staleText(state) }}（这道题已经不能再答）</p>
                </article>
            </div>
        </Collapsible>
        <Collapsible v-if="groups.closed.length > 0" v-model:open="closedOpen">
            <template #trigger>
                <button type="button" class="nbdev-card-title nbdev-secondary flex items-center gap-1" :aria-expanded="closedOpen">
                    <span :class="closedOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" aria-hidden="true" />已取代与撤回 {{ groups.closed.length }}
                </button>
            </template>
            <ul class="nbdev-empty mt-2 flex flex-col gap-1.5">
                <li v-for="state in groups.closed" :key="state.question.id">
                    <span class="line-through">{{ state.question.label }}</span>
                    <span class="nbdev-small"> · {{ outcomeText(state) }}</span>
                </li>
            </ul>
        </Collapsible>
    </div>
</template>

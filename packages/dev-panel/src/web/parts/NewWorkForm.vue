<script setup lang="ts">
import {Button, Field, Input, Textarea, RadioGroup} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {SLUG_PATTERN} from "../../core/ids.js";
import {controlCharProblem, titleProblem} from "../../core/text-rules.js";
import {WORK_FORM_FIELDS} from "../host/create-fields.js";
import type {PreviewProblem} from "../host/types.js";

/** 新建 Work 的表单（第三轮稿 `r3/new.html`）：短名、标题、目标、Issue、首个 Task。Work 的状态不给选，一律进行中（与 `nbdev work new` 相同）。 */
export type WorkFormValue = {slug: string; title: string; goal: string; issue: string; taskSlug: string; taskTitle: string; taskStatus: "planned" | "active"};

const props = defineProps<{modelValue: WorkFormValue; problems: PreviewProblem[]; pending: boolean; slow: boolean; disabledReason: string | null}>();
const emit = defineEmits<{"update:modelValue": [value: WorkFormValue]; submit: []}>();

const update = <K extends keyof WorkFormValue>(key: K, value: WorkFormValue[K]) => emit("update:modelValue", {...props.modelValue, [key]: value});
const STATUS_OPTIONS = [{value: "planned", label: "计划中"}, {value: "active", label: "进行中"}];

/** 本地的即时提示（同一份核心规则），服务端预览的问题按字段补上。 */
const errors = computed(() => {
    const value = props.modelValue;
    const found: Record<string, string> = {};
    if (value.slug !== "" && !SLUG_PATTERN.test(value.slug)) found.slug = "只能是小写字母、数字与连字符";
    if (value.taskSlug !== "" && !SLUG_PATTERN.test(value.taskSlug)) found.taskSlug = "只能是小写字母、数字与连字符";
    if (value.title !== "") found.title = titleProblem(value.title) ?? "";
    if (value.taskTitle !== "") found.taskTitle = titleProblem(value.taskTitle) ?? "";
    if (value.goal !== "") found.goal = controlCharProblem(value.goal, true) ?? "";
    if (value.issue !== "" && !/^[1-9][0-9]*$/u.test(value.issue)) found.issue = "Issue 编号是正整数";
    // 只吸收表单里有的字段：预览本身失败（`preview`）只在预览区显示，不挡提交。
    for (const problem of props.problems) if (WORK_FORM_FIELDS.has(problem.field)) found[problem.field] ||= problem.message;
    return found;
});
const complete = computed(() => ["slug", "title", "goal", "taskSlug"].every((key) => props.modelValue[key as keyof WorkFormValue] !== "") && Object.values(errors.value).every((message) => !message));
</script>

<template>
    <form class="flex flex-col gap-3" @submit.prevent="complete && !pending && !disabledReason && emit('submit')">
        <fieldset class="grid grid-cols-1 gap-3 md:grid-cols-2" :disabled="pending || disabledReason !== null">
            <Field label="短名" description="kebab-case，进 Work id，例如 dev-panel" :error="errors.slug ?? ''" required>
                <Input :model-value="modelValue.slug" @update:model-value="(value: string) => update('slug', value)" />
            </Field>
            <Field label="标题" :error="errors.title ?? ''" required>
                <Input :model-value="modelValue.title" @update:model-value="(value: string) => update('title', value)" />
            </Field>
            <Field label="目标" description="写进 README 的“目标”一节" :error="errors.goal ?? ''" required class="md:col-span-2">
                <Textarea :model-value="modelValue.goal" :rows="4" @update:model-value="(value: string) => update('goal', value)" />
            </Field>
            <Field label="Issue（可选）" :error="errors.issue ?? ''">
                <Input :model-value="modelValue.issue" inputmode="numeric" @update:model-value="(value: string) => update('issue', value)" />
            </Field>
            <div />
            <Field label="首个 Task 的短名" :error="errors.taskSlug ?? ''" required>
                <Input :model-value="modelValue.taskSlug" @update:model-value="(value: string) => update('taskSlug', value)" />
            </Field>
            <Field label="首个 Task 的标题（可选，缺省同 Work 标题）" :error="errors.taskTitle ?? ''">
                <Input :model-value="modelValue.taskTitle" @update:model-value="(value: string) => update('taskTitle', value)" />
            </Field>
            <Field label="首个 Task 的状态" group>
                <RadioGroup :model-value="modelValue.taskStatus" :options="STATUS_OPTIONS" orientation="horizontal" size="sm" @update:model-value="(value: string) => update('taskStatus', value as WorkFormValue['taskStatus'])" />
            </Field>
        </fieldset>
        <div class="flex flex-wrap items-center gap-2">
            <Button variant="primary" type="submit" :loading="pending" :disabled="!complete || disabledReason !== null">新建 Work</Button>
            <span class="nbdev-note" v-if="slow">在等别的写入完成…</span>
        </div>
    </form>
</template>

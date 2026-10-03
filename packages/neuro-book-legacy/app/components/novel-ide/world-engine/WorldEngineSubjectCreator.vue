<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {formatWorldEngineConflictMessage} from "nbook/app/utils/world-engine-preview";
import type {
    CreateSubjectResultDto,
    WorldIssueDto,
    WorldSchemaProjectionDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    projectRoot: string;
    schema: WorldSchemaProjectionDto | null;
    busy?: boolean;
}>();

const emit = defineEmits<{
    (e: "created", payload: {subject: WorldSubjectDto; issues: WorldIssueDto[]}): void;
    (e: "error", message: string): void;
    (e: "notice", message: string): void;
}>();

const form = reactive({
    id: "world",
    type: "world",
    name: "世界",
    time: "",
});
const creating = ref(false);
const lastAppliedDefaultTime = ref("");

const schemaTypes = computed(() => props.schema?.subjectTypes ?? []);
const selectedTypeAttrs = computed(() => schemaTypes.value.find((item) => item.type === form.type)?.attrs ?? []);
const formDisabled = computed(() => props.busy || creating.value);
const canSubmit = computed(() => Boolean(props.projectRoot) && !props.busy && !creating.value && form.id.trim() && form.type.trim() && form.time.trim());

/** 创建 World Engine subject；只有 schema default 非空时后端才会写入初始化切面。 */
async function createSubject(): Promise<void> {
    if (!canSubmit.value) {
        emit("error", "创建 subject 需要 id、type 和 time。");
        return;
    }

    creating.value = true;
    try {
        const requestBody = {
            id: form.id.trim(),
            type: form.type.trim(),
            name: form.name.trim(),
            time: form.time.trim(),
        };
        const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
            method: "POST",
            query: {projectRoot: props.projectRoot},
            body: requestBody,
        });
        const subject: WorldSubjectDto = {
            id: result.subjectId,
            type: requestBody.type,
            name: requestBody.name,
        };
        emit("created", {subject, issues: result.issues});
        form.id = "";
        form.name = "";
    } catch (error) {
        emit("error", formatWorldEngineConflictMessage(resolveApiErrorMessage(error, "创建 subject 失败")));
    } finally {
        creating.value = false;
    }
}

/** 返回当前 schema 下手动创建 subject 的默认类型。 */
function defaultSubjectType(): string {
    return schemaTypes.value[0]?.type ?? "world";
}

/** 返回当前 schema 下手动创建 subject 的默认初始化时间。 */
function defaultSubjectTime(): string {
    return props.schema?.calendar.examples[0] ?? "";
}

/** Project 切换后重置表单，避免沿用上一个 Project 的 id / time。 */
function resetFormForProject(): void {
    form.id = "world";
    form.type = defaultSubjectType();
    form.name = "世界";
    form.time = defaultSubjectTime();
    lastAppliedDefaultTime.value = form.time;
}

/** schema 刷新后同步默认 type/time，但保留作者手动改过的初始化时间。 */
function applySchemaDefaults(): void {
    const firstType = defaultSubjectType();
    if (!schemaTypes.value.some((item) => item.type === form.type)) {
        form.type = firstType;
    }
    const nextDefaultTime = defaultSubjectTime();
    if (!form.time || form.time === lastAppliedDefaultTime.value) {
        form.time = nextDefaultTime;
    }
    lastAppliedDefaultTime.value = nextDefaultTime;
}

watch(() => props.schema, () => {
    applySchemaDefaults();
}, {immediate: true});

watch(() => props.projectRoot, () => {
    resetFormForProject();
});
</script>

<template>
    <section class="border-b border-[var(--border-color)] p-2">
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
                <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Create Subject</div>
                <span class="i-lucide-user-plus h-4 w-4 text-[var(--text-muted)]"></span>
            </div>
            <fieldset class="space-y-2 disabled:opacity-60" :disabled="formDisabled">
                <div class="grid grid-cols-2 gap-2">
                    <input v-model="form.id" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="id">
                    <select v-model="form.type" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]">
                        <option v-for="type in schemaTypes" :key="type.type" :value="type.type">{{ type.type }}</option>
                    </select>
                </div>
                <input v-model="form.name" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="name">
                <input v-model="form.time" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="time">
                <div class="flex max-h-14 flex-wrap gap-1 overflow-hidden">
                    <span v-for="attr in selectedTypeAttrs.slice(0, 8)" :key="attr.name" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ attr.name }}</span>
                </div>
                <button type="button" class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!canSubmit" @click="void createSubject()">
                    <span :class="creating ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-circle-plus'" class="h-3.5 w-3.5"></span>
                    创建 Subject
                </button>
            </fieldset>
        </div>
    </section>
</template>

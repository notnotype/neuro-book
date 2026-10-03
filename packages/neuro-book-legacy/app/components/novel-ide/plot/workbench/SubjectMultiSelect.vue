<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    projectRoot: string;
    modelValue: string[];
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string[]): void;
}>();

const subjects = ref<WorldSubjectDto[]>([]);
const search = ref("");
const loading = ref(false);
const error = ref("");

const selectedSet = computed(() => new Set(props.modelValue));
const selectedSubjects = computed(() => props.modelValue.map((subjectId) => (
    subjects.value.find((subject) => subject.id === subjectId) ?? {id: subjectId, type: "unknown", name: subjectId}
)));
const filteredSubjects = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    if (!keyword) {
        return subjects.value;
    }
    return subjects.value.filter((subject) => (
        subject.id.toLowerCase().includes(keyword)
        || subject.name.toLowerCase().includes(keyword)
        || subject.type.toLowerCase().includes(keyword)
    ));
});

watch(() => props.projectRoot, () => {
    void loadSubjects();
}, {immediate: true});

/**
 * 读取当前 Project Workspace 的 World Engine subjects。
 */
async function loadSubjects(): Promise<void> {
    if (!props.projectRoot) {
        subjects.value = [];
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        subjects.value = await $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {
            query: {projectRoot: props.projectRoot},
        });
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "加载 World Engine subjects 失败");
    } finally {
        loading.value = false;
    }
}

/**
 * 切换 subject 是否属于当前 Scene。
 */
function toggleSubject(subjectId: string): void {
    if (selectedSet.value.has(subjectId)) {
        emit("update:modelValue", props.modelValue.filter((item) => item !== subjectId));
        return;
    }
    emit("update:modelValue", [...props.modelValue, subjectId]);
}

/**
 * 移除一个已选 subject。
 */
function removeSubject(subjectId: string): void {
    emit("update:modelValue", props.modelValue.filter((item) => item !== subjectId));
}
</script>

<template>
    <!-- Scene World Anchor 出场 subject 多选器 -->
    <div class="space-y-2">
        <div class="flex min-h-8 flex-wrap gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
            <button
                v-for="subject in selectedSubjects"
                :key="subject.id"
                type="button"
                class="inline-flex max-w-full items-center gap-1 rounded bg-[var(--status-info-bg)] px-1.5 py-0.5 text-[11px] text-[var(--status-info)] ring-1 ring-inset ring-[var(--status-info-border)]"
                :title="`${subject.type} · ${subject.id}`"
                @click="removeSubject(subject.id)"
            >
                <span class="truncate">{{ subject.name || subject.id }}</span>
                <span class="i-lucide-x h-3 w-3 shrink-0"></span>
            </button>
            <span v-if="selectedSubjects.length === 0" class="text-[11px] text-[var(--text-muted)]">未选择出场 subject</span>
        </div>

        <input
            v-model="search"
            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
            placeholder="搜索 subject 名称、ID 或类型"
        >

        <div class="max-h-44 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] custom-scrollbar">
            <button
                v-for="subject in filteredSubjects"
                :key="subject.id"
                type="button"
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                @click="toggleSubject(subject.id)"
            >
                <span class="h-3.5 w-3.5 shrink-0" :class="selectedSet.has(subject.id) ? 'i-lucide-check-square text-[var(--accent-main)]' : 'i-lucide-square text-[var(--text-muted)]'"></span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-[var(--text-main)]">{{ subject.name || subject.id }}</span>
                    <span class="block truncate font-mono text-[10px] text-[var(--text-muted)]">{{ subject.type }} · {{ subject.id }}</span>
                </span>
            </button>
            <div v-if="!loading && filteredSubjects.length === 0" class="px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">暂无匹配 subject</div>
            <div v-if="loading" class="px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">加载中...</div>
        </div>

        <div v-if="error" class="text-[11px] text-[var(--status-danger)]">{{ error }}</div>
    </div>
</template>

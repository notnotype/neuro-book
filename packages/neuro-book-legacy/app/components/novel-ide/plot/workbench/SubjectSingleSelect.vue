<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    projectRoot: string;
    modelValue: string | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

const subjects = ref<WorldSubjectDto[]>([]);
const search = ref("");
const loading = ref(false);
const error = ref("");

const selectedSubject = computed(() => (
    props.modelValue
        ? subjects.value.find((subject) => subject.id === props.modelValue) ?? {id: props.modelValue, type: "unknown", name: props.modelValue}
        : null
));
const filteredSubjects = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    const candidates = subjects.value.filter((subject) => subject.type === "location" || props.modelValue === subject.id);
    if (!keyword) {
        return candidates;
    }
    return candidates.filter((subject) => (
        subject.id.toLowerCase().includes(keyword)
        || subject.name.toLowerCase().includes(keyword)
        || subject.type.toLowerCase().includes(keyword)
    ));
});

watch(() => props.projectRoot, () => {
    void loadSubjects();
}, {immediate: true});

/**
 * 读取地点候选 subject；第一版优先展示 type=location。
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
</script>

<template>
    <!-- Scene World Anchor 地点 subject 单选器 -->
    <div class="space-y-2">
        <div class="flex min-h-8 items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
            <div class="min-w-0">
                <div class="truncate text-[12px] text-[var(--text-main)]">{{ selectedSubject?.name ?? "未选择地点" }}</div>
                <div v-if="selectedSubject" class="truncate font-mono text-[10px] text-[var(--text-muted)]">{{ selectedSubject.type }} · {{ selectedSubject.id }}</div>
            </div>
            <button v-if="selectedSubject" type="button" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="清空地点" @click="emit('update:modelValue', null)">
                <span class="i-lucide-x h-3.5 w-3.5"></span>
            </button>
        </div>

        <input
            v-model="search"
            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
            placeholder="搜索 location subject"
        >

        <div class="max-h-36 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] custom-scrollbar">
            <button
                v-for="subject in filteredSubjects"
                :key="subject.id"
                type="button"
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                @click="emit('update:modelValue', subject.id)"
            >
                <span class="h-3.5 w-3.5 shrink-0" :class="props.modelValue === subject.id ? 'i-lucide-map-pin-check text-[var(--accent-main)]' : 'i-lucide-map-pin text-[var(--text-muted)]'"></span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-[var(--text-main)]">{{ subject.name || subject.id }}</span>
                    <span class="block truncate font-mono text-[10px] text-[var(--text-muted)]">{{ subject.type }} · {{ subject.id }}</span>
                </span>
            </button>
            <div v-if="!loading && filteredSubjects.length === 0" class="px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">暂无 location subject</div>
            <div v-if="loading" class="px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">加载中...</div>
        </div>

        <div v-if="error" class="text-[11px] text-[var(--status-danger)]">{{ error }}</div>
    </div>
</template>

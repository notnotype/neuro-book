<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {SceneWorldContextDto} from "nbook/shared/dto/plot.dto";

const props = defineProps<{
    projectRoot: string;
    sceneId: string;
}>();

const emit = defineEmits<{
    (e: "openWorldEngine"): void;
}>();

const context = ref<SceneWorldContextDto | null>(null);
const loading = ref(false);
const error = ref("");

const hasContext = computed(() => Boolean(context.value && (
    context.value.slices.length > 0 || context.value.subjectStates.length > 0
)));
const unresolvedSubjectIds = computed(() => context.value?.unresolvedSubjectIds ?? []);

watch(() => [props.projectRoot, props.sceneId], () => {
    void loadContext();
}, {immediate: true});

/**
 * 查询当前 Scene 的 World Engine 范围上下文。
 */
async function loadContext(): Promise<void> {
    if (!props.projectRoot || !props.sceneId) {
        context.value = null;
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        context.value = await $fetch<SceneWorldContextDto>(`/api/projects/plot/scenes/${encodeURIComponent(props.sceneId)}/world-context`, {
            query: {projectRoot: props.projectRoot},
        });
    } catch (caught) {
        context.value = null;
        error.value = resolveApiErrorMessage(caught, "查询 World Engine 上下文失败");
    } finally {
        loading.value = false;
    }
}

/**
 * 把 subject attrs 压缩成 Inspector 内可读的摘要。
 */
function attrsSummary(attrs: Record<string, unknown>): string {
    const entries = Object.entries(attrs).slice(0, 4);
    if (!entries.length) {
        return "无状态属性";
    }
    return entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join("；");
}

/**
 * 展示 JSON 值，避免复杂对象撑开检查器。
 */
function formatValue(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}
</script>

<template>
    <!-- Scene 对应的 World Engine 上下文预览 -->
    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-2.5">
        <div class="mb-2 flex items-center justify-between gap-2">
            <div class="text-[11px] font-semibold text-[var(--text-main)]">World Engine 上下文</div>
            <div class="flex shrink-0 items-center gap-1">
                <button type="button" data-testid="plot-world-context-open-workbench" class="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('openWorldEngine')">
                    <span class="i-lucide-external-link h-3 w-3"></span>
                    打开
                </button>
                <button type="button" class="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="loading" @click="void loadContext()">
                    <span class="i-lucide-refresh-cw h-3 w-3" :class="loading ? 'animate-spin' : ''"></span>
                    刷新
                </button>
            </div>
        </div>

        <div v-if="loading" class="py-4 text-center text-[11px] text-[var(--text-muted)]">正在查询...</div>
        <div v-else-if="error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-2 text-[11px] leading-relaxed text-[var(--status-danger)]">{{ error }}</div>
        <div v-else-if="!hasContext" class="space-y-2">
            <div v-if="unresolvedSubjectIds.length" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-2 text-[11px] leading-relaxed text-[var(--status-warning)]">
                <div class="mb-1 flex items-center justify-center gap-1 font-semibold">
                    <span class="i-lucide-alert-triangle h-3.5 w-3.5"></span>
                    Subject 尚未接入 World Engine
                </div>
                <div class="break-all text-center font-mono">{{ unresolvedSubjectIds.join("，") }}</div>
            </div>
            <div class="rounded-md border border-dashed border-[var(--border-color)] px-2 py-4 text-center text-[11px] text-[var(--text-muted)]">暂无匹配的 slices 或 subject 状态</div>
        </div>
        <div v-else class="space-y-3">
            <div v-if="unresolvedSubjectIds.length" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-2 text-[11px] leading-relaxed text-[var(--status-warning)]">
                <div class="mb-1 flex items-center gap-1 font-semibold">
                    <span class="i-lucide-alert-triangle h-3.5 w-3.5"></span>
                    未接入 subject 不参与本次查询
                </div>
                <div class="break-all font-mono">{{ unresolvedSubjectIds.join("，") }}</div>
            </div>
            <section class="space-y-1.5">
                <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Slices</div>
                <div v-if="context?.slices.length" class="space-y-1.5">
                    <div v-for="slice in context.slices" :key="slice.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="flex items-center gap-2 text-[11px]">
                            <span class="truncate font-semibold text-[var(--text-main)]">{{ slice.title || slice.id }}</span>
                            <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ slice.patchCount }} patches</span>
                        </div>
                        <div class="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{{ slice.time }} · {{ slice.kind }}</div>
                        <div v-if="slice.summary" class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ slice.summary }}</div>
                    </div>
                </div>
                <div v-else class="text-[11px] text-[var(--text-muted)]">无相关 slice</div>
            </section>

            <section class="space-y-1.5">
                <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Subject States</div>
                <div v-if="context?.subjectStates.length" class="space-y-1.5">
                    <div v-for="subject in context.subjectStates" :key="subject.subjectId" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="flex items-center gap-2 text-[11px]">
                            <span class="truncate font-semibold text-[var(--text-main)]">{{ subject.name || subject.subjectId }}</span>
                            <span class="shrink-0 rounded bg-[var(--status-success-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-success)]">{{ subject.type }}</span>
                        </div>
                        <div class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ attrsSummary(subject.attrs) }}</div>
                    </div>
                </div>
                <div v-else class="text-[11px] text-[var(--text-muted)]">无 subject 终态</div>
            </section>
        </div>
    </div>
</template>

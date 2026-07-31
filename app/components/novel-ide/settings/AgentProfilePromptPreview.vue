<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentProfilePreparePreviewDto, AgentProfilePreparePreviewRequestDto} from "nbook/shared/dto/agent-profile.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";

type PreviewMode = "draft" | "effective";
type PromptSegment = {text: string; custom: boolean};

const props = defineProps<{
    profileKey: string;
    settings: LowCodeJsonObject;
    resourceMutations: LowCodeResourceMutationDto[];
    projectPath?: string;
}>();

const open = ref(false);
const mode = ref<PreviewMode>("draft");
const loading = ref(false);
const error = ref("");
const prompt = ref("");
const updatedAt = ref("");
const needsSessionContext = ref(false);
const contextLoading = ref(false);
const contextLoaded = ref(false);
const contextLoadError = ref("");
const contextSessions = ref<AgentSessionSummaryDto[]>([]);
const selectedSessionId = ref("");
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let requestGeneration = 0;
const sessionApi = useAgentSessionApi();

/** 需要初始化数据的 Profile 可选择真实 Session，确保角色档案与 Project 上下文均来自实际运行环境。 */
const sessionOptions = computed<SelectOption[]>(() => contextSessions.value.map((session) => ({
    value: String(session.sessionId),
    label: session.title || `Session #${session.sessionId}`,
    description: `${session.archived ? "已归档" : session.status} · ${session.projectPath ?? session.workspaceKey}`,
})));

/** 把完整提示词切成普通段与自定义条目段，用于只读高亮。 */
const segments = computed<PromptSegment[]>(() => {
    const result: PromptSegment[] = [];
    const pattern = /<custom_prompt_item\b[\s\S]*?<\/custom_prompt_item>/gu;
    let cursor = 0;
    for (const match of prompt.value.matchAll(pattern)) {
        const index = match.index ?? cursor;
        if (index > cursor) result.push({text: prompt.value.slice(cursor, index), custom: false});
        result.push({text: match[0], custom: true});
        cursor = index + match[0].length;
    }
    if (cursor < prompt.value.length) result.push({text: prompt.value.slice(cursor), custom: false});
    return result;
});

/** 打开完整提示词预览，默认展示当前未保存草稿。 */
async function show(): Promise<void> {
    open.value = true;
    mode.value = "draft";
    contextLoadError.value = "";
    if (contextSessions.value.length === 0) contextLoaded.value = false;
    await refresh();
}

/** 切换草稿/已生效视图并重新执行真实 profile.prepare。 */
async function setMode(value: PreviewMode): Promise<void> {
    if (mode.value === value) return;
    mode.value = value;
    await refresh();
}

/** 加载与当前 Profile 匹配的真实 Session；Project 配置只列出当前 Project 的候选项。 */
async function loadContextSessions(): Promise<boolean> {
    if (contextLoaded.value) return contextSessions.value.length > 0;
    contextLoading.value = true;
    contextLoadError.value = "";
    try {
        const page = await sessionApi.listSessions({
            profileKey: props.profileKey,
            includeArchived: true,
            includeSystem: true,
            ...(props.projectPath ? {projectPath: props.projectPath} : {}),
            limit: 200,
        });
        contextSessions.value = page.items;
        contextLoaded.value = true;
        return page.items.length > 0;
    } catch (caught) {
        contextLoadError.value = resolveApiErrorMessage(caught, "无法加载可用 Session");
        return false;
    } finally {
        contextLoading.value = false;
    }
}

/** 切换真实 Session 后重新执行 prepare，预览立即使用该 Session 的创建期 initial。 */
async function selectSession(value: string): Promise<void> {
    if (selectedSessionId.value === value) return;
    selectedSessionId.value = value;
    await refresh();
}

/** 调用服务端真实 prepare；后发请求覆盖先发请求。 */
async function refresh(): Promise<void> {
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = "";
    const body: AgentProfilePreparePreviewRequestDto = {
        profileKey: props.profileKey,
        ...(props.projectPath ? {projectPath: props.projectPath} : {}),
        ...(selectedSessionId.value ? {sessionId: selectedSessionId.value} : {}),
        ...(mode.value === "draft" ? {
            settingsOverride: props.settings,
            resourceMutations: props.resourceMutations,
        } : {}),
    };
    try {
        const result = await $fetch<AgentProfilePreparePreviewDto>("/api/agent/profiles/preview-prepare", {method: "POST", body});
        if (generation !== requestGeneration) return;
        const systemPrompt = result.messages.find((message) => message.role === "systemPrompt");
        prompt.value = systemPrompt?.text ?? "";
        const issues = result.issues.filter((issue) => issue.severity === "error");
        const requiresContext = issues.some((issue) => issue.code === "initial_context_required");
        needsSessionContext.value = requiresContext || Boolean(selectedSessionId.value);
        if (requiresContext && !selectedSessionId.value) {
            const hasSessions = await loadContextSessions();
            if (generation !== requestGeneration) return;
            const firstSession = contextSessions.value[0];
            if (hasSessions && firstSession) {
                selectedSessionId.value = String(firstSession.sessionId);
                await refresh();
                return;
            }
        }
        if (!result.ok || issues.length > 0) {
            error.value = issues.map((issue) => issue.message).join("\n") || "提示词预览失败";
        }
        updatedAt.value = new Date().toLocaleTimeString();
    } catch (caught) {
        if (generation !== requestGeneration) return;
        prompt.value = "";
        error.value = resolveApiErrorMessage(caught, "提示词预览失败");
    } finally {
        if (generation === requestGeneration) loading.value = false;
    }
}

/** 预览打开且处于草稿模式时，编辑后 500ms 自动刷新。 */
watch(() => [props.settings, props.resourceMutations], () => {
    if (!open.value || mode.value !== "draft") return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 500);
}, {deep: true});

onBeforeUnmount(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
});
</script>

<template>
    <!-- Agent Profile 最终 System Prompt 预览入口 -->
    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="void show()"><span class="i-lucide-file-search-2 h-3.5 w-3.5"></span>完整提示词预览</button>

    <Dialog v-model="open" :title="`${props.profileKey} · 完整 System Prompt`" size="xl" overlay-type="blur" :show-footer="false" body-class="min-h-0 overflow-hidden">
        <div class="flex h-full min-h-0 flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-1">
                    <button type="button" class="h-7 rounded-md px-3 text-xs" :class="mode === 'draft' ? 'bg-[var(--accent-main)] text-[var(--text-inverse)]' : 'text-[var(--text-secondary)]'" @click="void setMode('draft')">当前草稿</button>
                    <button type="button" class="h-7 rounded-md px-3 text-xs" :class="mode === 'effective' ? 'bg-[var(--accent-main)] text-[var(--text-inverse)]' : 'text-[var(--text-secondary)]'" @click="void setMode('effective')">已保存生效</button>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><span v-if="updatedAt">更新于 {{ updatedAt }}</span><button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 text-[var(--text-secondary)]" :disabled="loading" @click="void refresh()"><span class="h-3 w-3" :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>刷新</button></div>
            </div>

            <div class="rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)]">该内容来自服务端真实 <code>profile.prepare()</code>。黄色块是自定义条目；其余内容由人设、特色设置和固定协议动态生成。</div>
            <!-- 仅依赖创建期 initial 的特殊 Profile 显示真实 Session 上下文选择器 -->
            <div v-if="needsSessionContext" class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2.5">
                <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--text-main)]"><span class="i-lucide-database h-3.5 w-3.5 text-[var(--status-warning)]"></span>预览上下文</div>
                <p class="mb-2 text-[11px] leading-5 text-[var(--text-secondary)]">该 Profile 的提示词依赖创建 Session 时的角色或任务初始化数据。预览会读取所选 Session 的 <code>initial</code> 与 Project 上下文，但不会写入 Session。</p>
                <FormSelect v-if="sessionOptions.length > 0" :model-value="selectedSessionId" :options="sessionOptions" placeholder="选择一个 Session" size="sm" @update:model-value="value => void selectSession(value)" />
                <div v-else class="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><span v-if="contextLoading" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span><span>{{ contextLoading ? "正在查找可用 Session…" : `没有找到可用于 ${props.profileKey} 的 Session；请先创建一次该 Agent Session。` }}</span></div>
                <div v-if="contextLoadError" class="mt-2 text-[11px] text-[var(--status-danger)]">{{ contextLoadError }}</div>
            </div>
            <div v-if="error" class="whitespace-pre-wrap rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ error }}</div>
            <div v-if="loading && !prompt" class="flex min-h-48 flex-1 items-center justify-center text-sm text-[var(--text-muted)]"><span class="i-lucide-loader-2 mr-2 h-4 w-4 animate-spin"></span>正在生成真实提示词预览…</div>
            <pre v-else class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border-color)] bg-[var(--editor-bg)] p-4 font-mono text-xs leading-6 text-[var(--editor-text)]"><span v-for="(segment, index) in segments" :key="index" :class="segment.custom ? 'rounded bg-[var(--status-warning-bg)] text-[var(--text-main)] ring-1 ring-[var(--status-warning-border)]' : ''">{{ segment.text }}</span><span v-if="!prompt" class="text-[var(--text-muted)]">当前 Profile 没有生成 System Prompt。</span></pre>
        </div>
    </Dialog>
</template>

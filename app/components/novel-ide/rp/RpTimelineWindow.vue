<script setup lang="ts">
import {computed, ref, watch} from "vue";
import DialogWindow from "nbook/app/components/common/DialogWindow.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    RpTimelineActionRequestDto,
    RpTimelineNodeDto,
    RpTimelineProblemReportDto,
    RpTimelinePreviewDto,
    RpTimelineRestoreResultDto,
    RpTimelineTreeDto,
} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{
    modelValue: boolean;
    projectPath: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "restored", result: RpTimelineRestoreResultDto): void;
}>();

const notification = useNotification();
const tree = ref<RpTimelineTreeDto | null>(null);
const preview = ref<RpTimelinePreviewDto | null>(null);
const problemReport = ref<RpTimelineProblemReportDto | null>(null);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref("");
const checkpointLabel = ref("");
const checkpointSummary = ref("");
const checkpointReplacementId = ref<string | null>(null);
const restoreArmed = ref(false);
const createSafety = ref(true);
const safetyLabel = ref("恢复前安全切片");
const restoreReplacementId = ref<string | null>(null);

watch(() => props.modelValue, (visible) => {
    if (visible) void refresh();
});
watch(() => props.projectPath, () => {
    tree.value = null;
    preview.value = null;
    problemReport.value = null;
    selectedId.value = null;
});

const nodeMap = computed(() => new Map((tree.value?.nodes ?? []).map((node) => [node.id, node])));
const selectedNode = computed(() => selectedId.value ? nodeMap.value.get(selectedId.value) ?? null : null);
const activeNode = computed(() => tree.value ? nodeMap.value.get(tree.value.activeNodeId) ?? null : null);
const activeChildren = computed(() => activeNode.value?.childrenIds.map((id) => nodeMap.value.get(id)).filter((node): node is RpTimelineNodeDto => Boolean(node)) ?? []);
const replacementCandidates = computed(() => activeChildren.value.filter((node) => !node.locked && node.id !== tree.value?.activeNodeId));
const replacementRequired = computed(() => activeChildren.value.length >= (tree.value?.maxChildren ?? 4));

const flattenedNodes = computed(() => {
    if (!tree.value) return [];
    const result: Array<{node: RpTimelineNodeDto; depth: number}> = [];
    const visited = new Set<string>();
    /** 深度优先展开时间线，异常环只显示一次。 */
    function visit(nodeId: string, depth: number): void {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const node = nodeMap.value.get(nodeId);
        if (!node) return;
        result.push({node, depth});
        for (const childId of node.childrenIds) visit(childId, depth + 1);
    }
    visit(tree.value.rootId, 0);
    return result;
});

/** 重新读取时间线树，并保持当前选择。 */
async function refresh(): Promise<void> {
    if (!props.projectPath || loading.value) return;
    loading.value = true;
    loadError.value = "";
    try {
        tree.value = await $fetch<RpTimelineTreeDto | null>("/api/projects/rp/timeline", {query: {projectPath: props.projectPath}});
        if (tree.value) {
            const nextId = selectedId.value && nodeMap.value.has(selectedId.value) ? selectedId.value : tree.value.activeNodeId;
            await selectNode(nextId);
        } else {
            selectedId.value = null;
            preview.value = null;
        }
    } catch (error) {
        loadError.value = resolveApiErrorMessage(error, "世界切片树加载失败");
    } finally {
        loading.value = false;
    }
}

/** 初始化当前 RP 状态为锁定根切片。 */
async function initialize(): Promise<void> {
    await runAction({op: "initialize", label: "当前时间线起点"}, "世界切片树已启用");
}

/** 执行非恢复类时间线操作。 */
async function runAction(action: RpTimelineActionRequestDto, successMessage: string): Promise<void> {
    if (actionBusy.value) return;
    actionBusy.value = true;
    loadError.value = "";
    try {
        tree.value = await $fetch<RpTimelineTreeDto>("/api/projects/rp/timeline", {
            method: "POST", query: {projectPath: props.projectPath}, body: action,
        });
        notification.success(successMessage);
        if (tree.value) await selectNode(tree.value.activeNodeId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "世界切片操作失败"), {title: "操作失败"});
    } finally {
        actionBusy.value = false;
    }
}

/** 建立手工检查点。 */
async function createCheckpoint(): Promise<void> {
    if (!checkpointLabel.value.trim()) return;
    await runAction({
        op: "checkpoint",
        label: checkpointLabel.value,
        summary: checkpointSummary.value,
        replaceNodeId: replacementRequired.value ? checkpointReplacementId.value : null,
    }, "检查点已建立");
    checkpointLabel.value = "";
    checkpointSummary.value = "";
    checkpointReplacementId.value = null;
}

/** 只读加载节点摘要和完整性结果。 */
async function selectNode(nodeId: string): Promise<void> {
    selectedId.value = nodeId;
    restoreArmed.value = false;
    problemReport.value = null;
    loadError.value = "";
    try {
        preview.value = await $fetch<RpTimelinePreviewDto>("/api/projects/rp/timeline-preview", {
            query: {projectPath: props.projectPath, nodeId},
        });
    } catch (error) {
        preview.value = null;
        loadError.value = resolveApiErrorMessage(error, "切片预览失败");
        try {
            problemReport.value = await $fetch<RpTimelineProblemReportDto | null>("/api/projects/rp/timeline-diagnosis", {
                query: {projectPath: props.projectPath, nodeId},
            });
        } catch (diagnosisError) {
            loadError.value += `；${resolveApiErrorMessage(diagnosisError, "恢复诊断失败")}`;
        }
    }
}

/** 显式归档一条直接子分支，为后续新分支腾出位置。 */
async function archiveBranch(nodeId: string): Promise<void> {
    await runAction({op: "archive_branch", nodeId}, "分支已归档，恢复材料仍保留在项目中");
}

/** 恢复选中节点，并按设置先建立安全切片。 */
async function restoreSelected(): Promise<void> {
    if (!selectedNode.value || !tree.value || selectedNode.value.id === tree.value.activeNodeId || actionBusy.value) return;
    actionBusy.value = true;
    loadError.value = "";
    try {
        const result = await $fetch<RpTimelineRestoreResultDto>("/api/projects/rp/timeline-restore", {
            method: "POST",
            query: {projectPath: props.projectPath},
            body: {
                nodeId: selectedNode.value.id,
                confirmed: true,
                createSafety: createSafety.value,
                safetyLabel: safetyLabel.value,
                replaceNodeId: createSafety.value && replacementRequired.value ? restoreReplacementId.value : null,
            },
        });
        tree.value = result.tree;
        restoreArmed.value = false;
        notification.success("世界时间线已恢复；将创建新的主持会话隔离旧分支上下文");
        emit("restored", result);
        await selectNode(result.restoredNodeId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "世界切片恢复失败"), {title: "恢复失败"});
    } finally {
        actionBusy.value = false;
    }
}

/** 格式化存储体积。 */
function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
    <!-- RP 世界切片树管理器 -->
    <DialogWindow :model-value="modelValue" title="世界切片树" :width="940" height="min(740px, calc(100vh - 64px))" body-class="min-h-0 overflow-hidden" :busy="actionBusy" @update:model-value="emit('update:modelValue', $event)">
        <div v-if="loadError" class="shrink-0 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ loadError }}</div>
        <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]"><span class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>加载时间线…</div>
        <div v-else-if="!tree" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span class="i-lucide-git-fork h-9 w-9 text-[var(--accent-main)]"></span>
            <div class="text-[14px] font-semibold text-[var(--text-main)]">世界切片树尚未启用</div>
            <p class="max-w-[520px] text-[11px] leading-relaxed text-[var(--text-secondary)]">启用后会把当前 RP 世界数据库、运行状态、正文 Tick、骰子和角色记忆保存为锁定根切片。此后每个 committed Tick 自动形成节点。</p>
            <button type="button" class="rounded-md bg-[var(--accent-main)] px-3 py-1.5 text-[11px] text-[var(--text-inverse)] disabled:opacity-40" :disabled="actionBusy" @click="void initialize()">以当前状态建立根切片</button>
        </div>
        <div v-else class="flex min-h-0 flex-1">
            <!-- 树状节点区 -->
            <aside class="flex w-[360px] shrink-0 flex-col border-r border-[var(--border-color)]">
                <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
                    <span>{{ tree.nodes.length }} 个可用节点 · {{ tree.archivedNodeCount }} 个已归档</span>
                    <button type="button" title="刷新" @click="void refresh()"><span class="i-lucide-refresh-cw h-3.5 w-3.5"></span></button>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
                    <div v-for="item in flattenedNodes" :key="item.node.id" class="mb-1" :style="{paddingLeft: `${Math.min(item.depth, 8) * 16}px`}">
                        <div class="flex items-stretch gap-1">
                            <button type="button" class="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left" :class="selectedId === item.node.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'" @click="void selectNode(item.node.id)">
                                <div class="flex items-center gap-1.5"><span :class="item.node.id === tree.activeNodeId ? 'i-lucide-circle-dot' : item.node.kind === 'root' ? 'i-lucide-house' : 'i-lucide-git-commit-horizontal'" class="h-3.5 w-3.5 shrink-0" :style="{color: item.node.id === tree.activeNodeId ? 'var(--accent-main)' : 'var(--text-muted)'}"></span><span class="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-main)]">{{ item.node.label }}</span><span v-if="item.node.locked" class="i-lucide-lock h-3 w-3 shrink-0 text-[var(--status-warning)]"></span></div>
                                <div class="mt-0.5 flex gap-1 text-[9px] text-[var(--text-muted)]"><span>{{ item.node.storage === "full" ? "完整" : "差量" }}</span><span v-if="item.node.tick">· Tick {{ item.node.tick }}</span><span v-if="item.node.id === tree.activeNodeId" class="text-[var(--accent-text)]">· 当前</span></div>
                            </button>
                            <button v-if="item.node.id !== tree.rootId" type="button" class="w-6 rounded border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" :title="item.node.locked ? '解锁' : '锁定'" @click="void runAction({op: 'lock', nodeId: item.node.id, locked: !item.node.locked}, item.node.locked ? '切片已解锁' : '切片已锁定')"><span :class="item.node.locked ? 'i-lucide-lock-open' : 'i-lucide-lock'" class="h-3 w-3"></span></button>
                        </div>
                    </div>
                </div>
                <!-- 手工检查点 -->
                <div class="shrink-0 border-t border-[var(--border-color)] p-2.5">
                    <input v-model="checkpointLabel" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" maxlength="120" placeholder="检查点名称" />
                    <input v-model="checkpointSummary" class="mt-1.5 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[10px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" maxlength="500" placeholder="备注（可选）" />
                    <select v-if="replacementRequired" v-model="checkpointReplacementId" class="mt-1.5 w-full rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-input)] px-2 py-1.5 text-[10px] text-[var(--text-main)]">
                        <option :value="null">选择要替换的未锁定分支</option><option v-for="node in replacementCandidates" :key="node.id" :value="node.id">{{ node.label }}</option>
                    </select>
                    <button type="button" class="mt-1.5 w-full rounded-md border border-[var(--accent-main)] py-1.5 text-[10px] text-[var(--accent-text)] disabled:opacity-40" :disabled="actionBusy || !checkpointLabel.trim() || (replacementRequired && !checkpointReplacementId)" @click="void createCheckpoint()">建立当前检查点</button>
                </div>
            </aside>

            <!-- 只读预览与恢复确认 -->
            <main class="min-w-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
                <div v-if="problemReport" class="m-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 text-[11px]">
                    <div class="font-semibold text-[var(--status-danger)]">切片恢复材料损坏</div>
                    <p class="mt-1 leading-relaxed text-[var(--text-secondary)]">{{ problemReport.failure }}</p>
                    <p class="mt-1 text-[var(--text-muted)]">问题报告：{{ problemReport.reportPath }}</p>
                    <div v-if="problemReport.lastVerifiedNodeId" class="mt-2 rounded border border-[var(--status-warning-border)] bg-[var(--bg-panel)] p-2 text-[var(--text-secondary)]">
                        最近可验证节点为「{{ problemReport.lastVerifiedLabel }}」。系统不会自动回退；请先查看该节点的影响范围，再由你确认是否恢复。
                        <button type="button" class="ml-1 text-[var(--accent-text)] hover:underline" @click="void selectNode(problemReport.lastVerifiedNodeId!)">查看该节点</button>
                    </div>
                    <p v-else class="mt-2 text-[var(--status-danger)]">祖先链中没有可验证节点，请保留当前时间线并查阅问题报告。</p>
                </div>
                <div v-else-if="!selectedNode || !preview" class="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">选择节点进行只读预览。</div>
                <template v-else>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                        <div class="flex items-center justify-between gap-2"><h3 class="text-[14px] font-semibold text-[var(--text-main)]">{{ selectedNode.label }}</h3><span class="rounded bg-[var(--status-success-bg)] px-1.5 py-0.5 text-[9px] text-[var(--status-success)]">材料校验通过</span></div>
                        <p v-if="selectedNode.summary" class="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ selectedNode.summary }}</p>
                        <div class="mt-2 text-[9px] text-[var(--text-muted)]">{{ selectedNode.createdAt }} · {{ selectedNode.logicalFileCount }} 个文件 · {{ formatBytes(selectedNode.logicalBytes) }}</div>
                    </div>
                    <div class="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ preview.summary.turns }}</div><div class="text-[9px] text-[var(--text-muted)]">正式回合</div></div>
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ preview.summary.activeEvents }} / {{ preview.summary.events }}</div><div class="text-[9px] text-[var(--text-muted)]">活跃 / 全部事件</div></div>
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ preview.summary.npcs }}</div><div class="text-[9px] text-[var(--text-muted)]">角色名册</div></div>
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ selectedNode.worldSliceCount }}</div><div class="text-[9px] text-[var(--text-muted)]">世界切面</div></div>
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ preview.summary.resources }}</div><div class="text-[9px] text-[var(--text-muted)]">资源账户</div></div>
                        <div class="rounded-md border border-[var(--border-color)] p-2"><div class="text-[14px] text-[var(--text-main)]">{{ preview.summary.beliefs }}</div><div class="text-[9px] text-[var(--text-muted)]">角色认知</div></div>
                    </div>

                    <div v-if="selectedNode.id !== tree.activeNodeId" class="mt-3 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-2.5">
                        <div class="flex items-center justify-between gap-2"><span class="text-[11px] font-semibold text-[var(--status-info)]">相对当前时间线的影响范围</span><span class="text-[9px] text-[var(--text-muted)]">{{ preview.impact.changedFiles }} 个文件不同</span></div>
                        <div class="mt-2 grid grid-cols-3 gap-1.5">
                            <div v-for="category in preview.impact.categories" :key="category.key" class="rounded bg-[var(--bg-panel)] px-2 py-1.5 text-[9px]">
                                <div class="text-[var(--text-muted)]">{{ category.label }}</div>
                                <div class="mt-0.5 font-mono text-[var(--text-main)]">{{ category.activeValue }} → {{ category.targetValue }} <span v-if="category.targetValue !== category.activeValue" :class="category.targetValue < category.activeValue ? 'text-[var(--status-warning)]' : 'text-[var(--status-info)]'">({{ category.targetValue > category.activeValue ? "+" : "" }}{{ category.targetValue - category.activeValue }})</span></div>
                            </div>
                        </div>
                    </div>

                    <div v-if="selectedNode.parentId === tree.activeNodeId && !selectedNode.locked && selectedNode.id !== tree.activeNodeId" class="mt-3 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2.5 text-[10px] text-[var(--text-secondary)]">
                        这是当前节点的直接子分支，可将它归档以腾出分支位置。归档不会立即删除恢复材料。
                        <button type="button" class="ml-1 text-[var(--status-warning)] hover:underline" @click="void archiveBranch(selectedNode.id)">归档此分支</button>
                    </div>

                    <div v-if="selectedNode.id !== tree.activeNodeId" class="mt-4 border-t border-[var(--border-color)] pt-3">
                        <button v-if="!restoreArmed" type="button" class="rounded-md border border-[var(--status-warning-border)] px-3 py-1.5 text-[11px] text-[var(--status-warning)] hover:bg-[var(--status-warning-bg)]" @click="restoreArmed = true">准备恢复到此切片</button>
                        <div v-else class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3">
                            <div class="text-[12px] font-semibold text-[var(--status-danger)]">确认改变 active 时间线</div>
                            <p class="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">RP 世界、回合文件、正文、骰子、关系与角色记忆将恢复到该节点。玩家 OOC 认知继续保留；恢复后会新建主持会话隔离旧分支上下文。</p>
                            <label class="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-main)]"><input v-model="createSafety" type="checkbox" />先保存当前状态为安全切片（推荐）</label>
                            <input v-if="createSafety" v-model="safetyLabel" class="mt-1.5 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[10px] text-[var(--text-main)]" maxlength="120" />
                            <select v-if="createSafety && replacementRequired" v-model="restoreReplacementId" class="mt-1.5 w-full rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-input)] px-2 py-1.5 text-[10px] text-[var(--text-main)]"><option :value="null">安全切片需要分支位置：选择替换对象</option><option v-for="node in replacementCandidates" :key="node.id" :value="node.id">{{ node.label }}</option></select>
                            <div class="mt-2 flex justify-end gap-2"><button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--text-secondary)]" @click="restoreArmed = false">取消</button><button type="button" class="rounded-md bg-[var(--status-danger)] px-2 py-1 text-[10px] text-[var(--text-inverse)] disabled:opacity-40" :disabled="actionBusy || (createSafety && replacementRequired && !restoreReplacementId)" @click="void restoreSelected()">确认恢复</button></div>
                        </div>
                    </div>
                </template>
            </main>
        </div>
    </DialogWindow>
</template>

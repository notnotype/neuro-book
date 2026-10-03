<script setup lang="ts">
import ProfileTemplateDropZone from "nbook/app/components/profile-template-editor/ProfileTemplateDropZone.vue";
import ProfileTemplateNodeView from "nbook/app/components/profile-template-editor/ProfileTemplateNodeView.vue";
import type {
    ProfileTemplateNodeDto,
    ProfileTemplateNodeType,
} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    loading: boolean;
    displayRoot: ProfileTemplateNodeDto | null;
    selectedNodeId: string;
    nodeCount: number;
    disabledDropNodeIds: string[];
    canHaveChildren: (type: ProfileTemplateNodeType) => boolean;
    isRootDropActive: () => boolean;
}>();

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "prepare-drag", value: string): void;
    (e: "duplicate", value: string): void;
    (e: "delete", value: string): void;
    (e: "add-message"): void;
}>();
</script>

<template>
    <!-- 中间模板画布：承载根节点子树和根级 drop zone -->
    <section class="panel flex min-h-0 min-w-0 flex-col">
        <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-chevron-right h-4 w-4 text-[var(--accent-main)]"></span>
                    <div class="panel-title">ProfilePrompt（根节点）</div>
                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ props.nodeCount }} 节点</span>
                </div>
                <div class="mt-1 text-[11px] text-[var(--text-muted)]">System、HistorySet、ModelContext、AppendingSet 分别映射到 ProfileTurnPlan 分区。</div>
            </div>
            <div class="flex shrink-0 gap-2">
                <button class="small-btn">折叠全部</button>
                <button class="small-btn">展开全部</button>
            </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto pr-1 custom-scrollbar">
            <div v-if="props.loading" class="empty-state">加载中...</div>
            <template v-else-if="props.displayRoot">
                <div>
                    <ProfileTemplateNodeView
                        v-for="(child, index) in props.displayRoot.children"
                        :key="child.id"
                        :node="child"
                        :selected-id="props.selectedNodeId"
                        :depth="0"
                        :index="index"
                        :parent-id="props.displayRoot.id"
                        :can-have-children="props.canHaveChildren(child.type)"
                        :disabled-drop-node-ids="props.disabledDropNodeIds"
                        @select="emit('select', $event)"
                        @prepare-drag="emit('prepare-drag', $event)"
                        @duplicate="emit('duplicate', $event)"
                        @delete="emit('delete', $event)"
                    />
                </div>
            </template>
            <div v-else class="empty-state">暂无模板</div>
            <button class="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/35 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)]" @click="emit('add-message')">
                <span class="i-lucide-plus h-4 w-4"></span>
                <span>拖拽组件到此处添加</span>
            </button>
        </div>
    </section>
</template>

<style scoped>
.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
}

.panel-title {
    color: var(--text-main);
    font-size: 13px;
    font-weight: 700;
}

.small-btn {
    display: inline-flex;
    height: 28px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 0 10px;
    color: var(--text-secondary);
    font-size: 12px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.small-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.empty-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 55%, transparent);
    color: var(--text-muted);
    font-size: 13px;
}
</style>

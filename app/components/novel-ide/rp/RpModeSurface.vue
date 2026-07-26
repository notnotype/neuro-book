<script setup lang="ts">
import {ref} from "vue";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import RpSidebar from "nbook/app/components/novel-ide/rp/RpSidebar.vue";

/**
 * RP 模式第三布局：嵌在 IDE 头部下方的内容区（非弹窗）。
 * 左侧 世界/地图/角色 三面板（与 IDE 侧栏同侧），右侧 rp.leader 沉浸对话流。
 */
const props = defineProps<{
    /** 当前布局是否处于 RP 模式（透传给对话流做激活控制）。 */
    active: boolean;
    projectPath: string;
    novelId: string;
    /** 打开消息 Markdown 中的 workspace 引用（prose 链接等）。 */
    openReference?: (target: string) => void;
}>();

const sidebarRef = ref<InstanceType<typeof RpSidebar> | null>(null);
const sidebarVisible = ref(true);

/** agent 改动 workspace 时刷新侧栏（本 Tick 的世界写回/记忆落盘会触发）。 */
function handleWorkspaceSync(): void {
    void sidebarRef.value?.refresh();
}
</script>

<template>
    <!-- RP 模式内容区：左世界面板 + 右对话流 -->
    <div class="flex min-h-0 flex-1 overflow-hidden bg-[var(--bg-main)]">
        <aside v-if="sidebarVisible" class="ide-panel w-[360px] shrink-0 border-r border-[var(--border-color)]">
            <RpSidebar ref="sidebarRef" :project-path="props.projectPath" />
        </aside>
        <!-- 侧栏收起/展开轨道 -->
        <button
            type="button"
            class="flex w-6 shrink-0 items-center justify-center border-r border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            :title="sidebarVisible ? '收起世界面板' : '展开世界面板'"
            @click="sidebarVisible = !sidebarVisible"
        >
            <span :class="sidebarVisible ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="h-4 w-4"></span>
        </button>
        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AgentChatSurface
                :active="props.active"
                layout="workbench"
                :novel-id="props.novelId"
                profile-key-override="rp.leader"
                :open-reference="props.openReference"
                class="min-h-0 flex-1"
                @sync-workspace="handleWorkspaceSync"
            />
        </div>
    </div>
</template>

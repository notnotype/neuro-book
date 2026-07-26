<script setup lang="ts">
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";

const props = defineProps<{
    rightPanelOpen: boolean;
    agentModeActive: boolean;
    /** RP 模式界面是否打开（三态切换的第三段高亮）。 */
    rpModeActive?: boolean;
    novelTitle: string;
    novelItems: DropdownItem[];
    currentUser: AuthUserDto | null;
    workspaceMode?: "novel" | "user-assets";
}>();
const currentUser = toRef(props, "currentUser");
const isUserAssetsMode = computed(() => props.workspaceMode === "user-assets");
const {t} = useI18n();

const emit = defineEmits<{
    (e: "toggle-layout-mode"): void;
    (e: "set-layout-mode", mode: "agent" | "ide" | "rp"): void;
    (e: "toggle-agent"): void;
    (e: "open-bookshelf"): void;
    (e: "open-plot-workbench"): void;
    (e: "open-world-engine"): void;
    (e: "open-user-assets"): void;
    (e: "open-profile-workbench"): void;
    (e: "open-trace-viewer"): void;
    (e: "open-history-inbox"): void;
    (e: "switch-novel", value: string): void;
    (e: "open-admin"): void;
    (e: "logout"): void;
}>();

const userMenuItems = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];
    if (currentUser.value?.role === "admin") {
        items.push({
            label: t("ide.header.openAdmin"),
            value: "admin",
            iconClass: "i-lucide-shield",
        });
    }
    items.push({
        label: t("ide.header.logout"),
        value: "logout",
        iconClass: "i-lucide-log-out",
    });
    return items;
});

/**
 * 当前用户头像文字。
 */
const userInitial = computed(() => {
    const name = currentUser.value?.displayName || currentUser.value?.username || "U";
    return name.trim().slice(0, 1).toLocaleUpperCase();
});

/**
 * 处理用户菜单动作。
 */
const handleUserMenuSelect = (value: string): void => {
    if (value === "admin") {
        emit("open-admin");
        return;
    }
    if (value === "logout") {
        emit("logout");
    }
};
</script>

<template>
    <!-- 顶部导航栏 -->
    <header class="ide-panel flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[var(--text-main)] sm:px-4">
        <div class="flex min-w-0 items-center gap-2 sm:gap-4">
            <div class="flex items-center gap-2.5 font-medium">
                <div class="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm">
                    <span class="i-lucide-feather h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                </div>
                <span class="hidden text-[13px] font-bold tracking-[0.3em] uppercase lg:inline">Neuro Book</span>
            </div>
            <div class="hidden h-4 w-px bg-[var(--border-color)] sm:block"></div>
            <!-- Agent / IDE / RP 三态布局切换 -->
            <div
                role="tablist"
                :aria-label="t('ide.header.layoutMode')"
                class="ide-agent-mode-switch relative hidden h-8 w-[221px] items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] p-[3px] transition-colors hover:border-[var(--border-strong)] sm:flex"
            >
                <!-- 背景滑块 -->
                <span
                    class="absolute top-[3px] left-[3px] h-6 w-[71px] rounded-full border border-[var(--accent-main)] bg-[var(--accent-bg)] shadow-sm transition-[transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-10"
                    :class="rpModeActive ? 'translate-x-[142px]' : agentModeActive ? 'translate-x-0' : 'translate-x-[71px]'"
                ></span>

                <!-- Agent 模式 -->
                <button
                    type="button"
                    role="tab"
                    :aria-selected="agentModeActive && !rpModeActive"
                    class="relative z-20 flex h-6 w-[71px] items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors duration-300"
                    :class="agentModeActive && !rpModeActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                    @click="emit('set-layout-mode', 'agent')"
                >
                    <span class="i-lucide-bot h-3.5 w-3.5 shrink-0"></span>
                    <span class="tracking-[0.04em]">Agent</span>
                </button>

                <!-- IDE 模式 -->
                <button
                    type="button"
                    role="tab"
                    :aria-selected="!agentModeActive && !rpModeActive"
                    class="relative z-20 flex h-6 w-[71px] items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors duration-300"
                    :class="!agentModeActive && !rpModeActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                    @click="emit('set-layout-mode', 'ide')"
                >
                    <span class="i-lucide-panels-top-left h-3.5 w-3.5 shrink-0"></span>
                    <span class="tracking-[0.04em]">IDE</span>
                </button>

                <!-- RP 模式 -->
                <button
                    v-if="!isUserAssetsMode"
                    type="button"
                    role="tab"
                    :aria-selected="rpModeActive"
                    data-testid="rp-mode-entry"
                    class="relative z-20 flex h-6 w-[71px] items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors duration-300"
                    :class="rpModeActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                    @click="emit('set-layout-mode', 'rp')"
                >
                    <span class="i-lucide-theater h-3.5 w-3.5 shrink-0"></span>
                    <span class="tracking-[0.04em]">RP</span>
                </button>
            </div>
            <div class="hidden h-4 w-px bg-[var(--border-color)] sm:block"></div>
            <div v-if="!isUserAssetsMode" class="w-28 min-w-0 text-sm sm:w-44">
                <Dropdown :items="novelItems" menu-class="left-0 top-full mt-2 w-full" menu-max-height="min(360px, calc(100vh - 96px))" compact @select="(v) => emit('switch-novel', v)">
                    <button class="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]" :title="novelTitle || t('ide.header.noNovelSelected')">
                        <span class="i-lucide-book-open h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors"></span>
                        <span class="min-w-0 truncate font-serif text-[13px] italic text-[var(--text-secondary)] group-hover:text-[var(--text-main)] transition-colors">{{ novelTitle || t('ide.header.noNovelSelected') }}</span>
                        <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors"></span>
                    </button>
                </Dropdown>
            </div>
            <div v-else class="flex items-center gap-2 text-sm">
                <span class="font-serif text-[13px] italic text-[var(--text-secondary)]">{{ t("ide.header.userAssets") }}</span>
            </div>
        </div>

        <div class="flex shrink-0 items-center gap-1 sm:gap-2">
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] md:flex" :title="t('ide.header.bookshelfTitle')" @click="emit('open-bookshelf')">
                <span class="i-lucide-library h-4 w-4"></span>
                <span>{{ t("ide.header.bookshelf") }}</span>
            </button>
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" :title="t('ide.header.worldEngine')" @click="emit('open-world-engine')">
                <span class="i-lucide-globe-2 h-4 w-4 text-[var(--accent-text)]"></span>
                <span>World</span>
            </button>
            <button v-if="!isUserAssetsMode" data-testid="plot-workbench-entry" class="flex items-center gap-2 rounded-full border border-transparent px-3 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] sm:px-4" :title="t('ide.header.plotWorkbench')" @click="emit('open-plot-workbench')">
                <span class="i-lucide-git-branch h-4 w-4 text-[var(--accent-text)]"></span>
                <span>Plot</span>
            </button>
            <!-- Pi 请求 trace 查看器入口：全局观测，user-assets 模式同样可用 -->
            <button class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" :title="t('ide.header.traceViewerTitle')" @click="emit('open-trace-viewer')">
                <span class="i-lucide-activity h-4 w-4 text-[var(--accent-text)]"></span>
                <span>Trace</span>
            </button>
            <!-- 文件变更收件箱入口：审查 agent 对项目文件的改动，仅 novel 模式可用 -->
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" :title="t('ide.header.historyInboxTitle')" @click="emit('open-history-inbox')">
                <span class="i-lucide-inbox h-4 w-4 text-[var(--accent-text)]"></span>
                <span>{{ t("ide.header.historyInbox") }}</span>
            </button>
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" :title="t('ide.header.userAssetsTitle')" @click="emit('open-user-assets')">
                <span class="i-lucide-folder-cog h-4 w-4 text-[var(--accent-text)]"></span>
                <span>{{ t("ide.header.userAssets") }}</span>
            </button>
            <button v-if="isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" :title="t('ide.header.profileWorkbenchTitle')" @click="emit('open-profile-workbench')">
                <span class="i-lucide-file-code-2 h-4 w-4 text-[var(--accent-text)]"></span>
                <span>Profile</span>
            </button>
            <button
                class="flex items-center gap-2 rounded-full border px-2 py-1.5 text-[12px] tracking-[0.2em] uppercase transition-colors sm:px-4"
                :class="rightPanelOpen ? 'border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-main)]' : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :title="agentModeActive ? rightPanelOpen ? t('ide.header.collapseStudio') : t('ide.header.expandStudio') : rightPanelOpen ? t('ide.header.closeAgentPanel') : t('ide.header.openAgentPanel')"
                @click="emit('toggle-agent')"
            >
                <span :class="agentModeActive ? 'i-lucide-panel-right' : 'i-lucide-bot'" class="h-4 w-4"></span>
                <span class="hidden sm:inline">{{ agentModeActive ? 'Studio' : 'Agent' }}</span>
            </button>

            <div class="mx-1 h-4 w-px bg-[var(--border-color)] sm:mx-2"></div>

            <div class="w-8 shrink-0">
                <Dropdown :items="userMenuItems" menu-class="right-0 top-full mt-2 w-40" @select="handleUserMenuSelect">
                    <button class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.header.accountMenu')">
                        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[11px] font-semibold text-[var(--accent-text)]">{{ userInitial }}</span>
                    </button>
                </Dropdown>
            </div>
        </div>
    </header>
</template>

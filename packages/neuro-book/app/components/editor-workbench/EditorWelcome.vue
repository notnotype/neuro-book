<script setup lang="ts">
import {computed} from "vue";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {EditorTabPresentation} from "./editor-view.types";

export type WorkspaceMode = "novel" | "user-assets";

type WelcomeAction = Readonly<{
    id: string;
    label: string;
    description: string;
    iconClass: string;
    action: () => void;
}>;

const props = withDefaults(defineProps<{
    node: WorkspaceFileNode | null;
    tabs?: readonly EditorTabPresentation[];
    compact?: boolean;
    workspaceMode?: WorkspaceMode;
}>(), {
    tabs: () => [],
    compact: false,
    workspaceMode: "novel",
});

const emit = defineEmits<{
    (event: "select-tab", path: string): void;
    (event: "open-path", path: string): void;
    (event: "open-files"): void;
    (event: "create-chapter"): void;
    (event: "create-markdown-file"): void;
    (event: "create-lorebook-entry"): void;
    (event: "open-agent-panel"): void;
    (event: "open-profile-workbench"): void;
}>();

const {t} = useI18n();

const readonlyNode = computed(() => props.node !== null && !props.node.editable);
const visibleTabs = computed(() => props.tabs.slice(0, props.compact ? 3 : 4));
const novelWorkspace = computed(() => props.workspaceMode === "novel");

const welcomeTitle = computed(() => novelWorkspace.value
    ? t("editorWorkbench.welcome.startTitle")
    : t("editorWorkbench.welcome.viewAssets"));

const welcomeDescription = computed(() => novelWorkspace.value
    ? t("editorWorkbench.welcome.startDescription")
    : t("editorWorkbench.welcome.viewAssetsDescription"));

const quickActions = computed<WelcomeAction[]>(() => {
    if (!novelWorkspace.value) {
        return [
            {
                id: "assets-files",
                label: t("editorWorkbench.welcome.viewAssets"),
                description: t("editorWorkbench.welcome.viewAssetsDescription"),
                iconClass: "i-lucide-folder-tree",
                action: () => emit("open-files"),
            },
            {
                id: "profile-workbench",
                label: t("editorWorkbench.welcome.profileWorkbench"),
                description: t("editorWorkbench.welcome.profileWorkbenchDescription"),
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
        ];
    }
    return [
        {
            id: "chapter",
            label: t("editorWorkbench.welcome.newChapter"),
            description: t("editorWorkbench.welcome.newChapterDescription"),
            iconClass: "i-lucide-pen-line",
            action: () => emit("create-chapter"),
        },
        {
            id: "lorebook",
            label: t("editorWorkbench.welcome.newLorebook"),
            description: t("editorWorkbench.welcome.newLorebookDescription"),
            iconClass: "i-lucide-book-plus",
            action: () => emit("create-lorebook-entry"),
        },
        {
            id: "markdown",
            label: t("editorWorkbench.welcome.newMarkdown"),
            description: t("editorWorkbench.welcome.newMarkdownDescription"),
            iconClass: "i-lucide-file-plus-2",
            action: () => emit("create-markdown-file"),
        },
    ];
});

const primaryAction = computed<WelcomeAction | null>(() => {
    const recent = visibleTabs.value[0];
    if (novelWorkspace.value && recent) {
        return {
            id: "continue",
            label: recent.title,
            description: recent.path,
            iconClass: tabIconClass(recent),
            action: () => emit("select-tab", recent.path),
        };
    }
    return quickActions.value[0] ?? null;
});

const secondaryQuickActions = computed(() => quickActions.value.filter((action) => action.id !== primaryAction.value?.id));

function tabIconClass(tab: EditorTabPresentation): string {
    return tab.iconClass || "i-lucide-file-text";
}
</script>

<template>
    <section class="editor-welcome-root min-h-0 flex-1 overflow-y-auto bg-[var(--panel-surface)] px-4 py-5 sm:px-6 select-none">
        <div v-if="readonlyNode" class="editor-welcome-container mx-auto flex w-full max-w-[720px] flex-col gap-5">
            <div class="flex items-start gap-4 border-b border-[var(--divider)] pb-5">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-text)]">
                    <span class="i-lucide-lock-keyhole h-5 w-5" aria-hidden="true" />
                </div>
                <div class="min-w-0 flex-1">
                    <h1 class="text-lg font-semibold text-[var(--text-main)]">{{ t("editorWorkbench.welcome.uneditableTitle") }}</h1>
                    <p class="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{{ t("editorWorkbench.welcome.uneditableDescription") }}</p>
                </div>
            </div>

            <div class="rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                <div class="truncate font-mono text-[var(--text-main)]" :title="props.node?.path">{{ props.node?.path }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                    <span class="rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 py-0.5">{{ t("editorWorkbench.readonly") }}: true</span>
                    <span class="rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 py-0.5">type: {{ props.node?.entryType || "-" }}</span>
                    <span class="rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 py-0.5">{{ props.node?.isDirectory ? "directory" : "file" }}</span>
                </div>
            </div>

            <button type="button" class="welcome-row flex w-full items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer" @click="emit('open-files')">
                <span class="i-lucide-folder-tree h-5 w-5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ t("editorWorkbench.welcome.openFileTree") }}</span>
                    <span class="block truncate text-xs text-[var(--text-secondary)]">{{ t("editorWorkbench.welcome.locateNodeDescription") }}</span>
                </span>
            </button>
        </div>

        <div v-else class="editor-welcome-container mx-auto flex w-full flex-col" :class="{ 'is-compact': props.compact }">
            <header class="editor-welcome-hero flex flex-col gap-4 border-b border-[var(--divider)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0 flex-1">
                    <div class="welcome-eyebrow inline-flex items-center gap-2 text-[11px] font-bold tracking-wider text-[var(--accent-text)]">
                        <span :class="novelWorkspace ? 'i-lucide-pen-line' : 'i-lucide-folder-cog'" class="h-4 w-4" aria-hidden="true" />
                        <span>{{ t("editorWorkbench.title").toUpperCase() }}</span>
                    </div>
                    <h1 class="mt-2 text-xl sm:text-2xl font-semibold text-[var(--text-main)]">{{ welcomeTitle }}</h1>
                    <p class="mt-1.5 max-w-[680px] text-xs sm:text-sm leading-6 text-[var(--text-secondary)]">{{ welcomeDescription }}</p>
                </div>
                <div class="welcome-hero-actions flex shrink-0 flex-wrap items-center gap-2">
                    <button
                        v-if="primaryAction"
                        type="button"
                        class="welcome-primary-action inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--accent-main)] px-3.5 text-xs sm:text-sm font-semibold text-[var(--text-inverse)] shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
                        :title="primaryAction.description"
                        @click="primaryAction.action"
                    >
                        <span :class="primaryAction.iconClass" class="h-4 w-4" aria-hidden="true" />
                        <span class="max-w-[190px] truncate">{{ primaryAction.label }}</span>
                    </button>
                    <button
                        type="button"
                        class="welcome-secondary-action inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-3.5 text-xs sm:text-sm font-semibold text-[var(--text-main)] shadow-xs transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                        @click="emit('open-files')"
                    >
                        <span class="i-lucide-folder-tree h-4 w-4" aria-hidden="true" />
                        <span>{{ t("editorWorkbench.welcome.openFileTree") }}</span>
                    </button>
                </div>
            </header>

            <div class="welcome-action-grid mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                <button
                    v-for="action in secondaryQuickActions"
                    :key="action.id"
                    type="button"
                    class="welcome-action-card flex min-h-[58px] items-center gap-2.5 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="action.action"
                >
                    <span :class="action.iconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-xs sm:text-sm font-medium text-[var(--text-main)]">{{ action.label }}</span>
                        <span class="mt-0.5 block truncate text-[11px] sm:text-xs text-[var(--text-secondary)]">{{ action.description }}</span>
                    </span>
                </button>
                <button
                    v-if="novelWorkspace"
                    type="button"
                    class="welcome-action-card flex min-h-[58px] items-center gap-2.5 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="emit('open-agent-panel')"
                >
                    <span class="i-lucide-panel-right-open h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-xs sm:text-sm font-medium text-[var(--text-main)]">{{ t("editorWorkbench.welcome.openAgent") }}</span>
                        <span class="mt-0.5 block truncate text-[11px] sm:text-xs text-[var(--text-secondary)]">{{ t("editorWorkbench.welcome.openAgentDescription") }}</span>
                    </span>
                </button>
            </div>

            <section class="welcome-recent-section mt-5 flex flex-col gap-2.5">
                <div class="welcome-section-heading flex items-center justify-between gap-3">
                    <h2 class="welcome-section-title text-[11px] font-bold tracking-wider uppercase text-[var(--text-secondary)]">
                        {{ t("editorWorkbench.welcome.continueSection") }}
                    </h2>
                    <span v-if="visibleTabs.length > 0" class="welcome-section-hint text-[11px] text-[var(--text-muted)]">
                        {{ visibleTabs.length }} / 5
                    </span>
                </div>
                <div v-if="visibleTabs.length > 0" class="welcome-tab-list flex flex-col gap-2">
                    <button
                        v-for="tab in visibleTabs.slice(0, 5)"
                        :key="tab.path"
                        type="button"
                        class="welcome-tab-row flex min-h-[46px] items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-3.5 py-2 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                        :title="tab.path"
                        @click="emit('select-tab', tab.path)"
                    >
                        <span :class="tabIconClass(tab)" class="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                        <span class="min-w-0 flex-1">
                            <span
                                class="block truncate text-xs sm:text-sm font-medium text-[var(--text-main)]"
                                :class="tab.preview ? 'italic' : ''"
                            >
                                {{ tab.title }}
                            </span>
                            <span class="block truncate text-[11px] sm:text-xs text-[var(--text-secondary)]">{{ tab.path }}</span>
                        </span>
                        <span v-if="tab.dirty" class="h-2 w-2 shrink-0 rounded-full bg-[var(--status-warning)]" />
                    </button>
                </div>
                <button
                    v-else
                    type="button"
                    class="welcome-empty-row flex min-h-[46px] items-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="novelWorkspace ? emit('open-path', 'manuscript/') : emit('open-files')"
                >
                    <span class="i-lucide-arrow-right h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                    <span>{{ t("editorWorkbench.welcome.noOpenFiles") }}</span>
                </button>
            </section>
        </div>
    </section>
</template>

<style scoped>
.editor-welcome-root {
    container-type: inline-size;
}

.editor-welcome-container {
    max-width: 820px;
    gap: 1rem;
}

.editor-welcome-container.is-compact {
    max-width: 720px;
}
</style>

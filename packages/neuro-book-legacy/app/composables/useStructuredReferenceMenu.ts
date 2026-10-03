import type {Ref} from "vue";
import {computed, ref, watch} from "vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuItem,
    AgentTriggerMenuSection,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";
import type {AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-session.dto";
import type {
    PlotTreeDto,
} from "nbook/shared/dto/plot.dto";

type QuickTextItem = {
    id: string;
    label: string;
    description: string;
    iconClass: string;
    value: string;
};

type PlotThreadReferenceCandidate = {
    id: string;
    title: string;
    name: string;
    summary: string;
    isMainThread: boolean;
};

type PlotSceneReferenceCandidate = {
    id: string;
    threadId: string;
    threadTitle: string;
    title: string;
    summary: string;
};

const PLOT_RESULT_LIMIT = 20;

type RuntimeI18n = {
    t: (key: string) => string;
};

const referenceMenuFallbacks = {
    "ide.referenceMenu.currentThread": "当前线程",
    "ide.referenceMenu.currentScene": "当前场景",
    "ide.referenceMenu.referenceTitle": "引用",
    "ide.referenceMenu.lorebookTitle": "设定引用",
    "ide.referenceMenu.lorebookPathDescription": "输入 workspace 相对路径，例如 lorebook/character/苏雪/。",
    "ide.referenceMenu.threadTitle": "线程引用",
    "ide.referenceMenu.threadLoading": "加载线程中",
    "ide.referenceMenu.plotTreeLoadingDescription": "正在拉取当前小说的剧情树。",
    "ide.referenceMenu.sceneTitle": "场景引用",
    "ide.referenceMenu.sceneLoading": "加载场景中",
    "ide.referenceMenu.missingContext": "缺少上下文",
    "ide.referenceMenu.missingContextDescription": "请先选中剧情场景。",
    "ide.referenceMenu.skillTitle": "调用技能",
    "ide.referenceMenu.skillLoading": "加载技能中",
    "ide.referenceMenu.skillLoadingDescription": "正在读取当前仓库的 skills catalog。",
    "ide.referenceMenu.skillEmpty": "没有匹配技能",
    "ide.referenceMenu.skillNoMatchDescription": "当前查询没有匹配的 skill。",
    "ide.referenceMenu.skillNoneDescription": "当前仓库还没有可用的 skill。",
    "ide.referenceMenu.commandTitle": "执行命令",
    "ide.referenceMenu.plotThreadSection": "剧情线程",
    "ide.referenceMenu.plotSceneSection": "剧情场景",
    "ide.referenceMenu.plotSection": "剧情",
    "ide.referenceMenu.plotRootLoading": "加载剧情中",
    "ide.referenceMenu.noMatch": "没有匹配结果",
    "ide.referenceMenu.noReference": "暂无可引用内容",
    "ide.referenceMenu.tryAnotherKeyword": "换一个关键词试试。",
    "ide.referenceMenu.noReferenceObjects": "当前工作区没有可引用内容或剧情对象。",
    "ide.referenceMenu.commandPlanDescription": "切换 Plan Mode。",
    "ide.referenceMenu.commandCompactDescription": "压缩当前 Agent Session 上下文。",
    "ide.referenceMenu.commandClearDescription": "清空当前 Session 视图并回到空历史。",
    "ide.referenceMenu.commandNewDescription": "新建 Agent Session。",
    "ide.referenceMenu.commandRenameDescription": "手动重命名当前 Session，之后自动摘要不再改标题。",
    "ide.referenceMenu.commandSummarizeDescription": "把标题交还给自动摘要，并立即重新生成标题与摘要。",
    "ide.referenceMenu.commandSettingsDescription": "保留设置入口。",
} as const;

type ReferenceMenuKey = keyof typeof referenceMenuFallbacks;

/**
 * 结构化引用菜单会被普通单元测试直接调用；这里使用 Nuxt i18n 可用时翻译、不可用时回退中文源文案。
 */
function translateReferenceMenu(key: ReferenceMenuKey): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key) ?? referenceMenuFallbacks[key];
    } catch {
        return referenceMenuFallbacks[key];
    }
}

export interface UseStructuredReferenceMenuOptions {
    novelId: Ref<string>;
    selectedStoryThreadId: Ref<string | null>;
    selectedStorySceneId: Ref<string | null>;
    workspaceTree?: Ref<WorkspaceFileNode[]>;
}

export function useStructuredReferenceMenu(options: UseStructuredReferenceMenuOptions) {
    const t = translateReferenceMenu;
    const skillCatalog = ref<AgentSkillCatalogItemDto[]>([]);
    const loadingSkillCatalog = ref(false);
    const skillCatalogLoaded = ref(false);
    let skillCatalogRequest: Promise<void> | null = null;
    const plotTree = ref<PlotTreeDto | null>(null);
    const plotTreeLoadedNovelId = ref("");
    const loadingPlotTreeEntries = ref(false);
    const refreshVersion = ref(0);
    const commandItems = computed<QuickTextItem[]>(() => [
        {id: "command:plan", label: "plan", description: t("ide.referenceMenu.commandPlanDescription"), iconClass: "i-lucide-clipboard-list", value: "/plan"},
        {id: "command:compact", label: "compact", description: t("ide.referenceMenu.commandCompactDescription"), iconClass: "i-lucide-archive", value: "/compact"},
        {id: "command:clear", label: "clear", description: t("ide.referenceMenu.commandClearDescription"), iconClass: "i-lucide-trash", value: "/clear"},
        {id: "command:new", label: "new", description: t("ide.referenceMenu.commandNewDescription"), iconClass: "i-lucide-plus", value: "/new"},
        {id: "command:rename", label: "rename", description: t("ide.referenceMenu.commandRenameDescription"), iconClass: "i-lucide-pencil-line", value: "/rename "},
        {id: "command:summarize", label: "summarize", description: t("ide.referenceMenu.commandSummarizeDescription"), iconClass: "i-lucide-sparkles", value: "/summarize"},
        {id: "command:settings", label: "settings", description: t("ide.referenceMenu.commandSettingsDescription"), iconClass: "i-lucide-settings", value: "/settings"},
    ]);

    watch(options.novelId, () => {
        plotTree.value = null;
        plotTreeLoadedNovelId.value = "";
    });

    function matchesReferenceQuery(query: string, fields: Array<string | null | undefined>): boolean {
        const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
        if (!normalizedQuery) {
            return true;
        }

        return fields
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    }

    async function refreshSkillCatalog(): Promise<void> {
        if (skillCatalogLoaded.value) {
            return;
        }
        if (skillCatalogRequest) {
            return await skillCatalogRequest;
        }

        skillCatalogRequest = (async () => {
            loadingSkillCatalog.value = true;
            try {
                skillCatalog.value = await $fetch<AgentSkillCatalogItemDto[]>("/api/agent/skills");
                skillCatalogLoaded.value = true;
                refreshVersion.value += 1;
            } finally {
                loadingSkillCatalog.value = false;
                skillCatalogRequest = null;
            }
        })();
        return await skillCatalogRequest;
    }

    function getThreadCandidates(query: string): PlotThreadReferenceCandidate[] {
        const threadGroups = plotTree.value
            ? [...plotTree.value.phases.flatMap((phase) => phase.threads), ...plotTree.value.ungroupedThreads]
            : [];
        return threadGroups
            .filter((thread) => matchesReferenceQuery(query, [thread.id, thread.name, thread.title, thread.summary]))
            .slice(0, PLOT_RESULT_LIMIT)
            .map((thread) => ({
                id: thread.id,
                title: thread.title,
                name: thread.name,
                summary: thread.summary,
                isMainThread: thread.isMainThread,
            }));
    }

    function getSceneCandidates(query: string): PlotSceneReferenceCandidate[] {
        const threadGroups = plotTree.value
            ? [...plotTree.value.phases.flatMap((phase) => phase.threads), ...plotTree.value.ungroupedThreads]
            : [];
        return threadGroups
            .flatMap((thread) => thread.scenes.map((scene) => ({
                id: scene.id,
                threadId: thread.id,
                threadTitle: thread.title,
                title: scene.title,
                summary: scene.summary,
            })))
            .filter((scene) => matchesReferenceQuery(query, [scene.id, scene.title, scene.threadTitle, scene.summary]))
            .slice(0, PLOT_RESULT_LIMIT);
    }

    async function ensurePlotTreeLoaded(): Promise<void> {
        if (!options.novelId.value || loadingPlotTreeEntries.value || plotTreeLoadedNovelId.value === options.novelId.value) {
            return;
        }

        loadingPlotTreeEntries.value = true;
        try {
            plotTree.value = await $fetch<PlotTreeDto>(`/api/projects/plot/tree`, projectPlotOptions());
            plotTreeLoadedNovelId.value = options.novelId.value;
            refreshVersion.value += 1;
        } finally {
            loadingPlotTreeEntries.value = false;
        }
    }

    function projectPlotOptions(): {query: {projectRoot: string}} {
        return {query: {projectRoot: options.novelId.value}};
    }

    function resolveMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
        if (context.kind === "reference-root") {
            const routedContext = routeReferenceRootQuery(context.query);
            if (routedContext) {
                return resolveMenu(routedContext);
            }

            void ensurePlotTreeLoaded();
            const workspaceSections = options.workspaceTree
                ? buildWorkspaceReferenceSections(options.workspaceTree.value, context.query)
                : [];
            const plotSections = buildPlotRootSections(context.query);
            const sections = [...workspaceSections, ...plotSections];
            return {
                title: t("ide.referenceMenu.referenceTitle"),
                prefix: "@",
                sections: sections.length > 0 ? sections : [createEmptyReferenceSection(context.query)],
            };
        }

        if (context.kind === "lorebook") {
            return {
                title: t("ide.referenceMenu.lorebookTitle"),
                prefix: "",
                sections: [{
                    id: "lorebook-path",
                    items: [{
                        id: "lorebook:path",
                        label: context.query || "lorebook/",
                        description: t("ide.referenceMenu.lorebookPathDescription"),
                        iconClass: "i-lucide-library-big",
                        insertText: context.query,
                        trailingSpace: false,
                    }],
                }],
            };
        }

        if (context.kind === "thread") {
            void ensurePlotTreeLoaded();
            const threadCandidates = getThreadCandidates(context.query);
            if (loadingPlotTreeEntries.value && threadCandidates.length === 0) {
                return {title: t("ide.referenceMenu.threadTitle"), prefix: "@thread://", sections: [{id: "thread-loading", items: [{id: "thread:loading", label: t("ide.referenceMenu.threadLoading"), description: t("ide.referenceMenu.plotTreeLoadingDescription"), iconClass: "i-lucide-loader-circle animate-spin"}]}]};
            }

            const items = threadCandidates.map(toThreadMenuItem);
            return {title: t("ide.referenceMenu.threadTitle"), prefix: "@thread://", sections: items.length > 0 ? [{id: "thread", items}] : []};
        }

        if (context.kind === "scene") {
            void ensurePlotTreeLoaded();
            const sceneCandidates = getSceneCandidates(context.query);
            if (loadingPlotTreeEntries.value && sceneCandidates.length === 0) {
                return {title: t("ide.referenceMenu.sceneTitle"), prefix: "@scene://", sections: [{id: "scene-loading", items: [{id: "scene:loading", label: t("ide.referenceMenu.sceneLoading"), description: t("ide.referenceMenu.plotTreeLoadingDescription"), iconClass: "i-lucide-loader-circle animate-spin"}]}]};
            }

            const items = sceneCandidates.map(toSceneMenuItem);
            return {title: t("ide.referenceMenu.sceneTitle"), prefix: "@scene://", sections: items.length > 0 ? [{id: "scene", items}] : []};
        }

        if (context.kind === "skill") {
            if (!skillCatalogLoaded.value && !loadingSkillCatalog.value) {
                void refreshSkillCatalog();
            }
            const items = skillCatalog.value
                .filter((item) => matchesReferenceQuery(context.query, [item.name, item.description]))
                .map((item) => ({
                    id: `skill:${item.name}`,
                    label: item.name,
                    description: item.description,
                    iconClass: "i-lucide-sparkles",
                    hint: `$${item.name}`,
                    skill: {
                        name: item.name,
                    },
                }));
            if (loadingSkillCatalog.value && items.length === 0) {
                return {
                    title: t("ide.referenceMenu.skillTitle"),
                    prefix: "$",
                    sections: [{
                        id: "skill-loading",
                        items: [{
                            id: "skill:loading",
                            label: t("ide.referenceMenu.skillLoading"),
                            description: t("ide.referenceMenu.skillLoadingDescription"),
                            iconClass: "i-lucide-loader-circle animate-spin",
                        }],
                    }],
                };
            }

            if (skillCatalogLoaded.value && items.length === 0) {
                return {
                    title: t("ide.referenceMenu.skillTitle"),
                    prefix: "$",
                    sections: [{
                        id: "skill-empty",
                        items: [{
                            id: "skill:empty",
                            label: t("ide.referenceMenu.skillEmpty"),
                            description: skillCatalog.value.length > 0 ? t("ide.referenceMenu.skillNoMatchDescription") : t("ide.referenceMenu.skillNoneDescription"),
                            iconClass: "i-lucide-info",
                        }],
                    }],
                };
            }

            return {title: t("ide.referenceMenu.skillTitle"), prefix: "$", sections: items.length > 0 ? [{id: "skill", items}] : []};
        }

        const normalizedQuery = context.query.trim().toLocaleLowerCase("zh-CN");
        const items = commandItems.value
            .filter((item) => !normalizedQuery || `${item.label} ${item.description}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
            .map((item) => ({id: item.id, label: item.label, description: item.description, iconClass: item.iconClass, insertText: item.value}));
        return {title: t("ide.referenceMenu.commandTitle"), prefix: "/", sections: items.length > 0 ? [{id: "command", items}] : []};
    }

    /**
     * 显式输入 @thread:// / @scene:// 时切到对应剧情引用菜单。
     */
    function routeReferenceRootQuery(query: string): AgentTriggerMenuContext | null {
        const matched = /^(thread|scene):\/\/(.*)$/u.exec(query.trim());
        if (!matched) {
            return null;
        }
        return {
            kind: matched[1] as Extract<AgentTriggerMenuContext["kind"], "thread" | "scene">,
            query: matched[2] ?? "",
        };
    }

    /**
     * 生成 @ 根菜单里的剧情引用候选。
     */
    function buildPlotRootSections(query: string): AgentTriggerMenuSection[] {
        const sections: AgentTriggerMenuSection[] = [];
        const threadItems = getThreadCandidates(query).map(toThreadMenuItem);
        if (threadItems.length > 0) {
            sections.push({id: "plot-thread", title: t("ide.referenceMenu.plotThreadSection"), items: threadItems});
        }

        const sceneItems = getSceneCandidates(query).map(toSceneMenuItem);
        if (sceneItems.length > 0) {
            sections.push({id: "plot-scene", title: t("ide.referenceMenu.plotSceneSection"), items: sceneItems});
        }

        if (loadingPlotTreeEntries.value && threadItems.length === 0 && sceneItems.length === 0) {
            sections.push({
                id: "plot-loading",
                title: t("ide.referenceMenu.plotSection"),
                items: [{
                    id: "plot-root-loading",
                    label: t("ide.referenceMenu.plotRootLoading"),
                    description: t("ide.referenceMenu.plotTreeLoadingDescription"),
                    iconClass: "i-lucide-loader-circle animate-spin",
                    disabled: true,
                }],
            });
        }

        return sections;
    }

    /**
     * 搜索无结果时仍保留菜单，避免 Suggestion 直接关闭。
     */
    function createEmptyReferenceSection(query: string): AgentTriggerMenuSection {
        return {
            id: "empty-reference",
            items: [{
                id: "empty-reference-result",
                label: query.trim() ? t("ide.referenceMenu.noMatch") : t("ide.referenceMenu.noReference"),
                description: query.trim() ? t("ide.referenceMenu.tryAnotherKeyword") : t("ide.referenceMenu.noReferenceObjects"),
                iconClass: "i-lucide-search-x",
                disabled: true,
            }],
        };
    }

    /**
     * 转换剧情线程候选。
     */
    function toThreadMenuItem(candidate: PlotThreadReferenceCandidate): AgentTriggerMenuItem {
        return {
            id: `thread:${candidate.id}`,
            label: candidate.title,
            description: `${candidate.name}${candidate.summary ? ` · ${candidate.summary}` : ""}`,
            iconClass: candidate.isMainThread ? "i-lucide-star" : "i-lucide-git-branch-plus",
            hint: "thread",
            reference: {kind: "thread" as const, title: candidate.title, targetId: candidate.id},
        };
    }

    /**
     * 转换剧情场景候选。
     */
    function toSceneMenuItem(candidate: PlotSceneReferenceCandidate): AgentTriggerMenuItem {
        return {
            id: `scene:${candidate.id}`,
            label: candidate.title,
            description: `${candidate.threadTitle}${candidate.summary ? ` · ${candidate.summary}` : ""}`,
            iconClass: "i-lucide-clapperboard",
            hint: "scene",
            reference: {kind: "scene" as const, title: candidate.title, targetId: candidate.id},
        };
    }

    const menuRefreshKey = computed(() => [
        refreshVersion.value,
        options.workspaceTree?.value.map((node) => `${node.path}:${node.mtimeMs}`).join("|") ?? "",
        loadingSkillCatalog.value ? "lk1" : "lk0",
        skillCatalogLoaded.value ? "sk1" : "sk0",
        skillCatalog.value.length,
        loadingPlotTreeEntries.value ? "lp1" : "lp0",
        plotTreeLoadedNovelId.value,
        plotTree.value?.phases.length ?? 0,
        plotTree.value?.ungroupedThreads.length ?? 0,
    ].join("|"));

    return {
        resolveMenu,
        menuRefreshKey,
        refreshSkillCatalog,
    };
}

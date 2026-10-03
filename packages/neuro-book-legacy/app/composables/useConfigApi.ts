import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {
    ConfigAgentProfileBuildStatusDto,
    ConfigAgentProfileSettingsDto,
    ConfigBootstrapDto,
    ConfigEditorSnapshotDto,
    ConfigWorkspaceQueryDto,
    ExchangeRateDto,
    GlobalConfigUpdateDto,
    ProjectConfigDto,
} from "nbook/shared/dto/config.dto";
import type {ModelLibraryDto, ProviderTemplateLibraryDto} from "nbook/shared/dto/app-settings.dto";

type AgentProfileSettingsQueryParams = ConfigWorkspaceQueryDto & {
    scope: "global" | "project";
};

/**
 * 统一构造当前 IDE 上下文对应的 Config API 查询与保存入口。
 */
export function useConfigApi() {
    const novelIdeStore = useNovelIdeStore();
    const {t} = useI18n();

    /**
     * Workspace Root 配置查询参数。Global Config 写入时也带上当前目标，
     * 这样后端能返回对应 Project Workspace 视角的最新 editor snapshot。
     */
    function globalQuery(): ConfigWorkspaceQueryDto {
        return {workspaceKind: "user-assets"};
    }

    /**
     * 指定 Project Workspace 查询参数。
     */
    function novelProjectQuery(projectRoot: string): ConfigWorkspaceQueryDto {
        return {
            workspaceKind: "novel",
            projectRoot,
        };
    }

    /**
     * 当前设置页对应的 Workspace Root / Project Workspace 查询参数。
     *
     * 小说工作区还没完成初始化时，只能读取 Workspace Root 配置；否则会生成
     * `workspaceKind=novel` 但缺少 `projectRoot` 的无效请求。
     */
    function currentQuery(): ConfigWorkspaceQueryDto {
        if (novelIdeStore.workspaceKind === "user-assets" || !novelIdeStore.currentProjectRoot) {
            return {workspaceKind: "user-assets"};
        }
        return {
            workspaceKind: "novel",
            projectRoot: novelIdeStore.currentProjectRoot,
        };
    }

    /**
     * 当前 Project Workspace 查询参数；只有小说工作区初始化完成后才存在。
     */
    function projectQuery(): ConfigWorkspaceQueryDto {
        if (novelIdeStore.workspaceKind === "user-assets" || !novelIdeStore.currentProjectRoot) {
            throw new Error(t("composables.config.noWritableProjectWorkspace"));
        }
        return novelProjectQuery(novelIdeStore.currentProjectRoot);
    }

    /**
     * 读取设置页编辑快照。后端每次都从配置文件重新读取。
     */
    async function editorSnapshot(
        query: ConfigWorkspaceQueryDto = currentQuery(),
    ): Promise<ConfigEditorSnapshotDto> {
        return $fetch<ConfigEditorSnapshotDto>("/api/config/editor-snapshot", {
            query,
        });
    }

    /**
     * 读取 Agent Profile settings 专用快照。
     */
    async function agentProfileSettings(
        query: ConfigWorkspaceQueryDto = currentQuery(),
        scope: "global" | "project" = "global",
    ): Promise<ConfigAgentProfileSettingsDto> {
        return $fetch<ConfigAgentProfileSettingsDto>("/api/agent/profiles/settings", {
            query: {
                ...query,
                scope,
            } satisfies AgentProfileSettingsQueryParams,
        });
    }

    /**
     * 读取 Agent Profile 编译/加载状态。
     */
    async function agentProfileBuildStatus(): Promise<ConfigAgentProfileBuildStatusDto> {
        return $fetch<ConfigAgentProfileBuildStatusDto>("/api/agent/profiles/build-status");
    }

    /**
     * 读取首页与 Agent 抽屉所需的轻量配置。
     */
    async function bootstrap(query: ConfigWorkspaceQueryDto = currentQuery()): Promise<ConfigBootstrapDto> {
        return $fetch<ConfigBootstrapDto>("/api/config/bootstrap", {
            query,
        });
    }

    /**
     * 保存 Workspace Root `.nbook/config.json` 并返回后端重新合并后的快照。
     */
    async function saveGlobal(
        update: GlobalConfigUpdateDto,
        query: ConfigWorkspaceQueryDto = currentQuery(),
    ): Promise<ConfigEditorSnapshotDto> {
        const snapshot = await $fetch<ConfigEditorSnapshotDto>("/api/config/global", {
            method: "PUT",
            query,
            body: update,
        });
        novelIdeStore.bumpConfigRevision();
        return snapshot;
    }

    /**
     * 保存 Project Workspace `.nbook/config.json` 并返回后端重新合并后的快照。
     */
    async function saveProject(
        project: ProjectConfigDto,
        query: ConfigWorkspaceQueryDto = projectQuery(),
    ): Promise<ConfigEditorSnapshotDto> {
        const snapshot = await $fetch<ConfigEditorSnapshotDto>("/api/config/project", {
            method: "PUT",
            query,
            body: project,
        });
        novelIdeStore.bumpConfigRevision();
        return snapshot;
    }

    /**
     * 重置 Project Workspace 中指定 profile 的 profile home，并返回完整 Agent Profile settings 快照。
     */
    async function resetProfileHome(
        profileKey: string,
        query: ConfigWorkspaceQueryDto = projectQuery(),
    ): Promise<ConfigEditorSnapshotDto> {
        const snapshot = await $fetch<ConfigEditorSnapshotDto>("/api/config/profile-home/reset", {
            method: "POST",
            query,
            body: {profileKey},
        });
        novelIdeStore.bumpConfigRevision();
        return snapshot;
    }

    /** 读取 NeuroBook Model Library。 */
    async function modelLibrary(): Promise<ModelLibraryDto> {
        return $fetch<ModelLibraryDto>("/api/config/models/library");
    }

    /** 读取 NeuroBook Provider Template Library。 */
    async function providerTemplates(): Promise<ProviderTemplateLibraryDto> {
        return $fetch<ProviderTemplateLibraryDto>("/api/config/models/provider-templates");
    }

    /**
     * 读取费用显示用汇率；后端负责缓存和 Frankfurter 访问。
     */
    async function exchangeRate(): Promise<ExchangeRateDto> {
        return $fetch<ExchangeRateDto>("/api/config/exchange-rate", {
            query: {
                base: "USD",
                quote: "CNY",
            },
        });
    }

    return {
        globalQuery,
        novelProjectQuery,
        currentQuery,
        projectQuery,
        bootstrap,
        editorSnapshot,
        agentProfileSettings,
        agentProfileBuildStatus,
        saveGlobal,
        saveProject,
        resetProfileHome,
        modelLibrary,
        providerTemplates,
        exchangeRate,
    };
}

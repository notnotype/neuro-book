import {computed, ref, watch, type ComputedRef, type Ref} from "vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {candidateFromLibrary, completeModelCandidate} from "nbook/app/components/novel-ide/settings/model-draft-factory";
import {parseDraftInteger, type ModelSettingsModelDraft, type ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {DiscoveryListModel, ManualModelDraft, ModelLibraryGroup} from "nbook/app/components/novel-ide/settings/model-settings-view";
import type {ConfiguredModelDto, DiscoveryDiagnosticsDto, DiscoverProviderModelsResponseDto, DiscoveredProviderModelDto, ModelLibraryDto, ModelLibraryEntryDto, ModelProviderDraftDto, ProviderCredentialSource} from "nbook/shared/dto/app-settings.dto";
import {deriveModelGroup} from "nbook/shared/models/model-group";

type ModelDiscoverySessionOptions = {
    activeProvider: ComputedRef<ModelSettingsProviderDraft | null>;
    modelLibrary: Ref<ModelLibraryDto | null>;
    loadLibraries(): Promise<ModelLibraryDto>;
    findLibraryModel(modelId: string): ModelLibraryEntryDto | null;
    buildProviderRequest(provider: ModelSettingsProviderDraft): ModelProviderDraftDto;
    credentialSource(provider: ModelSettingsProviderDraft): ProviderCredentialSource;
    enableModel(model: ConfiguredModelDto): void;
    disableModel(model: ModelSettingsModelDraft): void;
    openTransientCandidate(candidate: Omit<ConfiguredModelDto, "enabled">): Promise<void>;
    ensureDefaultModel(): void;
};

type DiscoveryCacheEntry = {
    providerId: string;
    fingerprint: string;
    models: DiscoveredProviderModelDto[];
    diagnostics: DiscoveryDiagnosticsDto;
};

/**
 * 管理 Automatic Model Discovery 的前端临时会话。
 * 发现结果、搜索和手动候选均不会进入 Provider Config，只有调用 enableModel 后才持久化为草稿。
 */
export function useModelDiscoverySession(options: ModelDiscoverySessionOptions) {
    const {t} = useI18n();
    const notification = useNotification();
    /** 发现结果按本地 Provider 实例和连接 fingerprint 缓存，不能只按可编辑 ID。 */
    const discoveredModels = ref<Record<string, DiscoveryCacheEntry>>({});
    const manualDrafts = ref<Record<string, ManualModelDraft>>({});
    const discoveringProviderId = ref("");
    const discoveryDialogOpen = ref(false);
    const modelLibraryDialogOpen = ref(false);
    const discoverySearchQuery = ref("");
    const modelLibrarySearchQuery = ref("");
    const discoveryExpandedGroups = ref<Record<string, boolean>>({});
    const modelLibraryExpandedGroups = ref<Record<string, boolean>>({});
    /** Secret/Header 内容不进入 fingerprint；本地 revision 只用于在连接输入编辑后作废发现缓存。 */
    const credentialRevisions = ref<Record<string, number>>({});
    const credentialSnapshots = new Map<string, string>();
    /** requestOptions 可能包含影响模型目录的额外 Header；只记录 revision，不把 Header 内容放进 fingerprint。 */
    const requestOptionsRevisions = ref<Record<string, number>>({});
    const requestOptionsSnapshots = new Map<string, string>();

    /** 获取指定 Provider 的手动候选草稿。 */
    function manualDraft(providerId: string): ManualModelDraft {
        if (!manualDrafts.value[providerId]) {
            manualDrafts.value[providerId] = emptyManualDraft();
        }
        return manualDrafts.value[providerId];
    }

    /** 更新当前 Provider 的手动候选字段。 */
    function updateManualField(field: keyof ManualModelDraft, value: string): void {
        const provider = options.activeProvider.value;
        if (provider) {
            manualDraft(provider.id)[field] = value;
        }
    }

    /** 使用当前连接执行一次 Automatic Model Discovery。 */
    async function discover(): Promise<void> {
        const provider = options.activeProvider.value;
        if (!provider || discoveringProviderId.value) {
            return;
        }
        if (!provider.modelApi.trim()) {
            notification.error(t("settings.panels.models.providerModelApiRequired"));
            return;
        }
        discoveringProviderId.value = provider.id;
        try {
            await options.loadLibraries();
            const credentialRevision = credentialRevisions.value[provider.localKey] ?? 0;
            const requestOptionsRevision = requestOptionsRevisions.value[provider.localKey] ?? 0;
            const requestFingerprint = discoveryFingerprint(provider, credentialRevision, requestOptionsRevision);
            const providerRequest = options.buildProviderRequest(provider);
            const credentialSource = options.credentialSource(provider);
            const response = await $fetch<DiscoverProviderModelsResponseDto>("/api/config/models/provider-discover", {
                method: "POST",
                body: {
                    provider: providerRequest,
                    credentialSource,
                },
            });
            discoveredModels.value = {
                ...discoveredModels.value,
                [provider.localKey]: {
                    providerId: providerRequest.id,
                    fingerprint: requestFingerprint,
                    models: response.models,
                    diagnostics: response.diagnostics,
                },
            };
            if (response.diagnostics.partial) {
                notification.warning(discoveryDiagnosticsMessage(response.diagnostics, t));
            } else {
                notification.success(response.message);
            }
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.discoverFailed")));
        } finally {
            discoveringProviderId.value = "";
        }
    }

    /** 手动候选经统一补全后加入 Provider Config，或进入临时编辑器。 */
    function addManualModel(): void {
        const provider = options.activeProvider.value;
        if (!provider) {
            return;
        }
        const draft = manualDraft(provider.id);
        if (!draft.name.trim() || !draft.id.trim()) {
            notification.error(t("settings.panels.models.manualRequired"));
            return;
        }
        const discovered: DiscoveredProviderModelDto = {
            name: draft.name,
            id: draft.id,
            api: draft.api || null,
            group: draft.group || null,
            reasoning: null,
            input: null,
            contextWindowTokens: parseDraftInteger(draft.contextWindowTokens),
            maxTokens: parseDraftInteger(draft.maxTokens),
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
        };
        const completed = completeModelCandidate(discovered, options.findLibraryModel(draft.id), provider.modelApi.trim() || null);
        manualDrafts.value = {...manualDrafts.value, [provider.id]: emptyManualDraft()};
        if (completed.status === "complete") {
            options.enableModel(completed.model);
            notification.success(t("settings.panels.models.manualAdded"));
        } else {
            void options.openTransientCandidate(completed.candidate);
        }
    }

    /** 读取远程发现模型在当前 Provider Config 中的保存状态。 */
    function savedState(modelId: string): "enabled" | "disabled" | "missing" {
        const existing = options.activeProvider.value?.models.find((model) => model.id === modelId);
        return existing ? (existing.enabled ? "enabled" : "disabled") : "missing";
    }

    /** Automatic Model Discovery Dialog 的当前会话分组。 */
    const discoveryGroups = computed(() => {
        const provider = options.activeProvider.value;
        if (!provider) {
            return [];
        }
        const models = new Map<string, DiscoveryListModel>();
        const cache = discoveredModels.value[provider.localKey];
        const remoteModels = cache?.fingerprint === discoveryFingerprint(
            provider,
            credentialRevisions.value[provider.localKey] ?? 0,
            requestOptionsRevisions.value[provider.localKey] ?? 0,
        ) ? cache.models : [];
        for (const remote of remoteModels) {
            const completed = completeModelCandidate(remote, options.findLibraryModel(remote.id), provider.modelApi.trim() || null);
            const state = savedState(remote.id);
            models.set(remote.id, {
                name: remote.name,
                id: remote.id,
                group: remote.group || deriveModelGroup(remote.id),
                state: state === "enabled" ? "enabled" : state === "disabled" ? "disabled" : completed.status === "complete" ? "remote-complete" : "remote-incomplete",
                ...(completed.status === "complete" ? {completeModel: completed.model} : {incompleteCandidate: completed.candidate}),
            });
        }
        return groupDiscoveryModels([...models.values()], discoverySearchQuery.value);
    });

    /** 当前连接对应的发现诊断；连接或凭据变化后与模型结果一起失效。 */
    const discoveryDiagnostics = computed<DiscoveryDiagnosticsDto | null>(() => {
        const provider = options.activeProvider.value;
        if (!provider) {
            return null;
        }
        const cache = discoveredModels.value[provider.localKey];
        return cache?.fingerprint === discoveryFingerprint(
            provider,
            credentialRevisions.value[provider.localKey] ?? 0,
            requestOptionsRevisions.value[provider.localKey] ?? 0,
        )
            ? cache.diagnostics
            : null;
    });

    /** 切换发现列表模型的启用状态，或打开不完整候选编辑器。 */
    function toggleDiscoveredModel(model: DiscoveryListModel): void {
        const provider = options.activeProvider.value;
        const existing = provider?.models.find((item) => item.id === model.id);
        if (model.state === "enabled" && existing) {
            options.disableModel(existing);
            return;
        }
        if (model.state === "disabled" && existing) {
            existing.enabled = true;
            options.ensureDefaultModel();
            return;
        }
        if (model.completeModel) {
            options.enableModel(model.completeModel);
        } else if (model.incompleteCandidate) {
            void options.openTransientCandidate(model.incompleteCandidate);
        }
    }

    /** 独立 Model Library Dialog 的搜索分组。 */
    const modelLibraryGroups = computed<ModelLibraryGroup[]>(() => {
        const query = modelLibrarySearchQuery.value.trim().toLowerCase();
        if (!options.activeProvider.value || !options.modelLibrary.value) {
            return [];
        }
        const groups = new Map<string, ModelLibraryEntryDto[]>();
        for (const model of options.modelLibrary.value.models) {
            if (query && !model.id.toLowerCase().includes(query) && !model.name.toLowerCase().includes(query)) {
                continue;
            }
            const values = groups.get(model.source) ?? [];
            values.push(model);
            groups.set(model.source, values);
        }
        return [...groups.entries()]
            .map(([group, models]) => ({group, models: [...models].sort((left, right) => left.id.localeCompare(right.id))}))
            .sort((left, right) => left.group.localeCompare(right.group));
    });

    const enabledModelIds = computed(() => new Set(options.activeProvider.value?.models.filter((model) => model.enabled).map((model) => model.id) ?? []));

    /** 从 Model Library 显式添加或停用模型。 */
    function toggleLibraryModel(model: ModelLibraryEntryDto): void {
        const provider = options.activeProvider.value;
        const existing = provider?.models.find((item) => item.id === model.id);
        if (existing) {
            existing.enabled = !existing.enabled;
            options.ensureDefaultModel();
            return;
        }
        const candidate = candidateFromLibrary(model, provider?.modelApi.trim() || null);
        if (candidate.status === "complete") {
            options.enableModel(candidate.model);
        } else {
            void options.openTransientCandidate(candidate.candidate);
        }
    }

    /** 打开独立 Model Library Dialog。 */
    async function openModelLibrary(): Promise<void> {
        try {
            await options.loadLibraries();
            modelLibraryDialogOpen.value = true;
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
        }
    }

    /** Provider ID 变化时迁移当前前端发现会话。 */
    /**
     * Provider ID 已是不可变连接身份；该函数仅保留旧调用面的状态迁移能力，
     * 实际缓存键使用 localKey，避免不同连接因同名 ID 串结果。
     */
    function renameProvider(_previousId: string, _nextId: string): void {
        // 不迁移缓存：ID 变更必须由显式 clone 产生新的 localKey 和 fingerprint。
    }

    /** 删除 Provider 对应的全部临时发现状态。 */
    function removeProvider(providerId: string): void {
        const next = {...discoveredModels.value};
        for (const [localKey, entry] of Object.entries(next)) {
            if (entry.providerId === providerId) {
                delete next[localKey];
            }
        }
        discoveredModels.value = next;
        delete manualDrafts.value[providerId];
    }

    /** 清空临时发现会话；保存成功时可以保留当前结果。 */
    function reset(preserveResults = false): void {
        if (!preserveResults) {
            discoveredModels.value = {};
            manualDrafts.value = {};
        }
        discoveringProviderId.value = "";
    }

    watch(() => options.activeProvider.value?.id ?? "", (providerId) => {
        if (providerId) {
            manualDraft(providerId);
        }
    });

    watch(() => {
        const provider = options.activeProvider.value;
        return provider ? {
            localKey: provider.localKey,
            credential: JSON.stringify({
                apiKey: provider.options.apiKey,
                configured: provider.options.apiKeyConfigured,
                cleared: provider.options.apiKeyCleared,
            }),
            requestOptions: provider.options.requestOptions,
        } : null;
    }, (current) => {
        if (!current) {
            return;
        }
        const previous = credentialSnapshots.get(current.localKey);
        credentialSnapshots.set(current.localKey, current.credential);
        if (previous !== undefined && previous !== current.credential) {
            credentialRevisions.value = {
                ...credentialRevisions.value,
                [current.localKey]: (credentialRevisions.value[current.localKey] ?? 0) + 1,
            };
        }
        const previousRequestOptions = requestOptionsSnapshots.get(current.localKey);
        requestOptionsSnapshots.set(current.localKey, current.requestOptions);
        if (previousRequestOptions !== undefined && previousRequestOptions !== current.requestOptions) {
            requestOptionsRevisions.value = {
                ...requestOptionsRevisions.value,
                [current.localKey]: (requestOptionsRevisions.value[current.localKey] ?? 0) + 1,
            };
        }
    }, {immediate: true});

    return {
        discoveringProviderId,
        discoveryDialogOpen,
        modelLibraryDialogOpen,
        discoverySearchQuery,
        modelLibrarySearchQuery,
        discoveryExpandedGroups,
        modelLibraryExpandedGroups,
        discoveryGroups,
        discoveryDiagnostics,
        modelLibraryGroups,
        enabledModelIds,
        manualDraft,
        updateManualField,
        discover,
        addManualModel,
        toggleDiscoveredModel,
        toggleLibraryModel,
        openModelLibrary,
        renameProvider,
        removeProvider,
        reset,
    };
}

function discoveryDiagnosticsMessage(
    diagnostics: DiscoveryDiagnosticsDto,
    translate: (key: string, params?: Record<string, unknown>) => string,
): string {
    return translate("settings.panels.models.discoveryPartial", {
        skipped: diagnostics.skippedCount,
        duplicates: diagnostics.duplicateCount,
        truncated: diagnostics.truncated ? translate("settings.panels.models.discoveryTruncated") : "",
    });
}

/** 创建空手动候选。 */
function emptyManualDraft(): ManualModelDraft {
    return {name: "", id: "", api: "", group: "", contextWindowTokens: "", maxTokens: ""};
}

/** 生成不含 API key 的前端发现 fingerprint。 */
function discoveryFingerprint(provider: ModelSettingsProviderDraft, credentialRevision: number, requestOptionsRevision: number): string {
    return JSON.stringify({
        id: provider.id.trim(),
        modelApi: provider.modelApi.trim() || null,
        baseURL: normalizeDiscoveryEndpoint(provider.options.baseURL),
        proxy: normalizeDiscoveryEndpoint(provider.options.proxy),
        credentialRevision,
        requestOptionsRevision,
        apiKeyState: provider.options.apiKeyCleared
            ? "cleared"
            : provider.options.apiKey.trim()
                ? "provided"
                : provider.options.apiKeyConfigured
                    ? "saved"
                    : "empty",
    });
}

function normalizeDiscoveryEndpoint(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        return "";
    }
    try {
        const url = new URL(normalized);
        url.username = "";
        url.password = "";
        url.hash = "";
        if (url.pathname.length > 1) {
            url.pathname = url.pathname.replace(/\/+$/u, "");
        }
        return url.toString();
    } catch {
        return normalized;
    }
}

/** 按搜索和 Group 归并发现候选。 */
function groupDiscoveryModels(models: DiscoveryListModel[], queryText: string) {
    const query = queryText.trim().toLowerCase();
    const groups = new Map<string, DiscoveryListModel[]>();
    for (const model of models) {
        if (query && !model.name.toLowerCase().includes(query) && !model.id.toLowerCase().includes(query)) {
            continue;
        }
        const values = groups.get(model.group) ?? [];
        values.push(model);
        groups.set(model.group, values);
    }
    return [...groups.entries()]
        .map(([group, values]) => ({group, models: [...values].sort((left, right) => left.id.localeCompare(right.id))}))
        .sort((left, right) => left.group.localeCompare(right.group));
}

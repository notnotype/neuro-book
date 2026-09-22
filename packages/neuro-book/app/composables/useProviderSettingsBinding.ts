import {computed, onScopeDispose, ref, watch, type Ref} from "vue";
import {useI18n} from "vue-i18n";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {clearModelCostDraft, createModelCostDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-model-cost-draft";
import {candidateFromLibrary, requiredModelFields} from "nbook/app/components/novel-ide/settings/sections/providers/provider-model-draft-factory";
import {parseDraftInteger, parseModelInput, parseModelReasoning, type ModelSettingsModelDraft, type ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-settings-draft";
import type {ManualModelDraft, ModelApiOption, SavedModelGroupView} from "nbook/app/components/novel-ide/settings/sections/providers/provider-view-types";
import {useModelCheckSession} from "nbook/app/components/novel-ide/settings/useModelCheckSession";
import {useModelDiscoverySession} from "nbook/app/components/novel-ide/settings/useModelDiscoverySession";
import {useModelSettingsDraftSession, type ModelSettingsPanelProps, type ModelSettingsScope} from "nbook/app/components/novel-ide/settings/useModelSettingsDraftSession";
import {useProviderTemplateSession} from "nbook/app/components/novel-ide/settings/useProviderTemplateSession";
import type {ModelInputKind, ModelLibraryDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigWorkspaceQueryDto} from "nbook/shared/dto/config.dto";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";

/** 防抖写回窗口：与其它区段的自动保存同档。 */
const SAVE_DEBOUNCE_MS = 500;

export type ProviderSettingsBindingOptions = {
    scope: () => ModelSettingsScope;
    targetQuery: () => ConfigWorkspaceQueryDto;
    targetLabel: () => string;
    /** 区段真的被打开时才取数：没进过的区段不发请求，进过之后切作用域才重新读取。 */
    enabled: () => boolean;
};

const MODEL_API_OPTIONS: ModelApiOption[] = [
    {value: "openai-completions", label: "OpenAI Completions", description: "OpenAI-compatible Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API"},
    {value: "anthropic-messages", label: "Anthropic Messages", description: "Anthropic Claude Messages"},
    {value: "google-generative-ai", label: "Google Generative AI", description: "Gemini / Google GenAI"},
    {value: "bedrock-converse-stream", label: "Bedrock Converse", description: "AWS Bedrock Converse Stream"},
];

/**
 * 模型区段的宿主侧绑定：四个会话（草稿 / 检查 / 发现 / 模板）在这里组装，
 * 并把它们的字段与动作一对一映射成 `ProviderSettingsView` 的 props / emits。
 *
 * 视图自身不读 store、不发请求；会话里已有的 `save()` 是唯一写回入口，
 * 宿主侧的自动保存只是给它套了一层防抖——保存时机变了，写回语义没变。
 */
export function useProviderSettingsBinding(options: ProviderSettingsBindingOptions) {
    const {t} = useI18n();
    const notification = useNotification();
    const panelProps: ModelSettingsPanelProps = {
        get scope() {
            return options.scope();
        },
        get targetQuery() {
            return options.targetQuery();
        },
        get targetLabel() {
            return options.targetLabel();
        },
    };

    // 会话之间互相回调：先占位，会话创建后填真身（与旧面板同一套做法）。
    let loadLibraries: () => Promise<ModelLibraryDto> = async () => ({models: []});
    let resetChecks = (): void => undefined;
    let cancelProviderChecks = (_provider: ModelSettingsProviderDraft, _clearBatch: boolean): void => undefined;
    let cancelModelCheck = (_provider: ModelSettingsProviderDraft, _model: ModelSettingsModelDraft): void => undefined;
    let resetDiscovery = (_preserveResults: boolean): void => undefined;
    let renameDiscovery = (_previousId: string, _nextId: string): void => undefined;
    let removeDiscovery = (_providerId: string): void => undefined;

    const draftSession = useModelSettingsDraftSession({
        props: panelProps,
        loadLibraries: () => loadLibraries(),
        resetChecks: () => resetChecks(),
        cancelProviderChecks: (provider, clearBatch) => cancelProviderChecks(provider, clearBatch),
        cancelModelCheck: (provider, model) => cancelModelCheck(provider, model),
        resetDiscovery: (preserveResults) => resetDiscovery(preserveResults),
        renameDiscovery: (previousId, nextId) => renameDiscovery(previousId, nextId),
        removeDiscovery: (providerId) => removeDiscovery(providerId),
    });
    const {
        loading,
        saving,
        activeProviderKey,
        draft,
        activeProvider,
        deleteProviderDialogOpen,
        validationDialogOpen,
        repairingModels,
        dirty,
        validationState,
        validationIssues,
        validationIssueDetails,
        enabledModelGroups,
        disabledModels,
        createProviderKey,
        cloneModel,
        buildProviderRequest,
        buildModelDraft: buildModelCheckDraft,
        credentialSource,
        ensureDefaultModel: ensureDefaultModelKey,
        clearActiveProviderApiKey,
        toggleActiveProviderEnabled,
        renameActiveProviderId,
        cloneActiveProviderConnection,
        requestDeleteActiveProvider,
        confirmDeleteActiveProvider,
        enableModel,
        disableModel,
        deleteModel,
        savedModelIssues,
        displayedContextWindow: resolveDisplayedContextWindow,
        repair: repairModelSettings,
        load: loadSettings,
        saveResult: saveSettingsResult,
    } = draftSession;

    const templateSession = useProviderTemplateSession({
        draft,
        activeProviderKey,
        createProviderKey,
        cloneModel,
        ensureDefaultModel: ensureDefaultModelKey,
    });
    const {
        modelLibrary: modelLibraryData,
        selectedTemplate,
        templateOptions: providerTemplateOptions,
        load: loadModelLibraries,
        findModel: findLibraryModel,
        addProvider,
    } = templateSession;
    loadLibraries = loadModelLibraries;

    const editingModel = ref<ModelSettingsModelDraft | null>(null);
    const editingTransientCandidate = ref(false);
    const modelEditDialogOpen = ref(false);

    /** 打开已保存模型编辑器。 */
    async function openModelEdit(model: ModelSettingsModelDraft): Promise<void> {
        editingTransientCandidate.value = false;
        editingModel.value = model;
        try {
            await loadModelLibraries();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
        } finally {
            modelEditDialogOpen.value = true;
        }
    }

    /** 只有能力完整的临时候选才能进入 Provider Config。 */
    function confirmTransientCandidate(): void {
        const model = editingModel.value;
        if (!editingTransientCandidate.value || !model) {
            return;
        }
        try {
            const candidate = buildModelCheckDraft(model);
            const missingFields = requiredModelFields(candidate);
            if (missingFields.length > 0) {
                notification.error(t("settings.panels.models.transientMissingFields", {fields: missingFields.join(", ")}));
                return;
            }
            enableModel({...candidate, enabled: true});
        } catch (error) {
            notification.error(error instanceof Error ? error.message : String(error));
            return;
        }
        editingTransientCandidate.value = false;
        editingModel.value = null;
        modelEditDialogOpen.value = false;
        notification.success(t("settings.panels.models.manualAdded"));
    }

    /** 用 Model Library 补齐通用能力，不覆盖 Provider 专属字段。 */
    function reapplyLibraryModel(model: ModelSettingsModelDraft): void {
        const libraryModel = findLibraryModel(model.id);
        if (!libraryModel) {
            notification.warning(t("settings.panels.models.noLibraryMetadata"));
            return;
        }
        const completed = candidateFromLibrary(libraryModel, model.api.trim() || activeProvider.value?.modelApi.trim() || null);
        const replacement = completed.status === "complete" ? completed.model : {...completed.candidate, enabled: model.enabled};
        const libraryDraft = cloneModel(replacement);
        Object.assign(model, {
            api: libraryDraft.api,
            reasoning: libraryDraft.reasoning,
            input: libraryDraft.input,
            maxTokens: libraryDraft.maxTokens,
            thinkingLevelMap: libraryDraft.thinkingLevelMap,
            contextWindowTokens: libraryDraft.contextWindowTokens,
        });
    }

    /** 切换模型输入能力。 */
    function toggleModelInput(model: ModelSettingsModelDraft, inputKind: ModelInputKind): void {
        const values = parseModelInput(model.input) ?? [];
        model.input = values.includes(inputKind) ? values.filter((item) => item !== inputKind).join(",") : [...values, inputKind].join(",");
    }

    function resetModelCost(model: ModelSettingsModelDraft): void {
        clearModelCostDraft(model.cost);
    }

    function enableModelCostOverride(model: ModelSettingsModelDraft): void {
        model.cost = createModelCostDraft({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: []});
    }

    function displayModelApi(model: ModelSettingsModelDraft): string {
        return model.api.trim() || t("settings.panels.models.notConfigured");
    }

    function displayModelApiSource(model: ModelSettingsModelDraft): string {
        return model.api.trim() ? t("settings.panels.models.modelApiSourceModel") : t("settings.panels.models.modelApiSourceMissing");
    }

    const checkSession = useModelCheckSession({
        activeProvider,
        runnableModelKeys: computed(() => validationState.value.runnableModelKeys),
        buildProviderRequest,
        buildModelDraft: buildModelCheckDraft,
        credentialSource,
    });
    const {
        activeCheckingCount: activeProviderCheckingModelCount,
        checkingAll: checkingAllModels,
        runnable: modelDraftRunnable,
        result: modelCheckResult,
        isChecking: isModelChecking,
        checkModel,
        checkAll: checkAllActiveProviderModels,
        cancelActiveProvider: cancelActiveProviderChecks,
        cancelActiveModel: cancelActiveModelCheck,
        reset: resetModelChecks,
    } = checkSession;

    const discoverySession = useModelDiscoverySession({
        activeProvider,
        modelLibrary: modelLibraryData,
        loadLibraries: loadModelLibraries,
        findLibraryModel,
        buildProviderRequest,
        credentialSource,
        enableModel,
        disableModel,
        openTransientCandidate: async (candidate) => {
            editingTransientCandidate.value = true;
            editingModel.value = cloneModel({...candidate, enabled: true});
            try {
                await loadModelLibraries();
            } catch (error) {
                notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
            } finally {
                modelEditDialogOpen.value = true;
            }
        },
        ensureDefaultModel: ensureDefaultModelKey,
    });
    const {
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
        discover: discoverModels,
        addManualModel,
        toggleDiscoveredModel,
        toggleLibraryModel,
        openModelLibrary,
        reset: resetDiscoverySession,
        renameProvider: renameDiscoveryProvider,
        removeProvider: removeDiscoveryProvider,
    } = discoverySession;
    resetChecks = resetModelChecks;
    cancelProviderChecks = () => cancelActiveProviderChecks();
    cancelModelCheck = (_provider, model) => cancelActiveModelCheck(model);
    resetDiscovery = resetDiscoverySession;
    renameDiscovery = renameDiscoveryProvider;
    removeDiscovery = removeDiscoveryProvider;

    const editingLibraryModel = computed(() => editingModel.value ? findLibraryModel(editingModel.value.id) : null);
    const editingModelMissingFields = computed(() => {
        const model = editingModel.value;
        if (!model) {
            return [];
        }
        // JSON 字段允许在编辑中暂时非法；缺失能力检查只解析基础字段，避免输入半截 JSON 时让弹窗抛错。
        return requiredModelFields({
            api: model.api.trim() || null,
            reasoning: parseModelReasoning(model.reasoning),
            input: parseModelInput(model.input),
            contextWindowTokens: parseDraftInteger(model.contextWindowTokens),
            maxTokens: parseDraftInteger(model.maxTokens),
        });
    });

    const savedModelGroups = computed<SavedModelGroupView[]>(() => {
        const provider = activeProvider.value;
        if (!provider) {
            return [];
        }
        return enabledModelGroups.value.map((group) => ({
            group: group.group,
            models: group.models.map((model) => ({
                model,
                apiLabel: displayModelApi(model),
                apiSourceLabel: displayModelApiSource(model),
                contextWindowLabel: resolveDisplayedContextWindow(provider.id, model),
                issues: savedModelIssues(provider.id, model.id),
                checkResult: modelCheckResult(provider, model),
                checking: isModelChecking(provider, model),
                runnable: modelDraftRunnable(provider, model),
            })),
        }));
    });

    function toggleExpandedGroup(record: Ref<Record<string, boolean>>, group: string): void {
        record.value[group] = !record.value[group];
    }

    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 会话是否真的读过配置。没读过时草稿只是空壳，`dirty` 会误判为真——
     * 这时写回等于把空 models 段覆盖到真配置上，所以读之前一律不写。
     */
    const hasLoaded = ref(false);

    /**
     * 用户是否真的改过东西。会话的 `dirty` 是「草稿与快照文本不同」的派生判断，
     * 归一化差异也会让它为真；切档前 flush 只看它，就会把没改过的配置写回去。
     * 所以写回的准入条件是「用户改过」，而不是「会话算出来脏」。
     */
    let userDirty = false;

    function cancelScheduledSave(): void {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
    }

    async function persist(): Promise<void> {
        const saved = await saveSettingsResult(null);
        if (saved) {
            userDirty = false;
        } else if (dirty.value) {
            // 保存失败走系统通知：视图没有内联保存状态了。
            notification.error(t("settings.panels.models.saveFailed"));
        }
    }

    /** 读取 Provider 配置；成功后草稿才算「可写」。 */
    async function loadProviderSettings(): Promise<void> {
        await loadSettings();
        hasLoaded.value = true;
    }

    /** 视图每次改动后调用：这是「用户改过」的唯一入口，同时安排一次防抖写回。 */
    function scheduleSave(): void {
        userDirty = true;
        if (!hasLoaded.value) {
            return;
        }
        cancelScheduledSave();
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void persist();
        }, SAVE_DEBOUNCE_MS);
    }

    /** 切区段、切作用域前立即写一次（跳过防抖）；没读过配置或用户没改过就什么都不写。 */
    async function flushSave(): Promise<void> {
        cancelScheduledSave();
        if (!hasLoaded.value || !userDirty) {
            return;
        }
        await persist();
    }

    watch(modelEditDialogOpen, (open) => {
        if (!open && editingTransientCandidate.value) {
            editingTransientCandidate.value = false;
            editingModel.value = null;
        }
    });

    let loadedKey = "";

    /** 当前作用域 + 配置目标：换目标才需要重读，单纯重新进入区段不需要（草稿还在）。 */
    function providerTargetKey(): string {
        return `${options.scope()}:${JSON.stringify(options.targetQuery())}`;
    }

    // 区段没打开过就不发请求；只有配置目标真的变了才重读——重新进入区段时草稿还在，
    // 重读会让表单先被占位替换一次（肉眼就是「闪一下」）。
    watch(
        [
            () => options.enabled(),
            () => options.enabled() ? providerTargetKey() : "",
        ],
        ([enabled]) => {
            if (!enabled) {
                return;
            }
            const key = providerTargetKey();
            if (loadedKey === key) {
                return;
            }
            loadedKey = key;
            void loadProviderSettings();
        },
        {immediate: true},
    );

    const viewBindings = computed(() => ({
        draft: draft.value,
        isProjectScope: panelProps.scope === "project",
        targetLabel: panelProps.targetLabel ?? "",
        loading: loading.value,
        saving: saving.value,
        validationIssues: validationIssues.value,
        validationIssueDetails: validationIssueDetails.value,
        repairingModels: repairingModels.value,
        savedModelGroups: savedModelGroups.value,
        disabledModels: disabledModels.value,
        activeProviderKey: activeProviderKey.value,
        activeProviderCheckingModelCount: activeProviderCheckingModelCount.value,
        checkingAllModels: checkingAllModels.value,
        discoveringProviderId: discoveringProviderId.value,
        modelApiOptions: MODEL_API_OPTIONS,
        providerTemplates: providerTemplateOptions.value,
        selectedTemplate: selectedTemplate.value,
        maxRetriesPlaceholder: DEFAULT_PI_MAX_RETRIES,
        validationDialogOpen: validationDialogOpen.value,
        deleteProviderDialogOpen: deleteProviderDialogOpen.value,
        modelEditDialogOpen: modelEditDialogOpen.value,
        discoveryDialogOpen: discoveryDialogOpen.value,
        modelLibraryDialogOpen: modelLibraryDialogOpen.value,
        editingModel: editingModel.value,
        editingLibraryModel: editingLibraryModel.value,
        editingModelMissingFields: editingModelMissingFields.value,
        editingTransientCandidate: editingTransientCandidate.value,
        discoveryGroups: discoveryGroups.value,
        discoverySearchQuery: discoverySearchQuery.value,
        discoveryExpandedGroups: discoveryExpandedGroups.value,
        discoveryDiagnostics: discoveryDiagnostics.value,
        discoveryManualDraft: manualDraft(activeProvider.value?.id ?? ""),
        modelLibraryGroups: modelLibraryGroups.value,
        modelLibrarySearchQuery: modelLibrarySearchQuery.value,
        modelLibraryExpandedGroups: modelLibraryExpandedGroups.value,
        enabledModelIds: enabledModelIds.value,
        "onUpdate:draft": (value: typeof draft.value) => {
            draft.value = value;
            scheduleSave();
        },
        "onSelect-provider": (key: string) => {
            activeProviderKey.value = key;
        },
        "onToggle-provider-enabled": () => {
            toggleActiveProviderEnabled();
            scheduleSave();
        },
        "onRename-provider-id": (nextId: string) => {
            renameActiveProviderId(nextId);
            scheduleSave();
        },
        "onClone-provider-connection": () => {
            cloneActiveProviderConnection();
            scheduleSave();
        },
        "onRequest-delete-provider": () => requestDeleteActiveProvider(),
        "onClear-provider-api-key": () => {
            clearActiveProviderApiKey();
            scheduleSave();
        },
        "onUpdate:selectedTemplate": (value: string) => {
            selectedTemplate.value = value;
        },
        "onAdd-provider": () => {
            void addProvider();
            scheduleSave();
        },
        "onDiscover-models": () => {
            void discoverModels();
        },
        "onCheck-model": (model: ModelSettingsModelDraft) => void checkModel(model),
        "onCancel-model-check": (model: ModelSettingsModelDraft) => {
            const provider = activeProvider.value;
            if (provider) cancelModelCheck(provider, model);
        },
        "onCheck-all-models": () => void checkAllActiveProviderModels(),
        "onCancel-model-checks": () => {
            const provider = activeProvider.value;
            if (provider) cancelProviderChecks(provider, true);
        },
        "onEdit-model": (model: ModelSettingsModelDraft) => void openModelEdit(model),
        "onDisable-model": (model: ModelSettingsModelDraft) => {
            disableModel(model);
            scheduleSave();
        },
        "onDelete-model": (model: ModelSettingsModelDraft) => {
            deleteModel(model);
            scheduleSave();
        },
        "onOpen-discovery": () => void discoverModels(),
        "onOpen-library": () => openModelLibrary(),
        "onRepair": () => {
            void repairModelSettings();
        },
        "onOpen-validation-issues": () => {
            validationDialogOpen.value = true;
        },
        "onUpdate:validationDialogOpen": (value: boolean) => {
            validationDialogOpen.value = value;
        },
        "onUpdate:deleteProviderDialogOpen": (value: boolean) => {
            deleteProviderDialogOpen.value = value;
        },
        "onUpdate:modelEditDialogOpen": (value: boolean) => {
            modelEditDialogOpen.value = value;
        },
        "onUpdate:discoveryDialogOpen": (value: boolean) => {
            discoveryDialogOpen.value = value;
        },
        "onUpdate:modelLibraryDialogOpen": (value: boolean) => {
            modelLibraryDialogOpen.value = value;
        },
        "onConfirm-delete-provider": () => {
            void confirmDeleteActiveProvider();
        },
        "onConfirm-model-edit": () => confirmTransientCandidate(),
        "onToggle-model-input": (model: ModelSettingsModelDraft, inputKind: ModelInputKind) => toggleModelInput(model, inputKind),
        "onReset-model-input": (model: ModelSettingsModelDraft) => {
            model.input = "";
        },
        "onReset-model-cost": (model: ModelSettingsModelDraft) => resetModelCost(model),
        "onEnable-model-cost": (model: ModelSettingsModelDraft) => enableModelCostOverride(model),
        "onReapply-library": (model: ModelSettingsModelDraft) => reapplyLibraryModel(model),
        "onUpdate:discoverySearchQuery": (value: string) => {
            discoverySearchQuery.value = value;
        },
        "onUpdate:modelLibrarySearchQuery": (value: string) => {
            modelLibrarySearchQuery.value = value;
        },
        "onUpdate:discoveryManualField": (field: keyof ManualModelDraft, value: string) => updateManualField(field, value),
        "onToggle-discovery-group": (group: string) => toggleExpandedGroup(discoveryExpandedGroups, group),
        "onToggle-model-library-group": (group: string) => toggleExpandedGroup(modelLibraryExpandedGroups, group),
        "onToggle-discovered-model": (model: Parameters<typeof toggleDiscoveredModel>[0]) => {
            toggleDiscoveredModel(model);
            scheduleSave();
        },
        "onToggle-library-model": (model: Parameters<typeof toggleLibraryModel>[0]) => {
            toggleLibraryModel(model);
            scheduleSave();
        },
        "onDiscover": () => {
            void discoverModels();
        },
        "onAdd-manual-model": () => {
            void addManualModel();
            scheduleSave();
        },
    }));

    onScopeDispose(() => {
        // 组件销毁时不能让已排队的改动随定时器一起消失：先把写回发出去。
        void flushSave();
    });

    return {
        viewBindings,
        /** 是否已经成功读过一次：宿主用它判断这个区段有没有数据可渲染。 */
        loaded: hasLoaded as Readonly<Ref<boolean>>,
        load: loadProviderSettings,
        flushSave,
        loading,
        saving,
    };}

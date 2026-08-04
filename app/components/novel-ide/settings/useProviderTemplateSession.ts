import {computed, ref, type Ref} from "vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto, ModelLibraryDto, ModelLibraryEntryDto, ProviderTemplateDto, ProviderTemplateLibraryDto} from "nbook/shared/dto/app-settings.dto";

type ProviderTemplateSessionOptions = {
    draft: Ref<ModelSettingsDraft>;
    activeProviderKey: Ref<string>;
    createProviderKey(providerId: string): string;
    cloneModel(model: ConfiguredModelDto): ModelSettingsModelDraft;
    ensureDefaultModel(): void;
};

const FALLBACK_TEMPLATE: ProviderTemplateDto = {
    id: "custom",
    name: "Custom Provider",
    baseUrl: "",
    defaultModelApi: null,
    models: [],
};

/**
 * 管理 Model Library 与 Provider Template Library 的只读数据，
 * 并把模板实例化为普通 Provider Config 草稿。
 */
export function useProviderTemplateSession(options: ProviderTemplateSessionOptions) {
    const {t} = useI18n();
    const configApi = useConfigApi();
    const notification = useNotification();
    const modelLibrary = ref<ModelLibraryDto | null>(null);
    const providerTemplates = ref<ProviderTemplateLibraryDto | null>(null);
    const selectedTemplate = ref(FALLBACK_TEMPLATE.id);
    const templateOptions = computed(() => providerTemplates.value?.templates ?? [FALLBACK_TEMPLATE]);

    /** 懒加载两个只读 Library；同一前端会话只请求一次。 */
    async function load(): Promise<ModelLibraryDto> {
        if (!modelLibrary.value || !providerTemplates.value) {
            const [library, templates] = await Promise.all([
                configApi.modelLibrary(),
                configApi.providerTemplates(),
            ]);
            modelLibrary.value = library;
            providerTemplates.value = templates;
            if (!templateOptions.value.some((template) => template.id === selectedTemplate.value)) {
                selectedTemplate.value = templateOptions.value[0]?.id ?? FALLBACK_TEMPLATE.id;
            }
        }
        return modelLibrary.value;
    }

    /** 按精确 model ID 查询 Model Library。 */
    function findModel(modelId: string): ModelLibraryEntryDto | null {
        return modelLibrary.value?.models.find((model) => model.id === modelId.trim()) ?? null;
    }

    /** 生成不与当前草稿冲突的 Provider Config ID。 */
    function uniqueProviderId(baseId: string): string {
        const normalizedBaseId = baseId.trim() || "provider";
        const providerIds = new Set(options.draft.value.providers.map((provider) => provider.id));
        if (!providerIds.has(normalizedBaseId)) {
            return normalizedBaseId;
        }
        let suffix = 2;
        while (providerIds.has(`${normalizedBaseId}-${String(suffix)}`)) {
            suffix += 1;
        }
        return `${normalizedBaseId}-${String(suffix)}`;
    }

    /** 从当前选中的 Provider Template 创建普通 Provider Config 草稿。 */
    async function addProvider(): Promise<void> {
        try {
            await load();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadModelLibraryFailed")));
            return;
        }
        const template = templateOptions.value.find((item) => item.id === selectedTemplate.value) ?? templateOptions.value[0];
        if (!template) {
            return;
        }
        const providerId = uniqueProviderId(template.id);
        const localKey = options.createProviderKey(providerId);
        options.activeProviderKey.value = localKey;
        options.draft.value.providers.push({
            localKey,
            id: providerId,
            name: template.name,
            enabled: true,
            modelApi: template.defaultModelApi ?? "",
            options: {
                apiKey: "",
                baseURL: template.baseUrl,
                proxy: "",
                timeoutMs: "",
                maxRetries: "",
                requestOptions: "",
                apiKeyConfigured: false,
                apiKeyMaskedValue: null,
                apiKeyCleared: false,
            },
            models: template.models.map((model) => options.cloneModel({...model, enabled: model.enabled})),
        });
        options.ensureDefaultModel();
        notification.success(t("settings.panels.models.providerAdded", {label: template.name}));
    }

    return {
        modelLibrary,
        providerTemplates,
        selectedTemplate,
        templateOptions,
        load,
        findModel,
        addProvider,
    };
}

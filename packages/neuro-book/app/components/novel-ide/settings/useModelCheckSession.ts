import {computed, ref, type ComputedRef} from "vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ModelSettingsModelDraft, ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/sections/model/model-settings-draft";
import type {CheckModelResponseDto, ConfiguredModelDto, ModelProviderDraftDto, ProviderCredentialSource} from "nbook/shared/dto/app-settings.dto";

type ModelCheckResult = CheckModelResponseDto & {
    /** 请求被用户取消时为 true；普通失败为空。 */
    cancelled?: boolean;
};

type ModelCheckControllerState = {
    controller: AbortController;
};

type ModelCheckBatchState = {
    providerKey: string;
    modelKeys: string[];
};

type ModelCheckSessionOptions = {
    activeProvider: ComputedRef<ModelSettingsProviderDraft | null>;
    runnableModelKeys: ComputedRef<ReadonlySet<string>>;
    buildProviderRequest(provider: ModelSettingsProviderDraft): ModelProviderDraftDto;
    buildModelDraft(model: ModelSettingsModelDraft): Omit<ConfiguredModelDto, "enabled">;
    credentialSource(provider: ModelSettingsProviderDraft): ProviderCredentialSource;
};

/** 单个 Provider 批量检查的最大并发，避免设置页一次性打爆远端端点。 */
export const MODEL_CHECK_CONCURRENCY_LIMIT = 4;

/**
 * 管理模型健康检查的取消、批次锁和临时结果。
 * Provider Config 草稿仍由调用者持有，本 Module 不修改模型数据。
 */
export function useModelCheckSession(options: ModelCheckSessionOptions) {
    const {t} = useI18n();
    const notification = useNotification();
    const controllers = ref<Record<string, ModelCheckControllerState>>({});
    const results = ref<Record<string, ModelCheckResult>>({});
    const batches = ref<Record<string, ModelCheckBatchState>>({});
    let stateVersion = 0;

    /** 返回模型在本地会话中的稳定检查 key。 */
    function key(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): string {
        return `${provider.localKey}/${model.localKey}`;
    }

    const activeProviderModelKeys = computed(() => {
        const provider = options.activeProvider.value;
        if (!provider?.enabled) {
            return [] as string[];
        }
        return provider.models.filter((model) => model.enabled).map((model) => key(provider, model));
    });

    const activeCheckingKeys = computed(() => activeProviderModelKeys.value.filter((modelKey) => Boolean(controllers.value[modelKey])));
    const activeCheckingCount = computed(() => activeCheckingKeys.value.length);
    const checkingAll = computed(() => {
        const provider = options.activeProvider.value;
        const batch = provider ? batches.value[provider.localKey] : null;
        return Boolean(batch?.modelKeys.some((modelKey) => controllers.value[modelKey]));
    });

    /** 判断模型是否具备健康检查所需的完整运行能力。 */
    function runnable(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): boolean {
        return options.runnableModelKeys.value.has(`${provider.id.trim()}/${model.id.trim()}`);
    }

    /** 读取单模型临时检查结果。 */
    function result(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): ModelCheckResult | null {
        return results.value[key(provider, model)] ?? null;
    }

    /** 判断单模型是否正在检查。 */
    function isChecking(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): boolean {
        return Boolean(controllers.value[key(provider, model)]);
    }

    /** 识别浏览器与 fetch 的取消错误。 */
    function isAbortError(error: unknown): boolean {
        if (error instanceof DOMException && error.name === "AbortError") {
            return true;
        }
        return typeof error === "object" && error !== null && "name" in error && (error as {name?: unknown}).name === "AbortError";
    }

    /** 批次中所有请求结束后释放“检测全部”锁。 */
    function clearSettledBatches(providerKey?: string): void {
        const next = {...batches.value};
        const entries = providerKey ? [[providerKey, next[providerKey]] as const] : Object.entries(next);
        let changed = false;
        for (const [batchProviderKey, batch] of entries) {
            if (!batch || batch.modelKeys.some((modelKey) => Boolean(controllers.value[modelKey]))) {
                continue;
            }
            delete next[batchProviderKey];
            changed = true;
        }
        if (changed) {
            batches.value = next;
        }
    }

    /** Provider 被禁用或重命名时释放旧批次锁。 */
    function clearProviderBatch(provider: ModelSettingsProviderDraft): void {
        if (!batches.value[provider.localKey]) {
            return;
        }
        const next = {...batches.value};
        delete next[provider.localKey];
        batches.value = next;
    }

    /** 取消指定模型检查。 */
    function cancelModel(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): void {
        controllers.value[key(provider, model)]?.controller.abort();
    }

    /** 取消 Provider 下全部检查。 */
    function cancelProvider(provider: ModelSettingsProviderDraft, clearBatch = false): void {
        for (const model of provider.models) {
            cancelModel(provider, model);
        }
        if (clearBatch) {
            clearProviderBatch(provider);
        }
    }

    /** 取消当前 Provider 下全部检查。 */
    function cancelActiveProvider(): void {
        const provider = options.activeProvider.value;
        if (provider) {
            cancelProvider(provider);
        }
    }

    /** 取消当前 Provider 的指定模型检查。 */
    function cancelActiveModel(model: ModelSettingsModelDraft): void {
        const provider = options.activeProvider.value;
        if (provider) {
            cancelModel(provider, model);
        }
    }

    /** 清空全部会话状态并取消正在执行的请求。 */
    function reset(): void {
        stateVersion += 1;
        for (const state of Object.values(controllers.value)) {
            state.controller.abort();
        }
        controllers.value = {};
        results.value = {};
        batches.value = {};
    }

    /** 执行单模型健康检查并记录临时结果。 */
    async function run(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): Promise<ModelCheckResult> {
        const modelKey = key(provider, model);
        const controller = new AbortController();
        const version = stateVersion;
        controllers.value = {...controllers.value, [modelKey]: {controller}};
        try {
            const response = await $fetch<CheckModelResponseDto>("/api/config/models/model-check", {
                method: "POST",
                signal: controller.signal,
                body: {
                    provider: options.buildProviderRequest(provider),
                    model: options.buildModelDraft(model),
                    credentialSource: options.credentialSource(provider),
                },
            });
            if (version === stateVersion && !controller.signal.aborted) {
                results.value = {...results.value, [modelKey]: response};
            }
            return response;
        } catch (error) {
            const response: ModelCheckResult = controller.signal.aborted || isAbortError(error)
                ? {success: false, latencyMs: null, message: t("settings.panels.models.modelCheckCancelled"), cancelled: true}
                : {success: false, latencyMs: null, message: resolveApiErrorMessage(error, t("settings.panels.models.modelCheckFailed"))};
            if (version === stateVersion) {
                results.value = {...results.value, [modelKey]: response};
            }
            return response;
        } finally {
            if (controllers.value[modelKey]?.controller === controller) {
                const next = {...controllers.value};
                delete next[modelKey];
                controllers.value = next;
                clearSettledBatches();
            }
        }
    }

    /** 检查当前 Provider 下的单个模型。 */
    async function checkModel(model: ModelSettingsModelDraft): Promise<void> {
        const provider = options.activeProvider.value;
        if (!provider?.enabled || !model.enabled || !runnable(provider, model) || isChecking(provider, model)) {
            return;
        }
        await run(provider, model);
    }

    /** 并发检查当前 Provider 下全部可运行模型。 */
    async function checkAll(): Promise<void> {
        const provider = options.activeProvider.value;
        if (!provider?.enabled || checkingAll.value) {
            return;
        }
        const enabledModels = provider.models.filter((model) => model.enabled && runnable(provider, model));
        if (enabledModels.length === 0) {
            notification.info(t("settings.panels.models.noEnabledProviderModels"));
            return;
        }
        batches.value = {
            ...batches.value,
            [provider.localKey]: {providerKey: provider.localKey, modelKeys: enabledModels.map((model) => key(provider, model))},
        };
        const pendingModels = enabledModels.filter((model) => !isChecking(provider, model));
        if (pendingModels.length === 0) {
            clearSettledBatches(provider.localKey);
            return;
        }
        try {
            await runWithConcurrency(pendingModels, MODEL_CHECK_CONCURRENCY_LIMIT, (model) => run(provider, model));
        } finally {
            clearSettledBatches(provider.localKey);
        }
    }

    return {
        activeCheckingCount,
        checkingAll,
        runnable,
        result,
        isChecking,
        checkModel,
        checkAll,
        cancelModel,
        cancelProvider,
        cancelActiveProvider,
        cancelActiveModel,
        clearProviderBatch,
        reset,
    };
}

/** 以固定 worker 数执行批量检查，保留每个模型独立的失败结果。 */
async function runWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
    let cursor = 0;
    const worker = async (): Promise<void> => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            const item = items[index];
            if (item !== undefined) {
                await task(item);
            }
        }
    };
    const workers = Array.from({length: Math.min(Math.max(1, limit), items.length)}, () => worker());
    await Promise.all(workers);
}

<script setup lang="ts">
/**
 * ComfyUI 生图设置面板：连接地址 + 测试连接、提示词蒸馏模型、正负向提示词默认值、
 * 生成参数默认值。走 editorSnapshot → 修改 comfyui → saveGlobal 的标准面板链路（global scope）。
 * 自定义工作流的导入与 mapping 编辑在本面板下方的工作流区块（NovelIdeComfyUiWorkflowSection）。
 */
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import NovelIdeComfyUiWorkflowSection from "nbook/app/components/novel-ide/settings/NovelIdeComfyUiWorkflowSection.vue";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigUpdateDto, ComfyUiConfigDto} from "nbook/shared/dto/config.dto";
import type {ComfyUiCheckResponseDto} from "nbook/shared/dto/comfyui.dto";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

/** 展示默认值，与后端 normalizer 的 DEFAULT_COMFYUI 保持一致。 */
const COMFYUI_DEFAULTS = {
    enabled: false,
    baseURL: "http://127.0.0.1:8188",
    timeoutMs: 30_000,
    promptModelKey: null as string | null,
    positivePrefix: "masterpiece, best quality, amazing quality, very aesthetic, absurdres",
    negativeDefault: "worst quality, low quality, lowres, bad anatomy, bad hands, jpeg artifacts, chromatic aberration, watermark, signature, artist name, blurry",
    checkpoint: "",
    width: 832,
    height: 1216,
    steps: 32,
    cfg: 4.5,
    activeWorkflowId: null as string | null,
};

/** 面板可编辑字段的草稿形态，快照对比用同一结构。 */
type ComfyUiDraft = {
    enabled: boolean;
    baseURL: string;
    timeoutMs: number;
    promptModelKey: string | null;
    positivePrefix: string;
    negativeDefault: string;
    checkpoint: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    activeWorkflowId: string | null;
};

const props = withDefaults(defineProps<{
    targetQuery?: ConfigWorkspaceQueryDto;
}>(), {
    targetQuery: undefined,
});

const configApi = useConfigApi();
const notification = useNotification();
const {t} = useI18n();

const loading = ref(false);
const saving = ref(false);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const draft = ref<ComfyUiDraft>({...COMFYUI_DEFAULTS});
const snapshot = ref<ComfyUiDraft>({...COMFYUI_DEFAULTS});

/** 测试连接是面板内自管的临时状态，不参与 dirty。 */
const checking = ref(false);
const checkResult = ref<ComfyUiCheckResponseDto | null>(null);
let checkAbort: AbortController | null = null;

const enabledModels = computed<EnabledModelOptionDto[]>(() => editorSnapshot.value?.modelSettings.enabledModels ?? []);

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(snapshot.value));

/**
 * 从快照读 comfyui 当前值；global 里没写过的字段落展示默认值。
 */
function applySettings(snapshotDto: ConfigEditorSnapshotDto): void {
    editorSnapshot.value = snapshotDto;
    const config: ComfyUiConfigDto = snapshotDto.global.comfyui ?? {};
    const defaults = config.defaults ?? {};
    const next: ComfyUiDraft = {
        enabled: config.enabled ?? COMFYUI_DEFAULTS.enabled,
        baseURL: config.baseURL ?? COMFYUI_DEFAULTS.baseURL,
        timeoutMs: config.timeoutMs ?? COMFYUI_DEFAULTS.timeoutMs,
        promptModelKey: config.promptModelKey ?? COMFYUI_DEFAULTS.promptModelKey,
        positivePrefix: config.positivePrefix ?? COMFYUI_DEFAULTS.positivePrefix,
        negativeDefault: config.negativeDefault ?? COMFYUI_DEFAULTS.negativeDefault,
        checkpoint: defaults.checkpoint ?? COMFYUI_DEFAULTS.checkpoint,
        width: defaults.width ?? COMFYUI_DEFAULTS.width,
        height: defaults.height ?? COMFYUI_DEFAULTS.height,
        steps: defaults.steps ?? COMFYUI_DEFAULTS.steps,
        cfg: defaults.cfg ?? COMFYUI_DEFAULTS.cfg,
        activeWorkflowId: config.activeWorkflowId ?? COMFYUI_DEFAULTS.activeWorkflowId,
    };
    draft.value = {...next};
    snapshot.value = {...next};
}

/**
 * 构造 Global Config 写回体。整块覆盖 comfyui（面板持有全部字段，无需保留手写残余）。
 */
function buildGlobalConfigPayload(): GlobalConfigUpdateDto {
    return {
        comfyui: {
            enabled: draft.value.enabled,
            baseURL: draft.value.baseURL.trim() || COMFYUI_DEFAULTS.baseURL,
            timeoutMs: draft.value.timeoutMs,
            promptModelKey: draft.value.promptModelKey,
            positivePrefix: draft.value.positivePrefix,
            negativeDefault: draft.value.negativeDefault,
            defaults: {
                checkpoint: draft.value.checkpoint,
                width: draft.value.width,
                height: draft.value.height,
                steps: draft.value.steps,
                cfg: draft.value.cfg,
            },
            activeWorkflowId: draft.value.activeWorkflowId,
        },
    };
}

async function loadSettings(): Promise<void> {
    loading.value = true;
    try {
        applySettings(await configApi.editorSnapshot(props.targetQuery));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.loadFailed")));
    } finally {
        loading.value = false;
    }
}

async function restoreSettings(): Promise<void> {
    await loadSettings();
}

async function saveSettings(): Promise<void> {
    if (!dirty.value || saving.value) {
        return;
    }
    saving.value = true;
    try {
        applySettings(await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery));
        notification.success(t("settings.panels.comfyui.saveSuccess"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.saveFailed")));
    } finally {
        saving.value = false;
    }
}

/**
 * 测试连接：用当前草稿 baseURL（未保存也可测）。
 */
async function checkConnection(): Promise<void> {
    if (checking.value) {
        checkAbort?.abort();
        checking.value = false;
        return;
    }
    checking.value = true;
    checkResult.value = null;
    checkAbort = new AbortController();
    try {
        checkResult.value = await $fetch<ComfyUiCheckResponseDto>("/api/comfyui/check", {
            method: "POST",
            body: {baseURL: draft.value.baseURL.trim()},
            signal: checkAbort.signal,
        });
    } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
            checkResult.value = {success: false, latencyMs: null, message: resolveApiErrorMessage(error, t("settings.panels.comfyui.checkFailed"))};
        }
    } finally {
        checking.value = false;
    }
}

/** 数字输入统一夹取。 */
function updateNumber(key: "timeoutMs" | "width" | "height" | "steps" | "cfg", value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    const clamped = Math.min(Math.max(key === "cfg" ? parsed : Math.floor(parsed), min), max);
    draft.value = {...draft.value, [key]: clamped};
}

watch(() => props.targetQuery, () => {
    void loadSettings();
}, {deep: true});

onMounted(() => {
    void loadSettings();
});

onBeforeUnmount(() => {
    checkAbort?.abort();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
    restoreSettings,
});
</script>

<template>
    <!-- ComfyUI 生图设置面板 -->
    <div class="space-y-4 pt-1">
        <div class="max-w-xl">
            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.comfyui.title") }}</h3>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.description") }}</p>
        </div>

        <div v-if="loading" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("common.loading") }}</span>
        </div>

        <div v-else class="grid gap-3">
            <!-- 启用开关 -->
            <div class="flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)]">
                    <span class="i-lucide-image h-5 w-5"></span>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.enabledTitle") }}</div>
                    <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.enabledDescription") }}</div>
                </div>
                <button type="button" class="relative h-6 w-11 shrink-0 rounded-full border transition-colors" :class="draft.enabled ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'" @click="draft = {...draft, enabled: !draft.enabled}">
                    <span class="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" :class="draft.enabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
                </button>
            </div>

            <!-- 连接地址 + 测试连接 -->
            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.baseUrlTitle") }}</div>
                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.baseUrlDescription") }}</div>
                <div class="mt-3 flex items-center gap-2">
                    <input type="text" class="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.baseURL" placeholder="http://127.0.0.1:8188" spellcheck="false" @input="draft = {...draft, baseURL: ($event.target as HTMLInputElement).value}">
                    <button type="button" class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="void checkConnection()">
                        <span v-if="checking" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                        <span v-else class="i-lucide-plug-zap h-3.5 w-3.5"></span>
                        {{ checking ? t("settings.panels.comfyui.checking") : t("settings.panels.comfyui.checkConnection") }}
                    </button>
                </div>
                <!-- 测试结果 -->
                <div v-if="checkResult" class="mt-2 flex items-start gap-1.5 text-xs" :class="checkResult.success ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'">
                    <span :class="checkResult.success ? 'i-lucide-check-circle-2' : 'i-lucide-alert-circle'" class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                    <span class="break-all">{{ checkResult.message }}</span>
                </div>
                <label class="mt-3 block">
                    <span class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.timeoutTitle") }}</span>
                    <input type="number" class="mt-1 h-8 w-full max-w-[220px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.timeoutMs" min="1000" max="600000" step="1000" @input="updateNumber('timeoutMs', ($event.target as HTMLInputElement).value, 1000, 600000)">
                </label>
            </div>

            <!-- 提示词蒸馏模型 -->
            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.promptModelTitle") }}</div>
                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.promptModelDescription") }}</div>
                <div class="mt-3 max-w-[360px]">
                    <NovelIdeModelSelect v-model="draft.promptModelKey" :models="enabledModels" :allow-default="true" :default-label="t('settings.panels.comfyui.promptModelFollowDefault')" />
                </div>
            </div>

            <!-- 提示词前后缀 -->
            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <label class="block">
                    <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.positivePrefixTitle") }}</span>
                    <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.positivePrefixDescription") }}</span>
                    <textarea class="mt-2 min-h-[56px] w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.positivePrefix" spellcheck="false" @input="draft = {...draft, positivePrefix: ($event.target as HTMLTextAreaElement).value}"></textarea>
                </label>
                <label class="mt-3 block">
                    <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.negativeDefaultTitle") }}</span>
                    <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.negativeDefaultDescription") }}</span>
                    <textarea class="mt-2 min-h-[56px] w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.negativeDefault" spellcheck="false" @input="draft = {...draft, negativeDefault: ($event.target as HTMLTextAreaElement).value}"></textarea>
                </label>
            </div>

            <!-- 生成参数默认值 -->
            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.defaultsTitle") }}</div>
                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.defaultsDescription") }}</div>
                <label class="mt-3 block">
                    <span class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.checkpointTitle") }}</span>
                    <input type="text" class="mt-1 h-8 w-full max-w-[360px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.checkpoint" :placeholder="t('settings.panels.comfyui.checkpointPlaceholder')" spellcheck="false" @input="draft = {...draft, checkpoint: ($event.target as HTMLInputElement).value}">
                </label>
                <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label class="block">
                        <span class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.widthTitle") }}</span>
                        <input type="number" class="mt-1 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.width" min="64" max="4096" step="64" @input="updateNumber('width', ($event.target as HTMLInputElement).value, 64, 4096)">
                    </label>
                    <label class="block">
                        <span class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.heightTitle") }}</span>
                        <input type="number" class="mt-1 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.height" min="64" max="4096" step="64" @input="updateNumber('height', ($event.target as HTMLInputElement).value, 64, 4096)">
                    </label>
                    <label class="block">
                        <span class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.stepsTitle") }}</span>
                        <input type="number" class="mt-1 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.steps" min="1" max="150" step="1" @input="updateNumber('steps', ($event.target as HTMLInputElement).value, 1, 150)">
                    </label>
                    <label class="block">
                        <span class="text-xs text-[var(--text-secondary)]">CFG</span>
                        <input type="number" class="mt-1 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draft.cfg" min="0" max="30" step="0.5" @input="updateNumber('cfg', ($event.target as HTMLInputElement).value, 0, 30)">
                    </label>
                </div>
            </div>

            <!-- 工作流管理（导入自定义 API JSON + 默认工作流选择 + mapping 编辑） -->
            <NovelIdeComfyUiWorkflowSection v-model:active-workflow-id="draft.activeWorkflowId" />
        </div>
    </div>
</template>

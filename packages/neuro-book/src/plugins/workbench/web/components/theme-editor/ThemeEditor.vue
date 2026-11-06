<script setup lang="ts">
/**
 * 主题编辑器（同名 .md，docs/specs/theme/editor.md）：我的主题库的选择与增删，左边分区导航，右边一次一个分区。页签与浮动窗口放的
 * 是同一个主体；所有修改交给模型，这里只呈现与转发。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {Button, EmptyState, ScrollArea, SegmentedControl, Select} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {useWorkbenchText} from "../../text";
import type {ThemeEntry} from "../../themes";
import DraftInput from "./DraftInput.vue";
import ThemeEditorChrome from "./ThemeEditorChrome.vue";
import ThemeEditorScene from "./ThemeEditorScene.vue";
import type {ThemeTransfer, TransferResult} from "./transfer";
import ThemeEditorColors from "./ThemeEditorColors.vue";
import ThemeEditorTypography from "./ThemeEditorTypography.vue";
import {SAVE_FAILED, ThemeEditorModel, TITLE_EMPTY} from "./theme-editor-model";
import type {EditorSection} from "./theme-editor-model";

defineOptions({name: "ThemeEditor"});

// 布尔属性不传时 Vue 会当成 false，所以缺省要写出来。
const props = withDefaults(defineProps<{
    model: ThemeEditorModel;
    /** 主题目录里的全部主题，“复制自…”从这里选。 */
    themes: ReadonlyArray<ThemeEntry>;
    /** 画“关闭”按钮（浮动窗口里）；页签里不画。缺省画。 */
    closable?: boolean;
    /** 导出与导入的实现；请求由持有者发。 */
    transfer: ThemeTransfer;
}>(), {closable: true});

const emit = defineEmits<{(event: "close"): void}>();

const text = useWorkbenchText();
const resolver = useText();
const model = props.model;

const SECTIONS: ReadonlyArray<EditorSection> = ["basic", "colors", "fonts", "chrome", "scene", "contrast"];

const titleOf = (title: ThemeEntry["declaration"]["title"]): string => resolver.t(title);
const options = computed(() => model.mine.value.map((theme) => ({label: titleOf(theme.declaration.title), value: theme.id})));
const copyOptions = computed(() => props.themes.map((entry) => ({label: titleOf(entry.declaration.title), value: entry.id})));
const copyFrom = ref("");

const appearanceOptions = computed(() => [
    {value: "light", label: text("themeEditor.appearance.light"), iconClass: "i-lucide-sun"},
    {value: "dark", label: text("themeEditor.appearance.dark"), iconClass: "i-lucide-moon"},
]);

const titleValue = (language: "zh-CN" | "en-US"): string => {
    const title = model.current.value?.declaration.title;
    return typeof title === "object" && title !== null && language in title ? String((title as Record<string, string>)[language]) : "";
};

/**
 * 删除要点两次：第一次变成“确认删除”，4 秒不再点、换了主题或失焦就回去；第二次点得太快（不到 400ms）不算——快速双击来不及读到
 * “确认删除”，不该直接删掉。不靠失焦一条：Safari 与 macOS 的 Firefox 点按钮不给按钮焦点。
 */
const confirming = ref(false);
let confirmStarted = 0;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
const resetConfirm = (): void => {
    confirming.value = false;
    if (confirmTimer !== null) clearTimeout(confirmTimer);
    confirmTimer = null;
};
const remove = async (): Promise<void> => {
    if (!confirming.value) {
        confirming.value = true;
        confirmStarted = Date.now();
        confirmTimer = setTimeout(resetConfirm, 4000);
        return;
    }
    if (Date.now() - confirmStarted < 400) return;
    resetConfirm();
    await model.remove();
};
watch(() => model.selectedId.value, resetConfirm);
onBeforeUnmount(resetConfirm);

const createFrom = async (id: string): Promise<void> => {
    const entry = props.themes.find((candidate) => candidate.id === id);
    copyFrom.value = "";
    if (entry === undefined) return;
    // 复制插件主题：先把它的场景图读出来、传成我的素材，全部成功才建副本（失败不留半个副本）。我的主题的图文件名可以直接共用。
    const hasScene = entry.declaration.light.scene !== undefined || entry.declaration.dark.scene !== undefined;
    if (hasScene && entry.plugin !== "user") {
        const copied = await props.transfer.copyScenes(entry);
        if (!copied.ok) {
            transferResult.value = {ok: false, message: {key: "copyFailed", params: {reason: copied.reason}}};
            return;
        }
        await model.create(entry, titleOf(entry.declaration.title), copied.scenes);
        return;
    }
    await model.create(entry, titleOf(entry.declaration.title));
};

/** 导出与导入的结果：一行提示，成功与失败各一种色。 */
const transferResult = ref<TransferResult | null>(null);
/** 意外（读不了的响应、抛错的文件读取）：不当成未处理的拒绝，给一行通用的原因。 */
const unexpected = ref<string | null>(null);
const transferring = ref(false);
const importInput = ref<HTMLInputElement | null>(null);
const transferWith = async (run: () => Promise<TransferResult | null>): Promise<void> => {
    if (transferring.value) return;
    transferring.value = true;
    unexpected.value = null;
    try {
        transferResult.value = await run();
    } catch (error) {
        transferResult.value = null;
        unexpected.value = text("themeEditor.transfer.unexpected", {reason: error instanceof Error ? error.message : String(error)});
    } finally {
        transferring.value = false;
    }
};
const exportTheme = (): Promise<void> => transferWith(() => props.transfer.exportTheme());
const onImportFile = async (event: Event): Promise<void> => {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = "";
    if (file === undefined) return;
    await transferWith(async () => props.transfer.importArchive(new Uint8Array(await file.arrayBuffer())));
};
const transferText = computed(() => {
    if (unexpected.value !== null) return unexpected.value;
    const result = transferResult.value;
    if (result === null) return "";
    return text(`themeEditor.transfer.${result.message.key}` as "themeEditor.transfer.exported", result.message.params as never);
});
/** 提示只属于那一次操作：换了主题或分区就清掉。 */
watch(() => [model.selectedId.value, model.section.value], () => {
    transferResult.value = null;
    unexpected.value = null;
});

/** 最近一次被拒绝的修改：标题空、取值引外部资源这类写不进去的，行内给原因，不静默。 */
const rejectedText = computed(() => {
    const reason = model.rejected.value;
    if (reason === null) return null;
    if (reason === TITLE_EMPTY) return text("themeEditor.rejected.titleEmpty");
    if (reason.startsWith(SAVE_FAILED)) return text("themeEditor.rejected.saveFailed", {code: reason.slice(SAVE_FAILED.length)});
    return text("themeEditor.rejected.invalid", {reason});
});

const lightName = computed(() => text("themeEditor.appearance.light"));
const darkName = computed(() => text("themeEditor.appearance.dark"));
const appearanceName = (appearance: "light" | "dark"): string => (appearance === "light" ? lightName.value : darkName.value);
</script>

<template>
    <div class="theme-editor" data-theme-editor>
        <header class="theme-editor__bar">
            <div v-if="model.mine.value.length > 0" class="theme-editor__picker">
                <Select
                    size="sm"
                    :model-value="model.selectedId.value ?? ''"
                    :options="options"
                    :aria-label="text('themeEditor.library.label')"
                    @update:model-value="model.select($event)"
                />
            </div>
            <Button size="sm" variant="secondary" icon-class="i-lucide-plus" data-new @click="model.create()">{{ text("themeEditor.library.new") }}</Button>
            <div class="theme-editor__copy-from" data-copy-from>
                <Select
                    size="sm"
                    :model-value="copyFrom"
                    :options="copyOptions"
                    :placeholder="text('themeEditor.library.copyFrom')"
                    :aria-label="text('themeEditor.library.copyFrom')"
                    @update:model-value="createFrom($event)"
                />
            </div>
            <Button size="sm" variant="secondary" icon-class="i-lucide-copy" :disabled="model.current.value === null" data-duplicate @click="model.duplicate()">{{ text("themeEditor.library.duplicate") }}</Button>
            <Button size="sm" :variant="confirming ? 'danger' : 'ghost'" icon-class="i-lucide-trash-2" :disabled="model.current.value === null" data-delete @click="remove" @blur="resetConfirm">
                {{ confirming ? text("themeEditor.library.deleteConfirm") : text("themeEditor.library.delete") }}
            </Button>
            <Button size="sm" variant="ghost" icon-class="i-lucide-download" :disabled="model.current.value === null || transferring" data-export @click="exportTheme">{{ text("themeEditor.library.export") }}</Button>
            <Button size="sm" variant="ghost" icon-class="i-lucide-upload" :disabled="transferring" data-import @click="importInput?.click()">{{ text("themeEditor.library.import") }}</Button>
            <input ref="importInput" type="file" accept=".zip,application/zip" class="theme-editor__file" data-import-file @change="onImportFile" />
            <span class="theme-editor__spacer" />
            <SegmentedControl
                size="sm"
                :model-value="model.appearance.value"
                :options="appearanceOptions"
                :aria-label="text('themeEditor.appearance.label')"
                data-appearance
                @update:model-value="model.appearance.value = $event as 'light' | 'dark'"
            />
            <Button v-if="closable" size="sm" variant="ghost" icon-class="i-lucide-x" data-close @click="emit('close')">{{ text("themeEditor.close") }}</Button>
        </header>

        <!-- 常驻的提示区：读屏对“刚插入”的提示区往往不播报，所以元素一直在，只换内容。 -->
        <p class="theme-editor__transfer" :data-tone="unexpected !== null || transferResult?.ok === false ? 'bad' : transferResult === null ? '' : 'ok'" role="status" data-transfer>{{ transferText }}</p>
        <p v-if="rejectedText !== null" class="theme-editor__error" role="alert" data-rejected>{{ rejectedText }}</p>
        <p v-if="model.failure.value !== null" class="theme-editor__error" role="alert" data-library-failed>{{ text("themeEditor.library.failed", {reason: model.failure.value}) }}</p>

        <div v-if="!model.ready.value" class="theme-editor__state" role="status" aria-busy="true">{{ text("themeEditor.library.loading") }}</div>

        <EmptyState v-else-if="model.current.value === null" class="theme-editor__empty" icon-class="i-lucide-palette" :title="text('themeEditor.empty.title')" :description="text('themeEditor.empty.hint')" data-empty>
            <div class="theme-editor__empty-actions">
                <Button size="sm" data-new-empty @click="model.create()">{{ text("themeEditor.library.new") }}</Button>
                <Select
                    size="sm"
                    :model-value="copyFrom"
                    :options="copyOptions"
                    :placeholder="text('themeEditor.library.copyFrom')"
                    :aria-label="text('themeEditor.library.copyFrom')"
                    @update:model-value="createFrom($event)"
                />
            </div>
        </EmptyState>

        <div v-else class="theme-editor__body">
            <nav class="theme-editor__nav" :aria-label="text('themeEditor.sections.label')">
                <button
                    v-for="section in SECTIONS"
                    :key="section"
                    type="button"
                    class="theme-editor__nav-item"
                    :data-section-tab="section"
                    :aria-current="model.section.value === section ? 'page' : undefined"
                    @click="model.section.value = section"
                >
                    <span>{{ text(`themeEditor.sections.${section}` as "themeEditor.sections.basic") }}</span>
                    <span v-if="section === 'contrast' && model.failures.value.length > 0" class="theme-editor__badge" data-contrast-count>{{ model.failures.value.length }}</span>
                </button>
            </nav>

            <ScrollArea class="theme-editor__panel">
                <div class="theme-editor__section">
                    <div v-if="model.section.value === 'basic'" class="theme-editor__basic" data-section="basic">
                        <label class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.titleZh") }}</span>
                            <DraftInput :value="titleValue('zh-CN')" @change="model.setTitle('zh-CN', $event)" />
                        </label>
                        <label class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.titleEn") }}</span>
                            <DraftInput :value="titleValue('en-US')" @change="model.setTitle('en-US', $event)" />
                        </label>
                        <div class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.base") }}</span>
                            <SegmentedControl
                                size="sm"
                                :model-value="model.current.value.declaration.base"
                                :options="[{value: 'nbook', label: text('themeEditor.basic.baseNbook')}, {value: 'macos', label: text('themeEditor.basic.baseMacos')}]"
                                :aria-label="text('themeEditor.basic.base')"
                                data-base
                                @update:model-value="model.setBase($event as 'nbook' | 'macos')"
                            />
                            <p class="theme-editor__hint">{{ text("themeEditor.basic.baseHint") }}</p>
                        </div>
                    </div>
                    <ThemeEditorColors v-else-if="model.section.value === 'colors'" :model="model" />
                    <ThemeEditorTypography v-else-if="model.section.value === 'fonts'" :model="model" />
                    <ThemeEditorChrome v-else-if="model.section.value === 'chrome'" :model="model" />
                    <ThemeEditorScene v-else-if="model.section.value === 'scene'" :model="model" :transfer="transfer" />
                    <div v-else class="theme-editor__contrast" data-section="contrast">
                        <p class="theme-editor__hint">{{ text("themeEditor.contrast.legend") }}</p>
                        <h3 class="theme-editor__heading">{{ text("themeEditor.contrast.summary") }}</h3>
                        <p v-if="model.failures.value.length === 0" class="theme-editor__ok" data-contrast-none>{{ text("themeEditor.contrast.none") }}</p>
                        <ul v-else class="theme-editor__failures">
                            <li v-for="item in model.failures.value" :key="`${item.appearance}:${item.check.key}`" data-contrast-failure>
                                <span class="theme-editor__failure-appearance">{{ appearanceName(item.appearance) }}</span>
                                <code>{{ item.check.key }}</code>
                                <span class="theme-editor__failure-ratio">{{ item.check.ratio?.toFixed(2) }}</span>
                                <span class="theme-editor__hint">{{ text("themeEditor.contrast.against", {surface: item.check.against ?? ""}) }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </ScrollArea>
        </div>
    </div>
</template>

<style scoped>
/* 编辑面板始终用实心面：被预览的主题可能把浮层面做成半透明，那样改色时看不清自己在改什么（docs/specs/theme/editor.md 输出 18）。 */
.theme-editor {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    /*
     * 实心：正在编辑的 `--bg-panel` 可以写成半透明（取色器与色值输入都允许 rgba），这时面板不能跟着透出后面的工作台。
     * 把它叠在 `Canvas`（随 color-scheme 的不透明系统底色）上，写成半透明也只是变浅，不会透。
     */
    background: linear-gradient(var(--bg-panel), var(--bg-panel)), Canvas;
    color: var(--text-main);
}

.theme-editor__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-bottom: var(--border-w) solid var(--border-color);
}

.theme-editor__copy-from {
    flex: 0 1 150px;
    min-width: 120px;
}

.theme-editor__picker {
    flex: 0 1 240px;
    min-width: 160px;
}

.theme-editor__file {
    display: none;
}

.theme-editor__transfer {
    margin: 0;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-xs);
}

.theme-editor__transfer:empty {
    padding: 0;
}

.theme-editor__transfer[data-tone="ok"] {
    color: var(--status-success);
}

.theme-editor__transfer[data-tone="bad"] {
    color: var(--status-danger);
}

.theme-editor__spacer {
    flex: 1;
}

.theme-editor__error {
    margin: 0;
    padding: var(--space-3) var(--space-6);
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.theme-editor__state,
.theme-editor__empty {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.theme-editor__empty-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
}

.theme-editor__body {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
}

.theme-editor__nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border-right: var(--border-w) solid var(--border-color);
}

.theme-editor__nav-item {
    flex: none;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
}

.theme-editor__nav-item:hover {
    background: var(--bg-hover);
}

.theme-editor__nav-item[aria-current="page"] {
    background: var(--accent-bg);
    color: var(--accent-text);
    font-weight: 600;
}

.theme-editor__badge {
    min-width: 18px;
    padding: 0 var(--space-2);
    border-radius: 999px;
    background: var(--status-danger);
    color: var(--text-inverse);
    font-size: var(--text-xs);
    text-align: center;
}

.theme-editor__panel {
    min-width: 0;
    min-height: 0;
}

/* 分区内容自己是容器：配色行与取景编辑按“内容有多宽”换排法，不按整个编辑器（含导航）的宽。 */
.theme-editor__section {
    container-type: inline-size;
    max-width: 920px;
    padding: var(--space-6) var(--space-8);
}

.theme-editor__basic,
.theme-editor__contrast {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 560px;
}

.theme-editor__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
}

.theme-editor__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor__heading {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-editor__ok {
    margin: 0;
    color: var(--status-success);
    font-size: var(--text-sm);
}

.theme-editor__failures {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.theme-editor__failures li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-sm);
}

.theme-editor__failure-ratio {
    color: var(--status-danger);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* 窄窗口：导航收成顶部一条，分区内容占满宽（Spec 输出 18）。 */
@container (max-width: 520px) {
    .theme-editor__body {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
    }

    .theme-editor__nav {
        flex-direction: row;
        overflow-x: auto;
        border-right: 0;
        border-bottom: var(--border-w) solid var(--border-color);
    }

    .theme-editor__section {
        padding: var(--space-4);
    }
}
</style>

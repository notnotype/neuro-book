<script setup lang="ts">
/**
 * 主题编辑器（同名 .md，docs/specs/theme/editor.md）：我的主题库的选择与增删，左边分区导航，右边一次一个分区。页签与浮动窗口放的
 * 是同一个主体；所有修改交给模型，这里只呈现与转发。
 */
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";

import {Button, EmptyState, ScrollArea, SegmentedControl, Select} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {useWorkbenchText} from "../../text";
import type {ThemeEntry} from "../../themes";
import DraftInput from "./DraftInput.vue";
import ThemeEditorChrome from "./ThemeEditorChrome.vue";
import ThemeEditorIcons from "./ThemeEditorIcons.vue";
import ThemeEditorScene from "./ThemeEditorScene.vue";
import type {ThemeTransfer, TransferResult} from "./transfer";
import ThemeEditorColors from "./ThemeEditorColors.vue";
import ThemeEditorContrast from "./ThemeEditorContrast.vue";
import ThemeEditorTypography from "./ThemeEditorTypography.vue";
import {SAVE_FAILED, ThemeEditorModel, TITLE_EMPTY} from "./theme-editor-model";
import type {SweepFailure} from "./theme-editor-model";
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

const SECTIONS: ReadonlyArray<EditorSection> = ["basic", "colors", "fonts", "chrome", "scene", "icons", "contrast"];

const nav = ref<HTMLElement | null>(null);
/**
 * 窄屏时导航是横向可滚的一条：把当前项带进可视范围。只改导航条自己的 `scrollLeft`，不用 `scrollIntoView`（它会连带滚动所有可滚动的
 * 祖先，在浮动窗口或编辑区里会把外层也推走）。桌面竖排时导航不能横向滚，什么也不发生。
 * 三个入口：分区变了；导航条出现（分区存在组件外的编辑状态里，组件重新挂载时 `section` 没变，监听不触发）；导航条宽度变了
 * （窗口由宽变窄，竖排换成横排，分区没变）。
 */
const revealCurrentSection = (): void => {
    const bar = nav.value;
    const current = bar?.querySelector<HTMLElement>("[aria-current=\"page\"]");
    if (bar === null || bar === undefined || current === null || current === undefined || bar.scrollWidth <= bar.clientWidth) return;
    const barBox = bar.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    if (box.left < barBox.left) bar.scrollLeft -= barBox.left - box.left;
    else if (box.right > barBox.right) bar.scrollLeft += box.right - barBox.right;
};
watch(() => model.section.value, () => void nextTick(revealCurrentSection));
// 导航条在“库读完且有当前主题”时才存在（读取中、空状态下是别的节点，新建后才出现，删光再建会换节点），所以不在 `onMounted` 里
// 一次性取它：跟着元素的出现与更换走，出现时立即对一次，换掉或消失时释放观察者。
watch(nav, (element, _previous, onCleanup) => {
    if (element === null) return;
    revealCurrentSection();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(revealCurrentSection);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
}, {flush: "post"});

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
    // 复制插件主题：先把它的场景图、工作态场景和图标读出来、传成我的素材，全部成功才建副本（主题记录是原子的）。我的主题的素材文件名可以直接共用。
    const hasAssets = ["light", "dark"].some((appearance) => {
        const look = entry.declaration[appearance as "light" | "dark"];
        return look.scene !== undefined || look.workingScene !== undefined || look.icons !== undefined;
    });
    if (hasAssets && entry.plugin !== "user") {
        const copied = await props.transfer.copyAssets(entry);
        if (!copied.ok) {
            transferResult.value = {ok: false, message: {key: "copyFailed", params: {reason: copied.reason}}};
            return;
        }
        await model.create(entry, titleOf(entry.declaration.title), copied.declaration);
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
/**
 * 清理未使用素材（docs/specs/theme/editor.md 输出 22）：先统计，用户确认后只删统计里的那些，删除没有回收站。统计、确认、结果在顶栏下的
 * 一行里依次呈现；写素材的操作（上传、导入、复制）进行时不能开始，也不能确认。
 */
type Sweep =
    | {readonly kind: "idle"}
    | {readonly kind: "working"}
    | {readonly kind: "none"}
    | {readonly kind: "ask"; readonly names: ReadonlyArray<string>; readonly bytes: number}
    | {readonly kind: "done"; readonly removed: number; readonly skipped: number; readonly failed: number; readonly code?: string}
    | {readonly kind: "failed"; readonly failure: SweepFailure};
const sweep = ref<Sweep>({kind: "idle"});
const sweepCancel = ref<{readonly $el?: HTMLElement} | HTMLElement | null>(null);
/** 请求抛出的意外（统计与真删都先把 working 设上，不能让它卡住）：当作路由失败交回，不留未处理的拒绝。 */
const unexpectedFailure = (error: unknown): Sweep => ({kind: "failed", failure: {ok: false, kind: "route", reason: error instanceof Error ? error.message : String(error)}});
const startSweep = async (): Promise<void> => {
    if (sweep.value.kind === "working") return;
    sweep.value = {kind: "working"};
    try {
        const plan = await model.unusedAssets(props.transfer);
        sweep.value = !plan.ok ? {kind: "failed", failure: plan} : plan.names.length === 0 ? {kind: "none"} : {kind: "ask", names: plan.names, bytes: plan.bytes};
    } catch (error) {
        sweep.value = unexpectedFailure(error);
    }
    // 统计出来后“清理素材”停用，焦点留在停用的按钮上就丢了：不可恢复的确认默认落在更安全的“取消”上。
    if (sweep.value.kind === "ask") {
        await nextTick();
        const target = sweepCancel.value;
        (target instanceof HTMLElement ? target : target?.$el)?.focus();
    }
};
const confirmSweep = async (): Promise<void> => {
    const asked = sweep.value;
    if (asked.kind !== "ask") return;
    sweep.value = {kind: "working"};
    try {
        const done = await model.removeUnused(props.transfer, asked.names);
        sweep.value = done.ok ? {kind: "done", removed: done.removed, skipped: done.skipped, failed: done.failed, ...(done.code === undefined ? {} : {code: done.code})} : {kind: "failed", failure: done};
    } catch (error) {
        sweep.value = unexpectedFailure(error);
    }
};
/** 失败的一行用 `alert`，其余是 `status`；删除失败的素材（权限、被占用）与路由失败一样要让人看见。 */
const sweepBad = computed(() => sweep.value.kind === "failed" || (sweep.value.kind === "done" && sweep.value.failed > 0));
const sweepText = computed(() => {
    const state = sweep.value;
    switch (state.kind) {
        case "none": return text("themeEditor.library.sweepNone");
        case "ask": return text("themeEditor.library.sweepAsk", {count: state.names.length, kb: Math.max(1, Math.round(state.bytes / 1024))});
        case "done":
            if (state.failed > 0) return text("themeEditor.library.sweepDoneFailed", {removed: state.removed, failed: state.failed, code: state.code ?? "?"});
            return state.skipped === 0 ? text("themeEditor.library.sweepDone", {removed: state.removed}) : text("themeEditor.library.sweepDoneSkipped", {removed: state.removed, skipped: state.skipped});
        case "failed":
            switch (state.failure.kind) {
                case "not-ready": return text("themeEditor.library.sweepNotReady");
                case "unreadable": return text("themeEditor.library.sweepUnreadable");
                case "too-many": return text("themeEditor.library.sweepTooMany");
                default: return text("themeEditor.library.sweepFailed", {reason: state.failure.reason});
            }
        default: return "";
    }
});

/** 提示只属于那一次操作：换了主题或分区就清掉。 */
watch(() => [model.selectedId.value, model.section.value], () => {
    transferResult.value = null;
    unexpected.value = null;
    // 清理的提示也只属于那一次操作；统计出来的名单会过时，要重新统计（正在进行的不打断）。
    if (sweep.value.kind !== "working") sweep.value = {kind: "idle"};
});

/** 最近一次被拒绝的修改：标题空、取值引外部资源这类写不进去的，行内给原因，不静默。 */
const rejectedText = computed(() => {
    const reason = model.rejected.value;
    if (reason === null) return null;
    if (reason === TITLE_EMPTY) return text("themeEditor.rejected.titleEmpty");
    if (reason.startsWith(SAVE_FAILED)) return text("themeEditor.rejected.saveFailed", {code: reason.slice(SAVE_FAILED.length)});
    return text("themeEditor.rejected.invalid", {reason});
});

</script>

<template>
    <div class="theme-editor" data-theme-editor>
        <header class="theme-editor__bar">
            <div class="theme-editor__library">
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
                <Button size="sm" variant="ghost" icon-class="i-lucide-eraser" :loading="sweep.kind === 'working'" :disabled="sweep.kind === 'working' || sweep.kind === 'ask' || model.assetWork.value > 0 || !model.canClean.value" data-sweep @click="startSweep">{{ text("themeEditor.library.sweep") }}</Button>
            </div>
            <div class="theme-editor__view">
                <SegmentedControl
                    size="sm"
                    :model-value="model.appearance.value"
                    :options="appearanceOptions"
                    :aria-label="text('themeEditor.appearance.label')"
                    data-appearance
                    @update:model-value="model.appearance.value = $event as 'light' | 'dark'"
                />
                <Button v-if="closable" size="sm" variant="ghost" icon-class="i-lucide-x" data-close @click="emit('close')">{{ text("themeEditor.close") }}</Button>
            </div>
        </header>

        <!-- 常驻的提示区：读屏对“刚插入”的提示区往往不播报，所以元素一直在，只换内容。 -->
        <p class="theme-editor__transfer" :data-tone="unexpected !== null || transferResult?.ok === false ? 'bad' : transferResult === null ? '' : 'ok'" role="status" data-transfer>{{ transferText }}</p>
        <!-- 文字在常驻的提示区里（失败的一行是 alert），按钮在它旁边：礼貌型提示区里不放可点的控件。 -->
        <div class="theme-editor__sweep" :data-tone="sweepBad ? 'bad' : ''" data-sweep-status>
            <span v-if="sweepText !== ''" :role="sweepBad ? 'alert' : 'status'" data-sweep-text>{{ sweepText }}</span>
            <template v-if="sweep.kind === 'ask'">
                <Button size="sm" variant="danger" :disabled="model.assetWork.value > 0" data-sweep-confirm @click="confirmSweep">{{ text("themeEditor.library.sweepConfirm") }}</Button>
                <Button ref="sweepCancel" size="sm" variant="ghost" data-sweep-cancel @click="sweep = {kind: 'idle'}">{{ text("themeEditor.library.sweepCancel") }}</Button>
            </template>
        </div>
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
            <nav ref="nav" class="theme-editor__nav" :aria-label="text('themeEditor.sections.label')">
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
                    <ThemeEditorIcons v-else-if="model.section.value === 'icons'" :model="model" :transfer="transfer" />
                    <ThemeEditorContrast v-else :model="model" />
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

/*
 * 库操作自己换行，亮暗开关与关闭固定在右上：窗口变窄时只是库操作多占几行，开关不会被挤到只剩它们的一排。
 * 窄到库操作排不下 280px 时（手机宽度）整组才落到下一行。
 */
.theme-editor__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-bottom: var(--border-w) solid var(--border-color);
}

.theme-editor__library {
    display: flex;
    flex: 1 1 280px;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
}

.theme-editor__view {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3);
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

.theme-editor__sweep {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-6);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.theme-editor__sweep:empty {
    padding: 0;
}

.theme-editor__sweep[data-tone="bad"] {
    color: var(--status-danger);
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

.theme-editor__basic {
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

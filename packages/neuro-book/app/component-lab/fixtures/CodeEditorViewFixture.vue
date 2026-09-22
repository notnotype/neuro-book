<script setup lang="ts">
/**
 * CodeEditorView 的 Lab 场景：真实 Monaco 内核下的「一个文档、多种语言投影」。
 *
 * 演示重点：
 * 1. Markdown 正文与 HTML 都只有源码，没有预览或可视化编辑；
 * 2. JSON 不解析、不重排、不格式化——非法正文照样可编辑、可保存；
 * 3. 两个正文通道分得清：视图里输入经 change 结算回夹具，右栏改数据经内核 update 同步；
 * 4. 只读文档、空文档与「没有活动编辑器」的表现；
 * 5. 按钮与命令同源：disabled 与执行都走宿主注册表，命令注册生命周期绑定当前 ready 身份。
 *
 * 夹具扮演宿主，不读写磁盘、不接 store、不做保存排队：这里没有「已保存」这种结论。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";
import CodeEditorView from "nbook/app/components/editor-workbench/CodeEditorView.vue";
import {matchesEditorDocument} from "nbook/app/components/editor-workbench/editor-view.types";
import type {
    CommandEditorBinding,
    EditorChangeResult,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorViewHandle,
} from "nbook/app/components/editor-workbench/editor-view.types";
import {useWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";
import {registerEditorCommands} from "nbook/app/utils/workbench/editor-commands";
import type {CommandInvocation, CommandResult, Release} from "nbook/app/utils/workbench/commands";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const host = useWorkbenchCommands();

type SceneData = {
    path: string;
    content: string;
    languageId: string;
    readonly: boolean;
};

/** 无编辑器场景：只演示「没有活动编辑器时命令不注册」，不摆假编辑器。 */
const EDITORLESS_SCENES = new Set(["commands-unavailable"]);

/** 60 行、无尾换行：行号跳转的 1 / 60 边界就落在这份正文上。 */
function commandNavigationContent(): string {
    return Array.from({length: 60}, (_, index) => `第 ${index + 1} 行：命令导航验收`).join("\n");
}

/** 登记初值。右栏数据面板改的是同一份形状。 */
const sceneData: Record<string, SceneData> = {
    markdown: {
        path: "manuscript/chapter-01.md",
        languageId: "markdown",
        readonly: false,
        content: "# 开场\n\n潮水退下去的时候，礁石上留下了一层薄薄的盐。\n\n她把鞋提在手里，沿着滩涂往东走。\n\n> 那些没有说出口的话，最后都变成了潮声。\n\n- 第一件事：把灯点上\n- 第二件事：等他回来\n",
    },
    "json-invalid": {
        path: "project/chapters.json",
        languageId: "json",
        readonly: false,
        // 故意不是合法 JSON：缺少闭合括号、字符串没写完。夹具不替它补全，也不格式化。
        content: "{\n    \"chapters\": [\n        {\"id\": 1, \"title\": \"开场\"},\n        {\"id\": 2, \"title\": \"退潮\", \"draft\": tru\n",
    },
    "html-source": {
        path: "export/page.html",
        languageId: "html",
        readonly: false,
        content: "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"utf-8\">\n    <title>退潮</title>\n</head>\n<body>\n    <p>这段 HTML 只有源码，没有预览。</p>\n</body>\n</html>\n",
    },
    readonly: {
        path: "assets/导出的旧稿.txt",
        languageId: "plaintext",
        readonly: true,
        content: "这是一份只读文档：内核不允许输入，夹具也不伪造「保存成功」。\n",
    },
    empty: {
        path: "manuscript/未命名.md",
        languageId: "markdown",
        readonly: false,
        content: "",
    },
    "command-navigation": {
        path: "lab/command-navigation.txt",
        languageId: "plaintext",
        readonly: false,
        content: commandNavigationContent(),
    },
    "commands-unavailable": {
        path: "lab/commands-unavailable.txt",
        languageId: "plaintext",
        readonly: false,
        content: "",
    },
};

const path = ref("");
const content = ref("");
const languageId = ref("plaintext");
const readonly = ref(false);
/** 夹具扮演的权威缓冲修订：基线不符的提交如实回 conflict，实例必须保留候选。 */
const revision = ref(0);
/** 本场景的初值，用来判断「有未保存修改」，不是磁盘状态。 */
const baseline = ref("");
/** 文档身份：路径或语言或只读性变了就是另一份文档，要重建内核实例。 */
const identity = ref("");
/** 内核实例代号：由宿主单调分配，场景离开再回来不会复用旧 generation。 */
const mountKey = ref(0);
/** 交给视图的实例 token：同文档换实例时不复用模型身份。 */
const viewInstanceId = computed(() => `lab-code-view:${mountKey.value}`);
const temporaryFontSize = ref<number | null>(null);
const viewHandle = ref<EditorViewHandle | null>(null);
const lastCommandResult = ref("尚未执行命令");
let commandRelease: Release | null = null;
let commandGeneration: number | null = null;

const editorless = computed(() => EDITORLESS_SCENES.has(props.scene));
const target = computed<EditorDocumentTarget>(() => ({
    workspaceKey: "lab:code-editor-view",
    generation: mountKey.value,
    documentId: `lab-doc:${path.value}`,
    path: path.value,
}));
const documentSnapshot = computed<EditorDocumentSnapshot>(() => ({
    target: target.value,
    content: content.value,
    contentRevision: revision.value,
    languageId: languageId.value,
    readonly: readonly.value,
}));
const dirty = computed(() => content.value !== baseline.value);
const agentMode = computed({
    get: () => host.agentMode.value,
    set: (mode: "normal" | "discuss" | "plan") => {
        host.agentMode.value = mode;
    },
});

/** 右栏改数据可能被改成任意 JSON，先校验形状再消费，避免夹具自己崩掉。 */
function normalize(value: unknown): SceneData | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const candidate = value as Partial<SceneData>;
    if (typeof candidate.path !== "string" || typeof candidate.content !== "string" || typeof candidate.languageId !== "string") {
        return null;
    }
    return {
        path: candidate.path,
        content: candidate.content,
        languageId: candidate.languageId,
        readonly: candidate.readonly === true,
    };
}

function resolveScene(): SceneData {
    return normalize(props.data) ?? sceneData[props.scene] ?? sceneData.markdown!;
}

/** 命令是否可用的唯一判据：按钮 disabled 与执行入口读同一份求值结果。 */
function commandEnabled(id: string): boolean {
    const result = host.registry.isCommandEnabled(id);
    return result.ok && result.value === true;
}

/** 按钮与面板是同一入口：按钮只是「以 user 身份执行这条命令」的触发面。 */
async function runCommand(id: string, args?: unknown, invocation?: CommandInvocation): Promise<void> {
    const result: CommandResult<unknown> = await host.registry.executeCommand(id, args, invocation);
    lastCommandResult.value = result.ok ? `${id}：完成` : `${id}：${result.code}（${result.reason}）`;
    emitLabEvent("command", {
        id,
        ok: result.ok,
        invocation: invocation?.source ?? "user",
        code: result.ok ? null : result.code,
        reason: result.ok ? null : result.reason,
    });
}

/**
 * 撤下当前身份的四条命令：换代或卸载后旧句柄不能继续代表文档，
 * 确认等待期间的旧 registration identity 也随之失效。
 */
function releaseEditorCommands(): void {
    commandRelease?.();
    commandRelease = null;
    commandGeneration = null;
    viewHandle.value = null;
    if (host.activeEditor.value !== null) {
        host.activeEditor.value = null;
    }
    // editor-focus 是宿主事实：这里只上报「焦点不再在编辑器」。
    host.context.value = {...host.context.value, "editor-focus": false};
}

function registerCommandsFor(generation: number, handle: EditorViewHandle): void {
    const binding: CommandEditorBinding = {target: target.value, handle, readonly: readonly.value};
    host.activeEditor.value = binding;
    const registration = registerEditorCommands(host.registry, () => host.activeEditor.value);
    if (!registration.ok) {
        lastCommandResult.value = `编辑命令注册失败：${registration.reason}`;
        emitLabEvent("command-registration-error", registration.reason);
        return;
    }
    commandRelease = registration.value;
    commandGeneration = generation;
    emitLabEvent("commands-registered", {path: binding.target.path, generation});
}

function onReady(generation: number, handle: EditorViewHandle | null): void {
    // 迟到的旧实例回调不能清掉当前文档的注册：按挂载时捕获的 generation 比对。
    if (generation !== mountKey.value) {
        return;
    }
    if (handle === null) {
        releaseEditorCommands();
        emitLabEvent("ready", "内核卸载");
        return;
    }
    if (commandGeneration === generation && host.activeEditor.value?.handle === handle) {
        emitLabEvent("ready", "内核就绪");
        return;
    }
    releaseEditorCommands();
    viewHandle.value = handle;
    registerCommandsFor(generation, handle);
    emitLabEvent("ready", "内核就绪");
}

/**
 * 模板按渲染时的 generation 生成回调：事件执行时现读 mountKey 会认错身份。
 *
 * 绑定必须走计算属性、在模板里写成方法引用。`@ready="readyHandlerFor(mountKey)"` 是内联
 * 语句，Vue 只会执行它并丢弃返回的处理函数——事件永远到不了 onReady。
 */
function readyHandlerFor(generation: number): (handle: EditorViewHandle | null) => void {
    return (handle) => onReady(generation, handle);
}
const readyHandler = computed(() => readyHandlerFor(mountKey.value));

/** 夹具扮演的权威缓冲：基线过期回 conflict，目标已换代回 stale，都不是 accepted。 */
function onCommitChange(nextTarget: EditorDocumentTarget, baseRevision: number, next: string): EditorChangeResult {
    if (!matchesEditorDocument(nextTarget, target.value)) {
        return {status: "stale"};
    }
    if (baseRevision !== revision.value) {
        emitLabEvent("change-rejected", {path: nextTarget.path, baseRevision, revision: revision.value});
        return {status: "conflict", snapshot: documentSnapshot.value};
    }
    content.value = next;
    revision.value += 1;
    host.editorRevision.value += 1;
    emitLabEvent("change", {path: nextTarget.path, chars: next.length});
    return {status: "accepted", snapshot: documentSnapshot.value};
}

function onFocus(nextTarget: EditorDocumentTarget, focused: boolean): void {
    if (!matchesEditorDocument(nextTarget, target.value)) {
        return;
    }
    host.context.value = {...host.context.value, "editor-focus": focused};
    emitLabEvent("focus", {path: nextTarget.path, focused});
}

function onSave(nextTarget: EditorDocumentTarget): void {
    if (!matchesEditorDocument(nextTarget, target.value)) {
        return;
    }
    emitLabEvent("save", nextTarget.path);
}

function onTemporaryFontSize(size: number): void {
    temporaryFontSize.value = size;
    emitLabEvent("update-temporary-font-size", size);
}

/** 同 identity 的外部正文更新：不重建内核，但面板要按新的行数重算。 */
function applyExternalContent(next: string): void {
    content.value = next;
    revision.value += 1;
    host.editorRevision.value += 1;
}

/** 夹具自己发起的外部更新：模拟「别处改了正文，宿主推给视图」。 */
function externalUpdate(): void {
    applyExternalContent(`${content.value}\n\n（外部更新：这段文字不经过视图输入，走内核 update。）`);
    emitLabEvent("external-update", content.value.length);
}

function resetToBaseline(): void {
    applyExternalContent(baseline.value);
    emitLabEvent("reset", baseline.value.length);
}

watch(() => [props.scene, props.data] as const, () => {
    const next = resolveScene();
    const nextIdentity = `${next.path}|${next.languageId}|${next.readonly}`;

    path.value = next.path;
    languageId.value = next.languageId;
    readonly.value = next.readonly;

    if (editorless.value) {
        // 无编辑器场景不保留上一份文档的注册与活动绑定。
        releaseEditorCommands();
        identity.value = "";
        content.value = next.content;
        revision.value = 0;
        baseline.value = next.content;
        return;
    }

    if (nextIdentity !== identity.value) {
        // 身份变化：命令注册先下线，再按新文档重建内核（模型路径与初值一起换）。
        releaseEditorCommands();
        identity.value = nextIdentity;
        content.value = next.content;
        revision.value = 0;
        baseline.value = next.content;
        temporaryFontSize.value = null;
        mountKey.value = host.allocateEditorGeneration();
        return;
    }

    // 同一份文档：走内部件的「外部正文更新」通道，不重建实例。
    if (content.value !== next.content) {
        applyExternalContent(next.content);
    }
}, {immediate: true});

onBeforeUnmount(releaseEditorCommands);
</script>

<template>
    <div class="flex h-full min-h-[420px] min-w-0 flex-col bg-[var(--panel-surface)]">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--text-muted)]">
                <span class="font-mono text-[var(--text-main)]">{{ path }}</span>
                <span class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">{{ languageId }}</span>
                <span v-if="readonly" class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">只读</span>
                <span>{{ editorless ? "无编辑器" : (viewHandle ? "内核就绪" : "等待内核") }}</span>
                <span>{{ content.length }} 字符</span>
                <span :class="dirty ? 'text-[var(--status-warning)]' : ''">{{ dirty ? "与初值不同" : "与初值一致" }}</span>
                <span class="max-w-[280px] truncate font-mono text-[var(--text-secondary)]" data-lab-command-result>{{ lastCommandResult }}</span>
                <div class="flex-1"></div>
                <select
                    v-model="agentMode"
                    class="h-6 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1 text-[11px] text-[var(--text-main)]"
                    aria-label="模拟调用模式"
                >
                    <option value="normal">normal</option>
                    <option value="discuss">discuss</option>
                    <option value="plan">plan</option>
                </select>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="externalUpdate"
                >
                    外部更新正文
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="resetToBaseline"
                >
                    回到初值
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="viewHandle?.flushPendingChange()"
                >
                    冲刷待结算输入
                </button>
                <button
                    type="button"
                    :disabled="!commandEnabled('nbook.editor.focus')"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="runCommand('nbook.editor.focus')"
                >
                    聚焦
                </button>
                <button
                    type="button"
                    :disabled="!commandEnabled('nbook.edit.undo')"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="runCommand('nbook.edit.undo')"
                >
                    撤销
                </button>
                <button
                    type="button"
                    :disabled="!commandEnabled('nbook.edit.redo')"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="runCommand('nbook.edit.redo')"
                >
                    重做
                </button>
                <button
                    type="button"
                    :disabled="!commandEnabled('nbook.edit.undo')"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="runCommand('nbook.edit.undo', {}, {source: 'agent', callerId: 'lab'})"
                >
                    以 agent 执行撤销
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="runCommand('nbook.quick-open.open-commands')"
                >
                    命令面板
                </button>
            </div>
        </LabFixtureControls>

        <div v-if="editorless" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[12px] text-[var(--text-muted)]">
            <p class="text-[var(--text-main)]">这个场景没有活动编辑器。</p>
            <p>四条编辑命令不注册，行号导航不可用——触发面应当拒绝，而不是猜一个目标。</p>
        </div>
        <div v-else class="relative min-h-0 flex-1">
            <!--
                绝对定位是必需的：Monaco 会把自己测得的像素高度写成内联高度，而「随窗口」预设下
                盒子的高度就是内容自然高度，于是从平板切过来时会一直卡在上一档的高度。
                绝对定位的元素不参与父级内容高度计算，盒子只由 min-h 下限和确定高度决定。
            -->
            <CodeEditorView
                data-lab-subject
                class="absolute inset-0"
                :key="mountKey"
                :document="documentSnapshot"
                :visible="true"
                :view-instance-id="viewInstanceId"
                :commit-change="onCommitChange"
                :monaco-preferences="DEFAULT_MONACO_EDITOR_PREFERENCES"
                :temporary-font-size="temporaryFontSize"
                @save="onSave"
                @focus="onFocus"
                @ready="readyHandler"
                @update-temporary-font-size="onTemporaryFontSize"
            />
        </div>
    </div>
</template>

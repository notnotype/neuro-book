<script setup lang="ts">
/**
 * CodeEditorView 的 Lab 场景：真实 Monaco 内核下的「一个文档、多种语言投影」。
 *
 * 演示重点：
 * 1. Markdown 正文与 HTML 都只有源码，没有预览或可视化编辑；
 * 2. JSON 不解析、不重排、不格式化——非法正文照样可编辑、可保存；
 * 3. 两个正文通道分得清：视图里输入经 change 结算回夹具，右栏改数据经内核 update 同步；
 * 4. 只读文档与空文档的表现，以及 ready 句柄给出的聚焦/撤销/冲刷能力。
 *
 * 夹具扮演宿主，不读写磁盘、不接 store、不做保存排队：这里没有「已保存」这种结论。
 */
import {computed, ref, watch} from "vue";
import CodeEditorView from "nbook/app/components/editor-workbench/CodeEditorView.vue";
import type {EditorDocumentSnapshot, EditorDocumentTarget, EditorViewHandle} from "nbook/app/components/editor-workbench/editor-view.types";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneData = {
    path: string;
    content: string;
    languageId: string;
    readonly: boolean;
};

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
};

const path = ref("");
const content = ref("");
const languageId = ref("plaintext");
const readonly = ref(false);
/** 本场景的初值，用来判断「有未保存修改」，不是磁盘状态。 */
const baseline = ref("");
/** 文档身份：路径或语言或只读性变了就是另一份文档，要重建内核实例。 */
const identity = ref("");
const mountKey = ref(0);
const temporaryFontSize = ref<number | null>(null);
const viewHandle = ref<EditorViewHandle | null>(null);

const target = computed<EditorDocumentTarget>(() => ({
    workspaceKey: "lab:code-editor-view",
    generation: 1,
    documentId: `lab-doc:${path.value}`,
    path: path.value,
}));
const documentSnapshot = computed<EditorDocumentSnapshot>(() => ({
    target: target.value,
    content: content.value,
    languageId: languageId.value,
    readonly: readonly.value,
}));
const dirty = computed(() => content.value !== baseline.value);

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

watch(() => [props.scene, props.data] as const, () => {
    const next = resolveScene();
    const nextIdentity = `${next.path}|${next.languageId}|${next.readonly}`;
    path.value = next.path;
    languageId.value = next.languageId;
    readonly.value = next.readonly;
    if (nextIdentity !== identity.value) {
        // 身份变化：按新文档重建内核，模型路径与初值一起换。
        identity.value = nextIdentity;
        content.value = next.content;
        baseline.value = next.content;
        temporaryFontSize.value = null;
        mountKey.value += 1;
        return;
    }
    // 同一份文档：走内部件的「外部正文更新」通道，不重建实例。
    content.value = next.content;
}, {immediate: true});

function onChange(nextTarget: EditorDocumentTarget, next: string): void {
    content.value = next;
    emitLabEvent("change", {path: nextTarget.path, chars: next.length});
}

function onReady(handle: EditorViewHandle | null): void {
    viewHandle.value = handle;
    emitLabEvent("ready", handle ? "内核就绪" : "内核卸载");
}

function onSave(nextTarget: EditorDocumentTarget): void {
    emitLabEvent("save", nextTarget.path);
}

function onFocus(nextTarget: EditorDocumentTarget, focused: boolean): void {
    emitLabEvent("focus", {path: nextTarget.path, focused});
}

function onTemporaryFontSize(size: number): void {
    temporaryFontSize.value = size;
    emitLabEvent("update-temporary-font-size", size);
}

/** 夹具自己发起的外部更新：模拟「别处改了正文，宿主推给视图」。 */
function externalUpdate(): void {
    content.value = `${content.value}\n\n（外部更新：这段文字不经过视图输入，走内核 update。）`;
    emitLabEvent("external-update", content.value.length);
}

function resetToBaseline(): void {
    content.value = baseline.value;
    emitLabEvent("reset", baseline.value.length);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span class="font-mono text-[var(--text-main)]">{{ path }}</span>
            <span class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">{{ languageId }}</span>
            <span v-if="readonly" class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">只读</span>
            <span>{{ viewHandle ? "内核就绪" : "等待内核" }}</span>
            <span>{{ content.length }} 字符</span>
            <span :class="dirty ? 'text-[var(--status-warning)]' : ''">{{ dirty ? "与初值不同" : "与初值一致" }}</span>
            <div class="flex-1"></div>
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
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="viewHandle?.focus()"
            >
                聚焦
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="viewHandle?.undo?.()"
            >
                撤销
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="viewHandle?.redo?.()"
            >
                重做
            </button>
        </div>

        <div class="min-h-0 flex-1">
            <CodeEditorView
                data-lab-subject
                :key="mountKey"
                :document="documentSnapshot"
                :visible="true"
                :monaco-preferences="DEFAULT_MONACO_EDITOR_PREFERENCES"
                :temporary-font-size="temporaryFontSize"
                @change="onChange"
                @save="onSave"
                @focus="onFocus"
                @ready="onReady"
                @update-temporary-font-size="onTemporaryFontSize"
            />
        </div>
    </div>
</template>

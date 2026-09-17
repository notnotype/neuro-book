<script setup lang="ts">
/**
 * MonacoCodeEditor 的 Lab 场景：通用源码内核本身。
 *
 * 与 CodeEditorView 的分工：这里检视内核的入参——初值、语言、只读、占位文案与显示偏好；
 * 文档身份、视图句柄与切换时序在 CodeEditorView / EditorViewHost 的场景里看。
 *
 * initialValue 是**建实例时的**初值，之后改它不会替换正文（那是产品合同，不是夹具的偷懒）：
 * 所以右栏改数据会重建实例，夹具内的输入只结算到状态行，不回灌内核。
 */
import {computed, ref, watch} from "vue";
import MonacoCodeEditor from "nbook/app/components/editor-workbench/MonacoCodeEditor.vue";
import {DEFAULT_MONACO_EDITOR_PREFERENCES, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneData = {
    initialValue: string;
    language: string;
    readonly: boolean;
    placeholder: string;
    temporaryFontSize: number | null;
    preferences: MonacoEditorPreferences;
};

type ScenePatch = {
    initialValue?: string;
    language?: string;
    readonly?: boolean;
    placeholder?: string;
    temporaryFontSize?: number | null;
    preferences?: Partial<MonacoEditorPreferences>;
};
function preferences(overrides: Partial<MonacoEditorPreferences> = {}): MonacoEditorPreferences {
    return {...DEFAULT_MONACO_EDITOR_PREFERENCES, ...overrides};
}

const sceneData: Record<string, SceneData> = {
    markdown: {
        initialValue: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n\n- 把灯点上\n- 等他回来\n",
        language: "markdown",
        readonly: false,
        placeholder: "",
        temporaryFontSize: null,
        preferences: preferences(),
    },
    typescript: {
        initialValue: "type Draft = {\n    id: string;\n    title: string;\n    words: number;\n};\n\nfunction isLong(draft: Draft): boolean {\n    return draft.words > 3000;\n}\n",
        language: "typescript",
        readonly: false,
        placeholder: "",
        temporaryFontSize: null,
        preferences: preferences({tabSize: 4, lineNumbers: true}),
    },
    readonly: {
        initialValue: "这份文档只读：可以选中、复制、滚动，但输入不会进入正文。\n",
        language: "plaintext",
        readonly: true,
        placeholder: "",
        temporaryFontSize: null,
        preferences: preferences(),
    },
    placeholder: {
        initialValue: "",
        language: "markdown",
        readonly: false,
        placeholder: "在此输入正文，Ctrl+S 发出保存请求…",
        temporaryFontSize: null,
        preferences: preferences(),
    },
    preferences: {
        initialValue: "const unwrapped = \"这一段不自动换行，并且显示空白字符与行号开关的效果\";\n\n\t缩进用制表符，字号被临时调大。\n",
        language: "javascript",
        readonly: false,
        placeholder: "",
        temporaryFontSize: 22,
        preferences: preferences({wordWrap: false, lineNumbers: false, renderWhitespace: true, tabSize: 8, fontSize: 18}),
    },
};

const initialValue = ref("");
const language = ref("plaintext");
const readonly = ref(false);
const placeholder = ref("");
const temporaryFontSize = ref<number | null>(null);
const viewPreferences = ref<MonacoEditorPreferences>(preferences());
const visible = ref(true);
const mountKey = ref(0);
const ready = ref(false);
/** 状态行只反映夹具收到的输入，不代表任何磁盘状态。 */
const liveValue = ref("");
const lastEvent = ref("");

/** 右栏数据是按字段覆盖场景初值的补丁，不是整份替换：少写一个键就沿用场景的登记值。 */
function readPreferences(value: unknown): Partial<MonacoEditorPreferences> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const patch: Partial<MonacoEditorPreferences> = {};
    if (typeof raw.fontFamily === "string") {
        patch.fontFamily = raw.fontFamily;
    }
    if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)) {
        patch.fontSize = raw.fontSize;
    }
    if (typeof raw.lineHeight === "number" && Number.isFinite(raw.lineHeight)) {
        patch.lineHeight = raw.lineHeight;
    }
    if (typeof raw.tabSize === "number" && Number.isFinite(raw.tabSize)) {
        patch.tabSize = raw.tabSize;
    }
    if (typeof raw.wordWrap === "boolean") {
        patch.wordWrap = raw.wordWrap;
    }
    if (typeof raw.minimapEnabled === "boolean") {
        patch.minimapEnabled = raw.minimapEnabled;
    }
    if (typeof raw.lineNumbers === "boolean") {
        patch.lineNumbers = raw.lineNumbers;
    }
    if (typeof raw.renderWhitespace === "boolean") {
        patch.renderWhitespace = raw.renderWhitespace;
    }
    return patch;
}

function normalize(value: unknown): ScenePatch | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    const patch: ScenePatch = {};
    if (typeof candidate.initialValue === "string") {
        patch.initialValue = candidate.initialValue;
    }
    if (typeof candidate.language === "string") {
        patch.language = candidate.language;
    }
    if (typeof candidate.readonly === "boolean") {
        patch.readonly = candidate.readonly;
    }
    if (typeof candidate.placeholder === "string") {
        patch.placeholder = candidate.placeholder;
    }
    if (candidate.temporaryFontSize === null || (typeof candidate.temporaryFontSize === "number" && Number.isFinite(candidate.temporaryFontSize))) {
        patch.temporaryFontSize = candidate.temporaryFontSize;
    }
    if (candidate.preferences !== undefined) {
        const preferencePatch = readPreferences(candidate.preferences);
        if (preferencePatch !== null) {
            patch.preferences = preferencePatch;
        }
    }
    return patch;
}

function resolveScene(): SceneData {
    const base = sceneData[props.scene] ?? sceneData.markdown!;
    const patch = normalize(props.data);
    if (!patch) {
        return base;
    }
    return {
        ...base,
        ...patch,
        preferences: {...base.preferences, ...(patch.preferences ?? {})},
    };
}

watch(() => [props.scene, props.data] as const, () => {
    const next = resolveScene();
    initialValue.value = next.initialValue;
    language.value = next.language;
    readonly.value = next.readonly;
    placeholder.value = next.placeholder;
    temporaryFontSize.value = next.temporaryFontSize;
    viewPreferences.value = next.preferences;
    visible.value = true;
    liveValue.value = next.initialValue;
    ready.value = false;
    lastEvent.value = "";
    mountKey.value += 1;
}, {immediate: true});

/** 隐藏场景：visible 是产品的「重新可见前同步最新快照」开关，这里只做挂载与卸载观察。 */
function toggleVisible(): void {
    visible.value = !visible.value;
    emitLabEvent("visible", visible.value);
}

const dirty = computed(() => liveValue.value !== initialValue.value);
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">{{ language }}</span>
            <span v-if="readonly" class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">只读</span>
            <span v-if="temporaryFontSize">{{ `临时字号 ${temporaryFontSize}` }}</span>
            <span>{{ visible ? "可见" : "已隐藏" }}</span>
            <span>{{ ready ? "内核就绪" : "等待内核" }}</span>
            <span :class="dirty ? 'text-[var(--status-warning)]' : ''">{{ dirty ? `输入 ${liveValue.length} 字符（与初值不同）` : `初值 ${initialValue.length} 字符` }}</span>
            <span v-if="lastEvent" class="font-mono text-[var(--text-main)]">{{ lastEvent }}</span>
            <div class="flex-1"></div>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="toggleVisible"
            >
                可见性开关
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="mountKey += 1; liveValue = initialValue; ready = false"
            >
                重置实例
            </button>
        </div>

        <div class="min-h-0 flex-1">
            <MonacoCodeEditor
                data-lab-subject
                :key="mountKey"
                :initial-value="initialValue"
                :language="language"
                :readonly="readonly"
                :placeholder="placeholder"
                :visible="visible"
                :monaco-preferences="viewPreferences"
                :temporary-font-size="temporaryFontSize"
                @ready="ready = true; emitLabEvent('ready')"
                @change="(value: string) => { liveValue = value; lastEvent = `change ${value.length}`; emitLabEvent('change', value.length); }"
                @focus="emitLabEvent('focus')"
                @blur="emitLabEvent('blur')"
                @save-request="emitLabEvent('save-request')"
                @update-temporary-font-size="emitLabEvent('update-temporary-font-size', $event)"
            />
        </div>
    </div>
</template>

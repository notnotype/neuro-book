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
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof MonacoCodeEditor>(() => props.input, ["ready", "change", "focus", "blur", "save-request", "submit", "shift-tab", "update-temporary-font-size"]);
const emitLabEvent = useLabEventSink();
const visible = ref(true);
const mountKey = ref(0);
const ready = ref(false);
/** 内核正文只在建实例时取 initialValue；输入面板修改会重建内核。 */
const liveValue = ref("");
const lastEvent = ref("");
const initialValue = computed(() => subject.bindings.value.initialValue ?? "");
const language = computed(() => subject.bindings.value.language ?? "plaintext");
const readonly = computed(() => subject.bindings.value.readonly ?? false);
const temporaryFontSize = computed(() => subject.bindings.value.temporaryFontSize ?? null);

watch(() => [props.scene, initialValue.value] as const, () => {
    visible.value = true;
    liveValue.value = initialValue.value;
    ready.value = false;
    lastEvent.value = "";
    mountKey.value += 1;
}, {immediate: true});

/** 隐藏场景：visible 是产品的「重新可见前同步最新快照」开关。 */
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
                v-bind="subject.bindings.value"
                :visible="visible"
                @ready="ready = true"
                @change="(value: string) => { liveValue = value; lastEvent = `change ${value.length}`; }"
                @update-temporary-font-size="subject.write('props', 'temporaryFontSize', $event)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import DialogWindow from "../../../../src/components/feedback/DialogWindow.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const controls = ref<Record<string, string | boolean>>({});
const open = ref(false);
const width = ref(560);
const height = ref(520);
const closeReason = ref("");

const resizable = computed(() => props.sceneId === "resizable" || Boolean(controls.value.resizable));
const closable = computed(() => controls.value.closable !== false);

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) {
        defaults[control.id] = controlDefaultValue(control);
    }
    controls.value = defaults;
    open.value = false;
    width.value = 560;
    height.value = 520;
    closeReason.value = "";
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

function onOpenChange(value: boolean): void {
    open.value = value;
    emit("lab-event", "update:modelValue", value);
}

function onRequestClose(reason: "close-button" | "esc"): void {
    closeReason.value = reason;
    emit("lab-event", "request-close", reason);
    open.value = false;
}

function onWidth(value: number): void {
    width.value = value;
    emit("lab-event", "update:width", value);
}

function onHeight(value: number): void {
    height.value = value;
    emit("lab-event", "update:height", value);
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div class="max-w-2xl space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--divider)] pb-3">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">非模态浮动工作窗</h3>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">窗口外页面保持可交互；标题栏可拖动，{{ resizable ? "右侧、底部和右下角可调整尺寸。" : "当前未启用尺寸调整。" }}</p>
                </div>
                <Badge size="sm" :tone="open ? 'success' : 'neutral'" :dot="open">{{ open ? "已打开" : "已关闭" }}</Badge>
            </div>

            <Button id="nb-lab-target" variant="primary" icon-class="i-lucide-panel-top-open" @click="open = true">打开 DialogWindow</Button>

            <p v-if="closeReason" class="text-xs text-[var(--text-muted)]">最近关闭原因：{{ closeReason }}</p>
            <p class="text-xs text-[var(--text-muted)]">当前尺寸：{{ width }} × {{ height }} px；Tab 可进入 resize 手柄，方向键每次调整 10px。</p>

            <DialogWindow
                v-model="open"
                title="组件库非模态窗口"
                title-align="left"
                :width="width"
                :height="`${height}px`"
                max-height="calc(100vh - 80px)"
                :resizable="resizable"
                :closable="closable"
                teleport-target="body"
                @request-close="onRequestClose"
                @update:model-value="onOpenChange"
                @update:width="onWidth"
                @update:height="onHeight"
            >
                <div class="space-y-4">
                    <p>这是一个非模态 DialogWindow。点击窗口外的 Lab 控件不会关闭它，页面仍可继续操作。</p>
                    <label class="block text-xs font-medium text-[var(--text-secondary)]" for="dialog-window-demo-input">窗口内字段</label>
                    <FormInput id="dialog-window-demo-input" model-value="可编辑的窗口内容" name="dialog-window-demo" />
                    <p>长内容会在 body 区域内部滚动，不会把窗口外页面撑出横向滚动。</p>
                    <div class="h-80 rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] p-3 text-xs text-[var(--text-muted)]">滚动占位内容</div>
                </div>
                <template #footer>
                    <Button size="sm" variant="secondary" @click="open = false">关闭窗口</Button>
                </template>
            </DialogWindow>
        </div>
    </FixtureShell>
</template>

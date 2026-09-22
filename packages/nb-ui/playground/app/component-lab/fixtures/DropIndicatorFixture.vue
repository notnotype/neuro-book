<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import DropFeedbackOverlay, {type DropFeedbackPreview} from "../../../../src/components/layout/DropFeedbackOverlay.vue";
import DropIndicator from "../../../../src/components/layout/DropIndicator.vue";
import DropIndicatorLabel from "../../../../src/components/layout/DropIndicatorLabel.vue";
import type {GridDropRect} from "../../../../src/components/layout/grid-drop";
import FixtureShell from "../FixtureShell.vue";
import type {LabComponentDefinition} from "../registry";

/**
 * 拖放反馈原语 + 共享覆盖层的 Lab 演示。
 *
 * 前五场景是**静态**皮肤样例（area / entry / line / compact / long-label），不引入任何拖动管理器。
 * 覆盖层演示复用同一批形状：按钮把 `DropFeedbackOverlay` 的 `preview` 接到当前场景形状的**真实矩形**上，
 * 于是能直接看见公共层的内缩、提示药丸与 fixed 定位，而静态形状仍在原处作对照。关闭按钮 / `Esc` /
 * 场景切换都清掉 preview；监听器只在打开期间挂着，卸载时一并摘掉。几何归覆盖层自己算，这里不缓存坐标。
 */
const props = defineProps<{definition: LabComponentDefinition; sceneId: string}>();
const emit = defineEmits<{(event: "rendered"): void}>();
const variant = computed(() => props.sceneId === "line" ? "line" : props.sceneId === "area" ? "area" : "entry");
const label = computed(() => props.sceneId === "long-label"
    ? "将选中的全部视图移动到这个容器，同时保留当前编辑进度与视图状态"
    : props.sceneId === "area" ? "在右侧分屏" : "移动视图");

const stageRef = ref<HTMLElement | null>(null);
const overlayOpen = ref(false);
const overlayPreview = ref<DropFeedbackPreview | null>(null);

function rectOf(selector: string): GridDropRect | null {
    const element = stageRef.value?.querySelector(selector) ?? null;
    if (element === null) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom} : null;
}

/**
 * 覆盖层吃的是 viewport 坐标，所以直接把舞台上真实画出来的形状矩形喂进去：覆盖层与静态形状对齐，
 * 差别只剩它自己的内缩与药丸。线场景给竖直插入线（容器主轴水平），其余场景按当前皮肤给半区或条目。
 */
function syncOverlay(): void {
    if (!overlayOpen.value) {
        overlayPreview.value = null;
        return;
    }
    if (props.sceneId === "line") {
        overlayPreview.value = {areaRect: null, entryRect: null, indicator: rectOf(".drop-fixture__vertical-line"), orientation: "horizontal"};
        return;
    }
    const shape = rectOf("#nb-lab-target");
    overlayPreview.value = props.sceneId === "area"
        ? {areaRect: shape, entryRect: null, indicator: null, orientation: "vertical"}
        : {areaRect: null, entryRect: shape, indicator: null, orientation: "vertical"};
}

function releaseOverlayListeners(): void {
    window.removeEventListener("resize", syncOverlay);
    window.removeEventListener("keydown", handleOverlayKeydown);
}

function closeOverlay(): void {
    overlayOpen.value = false;
    overlayPreview.value = null;
    releaseOverlayListeners();
}

function toggleOverlay(): void {
    if (overlayOpen.value) {
        closeOverlay();
        return;
    }
    overlayOpen.value = true;
    window.addEventListener("resize", syncOverlay);
    window.addEventListener("keydown", handleOverlayKeydown);
    // 等一帧再量：场景切换后的布局稳定下来，坐标不会落在上一帧的盒子上。
    void nextTick(() => {
        syncOverlay();
        emit("rendered");
    });
}

function handleOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        closeOverlay();
    }
}

watch(() => props.sceneId, () => void nextTick(() => {
    syncOverlay();
    emit("rendered");
}));
onMounted(() => void nextTick(() => emit("rendered")));
onBeforeUnmount(releaseOverlayListeners);
</script>

<template>
    <FixtureShell :definition="definition" :scene-id="sceneId" :controls="{}">
        <div ref="stageRef" class="drop-fixture" :data-scene="sceneId">
            <div class="drop-fixture__content">
                <span>文档工作区</span>
                <span>拖放反馈不拦截下层指针</span>
            </div>
            <DropIndicator id="nb-lab-target" :variant="variant" class="drop-fixture__shape" />
            <DropIndicator v-if="sceneId === 'line'" variant="line" class="drop-fixture__vertical-line" />
            <div class="drop-fixture__label">
                <DropIndicatorLabel :label="label" icon-class="i-lucide-move" />
            </div>
            <div class="drop-fixture__controls">
                <button type="button" class="drop-fixture__button" :aria-pressed="overlayOpen" @click="toggleOverlay">
                    {{ overlayOpen ? "关闭共享覆盖层" : "显示共享覆盖层" }}
                </button>
                <span class="drop-fixture__note">DropFeedbackOverlay 按当前形状的真实矩形落位；Esc 关闭</span>
            </div>
        </div>
        <DropFeedbackOverlay :preview="overlayPreview" :label="label" icon-class="i-lucide-move" />
    </FixtureShell>
</template>

<style scoped>
.drop-fixture {
    position: relative;
    width: min(100%, 560px);
    min-width: 0;
    height: 240px;
    color: var(--text-secondary);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
}
.drop-fixture__content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
}
.drop-fixture__shape {
    position: absolute;
    inset: 12px;
}
.drop-fixture__label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    min-width: 0;
}
/* 形状是绝对定位且不接管指针，按钮抬一层就能照常点 */
.drop-fixture__controls {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    min-width: 0;
}
.drop-fixture__button {
    flex: none;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 40%, transparent);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--panel-surface) 90%, transparent);
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: pointer;
}
.drop-fixture__note {
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
[data-scene="entry"] .drop-fixture__shape,
[data-scene="long-label"] .drop-fixture__shape {
    inset: 96px 12px auto;
    height: 40px;
}
[data-scene="line"] .drop-fixture__shape {
    inset: 80px 12px auto;
    height: 2px;
}
[data-scene="compact"] .drop-fixture__shape {
    inset: 48px auto auto 16px;
    width: 40px;
    height: 40px;
}
.drop-fixture__vertical-line {
    position: absolute;
    left: 12px;
    top: 144px;
    width: 2px;
    height: 72px;
}
</style>

<script setup lang="ts">
/**
 * 场景取景编辑（同名 .md，docs/specs/theme/editor.md 输出 12、13）：五个取景框叠在同一张原图上，选中的实线、其余淡显；
 * 右边列表选框、改数值。拖框、拉右下角缩放和改数值互相同步，每一步都交给模型，工作台里对应位置同时变化。
 */
import {computed, onBeforeUnmount, ref} from "vue";

import {Button, Input} from "@notnotype/nb-ui/components";

import type {ThemeDeclaration} from "../../shared/themes";
import {useWorkbenchText} from "../text";
import {clampFrame, CROP_REGIONS, readFrame, writeFrame} from "./crop-model";
import type {CropCss, CropFrame, CropRegion, ImageSize} from "./crop-model";

defineOptions({name: "CropEditor"});

const props = defineProps<{
    imageUrl: string;
    crop: ThemeDeclaration["crop"] | undefined;
}>();

const emit = defineEmits<{
    /** 一个位置的取景变了；`undefined` 是清掉这个位置。 */
    (event: "change", region: CropRegion, css: CropCss | undefined): void;
    (event: "content-x", value: number | undefined): void;
    (event: "load-failed"): void;
}>();

const text = useWorkbenchText();

const COLORS: Readonly<Record<CropRegion, string>> = {empty: "#0f766e", marginLeft: "#b45309", marginRight: "#7c3aed", sidebarCorner: "#be123c", auxiliaryCorner: "#1d4ed8"};
const DEFAULTS: Readonly<Record<Exclude<CropRegion, "empty">, string>> = {marginLeft: "auto 118%", marginRight: "auto 118%", sidebarCorner: "1000px auto", auxiliaryCorner: "1000px auto"};

const image = ref<ImageSize | null>(null);
const picture = ref<HTMLElement | null>(null);
const selected = ref<CropRegion>("marginLeft");

const cssOf = (region: CropRegion): CropCss => (props.crop?.[region] ?? {}) as CropCss;
const regionName = (region: CropRegion): string => text(`themeEditor.scene.region.${region}` as "themeEditor.scene.region.empty");

/** 拖动中的框：先画在本地，停手或隔一小段时间再交给模型，免得每个像素写一次记录。 */
const draft = ref<{readonly region: CropRegion; readonly frame: CropFrame} | null>(null);

const frameOf = (region: CropRegion): CropFrame | null => {
    if (draft.value?.region === region) return draft.value.frame;
    return image.value === null ? null : readFrame(region, cssOf(region), image.value);
};
const frames = computed(() => CROP_REGIONS.map((region) => ({region, frame: frameOf(region)})));

const onLoad = (event: Event): void => {
    const element = event.target as HTMLImageElement;
    image.value = {width: element.naturalWidth, height: element.naturalHeight};
};

// ---- 拖框与缩放 ----

interface Gesture {
    readonly region: CropRegion;
    readonly mode: "move" | "resize";
    readonly startX: number;
    readonly startY: number;
    readonly frame: CropFrame;
    readonly width: number;
    readonly height: number;
}
let gesture: Gesture | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

const commit = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
    const current = draft.value;
    if (current !== null) emit("change", current.region, writeFrame(current.region, current.frame));
};
const schedule = (): void => {
    if (pending === null) pending = setTimeout(commit, 120);
};

const startGesture = (event: PointerEvent, region: CropRegion, mode: "move" | "resize"): void => {
    const frame = frameOf(region);
    const rect = picture.value?.getBoundingClientRect();
    if (frame === null || rect === undefined || image.value === null) return;
    selected.value = region;
    gesture = {region, mode, startX: event.clientX, startY: event.clientY, frame, width: rect.width, height: rect.height};
    draft.value = {region, frame};
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
};

const moveGesture = (event: PointerEvent): void => {
    const active = gesture;
    const size = image.value;
    if (active === null || size === null) return;
    const [dx, dy] = [(event.clientX - active.startX) / active.width, (event.clientY - active.startY) / active.height];
    let frame: CropFrame;
    if (active.mode === "move") {
        // 空状态的框大小由 cover 决定，可以比图大：只限制位置，不改大小。
        const room = (span: number): number => Math.max(0, 1 - span);
        frame = {...active.frame, x: Math.min(room(active.frame.w), Math.max(0, active.frame.x + dx)), y: Math.min(room(active.frame.h), Math.max(0, active.frame.y + dy))};
    } else {
        frame = clampFrame(active.region, {...active.frame, w: active.frame.w + dx}, size);
        // 缩放时右下角跟着指针，左上角不动；缩小后不出图的部分由 clampFrame 收回。
        frame = {...frame, x: Math.min(1 - frame.w, active.frame.x), y: Math.min(1 - frame.h, active.frame.y)};
    }
    draft.value = {region: active.region, frame};
    schedule();
};

const endGesture = (): void => {
    if (gesture === null) return;
    gesture = null;
    commit();
    draft.value = null;
};

onBeforeUnmount(() => {
    if (pending !== null) clearTimeout(pending);
});

// ---- 数值 ----

const sizeValue = computed(() => cssOf(selected.value).size ?? "");
const positionValue = computed(() => cssOf(selected.value).position ?? "");
const unparsable = computed(() => image.value !== null && frameOf(selected.value) === null && (sizeValue.value !== "" || positionValue.value !== ""));

const editNumbers = (field: "size" | "position", value: string): void => {
    const region = selected.value;
    if (region === "empty") {
        if (field === "position") emit("change", region, {position: value});
        return;
    }
    emit("change", region, {size: field === "size" ? value : sizeValue.value || DEFAULTS[region], position: field === "position" ? value : positionValue.value || "50% 50%"});
};

const contentX = computed(() => String(props.crop?.empty?.contentX ?? ""));
const editContentX = (value: string): void => {
    const number = Number(value);
    emit("content-x", value.trim() === "" || !Number.isFinite(number) ? undefined : number);
};

const styleOf = (frame: CropFrame): Record<string, string> => ({
    left: `${String(frame.x * 100)}%`,
    top: `${String(frame.y * 100)}%`,
    width: `${String(frame.w * 100)}%`,
    height: `${String(frame.h * 100)}%`,
});
</script>

<template>
    <div class="crop-editor" data-crop-editor>
        <div class="crop-editor__stage">
            <div ref="picture" class="crop-editor__picture" @pointermove="moveGesture" @pointerup="endGesture" @pointercancel="endGesture">
                <img class="crop-editor__image" :src="imageUrl" :alt="text('themeEditor.scene.image')" draggable="false" @load="onLoad" @error="emit('load-failed')" />
                <template v-for="item in frames" :key="item.region">
                    <div
                        v-if="item.frame !== null"
                        class="crop-editor__frame"
                        :class="{'crop-editor__frame--selected': selected === item.region}"
                        :style="{...styleOf(item.frame), '--frame-color': COLORS[item.region]}"
                        role="button"
                        tabindex="0"
                        :aria-label="text('themeEditor.scene.frame', {region: regionName(item.region)})"
                        :data-crop-frame="item.region"
                        @pointerdown="startGesture($event, item.region, 'move')"
                        @focus="selected = item.region"
                    >
                        <span class="crop-editor__tag">{{ regionName(item.region) }}</span>
                        <span v-if="selected === item.region && item.region !== 'empty'" class="crop-editor__handle" data-crop-handle @pointerdown="startGesture($event, item.region, 'resize')" />
                    </div>
                </template>
            </div>
            <p class="crop-editor__hint">{{ text("themeEditor.scene.hint") }}</p>
        </div>

        <div class="crop-editor__side">
            <ul class="crop-editor__list" role="listbox" :aria-label="text('themeEditor.scene.image')">
                <li v-for="region in CROP_REGIONS" :key="region">
                    <button type="button" role="option" class="crop-editor__item" :aria-selected="selected === region" :data-crop-item="region" @click="selected = region">
                        <i class="crop-editor__chip" :style="{background: COLORS[region]}" />
                        <span>{{ regionName(region) }}</span>
                    </button>
                </li>
            </ul>

            <div class="crop-editor__numbers" :data-crop-numbers="selected">
                <label v-if="selected !== 'empty'" class="crop-editor__number">
                    <span>{{ text("themeEditor.scene.size") }}</span>
                    <Input size="sm" :model-value="sizeValue" @update:model-value="editNumbers('size', $event)" />
                </label>
                <label class="crop-editor__number">
                    <span>{{ text("themeEditor.scene.position") }}</span>
                    <Input size="sm" :model-value="positionValue" @update:model-value="editNumbers('position', $event)" />
                </label>
                <label v-if="selected === 'empty'" class="crop-editor__number">
                    <span>{{ text("themeEditor.scene.contentX") }}</span>
                    <Input size="sm" :model-value="contentX" placeholder="0.25 – 0.5" @update:model-value="editContentX($event)" />
                </label>
                <p v-if="unparsable" class="crop-editor__warn" data-crop-unparsable>{{ text("themeEditor.scene.unparsable") }}</p>
                <Button size="sm" variant="ghost" :disabled="sizeValue === '' && positionValue === ''" @click="emit('change', selected, undefined)">{{ text("themeEditor.scene.clear") }}</Button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.crop-editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: var(--space-6);
    align-items: start;
}

.crop-editor__stage {
    min-width: 0;
}

.crop-editor__picture {
    position: relative;
    line-height: 0;
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-control);
    overflow: hidden;
    touch-action: none;
    user-select: none;
}

.crop-editor__image {
    display: block;
    width: 100%;
    height: auto;
}

/* 取景框用固定的标注色：它们叠在任意一张图上，不能取主题色。 */
.crop-editor__frame {
    position: absolute;
    box-sizing: border-box;
    border: 2px dashed var(--frame-color);
    background: color-mix(in srgb, var(--frame-color) 8%, transparent);
    opacity: 0.55;
    cursor: grab;
}

.crop-editor__frame--selected {
    border-style: solid;
    background: color-mix(in srgb, var(--frame-color) 14%, transparent);
    opacity: 1;
    z-index: 1;
}

.crop-editor__tag {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0 var(--space-2);
    background: var(--frame-color);
    color: #fff;
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
}

.crop-editor__handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: var(--frame-color);
    cursor: nwse-resize;
}

.crop-editor__hint {
    margin: var(--space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.crop-editor__side {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.crop-editor__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}

.crop-editor__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-main);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
}

.crop-editor__item:hover {
    background: var(--bg-hover);
}

.crop-editor__item[aria-selected="true"] {
    background: var(--accent-bg);
    font-weight: 600;
}

.crop-editor__chip {
    width: 10px;
    height: 10px;
    border-radius: 3px;
}

.crop-editor__numbers {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.crop-editor__number {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.crop-editor__warn {
    margin: 0;
    color: var(--status-warning);
    font-size: var(--text-xs);
}

@container (max-width: 520px) {
    .crop-editor {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>

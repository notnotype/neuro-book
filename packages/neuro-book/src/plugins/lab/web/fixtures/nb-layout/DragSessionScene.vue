<script setup lang="ts">
/**
 * 拖动会话的真实浏览器验收场景（docs/specs/ui/layout-drag.md，断言在 e2e/lab-drag-session.e2e.ts）。会话是 DOM 适配，捕获、
 * 焦点与边缘滚动的时序只有真实浏览器里才发生，这里不依赖外壳、编辑器或资源树，出问题时分得清是会话还是宿主。
 *
 * 来源：两个按钮、滚动区里的行。落点：滚动区里的行、两个登记的落点、一块只显示不提交的区域。提交、结束、来源收到的 click
 * 与按键都写进日志（`data-session-log`），e2e 按它断言。
 */
import {computed, ref, useTemplateRef} from "vue";

import {defineDropKind} from "@notnotype/nb-layout";
import type {DragEnd, GridDropRect} from "@notnotype/nb-layout";
import {DropFeedbackOverlay, dropTargetAt, useDragSession, useDropTarget} from "@notnotype/nb-layout/vue";

type Drop =
    | {readonly kind: "row"; readonly id: string; readonly rect: GridDropRect}
    | {readonly kind: "target"; readonly name: string; readonly rect: GridDropRect}
    | {readonly kind: "keep"; readonly rect: GridDropRect};

const SCENE_TARGET = defineDropKind<{readonly name: string}>("lab.drag-session");
const ROWS = Array.from({length: 40}, (_, index) => `r${index + 1}`);

const rootEl = useTemplateRef<HTMLElement>("rootEl");
const scrollerEl = useTemplateRef<HTMLElement>("scrollerEl");
const firstEl = useTemplateRef<HTMLElement>("firstEl");
const secondEl = useTemplateRef<HTMLElement>("secondEl");
useDropTarget(firstEl, [SCENE_TARGET], () => ({name: "first"}));
useDropTarget(secondEl, [SCENE_TARGET], () => ({name: "second"}));

const log = ref<string[]>([]);
/**
 * 最近一次判定收到的 `top` 是不是 null（输出 5：坐标在视口外时为 null）。指针下是 html、body 时判定同样没有落点，只看“没有落点”分不出这两种。
 * 只在变了时写：判定每帧都调。
 */
const topSeen = ref<"null" | "element" | "none">("none");
const note = (line: string): void => {
    log.value = [...log.value, line];
};

function rectOf(element: Element): GridDropRect {
    const {left, top, right, bottom} = element.getBoundingClientRect();
    return {left, top, right, bottom};
}

function endLine(end: DragEnd): string {
    return end.kind === "cancelled" ? `end:cancelled:${end.reason}` : `end:${end.kind}`;
}

const {state} = useDragSession<string, Drop, HTMLElement>(rootEl, () => {
    // 滚动容器在根里面，和根在同一次挂载里设上，建会话时一定读得到；读不到说明模板改了，直接报错，不建一个没有边缘滚动的会话。
    const scroller = scrollerEl.value;
    if (scroller === null) throw new Error("DragSessionScene：滚动容器没有挂上");
    return {
        scroll: "withdraw",
        autoScroll: {containers: () => [scroller]},
        sourceAt: (target) => target.closest<HTMLElement>("[data-source]")?.dataset.source ?? target.closest<HTMLElement>("[data-row]")?.dataset.row ?? null,
        resolve: ({top}) => {
            const seen = top === null ? "null" : "element";
            if (topSeen.value !== seen) topSeen.value = seen;
            if (top === null) return null;
            const row = top.closest<HTMLElement>("[data-row]");
            if (row !== null) return {kind: "row", id: row.dataset.row as string, rect: rectOf(row)};
            const keep = top.closest("[data-keep]");
            if (keep !== null) return {kind: "keep", rect: rectOf(keep)};
            const target = dropTargetAt(top, SCENE_TARGET);
            return target === null ? null : {kind: "target", name: target.data.name, rect: rectOf(target.element)};
        },
        actionKey: (drop) => (drop.kind === "keep" ? null : drop.kind === "row" ? `row:${drop.id}` : `target:${drop.name}`),
        commit: (drop, source) => note(`commit:${source}->${drop.kind === "row" ? drop.id : drop.kind === "target" ? drop.name : "keep"}`),
        onEnd: (end) => note(endLine(end)),
        keyboard: {
            sourceAt: (target) => (target instanceof HTMLElement && target.dataset.source !== undefined ? target.dataset.source : null),
            regions: () => [firstEl.value, secondEl.value].filter((element) => element !== null),
            stops: (region) => {
                const {left, right, top, bottom} = rectOf(region);
                const x = (left + right) / 2;
                return {axis: "vertical", points: [{x, y: top + (bottom - top) / 4}, {x, y: bottom - (bottom - top) / 4}]};
            },
            start: (_source, _regions, origin) => {
                const box = rectOf(origin);
                return {region: 0, at: {x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2}};
            },
            refocus: (source) => rootEl.value?.querySelector<HTMLElement>(`[data-source="${CSS.escape(source)}"]`) ?? null,
        },
    };
});
const over = computed(() => {
    const drop = state.value?.drop ?? null;
    return drop === null ? "none" : drop.kind === "row" ? drop.id : drop.kind === "target" ? drop.name : "keep";
});
const preview = computed(() => {
    const drop = state.value?.drop ?? null;
    return drop === null ? null : {areaRect: drop.rect, entryRect: null, indicator: null, orientation: "vertical" as const, armed: drop.kind !== "keep"};
});
/** 拖影特意接指针、正压在指针下：验证反馈元素不挡命中（输出 5）。产品的拖影不接指针，挡不挡看不出来。 */
const ghostStyle = computed(() => {
    const point = state.value?.point;
    return point === undefined ? {} : {left: `${point.x - 8}px`, top: `${point.y - 8}px`};
});
</script>

<template>
    <div class="drag-session-scene" data-lab-subject>
        <div ref="rootEl" class="drag-session-scene__root" data-session-root :data-session-state="state === null ? 'idle' : state.keyboard ? 'keyboard' : 'pointer'" :data-session-over="over" :data-session-top="topSeen">
            <div class="drag-session-scene__sources">
                <button type="button" data-source="a" @click="note('click:a')" @keydown="note(`key:${$event.key}`)">来源 A</button>
                <button type="button" data-source="b" @click="note('click:b')">来源 B</button>
                <div class="drag-session-scene__keep" data-keep>放回原位（只显示）</div>
            </div>
            <div ref="scrollerEl" class="drag-session-scene__scroller" data-session-scroller>
                <div v-for="row in ROWS" :key="row" class="drag-session-scene__row" :data-row="row">{{ row }}</div>
            </div>
            <div class="drag-session-scene__targets">
                <div ref="firstEl" class="drag-session-scene__target" data-target="first">落点 first</div>
                <div ref="secondEl" class="drag-session-scene__target" data-target="second">落点 second</div>
            </div>
        </div>
        <div class="drag-session-scene__side">
            <input data-session-outside aria-label="根之外的输入框" placeholder="根之外的输入框" />
            <pre data-session-log>{{ log.join("\n") }}</pre>
        </div>
        <Teleport to="body">
            <div v-if="state !== null" class="drag-session-scene__ghost" data-drag-feedback data-session-ghost :style="ghostStyle"></div>
        </Teleport>
        <DropFeedbackOverlay :preview="preview" label="" />
    </div>
</template>

<style scoped>
.drag-session-scene {
    display: flex;
    gap: 16px;
    width: 100%;
    height: 100%;
    padding: 16px;
    color: var(--text-main);
    font-size: var(--text-sm);
}

.drag-session-scene__root {
    display: flex;
    flex: 1;
    gap: 16px;
    min-width: 0;
    height: 320px;
    user-select: none;
}

.drag-session-scene__sources,
.drag-session-scene__targets {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
}

.drag-session-scene__sources button,
.drag-session-scene__keep,
.drag-session-scene__target,
.drag-session-scene__row {
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-control);
    background: var(--panel-surface);
    padding: 6px 10px;
}

.drag-session-scene__target {
    flex: 1;
}

.drag-session-scene__scroller {
    flex: 1;
    overflow: auto;
    border: var(--border-w) solid var(--panel-outline);
}

.drag-session-scene__side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 240px;
}

.drag-session-scene__side pre {
    flex: 1;
    overflow: auto;
    white-space: pre-wrap;
    font-size: var(--text-xs);
}

.drag-session-scene__ghost {
    position: fixed;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent-main);
    opacity: 0.6;
}
</style>

/**
 * nb-layout 组件的场景。被测组件经包的公开入口按名字取，登记只做 type 导入，组件模块在选中场景时才加载。
 */

import type {Component} from "vue";
import {h} from "vue";

import type {DropFeedbackOverlay, DropIndicatorLabel, DropSectorsOverlay, FloatWindowHandles, NestedGrid, Splitter, TabStrip} from "@notnotype/nb-layout/vue";

import {defineLabFixture, type LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";

function nbLayoutSubject(name: "DropIndicatorLabel" | "DropSectorsOverlay" | "FloatWindowHandles" | "Splitter"): () => Promise<{default: Component}> {
    return async () => ({default: (await import("@notnotype/nb-layout/vue"))[name] as Component});
}

const block = (label: string) => () => h("div", {class: "flex h-full w-full items-center justify-center text-sm text-[var(--text-secondary)]"}, label);

export const nbLayoutFixtures: LabFixture[] = [
    // 树与布局由夹具里的宿主（`useGridLayout`）算出并接纳手势提交，不是 JSON 输入；输入只是占位（类型要求登记必填的
    // node、layout），夹具不读它，场景 id 只决定用哪份快照恢复。手势与两轴几何的真实浏览器验收见 e2e/lab-nested-grid.e2e.ts。
    defineLabFixture<typeof NestedGrid>({
        component: "NestedGrid",
        scenes: (() => {
            const base = {node: null, layout: {sizes: {}, constraints: {}, sashSizes: {}, issues: []}};
            return [
                {id: "default", label: "默认两轴嵌套", input: {props: base}},
                {id: "unknown-ref", label: "未知引用恢复", input: {props: base}},
                {id: "malformed", label: "畸形重复身份拒绝", input: {props: base}},
                {id: "high-version", label: "高版本快照拒绝", input: {props: base}},
                // 结构变化、过渡、停放与焦点的验收（e2e/lab-grid-structure.e2e.ts）。
                {id: "structure", label: "结构变化与过渡", input: {props: base}},
                // 内容层：一棵树上的面板，跨面板有位移（e2e/lab-grid-panels.e2e.ts）。
                {id: "panels", label: "内容层与跨面板位移", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./NestedGridAcceptanceFixture.vue")).default,
    }),
    defineLabFixture<typeof DropFeedbackOverlay>({
        component: "DropFeedbackOverlay",
        scenes: [
            {id: "area", label: "半区落点", input: {props: {preview: {areaRect: {left: 80, top: 80, right: 400, bottom: 260}, entryRect: null, indicator: null, orientation: "vertical", armed: true}, label: "移到这里", iconClass: "i-lucide-move"}}},
            {id: "line", label: "插入线", input: {props: {preview: {areaRect: null, entryRect: null, indicator: {left: 80, top: 120, right: 360, bottom: 122}, orientation: "horizontal"}, label: "插入到第二章之前"}}},
            {id: "none", label: "没有落点", input: {props: {preview: null, label: ""}}},
            // 手势的真实浏览器验收见 e2e/lab-drag-session.e2e.ts；输入只是占位，这个场景的预览来自会话。
            {id: "session", label: "拖动会话", input: {props: {preview: null, label: ""}}},
        ],
        load: async () => (await import("./DropFeedbackOverlayFixture.vue")).default,
    }),
    // 手柄是透明的，看外观要键盘聚焦移动把手；拖动的验收在 e2e/workbench-float.e2e.ts。
    defineSubjectFixture<typeof FloatWindowHandles>({
        component: "FloatWindowHandles",
        subject: nbLayoutSubject("FloatWindowHandles"),
        scenes: [{id: "default", label: "八个手柄", input: {props: {rect: {x: 0, y: 0, width: 360, height: 240}, min: {width: 200, height: 100}, max: {width: 800, height: 600}, moveIconClass: "i-lucide-grip-horizontal"}}}],
    }),
    defineSubjectFixture<typeof DropSectorsOverlay>({
        component: "DropSectorsOverlay",
        subject: nbLayoutSubject("DropSectorsOverlay"),
        rootless: true,
        // 形状照 `layoutDropSectors` 的结果写死：这里看外观，形状与判定一致由 layout-drop.test.ts 守住。
        scenes: (() => {
            const near = 0.28;
            const far = 0.72;
            const edge = (panel: string, side: "left" | "right" | "top" | "bottom") => ({kind: "edge" as const, target: {kind: "split" as const, panel, edge: side}});
            const center = {kind: "center" as const, panel: "p"};
            const five = [
                {id: "left" as const, points: [[0, 0], [near, near], [near, far], [0, 1]] as const, action: edge("p", "left")},
                {id: "right" as const, points: [[1, 0], [far, near], [far, far], [1, 1]] as const, action: edge("p", "right")},
                {id: "top" as const, points: [[0, 0], [1, 0], [far, near], [near, near]] as const, action: edge("p", "top")},
                {id: "bottom" as const, points: [[0, 1], [1, 1], [far, far], [near, far]] as const, action: edge("p", "bottom")},
                {id: "center" as const, points: [[near, near], [far, near], [far, far], [near, far]] as const, action: center},
            ];
            const column = [
                {id: "top" as const, points: [[0, 0], [1, 0], [1, near], [0, near]] as const, action: edge("p", "top")},
                {id: "bottom" as const, points: [[0, 1], [1, 1], [1, far], [0, far]] as const, action: edge("p", "bottom")},
                {id: "center" as const, points: [[0, near], [1, near], [1, far], [0, far]] as const, action: center},
            ];
            const labels = {left: "左侧", right: "右侧", top: "上方", bottom: "下方", center: "添加为标签"};
            return [
                {id: "five", label: "编辑组：五块，右块是当前块", input: {props: {rect: {left: 80, top: 80, right: 680, bottom: 480}, sectors: five, active: "right" as const, labels}}},
                {id: "column", label: "侧栏这一列：上下中", input: {props: {rect: {left: 80, top: 80, right: 360, bottom: 480}, sectors: column, active: "center" as const, labels}}},
                {id: "narrow", label: "窄面板：放不下的块不写字", input: {props: {rect: {left: 80, top: 80, right: 300, bottom: 200}, sectors: five, active: null, labels}}},
                {id: "none", label: "没有落点", input: {props: {rect: null, sectors: [], active: null}}},
            ];
        })(),
    }),
    defineLabFixture<typeof TabStrip>({
        component: "TabStrip",
        // 输入只是占位（类型要求登记必填的项），夹具自己持有标签与选中项：键盘换序要真的改得动。断言在 e2e/lab-tab-strip.e2e.ts。
        scenes: [
            {id: "scroll", label: "一行，放不下时滚动", input: {props: {items: [], active: null, label: "标签"}}},
            {id: "wrap", label: "固定一行、普通折行", input: {props: {items: [], active: null, label: "标签"}}},
            {id: "adapt", label: "放不下时逐级让位", input: {props: {items: [], active: null, label: "标签"}}},
        ],
        load: async () => (await import("./TabStripFixture.vue")).default,
    }),
    defineSubjectFixture<typeof DropIndicatorLabel>({
        component: "DropIndicatorLabel",
        scenes: [
            {id: "default", label: "带图标", input: {props: {label: "新建容器（在侧栏）", iconClass: "i-lucide-plus"}}},
            {id: "long", label: "长文字", input: {props: {label: "移到「资源管理器」容器的末尾，并与大纲视图合并显示"}}},
        ],
        subject: nbLayoutSubject("DropIndicatorLabel"),
    }),
    defineSubjectFixture<typeof Splitter>({
        component: "Splitter",
        // `gesture-update` 每次指针移动都发，会淹没事件页签，不记。
        events: ["layout", "gesture-start", "gesture-end", "gesture-cancel"],
        class: "h-full w-full",
        slotPresets: {"panel-outline": block("大纲"), "panel-editor": block("正文"), "panel-notes": block("批注")},
        scenes: [
            {id: "horizontal", label: "三栏横向", input: {props: {direction: "horizontal", panels: [{id: "outline", defaultSizePx: 220, minSizePx: 120, sizing: "fixed"}, {id: "editor", sizing: "weight"}, {id: "notes", defaultSizePx: 260, minSizePx: 160, sizing: "fixed"}]}, slots: {"panel-outline": true, "panel-editor": true, "panel-notes": true}}},
            {id: "vertical", label: "两栏纵向", input: {props: {direction: "vertical", panels: [{id: "editor", sizing: "weight"}, {id: "notes", defaultSizePx: 180, minSizePx: 80, sizing: "fixed"}]}, slots: {"panel-editor": true, "panel-notes": true}}},
            {id: "disabled", label: "禁用拖动", input: {props: {direction: "horizontal", disabled: true, panels: [{id: "outline", defaultSizePx: 220, sizing: "fixed"}, {id: "editor", sizing: "weight"}]}, slots: {"panel-outline": true, "panel-editor": true}}},
        ],
        subject: nbLayoutSubject("Splitter"),
    }),
];

/**
 * nb-layout 组件的场景。被测组件经包的公开入口按名字取，登记只做 type 导入，组件模块在选中场景时才加载。
 */

import type {Component} from "vue";
import {h} from "vue";

import type {DropFeedbackOverlay, DropIndicatorLabel, Splitter} from "@notnotype/nb-layout/vue";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";

function nbLayoutSubject(name: "DropFeedbackOverlay" | "DropIndicatorLabel" | "Splitter"): () => Promise<{default: Component}> {
    return async () => ({default: (await import("@notnotype/nb-layout/vue"))[name] as Component});
}

const block = (label: string) => () => h("div", {class: "flex h-full w-full items-center justify-center text-sm text-[var(--text-secondary)]"}, label);

export const nbLayoutFixtures: LabFixture[] = [
    defineSubjectFixture<typeof DropFeedbackOverlay>({
        component: "DropFeedbackOverlay",
        class: "h-full w-full",
        scenes: [
            {id: "area", label: "半区落点", input: {props: {preview: {areaRect: {left: 80, top: 80, right: 400, bottom: 260}, entryRect: null, indicator: null, orientation: "vertical", armed: true}, label: "移到这里", iconClass: "i-lucide-move"}}},
            {id: "line", label: "插入线", input: {props: {preview: {areaRect: null, entryRect: null, indicator: {left: 80, top: 120, right: 360, bottom: 122}, orientation: "horizontal"}, label: "插入到第二章之前"}}},
            {id: "none", label: "没有落点", input: {props: {preview: null, label: ""}}},
        ],
        subject: nbLayoutSubject("DropFeedbackOverlay"),
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

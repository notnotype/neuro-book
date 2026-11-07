import {describe, expect, it} from "bun:test";

import {initialLiveDrop, insideShownSlot, stepLiveDrop} from "./live-drop";

/** 候选与预览（docs/specs/ui/workbench-layout.md“实时布局”）。 */
const SLOT = {left: 100, top: 100, right: 300, bottom: 300};
const edge = {key: "edge", immediate: false, slot: SLOT};
const center = {key: "center", immediate: false, slot: null};
const strip = {key: "strip", immediate: true, slot: null};

describe("稳定", () => {
    it("候选连续 150ms 不变才换预览；中途变了重新数", () => {
        let state = initialLiveDrop(0);
        state = stepLiveDrop(state, {now: 10, candidate: edge});
        expect(state.preview).toEqual({kind: "none"});
        state = stepLiveDrop(state, {now: 159, candidate: edge});
        expect(state.preview).toEqual({kind: "none"});
        state = stepLiveDrop(state, {now: 160, candidate: center});
        expect(state.preview).toEqual({kind: "none"});
        state = stepLiveDrop(state, {now: 309, candidate: center});
        expect(state.preview).toEqual({kind: "none"});
        state = stepLiveDrop(state, {now: 310, candidate: center});
        expect(state.preview).toEqual({kind: "candidate", key: "center"});
    });

    it("标签条内不等", () => {
        const state = stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: strip});
        expect(state.preview).toEqual({kind: "candidate", key: "strip"});
    });

    it("已经在预览的候选不用再等，时间照样记", () => {
        let state = stepLiveDrop(stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: edge}), {now: 170, candidate: edge});
        const shown = state.preview;
        state = stepLiveDrop(state, {now: 180, candidate: edge});
        expect(state.preview).toBe(shown);
    });
});

describe("没有候选", () => {
    it("从没预览过：还是已提交的布局", () => {
        let state = stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: edge});
        state = stepLiveDrop(state, {now: 20, candidate: null});
        state = stepLiveDrop(state, {now: 500, candidate: null});
        expect(state.preview).toEqual({kind: "none"});
    });

    it("预览过：等 150ms 后来源收起，空位没了；中途候选回来就不收", () => {
        let state = stepLiveDrop(stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: edge}), {now: 170, candidate: edge});
        state = stepLiveDrop(state, {now: 200, candidate: null});
        expect(state.preview).toEqual({kind: "candidate", key: "edge"});
        state = stepLiveDrop(state, {now: 349, candidate: null});
        expect(state.preview).toEqual({kind: "candidate", key: "edge"});
        state = stepLiveDrop(state, {now: 350, candidate: null});
        expect(state.preview).toEqual({kind: "source-removed"});
        expect(state.slot).toBeNull();
    });
});

describe("粘滞", () => {
    const shown = stepLiveDrop(stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: edge}), {now: 170, candidate: edge});

    it("空位内与 8px 边距算里面，再远不算", () => {
        expect(insideShownSlot(shown, {x: 200, y: 200})).toBe(true);
        expect(insideShownSlot(shown, {x: 92, y: 200})).toBe(true);
        expect(insideShownSlot(shown, {x: 91, y: 200})).toBe(false);
        expect(insideShownSlot(shown, {x: 200, y: 308})).toBe(true);
        expect(insideShownSlot(shown, {x: 200, y: 309})).toBe(false);
    });

    it("没有新面板的候选没有粘滞：不然这块面板自己的外缘选不到", () => {
        const onCenter = stepLiveDrop(stepLiveDrop(initialLiveDrop(0), {now: 10, candidate: center}), {now: 170, candidate: center});
        expect(insideShownSlot(onCenter, {x: 200, y: 200})).toBe(false);
    });

    it("换了预览，空位跟着换", () => {
        const next = stepLiveDrop(stepLiveDrop(shown, {now: 200, candidate: center}), {now: 360, candidate: center});
        expect(next.slot).toBeNull();
    });
});

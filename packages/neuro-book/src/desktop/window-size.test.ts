/**
 * 新窗口的外框（docs/specs/runtime/desktop-shell.md 输出 10）：产品窗口打开时就不小于最小尺寸，工作区不够时以工作区为准；对话框不受影响。
 */

import {describe, expect, it} from "bun:test";

import {centeredFrame, minimumFrame} from "./window-size";

const DEFAULT = {width: 1280, height: 800};
const DIALOG = {width: 480, height: 260};

describe("centeredFrame", () => {
    it("工作区够大：缺省大小居中", () => {
        expect(centeredFrame({x: 0, y: 0, width: 2560, height: 1392}, DEFAULT, minimumFrame(true))).toEqual({x: 640, y: 296, width: 1280, height: 800});
    });

    it("1366×768 开 125%（逻辑工作区约 1093×582）：取九成会小于最小值，抬到最小外框，仍在工作区里", () => {
        const custom = centeredFrame({x: 0, y: 0, width: 1093, height: 582}, DEFAULT, minimumFrame(true));
        expect(custom).toEqual({x: 55, y: 7, width: 983, height: 568});
        const system = centeredFrame({x: 0, y: 0, width: 1093, height: 582}, DEFAULT, minimumFrame(false));
        expect(system.height).toBe(582);
    });

    it("工作区比最小外框还小：窗口就是工作区大小", () => {
        expect(centeredFrame({x: 10, y: 20, width: 700, height: 500}, DEFAULT, minimumFrame(true))).toEqual({x: 10, y: 20, width: 700, height: 500});
    });

    it("对话框不传下限：大小不变", () => {
        expect(centeredFrame({x: 0, y: 0, width: 1093, height: 582}, DIALOG)).toEqual({x: 306, y: 161, width: 480, height: 260});
    });

    it("工作区量不到：左上角附近，用缺省大小与下限中较大的", () => {
        expect(centeredFrame({x: 0, y: 0, width: 0, height: 0}, DIALOG, minimumFrame(true))).toEqual({x: 120, y: 80, width: 816, height: 568});
    });
});

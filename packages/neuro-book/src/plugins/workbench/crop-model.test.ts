/**
 * 场景取景的换算（docs/specs/theme/editor.md 输出 12、13 与验收 7、8）：声明里的 CSS 写法与图上的框互相换算，读不懂的写法返回 null。
 */

import {describe, expect, it} from "bun:test";

import {clampFrame, CROP_REGIONS, frameAspect, parsePosition, readFrame, REGION_BOX, writeFrame} from "./web/theme-editor/crop-model";
import type {CropRegion} from "./web/theme-editor/crop-model";

const IMAGE = {width: 1536, height: 1024};

describe("读取位置", () => {
    it("百分数与关键字都认，两项缺一项、单位不对都读不懂", () => {
        expect(parsePosition("0% 100%")).toEqual({x: 0, y: 100});
        expect(parsePosition("center 70%")).toEqual({x: 50, y: 70});
        expect(parsePosition("right bottom")).toEqual({x: 100, y: 100});
        for (const bad of [undefined, "", "50%", "10px 20px", "top left", "50% 50% 50%", "calc(1px) 1%"]) expect(parsePosition(bad), String(bad)).toBeNull();
    });
});

describe("声明与取景框互相换算", () => {
    it("书房现有的取景能读出来：两侧靠下对齐，角取右上", () => {
        const left = readFrame("marginLeft", {size: "auto 118%", position: "0% 100%"}, IMAGE);
        expect(left?.x).toBeCloseTo(0, 5);
        expect(left?.h).toBeCloseTo(1 / 1.18, 5);
        expect((left?.y ?? 0) + (left?.h ?? 0)).toBeCloseTo(1, 5);
        const corner = readFrame("sidebarCorner", {size: "1000px auto", position: "100% 2%"}, IMAGE);
        expect(corner?.w).toBeCloseTo(REGION_BOX.sidebarCorner.width / 1000, 5);
        expect((corner?.x ?? 0) + (corner?.w ?? 0)).toBeCloseTo(1, 5);
        const empty = readFrame("empty", {position: "center 70%"}, IMAGE);
        expect(empty).not.toBeNull();
        expect((empty?.x ?? 0) + (empty?.w ?? 0) / 2).toBeCloseTo(0.5, 5);
    });

    it.each<[CropRegion, {size?: string; position: string}]>([
        ["marginLeft", {size: "auto 130%", position: "20% 60%"}],
        ["marginRight", {size: "auto 118%", position: "100% 100%"}],
        ["sidebarCorner", {size: "1000px auto", position: "100% 2%"}],
        ["auxiliaryCorner", {size: "800px auto", position: "0% 100%"}],
        // 空状态是 cover：图的高刚好等于参照盒的高，纵向没有余量，所以只有横向的位置能读写回来；纵向恒为 50%。
        ["empty", {position: "40% 50%"}],
    ])("%s：读出框再写回，得到同样的声明", (region, css) => {
        const frame = readFrame(region, css, IMAGE);
        expect(frame).not.toBeNull();
        expect(writeFrame(region, frame as NonNullable<typeof frame>)).toEqual(css);
    });

    it("框的宽高比与参照盒一致，缩放时靠 clampFrame 保持；框不会出图", () => {
        for (const region of CROP_REGIONS) {
            const frame = clampFrame(region, {x: 0.9, y: 0.9, w: 0.5, h: 0.5}, IMAGE);
            expect(frame.x + frame.w, region).toBeLessThanOrEqual(1 + 1e-9);
            expect(frame.y + frame.h, region).toBeLessThanOrEqual(1 + 1e-9);
            expect(frame.h / frame.w, region).toBeCloseTo(frameAspect(region, IMAGE), 5);
        }
    });

    it("手写的、编辑器读不懂的写法：该位置返回 null", () => {
        expect(readFrame("marginLeft", {size: "cover", position: "0% 100%"}, IMAGE)).toBeNull();
        expect(readFrame("marginLeft", {size: "auto 118%", position: "calc(10px) 100%"}, IMAGE)).toBeNull();
        expect(readFrame("sidebarCorner", {size: "auto 118%", position: "0% 0%"}, IMAGE)).toBeNull();
        expect(readFrame("sidebarCorner", {position: "0% 0%"}, IMAGE)).toBeNull();
        expect(readFrame("empty", {position: "nonsense"}, IMAGE)).toBeNull();
    });

    it("框与图一样大时位置写成居中，不除以零", () => {
        const css = writeFrame("empty", {x: 0, y: 0, w: 1, h: 1});
        expect(css).toEqual({position: "50% 50%"});
    });
});

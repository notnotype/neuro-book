import {describe, expect, it} from "bun:test";
import {collectLabFixtures, defineLabFixture} from "./define";

const load = async () => ({});

describe("场景登记的形状", () => {
    // 文案前缀 `nb-lab:` 同时是产物门禁的标记（define.ts 的 checkLabFixture）。
    it("缺 load 或 scenes 的登记直接报错，错误以 nb-lab: 开头并带组件名", () => {
        expect(() => defineLabFixture({component: "Probe", scenes: []} as never)).toThrow(/^nb-lab: defineLabFixture .*Probe/u);
        expect(() => defineLabFixture({component: "Probe", load} as never)).toThrow(/^nb-lab: /u);
        expect(defineLabFixture({component: "Probe", scenes: [], load} as never).component).toBe("Probe");
    });

    it("收集时模块没导出 fixtures 数组、或里面有坏登记，报出是哪个文件", () => {
        const good = {component: "Probe", scenes: [{id: "a", label: "甲"}], load};
        expect(collectLabFixtures({"../../../a/web/lab/fixtures.ts": {fixtures: [good]}, "../../../b/web/lab/fixtures.ts": {fixtures: []}}).map((fixture) => fixture.component)).toEqual(["Probe"]);
        expect(() => collectLabFixtures({"../../../a/web/lab/fixtures.ts": {fixture: [good]}})).toThrow(/^nb-lab: \.\.\/\.\.\/\.\.\/a\/web\/lab\/fixtures\.ts 要导出 fixtures 数组/u);
        expect(() => collectLabFixtures({"../../../b/web/lab/fixtures.ts": {fixtures: [good, {component: "Broken"}]}})).toThrow(/b\/web\/lab\/fixtures\.ts.*Broken/u);
    });
});

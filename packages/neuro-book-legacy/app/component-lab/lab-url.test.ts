import {describe, expect, it} from "vitest";
import {parseLabUrl, parseLabViewport} from "./lab-url";

const colorways = {"nbook-light": {appearance: "light" as const}, "nbook-dark": {appearance: "dark" as const}};

describe("lab-url", () => {
    it("尺寸接受预设名与 宽x高，越界或写错时忽略", () => {
        expect(parseLabViewport("phone")).toEqual({width: 390, height: 844});
        expect(parseLabViewport("free")).toEqual({width: 0, height: 0});
        expect(parseLabViewport("1400x900")).toEqual({width: 1400, height: 900});
        expect(parseLabViewport("99999x1")).toBeUndefined();
        expect(parseLabViewport("wide")).toBeUndefined();
        expect(parseLabViewport(null)).toBeUndefined();
    });

    it("配色可写 light / dark，也可写配色 id", () => {
        expect(parseLabUrl("?cw=light", colorways).colorwayId).toBe("nbook-light");
        expect(parseLabUrl("?cw=nbook-dark", colorways).colorwayId).toBe("nbook-dark");
    });

    it("组件与场景兼容长参数名", () => {
        expect(parseLabUrl("?component=AgentCard&scene=error&theme=macos&vp=tablet", colorways)).toEqual({
            component: "AgentCard", scene: "error", themeId: "macos", colorwayId: undefined, canvasSize: {width: 768, height: 1024},
        });
    });
});

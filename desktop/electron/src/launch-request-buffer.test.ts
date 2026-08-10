import {describe, expect, it} from "vitest";

import {DesktopLaunchRequestBuffer} from "nbook/desktop/electron/src/launch-request-buffer";

describe("Desktop launch request buffer", () => {
    it("在 Renderer 尚未就绪时保留最新请求并一次 drain", () => {
        const buffer = new DesktopLaunchRequestBuffer(2);
        buffer.push({args: ["neurobook://open/first"], cwd: "C:\\first"});
        buffer.push({args: ["neurobook://open/second"], cwd: "C:\\second"});
        buffer.push({args: ["neurobook://open/third"], cwd: "C:\\third"});

        expect(buffer.drain()).toEqual([
            {args: ["neurobook://open/second"], cwd: "C:\\second"},
            {args: ["neurobook://open/third"], cwd: "C:\\third"},
        ]);
        expect(buffer.drain()).toEqual([]);
    });

    it("在进入队列前严格验证请求", () => {
        const buffer = new DesktopLaunchRequestBuffer();
        expect(() => buffer.push({args: ["x".repeat(4097)], cwd: "C:\\"})).toThrow("最多包含 4096");
        expect(buffer.drain()).toEqual([]);
    });
});

import {describe, expect, it} from "vitest";
import {resolveSettingsMediaDir} from "./settings-screenshot";

describe("settings screenshot media root contract", () => {
    it("拒绝缺失或相对媒体根，避免写入隔离任务目录", () => {
        expect(() => resolveSettingsMediaDir(undefined)).toThrow("--media-dir");
        expect(() => resolveSettingsMediaDir("cache/images")).toThrow("绝对路径");
    });

    it("接受显式绝对媒体根并保留调用方路径", () => {
        expect(resolveSettingsMediaDir("/opt/data/cache/images")).toBe("/opt/data/cache/images");
    });
});

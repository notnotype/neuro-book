/**
 * 按贴纸显示的偏好（docs/specs/agent/stickers.md 输出 47）：打开加在末尾、关掉去掉、按当前目录剪掉已经不在的包、超过上限丢最早的。
 */

import {describe, expect, test} from "bun:test";

import {DISPLAY_PACKS_MAX, memoryDisplay, nextDisplayPacks} from "./display";

describe("nextDisplayPacks", () => {
    test("打开的加在末尾，已在的不重复；关掉的去掉", () => {
        expect(nextDisplayPacks(["user.a"], "builtin.lyra", true, null)).toEqual(["user.a", "builtin.lyra"]);
        expect(nextDisplayPacks(["builtin.lyra", "user.a"], "builtin.lyra", true, null)).toEqual(["user.a", "builtin.lyra"]);
        expect(nextDisplayPacks(["user.a", "builtin.lyra"], "builtin.lyra", false, null)).toEqual(["user.a"]);
    });

    test("目录取到了就剪掉已经不在的包（改了包名、删掉的）；目录还没取到时不剪", () => {
        expect(nextDisplayPacks(["user.old", "user.a"], "builtin.lyra", true, new Set(["user.a", "builtin.lyra"]))).toEqual(["user.a", "builtin.lyra"]);
        expect(nextDisplayPacks(["user.old"], "builtin.lyra", true, null)).toEqual(["user.old", "builtin.lyra"]);
    });

    test("超过上限时丢最早的", () => {
        const full = Array.from({length: DISPLAY_PACKS_MAX}, (_, index) => `user.p${String(index)}`);
        const next = nextDisplayPacks(full, "builtin.lyra", true, null);
        expect(next).toHaveLength(DISPLAY_PACKS_MAX);
        expect(next[0]).toBe("user.p1");
        expect(next.at(-1)).toBe("builtin.lyra");
    });
});

test("没有 Storage 时只在这次运行里记，读到的跟着设", () => {
    const display = memoryDisplay(() => null);
    display.set("builtin.lyra", true);
    expect(display.packs()).toEqual(["builtin.lyra"]);
    display.set("builtin.lyra", false);
    expect(display.packs()).toEqual([]);
});

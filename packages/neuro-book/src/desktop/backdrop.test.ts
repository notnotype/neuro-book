/**
 * 窗口背景的取舍（docs/specs/runtime/desktop-shell.md 输出 32）：设置值、系统版本与有没有自画外框决定窗口要不要透明、要哪一种。
 */

import {describe, expect, it} from "bun:test";

import {backdropFor, MIN_BACKDROP_BUILD, windowsBuild} from "./backdrop";

const WIN11 = {platform: "win32", release: "10.0.26200", customFrame: true};

describe("backdropFor", () => {
    it("设置是 mica 或 acrylic 时原样给；off 与不认识的情形都是 null", () => {
        expect(backdropFor("mica", WIN11)).toBe("mica");
        expect(backdropFor("acrylic", WIN11)).toBe("acrylic");
        expect(backdropFor("off", WIN11)).toBeNull();
    });

    it("22H2（build 22621）起才有；再往前、Windows 10 与认不出版本的都是 null，设置照样存着", () => {
        expect(backdropFor("mica", {...WIN11, release: `10.0.${String(MIN_BACKDROP_BUILD)}`})).toBe("mica");
        expect(backdropFor("mica", {...WIN11, release: `10.0.${String(MIN_BACKDROP_BUILD - 1)}`})).toBeNull();
        expect(backdropFor("acrylic", {...WIN11, release: "10.0.19045"})).toBeNull();
        expect(backdropFor("acrylic", {...WIN11, release: "unknown"})).toBeNull();
    });

    it("不是 Windows、没有自画外框（系统标题栏）时是 null", () => {
        expect(backdropFor("mica", {...WIN11, platform: "linux"})).toBeNull();
        expect(backdropFor("mica", {...WIN11, customFrame: false})).toBeNull();
    });
});

describe("windowsBuild", () => {
    it("取 os.release() 的第三段", () => {
        expect(windowsBuild("10.0.26200")).toBe(26200);
        expect(windowsBuild("6.1.7601")).toBe(7601);
        expect(windowsBuild("26200")).toBeNull();
    });
});

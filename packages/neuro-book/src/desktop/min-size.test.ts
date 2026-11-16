/**
 * 桌面窗口最小尺寸的换算（docs/specs/runtime/desktop-shell.md 输出 10）：`desktop/src/bun/min-size.c` 的纯函数 `nb_min_track`，
 * 在这里用 bun:ffi 的 cc（与壳运行时编译它的是同一个 TinyCC）只编纯函数来测。开发机的显示器多是 100%，DPI 换算与取整只有这里测得到；
 * 窗口过程本身由 Windows 验收（w00046 t18 的 evidences）。
 */

import {describe, expect, it} from "bun:test";
import {cc} from "bun:ffi";
import {fileURLToPath} from "node:url";

const source = fileURLToPath(new URL("../../desktop/src/bun/min-size.c", import.meta.url));
const {symbols} = cc({
    source,
    define: {NB_MIN_SIZE_PURE: "1"},
    symbols: {nb_min_track: {args: ["i32", "i32", "u32", "i32", "i32", "i32", "i32", "i32", "i32"], returns: "i64"}},
});

/** 拆开结果：宽在高 32 位，高在低 32 位。 */
function track(...args: [number, number, number, number, number, number, number, number, number]): {width: number; height: number} {
    const packed = BigInt(symbols.nb_min_track(...args));
    return {width: Number(packed >> 32n), height: Number(packed & 0xffffffffn)};
}

describe("nb_min_track", () => {
    it("100%：最小客户区加外框", () => {
        expect(track(800, 560, 96, 16, 8, 2560, 1392, 136, 39)).toEqual({width: 816, height: 568});
    });

    it("125%、150%、175%：按 DPI 换算并向上取整，外框是此刻的物理像素", () => {
        expect(track(800, 560, 120, 20, 10, 0, 0, 0, 0)).toEqual({width: 1020, height: 710});
        expect(track(800, 560, 144, 24, 12, 0, 0, 0, 0)).toEqual({width: 1224, height: 852});
        // 801 × 168 / 96 = 1401.75，向上取整到 1402。
        expect(track(801, 561, 168, 0, 0, 0, 0, 0, 0)).toEqual({width: 1402, height: 982});
    });

    it("DPI 为 0 按 96；外框差为负按 0", () => {
        expect(track(800, 560, 0, -5, -5, 0, 0, 0, 0)).toEqual({width: 800, height: 560});
    });

    it("工作区比最小值小：夹到工作区；工作区不知道（0）时不夹", () => {
        expect(track(800, 560, 120, 20, 10, 1366, 690, 0, 0)).toEqual({width: 1020, height: 690});
        expect(track(800, 560, 96, 16, 8, 0, 0, 0, 0)).toEqual({width: 816, height: 568});
    });

    it("系统已经给的值更大时不往小改", () => {
        expect(track(800, 560, 96, 16, 8, 0, 0, 900, 700)).toEqual({width: 900, height: 700});
    });
});

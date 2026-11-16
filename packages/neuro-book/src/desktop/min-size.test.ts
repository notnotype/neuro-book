/**
 * 桌面窗口最小尺寸（docs/specs/runtime/desktop-shell.md 输出 10）的 `desktop/src/bun/min-size.c`，用 bun:ffi 的 cc（与壳运行时编译它的
 * 是同一个 TinyCC）在这里编译：
 * - 纯函数 `nb_min_track`（定义 NB_MIN_SIZE_PURE 只编它）：开发机的显示器多是 100%，DPI 换算与取整只有这里测得到；
 * - 整份源码（大小断言随之生效）与窗口过程：user32 的函数表换成 JSCallback 做的替身，替身照 Win32 的约定读写结构体。
 * 窗口过程在真实窗口上的行为由 Windows 验收（w00046 t18 的 evidences）。
 */

import {describe, expect, it} from "bun:test";
import {cc, JSCallback, ptr, toArrayBuffer} from "bun:ffi";
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

describe("窗口过程（整份源码，user32 换成替身）", () => {
    const WM_GETMINMAXINFO = 0x24;
    const WM_NCDESTROY = 0x82;
    const HWND = 0x1000;
    const full = cc({source, symbols: {nb_init: {args: ["ptr", "u32"], returns: "i32"}, nb_window_proc: {args: ["ptr", "u32", "u64", "i64"], returns: "i64"}}});
    const name = (pointer: number): string => {
        const chars = new Uint16Array(toArrayBuffer(pointer as never, 0, 64));
        return String.fromCharCode(...chars.slice(0, chars.indexOf(0)));
    };
    const ints = (pointer: number, count: number): Int32Array => new Int32Array(toArrayBuffer(pointer as never, 0, count * 4));
    const state = {props: new Map<string, number>(), zoomed: 0, iconic: 0, calls: [] as string[]};
    const callbacks = [
        new JSCallback((_prev: number, _hwnd: number, msg: number) => { state.calls.push(`prev ${String(msg)}`); return 7; }, {args: ["ptr", "ptr", "u32", "u64", "i64"], returns: "i64"}),
        new JSCallback((_hwnd: number, msg: number) => { state.calls.push(`default ${String(msg)}`); return 9; }, {args: ["ptr", "u32", "u64", "i64"], returns: "i64"}),
        new JSCallback((_hwnd: number, key: number) => state.props.get(name(key)) ?? 0, {args: ["ptr", "ptr"], returns: "u64"}),
        new JSCallback((_hwnd: number, key: number) => { const value = state.props.get(name(key)) ?? 0; state.props.delete(name(key)); return value; }, {args: ["ptr", "ptr"], returns: "u64"}),
        new JSCallback(() => 120, {args: ["ptr"], returns: "u32"}),
        // 外框 1020×710、客户区 1000×700：外框差 20×10。
        new JSCallback((_hwnd: number, rect: number) => { ints(rect, 4).set([0, 0, 1020, 710]); return 1; }, {args: ["ptr", "ptr"], returns: "i32"}),
        new JSCallback((_hwnd: number, rect: number) => { ints(rect, 4).set([0, 0, 1000, 700]); return 1; }, {args: ["ptr", "ptr"], returns: "i32"}),
        new JSCallback(() => state.zoomed, {args: ["ptr"], returns: "i32"}),
        new JSCallback(() => state.iconic, {args: ["ptr"], returns: "i32"}),
        new JSCallback(() => 0x2000, {args: ["ptr", "u32"], returns: "ptr"}),
        // MONITORINFO：cbSize、rcMonitor、rcWork（偏移 20 起）、dwFlags；工作区 1366×690。
        new JSCallback((_monitor: number, info: number) => { ints(info, 10).set([0, 0, 1366, 690], 5); return 1; }, {args: ["ptr", "ptr"], returns: "i32"}),
    ];
    const table = new BigUint64Array(callbacks.map((callback) => BigInt(callback.ptr!)));
    const PREV = "nbook.wndproc";
    const MIN = "nbook.minsize";
    const minmax = (): Int32Array => new Int32Array([0, 0, 0, 0, 0, 0, 136, 39, 4000, 4000]);
    const send = (msg: number, info: Int32Array | null = null): bigint => BigInt(full.symbols.nb_window_proc(HWND as never, msg, 0n, info === null ? 0n : BigInt(ptr(info))));

    it("函数表的项数对不上时不抄、交回 0；对上了交回 1", () => {
        expect(full.symbols.nb_init(ptr(table), callbacks.length - 1)).toBe(0);
        expect(full.symbols.nb_init(ptr(table), callbacks.length)).toBe(1);
    });

    it("取不到原过程时交给缺省过程；有原过程时先交给它，WM_GETMINMAXINFO 按 DPI 120 加外框、夹到工作区", () => {
        full.symbols.nb_init(ptr(table), callbacks.length);
        state.props.clear();
        state.calls.length = 0;
        expect(send(5)).toBe(9n);
        expect(state.calls).toEqual(["default 5"]);
        state.props.set(PREV, 0x3000);
        state.props.set(MIN, 800 * 65536 + 560);
        const info = minmax();
        expect(send(WM_GETMINMAXINFO, info)).toBe(7n);
        // 800 × 120 / 96 + 20 = 1020；560 × 120 / 96 + 10 = 710，夹到工作区高 690。
        expect([info[6], info[7]]).toEqual([1020, 690]);
    });

    it("最大化或最小化时不改；没有登记最小值时不改", () => {
        full.symbols.nb_init(ptr(table), callbacks.length);
        state.props.set(PREV, 0x3000);
        state.props.set(MIN, 800 * 65536 + 560);
        for (const [zoomed, iconic] of [[1, 0], [0, 1]]) {
            state.zoomed = zoomed!;
            state.iconic = iconic!;
            const info = minmax();
            send(WM_GETMINMAXINFO, info);
            expect([info[6], info[7]]).toEqual([136, 39]);
        }
        state.zoomed = 0;
        state.iconic = 0;
        state.props.delete(MIN);
        const info = minmax();
        send(WM_GETMINMAXINFO, info);
        expect([info[6], info[7]]).toEqual([136, 39]);
    });

    it("WM_NCDESTROY：先交给原过程，再删掉两个属性", () => {
        full.symbols.nb_init(ptr(table), callbacks.length);
        state.props.set(PREV, 0x3000);
        state.props.set(MIN, 800 * 65536 + 560);
        state.calls.length = 0;
        send(WM_NCDESTROY);
        expect(state.calls).toEqual([`prev ${String(WM_NCDESTROY)}`]);
        expect([...state.props.keys()]).toEqual([]);
    });
});

/**
 * 桌面窗口在 Windows 上要补的两件事（docs/specs/runtime/desktop-shell.md 输出 10），Electrobun 2.0.6 没有接口，
 * 经 `bun:ffi` 直接调 user32。`win.ptr` 就是窗口的 HWND。
 *
 * - **补样式**（只对没有系统标题栏的窗口）：`titleBarStyle: "hiddenInset"` 的窗口是 `WS_CAPTION | WS_THICKFRAME`，没有 `WS_SYSMENU`、`WS_MINIMIZEBOX`、
 *   `WS_MAXIMIZEBOX`。缺了它们，最大化铺满整个显示器、底部被任务栏盖住（Electrobun 的 `WM_GETMINMAXINFO` 只给 `WS_POPUP`
 *   限在工作区），也没有 Alt+Space 系统菜单、任务栏点击最小化。补上以后最大化落在工作区里，`WM_NCCALCSIZE` 照旧去掉标题区
 *   （w00046 t03 的探针证据 frame-probe-r1）。升级 Electrobun 时复测：它自己处理了这件事，这里就该删掉。
 * - **窗口图标**（所有窗口）：Electrobun 不给窗口设图标（`WM_GETICON` 与窗口类图标都是 0），Alt+Tab 会显示通用图标。从包里的 ICO 按窗口
 *   所在显示器的 DPI 取大小两个尺寸；ICO 里 16–256 各档都从同一份 SVG 渲染，系统取最接近的一档。
 *
 * 线程：窗口归 Electrobun 的原生 UI 线程，这里跑在 Bun 的主线程。跨线程的 `SetWindowPos`、`SendMessage` 会同步等那个线程处理，
 * 那个线程又可能在等 Bun 主线程（Electrobun 的同步调度），所以一律用不等待的写法：`SWP_ASYNCWINDOWPOS` 与 `PostMessageW`。
 *
 * 失败只交回原因，由调用方写壳日志：窗口照样能用，只是最大化可能压住任务栏、图标是通用的。
 */

import {dlopen, FFIType, ptr} from "bun:ffi";
import type {Pointer} from "bun:ffi";

const GWL_STYLE = -16;
const WS_SYSMENU = 0x0008_0000n;
const WS_MINIMIZEBOX = 0x0002_0000n;
const WS_MAXIMIZEBOX = 0x0001_0000n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_ASYNCWINDOWPOS = 0x4000;
const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const SM_CXICON = 11;
const SM_CXSMICON = 49;

type User32 = ReturnType<typeof openUser32>;

function openUser32() {
    return dlopen("user32.dll", {
        GetWindowLongPtrW: {args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64},
        SetWindowLongPtrW: {args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64},
        SetWindowPos: {args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.bool},
        PostMessageW: {args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.bool},
        LoadImageW: {args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.ptr},
        GetDpiForWindow: {args: [FFIType.ptr], returns: FFIType.u32},
        GetSystemMetricsForDpi: {args: [FFIType.i32, FFIType.u32], returns: FFIType.i32},
    }).symbols;
}

let user32: User32 | null = null;
/** 同一尺寸的图标所有窗口共用，进程结束前不释放（窗口关掉时系统不替我们销毁 `WM_SETICON` 给的图标，共用就不会泄漏）。 */
const icons = new Map<number, Pointer>();

function loadIcon(lib: User32, file: string, size: number): Pointer | null {
    const cached = icons.get(size);
    if (cached !== undefined) return cached;
    const wide = Buffer.from(`${file}\0`, "utf16le");
    const icon = lib.LoadImageW(null, ptr(wide), IMAGE_ICON, size, size, LR_LOADFROMFILE);
    if (icon === null) return null;
    icons.set(size, icon);
    return icon;
}

/** 打开 user32；不是 Windows 或打不开时交回原因。 */
function library(): User32 | string {
    if (process.platform !== "win32") return "not windows";
    try {
        user32 ??= openUser32();
        return user32;
    } catch (error) {
        return `user32 unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
}

/**
 * 给一个没有系统标题栏的窗口补样式。不是 Windows 时什么都不做，交回 `[]`；交回的是没做成的项与原因。写完再读一次样式核对：
 * `SetWindowLongPtrW` 的返回值是旧样式，0 既可能是失败也可能是旧值本来为 0，读回来比更直接。
 */
export function adoptCustomFrame(hwnd: Pointer | null): string[] {
    if (process.platform !== "win32") return [];
    if (hwnd === null) return ["window handle is null"];
    const lib = library();
    if (typeof lib === "string") return [lib];
    const style = BigInt(lib.GetWindowLongPtrW(hwnd, GWL_STYLE));
    const wanted = style | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    if (wanted === style) return [];
    lib.SetWindowLongPtrW(hwnd, GWL_STYLE, wanted);
    if (BigInt(lib.GetWindowLongPtrW(hwnd, GWL_STYLE)) !== wanted) return [`window style not changed (still 0x${style.toString(16)})`];
    // 样式里的边框位变了，要 SWP_FRAMECHANGED 让系统重新算非客户区（Electrobun 的 WM_NCCALCSIZE 在这时去掉标题区）。
    if (!lib.SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS)) return ["SetWindowPos(SWP_FRAMECHANGED) failed"];
    return [];
}

/**
 * 给窗口设应用图标（产品窗口、启动页、对话框，有没有系统标题栏都要设）。`iconFile` 是包里的 ICO（`Resources/app/neurobook.ico`），
 * 读不到时窗口只是用通用图标。交回没做成的项与原因。
 */
export function setWindowIcon(hwnd: Pointer | null, iconFile: string): string[] {
    if (process.platform !== "win32") return [];
    if (hwnd === null) return ["window handle is null"];
    const lib = library();
    if (typeof lib === "string") return [lib];
    const problems: string[] = [];
    const dpi = lib.GetDpiForWindow(hwnd) || 96;
    for (const [kind, metric] of [[ICON_BIG, SM_CXICON], [ICON_SMALL, SM_CXSMICON]] as const) {
        const size = lib.GetSystemMetricsForDpi(metric, dpi);
        const icon = size > 0 ? loadIcon(lib, iconFile, size) : null;
        if (icon === null) problems.push(`icon ${String(size)}px not loaded from ${iconFile}`);
        // lParam 是 LPARAM（x64 下的有符号 64 位整数）：句柄按位模式转成整数传。
        else if (!lib.PostMessageW(hwnd, WM_SETICON, BigInt(kind), BigInt(icon))) problems.push(`WM_SETICON ${String(kind)} not posted`);
    }
    return problems;
}

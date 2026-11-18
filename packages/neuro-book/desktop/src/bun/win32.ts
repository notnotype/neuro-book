/**
 * 桌面窗口在 Windows 上要补的三件事（docs/specs/runtime/desktop-shell.md 输出 10），Electrobun 2.0.6 没有接口，
 * 经 `bun:ffi` 直接调 user32。`win.ptr` 就是窗口的 HWND。
 *
 * - **补样式**（只对没有系统标题栏的窗口）：`titleBarStyle: "hiddenInset"` 的窗口是 `WS_CAPTION | WS_THICKFRAME`，没有 `WS_SYSMENU`、`WS_MINIMIZEBOX`、
 *   `WS_MAXIMIZEBOX`。缺了它们，最大化铺满整个显示器、底部被任务栏盖住（Electrobun 的 `WM_GETMINMAXINFO` 只给 `WS_POPUP`
 *   限在工作区），也没有 Alt+Space 系统菜单、任务栏点击最小化。补上以后最大化落在工作区里，`WM_NCCALCSIZE` 照旧去掉标题区
 *   （w00046 t03 的探针证据 frame-probe-r1）。升级 Electrobun 时复测：它自己处理了这件事，这里就该删掉。
 * - **窗口图标**（所有窗口）：Electrobun 不给窗口设图标（`WM_GETICON` 与窗口类图标都是 0），Alt+Tab 会显示通用图标。从包里的 ICO 按窗口
 *   所在显示器的 DPI 取大小两个尺寸；ICO 里 16–256 各档都从同一份 SVG 渲染，系统取最接近的一档。
 * - **最小尺寸**（产品窗口）：子类化窗口过程，过程本身在 `min-size.c`（为什么、怎么编译写在那份源码的开头）。
 *
 * 线程：窗口归 Electrobun 的原生 UI 线程，这里跑在 Bun 的主线程。跨线程的 `SetWindowPos`、`SendMessage` 会同步等那个线程处理，
 * 那个线程又可能在等 Bun 主线程（Electrobun 的同步调度），所以能不等待的都用不等待的写法：`SWP_ASYNCWINDOWPOS` 与 `PostMessageW`。
 * 例外是改样式：`SetWindowLongPtrW(GWL_STYLE)` 会同步给窗口发 `WM_STYLECHANGING`、`WM_STYLECHANGED`；现在只在窗口刚创建时调，
 * 那时 UI 线程不会在等我们，接受。换窗口过程（`GWLP_WNDPROC`）与读写窗口属性不发消息。
 *
 * 失败只交回原因，由调用方写壳日志：窗口照样能用，只是最大化可能压住任务栏、图标是通用的、窗口能缩到很小。
 */

import {cc, dlopen, FFIType, ptr} from "bun:ffi";
import type {Pointer} from "bun:ffi";
import {relative} from "node:path";

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
        IsWindow: {args: [FFIType.ptr], returns: FFIType.bool},
        SetPropW: {args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.bool},
        RemovePropW: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
        GetPropW: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
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

const GWLP_WNDPROC = -4;
/** 窗口属性的名字，与 `min-size.c` 的 PROP_WNDPROC、PROP_MINSIZE 一致。 */
const PROP_WNDPROC = "nbook.wndproc";
const PROP_MINSIZE = "nbook.minsize";
/** `min-size.c` 里 user32 函数表的顺序。 */
const MIN_SIZE_IMPORTS = ["CallWindowProcW", "DefWindowProcW", "GetPropW", "RemovePropW", "GetDpiForWindow", "GetWindowRect", "GetClientRect", "IsZoomed", "IsIconic", "MonitorFromWindow", "GetMonitorInfoW"] as const;

/**
 * 编译好的窗口过程。`lib` 是 cc 交回的对象，管着编译出的代码：**永不调用 `lib.close()`、也不丢掉这个引用**，窗口过程的地址装在
 * 窗口上，代码一释放，下一条窗口消息就在 UI 线程里崩。编译失败也缓存成原因，后面的窗口不再重编；原因只交回一次（第一个窗口），
 * 之后的窗口交回空列表，壳日志里不重复同一行。
 */
let minSizeHook: {readonly lib: {close(): void}; readonly proc: bigint} | {readonly failed: string; reported: boolean} | null = null;

const wide = (text: string): Buffer => Buffer.from(`${text}\0`, "utf16le");

function compileMinSize(source: string): {readonly lib: {close(): void}; readonly proc: bigint} | string {
    if (process.arch !== "x64") return `min-size needs Windows x64 (this is ${process.arch})`;
    // TinyCC 打不开含非 ASCII 字符的路径（中文用户名下的安装目录就是这样）；相对当前目录（安装里的 app\bin）的路径只剩 ASCII，
    // 由系统按宽字符的当前目录解析（w00046 t18 的 min-size-probe-r1 第 5、6 条）。
    const path = relative(process.cwd(), source);
    if (!/^[\x20-\x7e]+$/u.test(path)) return `min-size source path is not ASCII relative to the working directory: ${path}`;
    try {
        const kernel32 = dlopen("kernel32.dll", {
            LoadLibraryW: {args: [FFIType.ptr], returns: FFIType.ptr},
            GetProcAddress: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
        }).symbols;
        const user32Module = kernel32.LoadLibraryW(ptr(wide("user32.dll")));
        if (user32Module === null) return "LoadLibraryW(user32.dll) failed";
        const table = new BigUint64Array(MIN_SIZE_IMPORTS.length);
        for (const [index, name] of MIN_SIZE_IMPORTS.entries()) {
            const address = kernel32.GetProcAddress(user32Module, ptr(Buffer.from(`${name}\0`, "latin1")));
            if (address === null) return `GetProcAddress(${name}) failed`;
            table[index] = BigInt(address);
        }
        const lib = cc({source: path, symbols: {nb_init: {args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32}, nb_window_proc_address: {returns: FFIType.ptr}}});
        // C 在 nb_init 里把地址抄进自己的函数表，之后 `table` 可以回收；项数对不上时它不抄，我们也不装。
        if (lib.symbols.nb_init(ptr(table), MIN_SIZE_IMPORTS.length) !== 1) return "min-size function table does not match min-size.c";
        const proc = lib.symbols.nb_window_proc_address();
        if (proc === null) return "min-size window procedure address is null";
        return {lib, proc: BigInt(proc)};
    } catch (error) {
        return `min-size compile failed: ${error instanceof Error ? error.message : String(error)}`;
    }
}

/**
 * 给产品窗口设客户区的最小尺寸（逻辑像素）。`source` 是包里的 `min-size.c`。同一个窗口再调只更新数值。交回没做成的项与原因；
 * 窗口已经关了不算问题。安装顺序：先存原过程与最小值两个属性，再换过程；换的时候发现过程已被别人换过（或失败）就换回、删属性。
 * “已经装好”看窗口此刻的过程是不是我们的，不看属性在不在：失败留下的属性不会让下一次误以为装好了。
 */
export function setMinimumSize(hwnd: Pointer | null, size: {readonly width: number; readonly height: number}, source: string): string[] {
    if (process.platform !== "win32") return [];
    if (hwnd === null) return ["window handle is null"];
    const lib = library();
    if (typeof lib === "string") return [lib];
    if (minSizeHook === null) {
        const compiled = compileMinSize(source);
        minSizeHook = typeof compiled === "string" ? {failed: compiled, reported: false} : compiled;
    }
    const hook = minSizeHook;
    if ("failed" in hook) {
        if (hook.reported) return [];
        hook.reported = true;
        return [hook.failed];
    }
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0 || size.width > 0xffff || size.height > 0xffff) return [`invalid minimum size ${String(size.width)}x${String(size.height)}`];
    if (!lib.IsWindow(hwnd)) return [];
    const packed = BigInt(size.width) << 16n | BigInt(size.height);
    const current = BigInt.asUintN(64, BigInt(lib.GetWindowLongPtrW(hwnd, GWLP_WNDPROC)));
    // 已经装过：过程是我们的，或者原过程的属性还在（装好之后别人又在我们之上子类化时，链顶不是我们；这时再装一次会把它的过程
    // 当成原过程存进属性，我们的过程调它、它又调回我们，无限递归）。失败的安装会删掉属性，不会被误认为装过。
    if (current === hook.proc || lib.GetPropW(hwnd, ptr(wide(PROP_WNDPROC))) !== null) return lib.SetPropW(hwnd, ptr(wide(PROP_MINSIZE)), packed) ? [] : ["SetPropW(minsize) failed"];
    const removeProps = (): void => {
        lib.RemovePropW(hwnd, ptr(wide(PROP_MINSIZE)));
        lib.RemovePropW(hwnd, ptr(wide(PROP_WNDPROC)));
    };
    if (current === 0n) return ["GetWindowLongPtrW(GWLP_WNDPROC) returned 0"];
    if (!lib.SetPropW(hwnd, ptr(wide(PROP_WNDPROC)), current)) return ["SetPropW(wndproc) failed"];
    if (!lib.SetPropW(hwnd, ptr(wide(PROP_MINSIZE)), packed)) {
        removeProps();
        return ["SetPropW(minsize) failed"];
    }
    // 窗口过程的地址按位模式当有符号 64 位整数传（LONG_PTR）。
    const old = BigInt.asUintN(64, BigInt(lib.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, BigInt.asIntN(64, hook.proc))));
    if (old === current) return [];
    if (old === 0n) {
        if (BigInt.asUintN(64, BigInt(lib.GetWindowLongPtrW(hwnd, GWLP_WNDPROC))) === hook.proc) return [];
        removeProps();
        return ["SetWindowLongPtrW(GWLP_WNDPROC) failed"];
    }
    // 读与换之间过程被别人换过：把它的换回去，不叠在一个我们没存的过程上。
    lib.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, BigInt.asIntN(64, old));
    removeProps();
    return ["window procedure changed while installing the minimum size"];
}

import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ProjectLifecycleError} from "nbook/server/workspace-files/project-identity";

const INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const WINDOWS_ATTRIBUTES_API_KEY = Symbol.for("nbook.project-root.windows-attributes.v1");

type WindowsFileAttributesApi = {
    readonly attributes: (pathBytes: Buffer) => number;
    readonly lastError: () => number;
};

type GlobalWindowsAttributesCache = typeof globalThis & {
    [key: symbol]: Promise<WindowsFileAttributesApi> | undefined;
};

/** 保留Windows原生错误码，避免把GetFileAttributesW失败误判为“不是reparse”。 */
class WindowsFileAttributesError extends Error {
    readonly osError: number;

    constructor(target: AbsoluteFsPath, osError: number) {
        super(`GetFileAttributesW读取Project Workspace root失败：${target}`);
        this.name = "WindowsFileAttributesError";
        this.osError = osError;
    }
}

/**
 * 使用Windows kernel attributes判断目录是否带任意reparse tag。
 *
 * 这里检查统一的FILE_ATTRIBUTE_REPARSE_POINT位，不建立tag白名单，因此junction、mount point、
 * cloud placeholder等Node Stats未暴露的目录reparse形态都走同一拒绝合同。
 */
export async function detectWindowsProjectRootReparse(projectRoot: AbsoluteFsPath): Promise<boolean> {
    if (process.platform !== "win32") {
        return false;
    }
    const api = await windowsFileAttributesApi();
    const namespacedRoot = path.toNamespacedPath(projectRoot);
    const pathBytes = Buffer.from(`${namespacedRoot}\0`, "utf16le");
    const attributes = api.attributes(pathBytes);
    if (attributes === INVALID_FILE_ATTRIBUTES) {
        const cause = new WindowsFileAttributesError(projectRoot, api.lastError());
        throw new ProjectLifecycleError(
            "PROJECT_ROOT_IO",
            "无法读取Project Workspace root的Windows文件属性",
            cause,
        );
    }
    return (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
}

/** 跨HMR generation复用唯一kernel32句柄；句柄生命周期与Product进程一致。 */
function windowsFileAttributesApi(): Promise<WindowsFileAttributesApi> {
    const cache = globalThis as GlobalWindowsAttributesCache;
    const cached = cache[WINDOWS_ATTRIBUTES_API_KEY];
    if (cached) {
        return cached;
    }
    const loading = loadWindowsFileAttributesApi();
    Object.defineProperty(cache, WINDOWS_ATTRIBUTES_API_KEY, {
        configurable: false,
        enumerable: false,
        value: loading,
        writable: false,
    });
    return loading;
}

/** 惰性加载Bun FFI；非Windows与Node-based tooling不会解析或打开kernel32。 */
async function loadWindowsFileAttributesApi(): Promise<WindowsFileAttributesApi> {
    const {dlopen, FFIType, ptr} = await import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
        GetFileAttributesW: {
            args: [FFIType.pointer],
            returns: FFIType.u32,
        },
        GetLastError: {
            args: [],
            returns: FFIType.u32,
        },
    });
    return Object.freeze({
        attributes: (pathBytes: Buffer) => Number(kernel32.symbols.GetFileAttributesW(ptr(pathBytes))) >>> 0,
        lastError: () => Number(kernel32.symbols.GetLastError()) >>> 0,
    });
}

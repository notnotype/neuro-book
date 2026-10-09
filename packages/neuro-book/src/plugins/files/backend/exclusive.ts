/**
 * 排他改名：目标已存在时失败，不覆盖文件、不替换空目录（docs/specs/workspace/files.md 的“文件操作”）。Node 的
 * `rename` 会静默覆盖目标，先查再改有竞态，所以经 `bun:ffi` 直接调用系统的排他改名：Linux `renameat2` 带
 * `RENAME_NOREPLACE`，macOS `renamex_np` 带 `RENAME_EXCL`，Windows `MoveFileExW` 不带替换标志。
 *
 * 只有 Linux 实测过（tmpfs 与 ext4 上文件、目录都得到 EEXIST）；文件系统不支持排他改名时报 `unsupported`，不退回会覆盖的
 * `rename`。
 */

import {dlopen, FFIType, read} from "bun:ffi";

export type ExclusiveRename = {readonly ok: true} | {readonly ok: false; readonly reason: "exists" | "missing" | "unsupported" | "cross-device" | "denied" | "failed"; readonly code: string};

type Native = (source: string, target: string) => ExclusiveRename;

let native: Native | null = null;

/** `source` 与 `target` 都是绝对路径；目标的父目录必须已存在。 */
export function renameNoReplace(source: string, target: string): ExclusiveRename {
    native ??= load();
    return native(source, target);
}

const cString = (value: string): Buffer => Buffer.from(`${value}\0`, "utf8");

/** errno → 结果；Linux 与 macOS 的数值不同，按平台给表。 */
function outcome(code: number, names: Readonly<Record<number, string>>): ExclusiveRename {
    const name = names[code] ?? `errno ${String(code)}`;
    switch (name) {
        case "EEXIST":
        case "ENOTEMPTY":
            return {ok: false, reason: "exists", code: name};
        case "ENOENT":
            return {ok: false, reason: "missing", code: name};
        case "EXDEV":
            return {ok: false, reason: "cross-device", code: name};
        case "EACCES":
        case "EPERM":
        case "EROFS":
            return {ok: false, reason: "denied", code: name};
        case "EINVAL":
        case "ENOSYS":
        case "ENOTSUP":
            return {ok: false, reason: "unsupported", code: name};
        default:
            return {ok: false, reason: "failed", code: name};
    }
}

const LINUX_ERRNO: Readonly<Record<number, string>> = {1: "EPERM", 2: "ENOENT", 13: "EACCES", 17: "EEXIST", 18: "EXDEV", 22: "EINVAL", 30: "EROFS", 38: "ENOSYS", 39: "ENOTEMPTY", 95: "ENOTSUP"};
const DARWIN_ERRNO: Readonly<Record<number, string>> = {1: "EPERM", 2: "ENOENT", 13: "EACCES", 17: "EEXIST", 18: "EXDEV", 22: "EINVAL", 30: "EROFS", 45: "ENOTSUP", 66: "ENOTEMPTY", 78: "ENOSYS"};
/** Windows 的 GetLastError：80 文件已存在、183 已存在、2/3 找不到、5 拒绝、17 跨卷。 */
const WINDOWS_ERROR: Readonly<Record<number, string>> = {2: "ENOENT", 3: "ENOENT", 5: "EACCES", 17: "EXDEV", 80: "EEXIST", 183: "EEXIST"};

function load(): Native {
    switch (process.platform) {
        case "linux": {
            const libc = dlopen("libc.so.6", {
                renameat2: {args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.u32], returns: FFIType.i32},
                __errno_location: {args: [], returns: FFIType.ptr},
            });
            const AT_FDCWD = -100;
            const RENAME_NOREPLACE = 1;
            return (source, target) => {
                if (libc.symbols.renameat2(AT_FDCWD, cString(source), AT_FDCWD, cString(target), RENAME_NOREPLACE) === 0) return {ok: true};
                return outcome(read.i32(libc.symbols.__errno_location()!, 0), LINUX_ERRNO);
            };
        }
        case "darwin": {
            const system = dlopen("libSystem.B.dylib", {
                renamex_np: {args: [FFIType.cstring, FFIType.cstring, FFIType.u32], returns: FFIType.i32},
                __error: {args: [], returns: FFIType.ptr},
            });
            const RENAME_EXCL = 4;
            return (source, target) => {
                if (system.symbols.renamex_np(cString(source), cString(target), RENAME_EXCL) === 0) return {ok: true};
                return outcome(read.i32(system.symbols.__error()!, 0), DARWIN_ERRNO);
            };
        }
        case "win32": {
            const kernel = dlopen("kernel32.dll", {
                MoveFileExW: {args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32},
                GetLastError: {args: [], returns: FFIType.u32},
            });
            const wide = (value: string): Buffer => Buffer.from(`${value}\0`, "utf16le");
            return (source, target) => {
                // 不带 MOVEFILE_REPLACE_EXISTING 与 MOVEFILE_COPY_ALLOWED：已存在就失败，不跨卷复制。
                if (kernel.symbols.MoveFileExW(wide(source), wide(target), 0) !== 0) return {ok: true};
                return outcome(kernel.symbols.GetLastError(), WINDOWS_ERROR);
            };
        }
        default:
            return () => ({ok: false, reason: "unsupported", code: process.platform});
    }
}

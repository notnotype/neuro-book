import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

type RenameNative = (source: string, target: string) => void;
let nativeRename: RenameNative | undefined;

/** The final namespace operation must reject an occupied target, not just preflight it. */
export async function renameNoReplace(source: AbsoluteFsPath, target: AbsoluteFsPath): Promise<void> {
    nativeRename ??= await loadRenameNoReplace();
    nativeRename(source, target);
}

async function loadRenameNoReplace(): Promise<RenameNative> {
    if (!(["win32", "linux", "darwin"].includes(process.platform))) {
        throw new Error(`当前平台不支持排他移动: ${process.platform}`);
    }
    let koffi: typeof import("koffi").default;
    try {
        koffi = (await import("koffi")).default;
    } catch (cause) {
        throw new Error("排他移动原生模块不可用", {cause});
    }

    if (process.platform === "win32") {
        let move: ReturnType<ReturnType<typeof koffi.load>["func"]>;
        let lastError: ReturnType<ReturnType<typeof koffi.load>["func"]>;
        try {
            const library = koffi.load("kernel32.dll");
            move = library.func("__stdcall", "MoveFileExW", "int", ["str16", "str16", "uint32"]);
            lastError = library.func("__stdcall", "GetLastError", "uint32", []);
        } catch (cause) {
            throw new Error("Windows 排他移动原语不可用", {cause});
        }
        return (source, target) => {
            // No REPLACE_EXISTING and no COPY_ALLOWED: directories and files stay on one volume.
            if (move(source, target, 0)) return;
            const code = lastError();
            if (code === 80 || code === 183) throw new Error(`目标路径已存在: ${target}`);
            throw new Error(`排他移动失败 (Windows ${code}): ${source} -> ${target}`);
        };
    }

    let move: ReturnType<ReturnType<typeof koffi.load>["func"]>;
    try {
        const library = koffi.load(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib");
        move = process.platform === "linux"
            ? library.func("int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags)")
            : library.func("int renamex_np(const char *oldpath, const char *newpath, unsigned int flags)");
    } catch (cause) {
        throw new Error("排他移动原语不可用", {cause});
    }
    return (source, target) => {
        const result = process.platform === "linux"
            ? move(-100, source, -100, target, 1) // AT_FDCWD, RENAME_NOREPLACE
            : move(source, target, 4); // RENAME_EXCL
        if (result === 0) return;
        const code = koffi.errno();
        if (code === koffi.os.errno.EEXIST) throw new Error(`目标路径已存在: ${target}`);
        if (code === koffi.os.errno.ENOSYS || code === koffi.os.errno.ENOTSUP
            || code === koffi.os.errno.EOPNOTSUPP || code === koffi.os.errno.EINVAL) {
            throw new Error(`当前文件系统不支持排他移动 (${code}): ${target}`);
        }
        throw new Error(`排他移动失败 (errno ${code}): ${source} -> ${target}`);
    };
}

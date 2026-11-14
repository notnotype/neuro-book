/**
 * 进程级的文件锁，不判旧：拿到就一直持有，直到 release 或进程退出；进程怎么结束锁都会被操作系统放掉，所以没有
 * “判旧再回收”的竞争，也不会因为持有者暂停太久被别人接管。适合一直持有到进程结束的所有者（单实例、独占写；共享模式下
 * 是“有人在用”的登记，例如一份安装只在没人用时才换文件）；短时间的临界区要等待或接管时用按过期判旧的锁。Bun 与 Node
 * 都没有文件锁，这里经 bun:ffi 调系统接口：
 *
 * - Linux 与 macOS：libc 的 `flock`，独占 `LOCK_EX`、共享 `LOCK_SH`，都带 `LOCK_NB`；Linux 按 glibc 的库名 `libc.so.6` 加载；
 * - Windows：kernel32 的 `CreateFileW` 打开（允许别人读写删，只靠锁排他）再 `LockFileEx` 锁第一个字节，带
 *   `LOCKFILE_FAIL_IMMEDIATELY`，独占另加 `LOCKFILE_EXCLUSIVE_LOCK`。锁跟着句柄走，同一进程用另一个句柄也算另一个持有者。
 *
 * 共享与独占互斥：有共享持有者时独占拿不到，有独占持有者时共享拿不到；共享之间互不排斥。
 *
 * 锁的是文件（inode）而不是路径名：锁文件一旦建好就不要删，删了再建是另一个文件，新旧两把锁互不排他。
 *
 * Windows 段在 Windows 上实测过（docs/adr/0031-nb-story-supports-windows.md），自动测试与发布冒烟都不跑 Windows：改到它要在
 * Windows 上重测。
 */

import {dlopen, FFIType, ptr} from "bun:ffi";
import {closeSync, openSync} from "node:fs";

export interface FileLock {
    /** 关掉文件即放锁；之后这个对象不能再用，重复调用无事。 */
    release(): void;
}

export interface LockOptions {
    /** 共享锁：与别的共享持有者共存，与独占互斥。缺省独占。 */
    readonly shared?: boolean;
}

/**
 * 拿 `path` 上的锁（文件不存在就建）。返回 null 表示锁被与之互斥的持有者拿着：独占时是任何别的持有者，共享时是独占的
 * 持有者；同一进程里另一次 `tryLock` 也算别的持有者。
 * 别的失败都抛 Error：打不开文件（目录不存在、没有权限）、平台不支持、Windows 上 `LockFileEx` 报“被占用”以外的错误。
 *
 * POSIX 上 `flock` 的任何失败都当作被占用，不看 errno（沿用实测过的原实现）。所以在不支持 `flock` 的文件系统
 * （例如部分 NFS）上会一直返回 null。
 */
export function tryLock(path: string, options: LockOptions = {}): FileLock | null {
    const shared = options.shared === true;
    return process.platform === "win32" ? tryLockWindows(path, shared) : tryLockPosix(path, shared);
}

const LOCK_SH = 1;
const LOCK_EX = 2;
const LOCK_NB = 4;

let flock: ((fd: number, operation: number) => number) | undefined;

function loadFlock(): (fd: number, operation: number) => number {
    if (flock) return flock;
    const library = process.platform === "darwin" ? "libSystem.B.dylib" : process.platform === "linux" ? "libc.so.6" : null;
    if (!library) throw new Error(`file lock is not supported on ${process.platform} (needs flock)`);
    const {symbols} = dlopen(library, {flock: {args: [FFIType.i32, FFIType.i32], returns: FFIType.i32}});
    flock = (fd, operation) => symbols.flock(fd, operation);
    return flock;
}

function tryLockPosix(path: string, shared: boolean): FileLock | null {
    const fd = openSync(path, "a");
    if (loadFlock()(fd, (shared ? LOCK_SH : LOCK_EX) | LOCK_NB) !== 0) {
        closeSync(fd);
        return null;
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            closeSync(fd);
        },
    };
}

// Win32 常量。访问权限要按无符号数传：JS 的 `|` 得到有符号 32 位整数，`0x80000000 | 0x40000000` 是负数，
// 传进 u32 参数后 CreateFileW 拿到的权限不对，之后 LockFileEx 报 ERROR_ACCESS_DENIED（在 pc-notype 上实测）。
const GENERIC_READ_WRITE = (0x80000000 | 0x40000000) >>> 0;
const FILE_SHARE_READ_WRITE_DELETE = 0x1 | 0x2 | 0x4;
const OPEN_ALWAYS = 4;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const LOCKFILE_FAIL_IMMEDIATELY = 0x1;
const LOCKFILE_EXCLUSIVE_LOCK = 0x2;
const INVALID_HANDLE_VALUE = -1n;
/** 别的句柄已锁住这一段（`ERROR_LOCK_VIOLATION`）；其它错误码不是“被占用”，照实报出。 */
const ERROR_LOCK_VIOLATION = 33;
/** x64 上 OVERLAPPED 的大小；全零表示从文件开头锁。 */
const OVERLAPPED_SIZE = 32;

type Kernel32 = {
    CreateFileW(name: ReturnType<typeof ptr>, access: number, share: number, security: null, disposition: number, flags: number, template: null): bigint;
    LockFileEx(handle: bigint, flags: number, reserved: number, low: number, high: number, overlapped: ReturnType<typeof ptr>): number;
    CloseHandle(handle: bigint): number;
    GetLastError(): number;
};

let kernel32: Kernel32 | undefined;

function loadKernel32(): Kernel32 {
    if (kernel32) return kernel32;
    const {symbols} = dlopen("kernel32.dll", {
        CreateFileW: {args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64},
        LockFileEx: {args: [FFIType.i64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32},
        CloseHandle: {args: [FFIType.i64], returns: FFIType.i32},
        GetLastError: {args: [], returns: FFIType.u32},
    });
    kernel32 = symbols as unknown as Kernel32;
    return kernel32;
}

function tryLockWindows(path: string, shared: boolean): FileLock | null {
    const api = loadKernel32();
    const name = Buffer.from(`${path}\0`, "utf16le");
    const handle = api.CreateFileW(ptr(name), GENERIC_READ_WRITE, FILE_SHARE_READ_WRITE_DELETE, null, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, null);
    if (handle === INVALID_HANDLE_VALUE) throw new Error(`cannot open lock file ${path} (Win32 error ${api.GetLastError()})`);
    const overlapped = new Uint8Array(OVERLAPPED_SIZE);
    if (api.LockFileEx(handle, (shared ? 0 : LOCKFILE_EXCLUSIVE_LOCK) | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ptr(overlapped)) === 0) {
        const code = api.GetLastError();
        api.CloseHandle(handle);
        if (code === ERROR_LOCK_VIOLATION) return null;
        throw new Error(`cannot lock ${path} (Win32 error ${code})`);
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            api.CloseHandle(handle);
        },
    };
}

# @notnotype/nb-flock

进程级的独占文件锁，不判旧：拿到就一直持有，直到 `release()` 或进程退出；进程怎样结束（包括被强杀），锁都由操作系统放掉，不会因为持有者暂停太久被别人接管。适合一直持有到进程结束的单一所有者，例如单实例服务、独占写一个文件。短时间的临界区要排队等待或接管死掉的持有者时，用按过期判旧的锁（例如 `proper-lockfile`）。

只在 Bun 里用：经 `bun:ffi` 调系统接口，Linux 与 macOS 用 libc 的 `flock`（Linux 按 glibc 的库名 `libc.so.6` 加载），Windows 用 kernel32 的 `LockFileEx`。`bun:ffi` 被 Bun 标为实验性接口。不支持 `flock` 的文件系统（例如部分 NFS）上会一直拿不到锁。

## 用法

```ts
import {tryLock} from "@notnotype/nb-flock";

const lock = tryLock("/path/to/state/server.lock");
if (lock === null) throw new Error("another instance is running");
try {
    // 独占期间的工作
} finally {
    lock.release();
}
```

- `tryLock(path)`：文件不存在就建。返回 `null` 表示锁被别的持有者拿着（同一进程里第二次拿同一个文件也拿不到）；打不开文件、平台不支持等别的失败抛 `Error`。
- `release()`：关掉文件即放锁；重复调用无事。
- 锁的是文件而不是路径名：锁文件建好就不要删，删了再建是另一个文件，新旧两把锁互不排他。

## 安装

```bash
bun add @notnotype/nb-flock
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。

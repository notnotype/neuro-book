# @notnotype/nb-file-lock

跨进程的文件锁与加锁替换，基于 [proper-lockfile](https://www.npmjs.com/package/proper-lockfile) 的锁目录：

- `holdLock(lockPath, report, options?)`：取一把跨进程的锁；`stillHeld()` 发现锁被判为残留、被别的进程接管，`release()` 不会删掉接管者的锁。
- `replaceLocked(file, options)`：在锁里读当前字节、由调用方决定写什么、写同目录临时文件、改名前核对仍持有锁且文件没被改过，再改名替换。给了 `mode` 时替换后的文件（连同临时文件）总是这个权限位，例如只给本用户读写的密钥文件；不给时新建为 0o644，覆盖沿用原文件的权限位。
- `lockHeld(lockPath)`：观察锁目录现在是否被存活的持有者占着。
- `lock`、`LockOptions`：原样转出，给参数不同的另一把锁用。

不发 npm（`private`），只在本仓库的工作区里用。边界与测试见 [`AGENTS.md`](AGENTS.md)。

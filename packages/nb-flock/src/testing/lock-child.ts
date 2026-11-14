/**
 * 测试用的子进程入口：在另一个进程里拿锁，让测试证明锁真的跨进程、进程结束就放。只给本包的测试用，不进发布包。
 *
 * `bun lock-child.ts <锁文件> [shared]`：拿到锁打印 `held` 后一直挂着，等测试结束它；拿不到打印 `busy` 并以 1 退出。
 * 第二个参数是 `shared` 时拿共享锁。
 * 关掉标准输入也会结束（测试进程意外退出时子进程跟着走）。
 */

import {tryLock} from "../index";

const path = process.argv[2];
if (path === undefined) throw new Error("usage: lock-child.ts <lock file> [shared]");
const lock = tryLock(path, {shared: process.argv[3] === "shared"});
if (lock === null) {
    console.log("busy");
    process.exit(1);
}
console.log("held");
for await (const _chunk of Bun.stdin.stream()) {
    // 只等标准输入关闭
}
process.exit(0);

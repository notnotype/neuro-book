/**
 * 桌面壳测试用的子进程：在另一个进程里拿安装锁（`nbook-install.lock`），让测试证明“有人在用”“有人在发起换上”是跨进程的、
 * 进程结束就放。
 *
 * `bun install-holder.ts <通道根> shared|exclusive`：拿到打印 `held` 后一直挂着；拿不到打印 `busy` 并以 1 退出。关掉标准输入
 * 就退出（测试进程意外退出时子进程跟着走）。
 */

import {join} from "node:path";

import {tryLock} from "@notnotype/nb-flock";

import {INSTALL_LOCK_FILE} from "../update-install";

const [channelRoot, mode] = process.argv.slice(2);
if (channelRoot === undefined || (mode !== "shared" && mode !== "exclusive")) throw new Error("usage: install-holder.ts <channel root> shared|exclusive");
const lock = tryLock(join(channelRoot, INSTALL_LOCK_FILE), {shared: mode === "shared"});
if (lock === null) {
    console.log("busy");
    process.exit(1);
}
console.log("held");
for await (const _chunk of Bun.stdin.stream()) {
    // 只等标准输入关闭
}
process.exit(0);

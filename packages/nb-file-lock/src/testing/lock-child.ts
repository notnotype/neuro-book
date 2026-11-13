/**
 * 测试用的子进程入口：在另一个进程里取锁或做加锁替换，让测试证明锁真的跨进程。只给本包的测试用，产品代码不引用。
 *
 * - `bun lock-child.ts replace <文件> <锁目录> <次数>`：把文件里的整数加一，做够次数后以 0 退出；任何一次失败打印原因、以 1 退出。
 * - `bun lock-child.ts hold <锁目录> <残留毫秒>`：取锁后打印 `held`，再逐行读标准输入：`check` 打印 `still:<null 或失去锁的原因>`，
 *   `release` 释放后打印 `released` 并结束。
 *
 * 两种模式都把 `report` 收到的事件打印成 `report:<事件>`。
 */

import {holdLock, replaceLocked} from "../index";

const report = (event: string): void => {
    console.log(`report:${event}`);
};

async function replace(file: string, lockPath: string, times: number): Promise<number> {
    for (let done = 0; done < times; done += 1) {
        const result = await replaceLocked(file, {
            lockPath,
            report,
            decide: (current) => ({write: String(current === null ? 1 : Number(new TextDecoder().decode(current.bytes)) + 1)}),
        });
        if (!result.ok) {
            console.log(`failed:${result.reason}:${result.detail}`);
            return 1;
        }
    }
    return 0;
}

async function hold(lockPath: string, staleMs: number): Promise<number> {
    const held = await holdLock(lockPath, report, {stale: staleMs});
    if (!held.ok) {
        console.log(`failed:${held.reason}:${held.detail}`);
        return 1;
    }
    console.log("held");
    for await (const line of console) {
        if (line === "check") console.log(`still:${(await held.lock.stillHeld()) ?? "null"}`);
        if (line === "release") {
            await held.lock.release();
            console.log("released");
            return 0;
        }
    }
    return 1;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "replace" && rest.length === 3) process.exitCode = await replace(rest[0] as string, rest[1] as string, Number(rest[2]));
else if (mode === "hold" && rest.length === 2) process.exitCode = await hold(rest[0] as string, Number(rest[1]));
else {
    console.log(`usage: lock-child.ts replace <file> <lockPath> <times> | hold <lockPath> <staleMs>`);
    process.exitCode = 2;
}

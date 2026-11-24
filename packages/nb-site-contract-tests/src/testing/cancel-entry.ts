/**
 * `src/sandbox.test.ts` 起的测试入口：经沙箱起一个服务，就绪后在标准输出写一行 `CANCEL_ENTRY_READY <JSON>`，然后一直等，
 * 直到外面的用例取消这个测试进程。文件名不合 `*.test.ts`，平常跑 `bun test` 时不会选中它；只能按路径运行。
 */

import {test} from "bun:test";

import {useSiteSandbox} from "./site";

// 与 `src/sandbox.test.ts` 里的同名常量一致。那边不能导入本文件：导入会执行下面的 `test()`，把这个不会结束的用例登记进那个文件。
const READY_PREFIX = "CANCEL_ENTRY_READY ";

const sandbox = useSiteSandbox("cancel-entry.ts");

test(
    "serve until this test process is cancelled",
    async () => {
        const site = await sandbox.start({dataDir: await sandbox.dataDir()});
        await site.ready();
        console.log(`${READY_PREFIX}${JSON.stringify({pid: site.pid, url: site.url, root: sandbox.root})}`);
        // 不 settle：这个测试进程要停在“服务正在跑”的状态，等外面发信号。用例上限给足，免得先被测试器的超时收掉。
        await new Promise<never>(() => undefined);
    },
    600_000,
);

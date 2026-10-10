/**
 * `identity.test.ts` 与 `registry.test.ts` 起的子进程：另一个进程改同一个身份文件、或在受限的 umask 下新建作品。
 * 按行与测试对话（stdout 一行一个事件，stdin 一行一个指令），不按时间等待。只由测试启动。
 *
 * - `update <项目目录> <id> <patch JSON>`：加载完打印 `ready`；收到 `go` 调用 `updateProjectMetadata`，打印结果 JSON 后退出。
 *   两个子进程都打印 `ready` 后测试同时放行，让两次修改真的在两个进程里争同一把锁。
 * - `create <状态根> <工作目录> <input JSON> <umask 八进制>`：把本进程的 umask 设成给定值后经登记表新建作品，打印结果
 *   JSON 后退出。umask 是进程级的，放在子进程里不影响测试进程。
 */

import {updateProjectMetadata} from "../identity";
import {createProjectRegistry} from "../registry";

async function firstLine(): Promise<string> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk, {stream: true});
        const index = buffer.indexOf("\n");
        if (index >= 0) return buffer.slice(0, index);
    }
    return buffer;
}

const report = (event: string, error: unknown): void => console.error(event, error);
const [mode, ...args] = process.argv.slice(2);

if (mode === "update" && args.length === 3) {
    const [path, id, patch] = args as [string, string, string];
    console.log("ready");
    if ((await firstLine()) === "go") console.log(JSON.stringify(await updateProjectMetadata(path, id, JSON.parse(patch), {report})));
} else if (mode === "create" && args.length === 4) {
    const [stateRoot, cwd, input, umask] = args as [string, string, string, string];
    process.umask(Number.parseInt(umask, 8));
    console.log(JSON.stringify(await createProjectRegistry({stateRoot, cwd}).create(JSON.parse(input))));
} else {
    throw new Error(`用法：update <项目目录> <id> <patch> | create <状态根> <工作目录> <input> <umask>，收到 ${process.argv.slice(2).join(" ")}`);
}

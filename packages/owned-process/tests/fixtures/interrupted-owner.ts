import {writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {spawnOwnedProcess} from "#owned-process/index";

const statePath = process.argv[2];
if (!statePath) throw new Error("中断fixture缺少状态路径。");

// 像 Source Dev 一样自己处理 SIGINT：收到后主动终止 lease，把终态写给测试。
const lease = spawnOwnedProcess({
    command: process.execPath,
    args: [fileURLToPath(new URL("./owned-root.ts", import.meta.url))],
    env: {...process.env, OWNED_PROCESS_STATE_PATH: statePath},
    stdout: "pipe",
    stderr: "pipe",
    graceMs: 100,
    hardKillWaitMs: 2_000,
});
process.on("SIGINT", () => {
    lease.terminate("shutdown").then(
        (completion) => writeFileSync(`${statePath}.result`, JSON.stringify(completion), "utf8"),
        (error: unknown) => writeFileSync(`${statePath}.result`, JSON.stringify({error: String(error)}), "utf8"),
    ).finally(() => process.exit(0));
});
setInterval(() => undefined, 60_000);

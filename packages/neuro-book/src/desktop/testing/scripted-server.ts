/**
 * 桌面壳测试用的服务端入口：经产品认领档案认领状态根，对壳可观察的部分（认领、应答、标准输入上的 `stop`）与真实服务端相同，
 * 行为由环境变量定。每次拉起是一代（第几次在这个状态根上拉起），测试从状态根上的记录读到每一代的进程号与它收到的 `stop`：
 *
 * - `targets.jsonl`：每代认领后追加一行 `{generation, pid, supervisor}`，`supervisor` 是 owned-process 的监督进程（父进程）。
 * - `stopped.jsonl`：收到 `stop` 的那一代追加一行 `{generation}`，然后放下认领、以 0 退出。
 *
 * 环境变量：
 *
 * - `NBOOK_TEST_TARGET_STOP=ignore`：不理 `stop` 与 SIGTERM，只能被 SIGKILL 结束（停止卡住）。
 * - `NBOOK_TEST_TARGET_HOLD=2,3`：这几代认领后停在 `starting`，直到状态根上出现 `release-<代>` 文件才发布地址（就绪）；
 *   文件一直不出现就一直停在 `starting`。
 */

import {appendFileSync, existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {claimNeuroBook} from "../../server/instance";

const root = process.env.NBOOK_STATE_ROOT;
if (root === undefined) throw new Error("没有 NBOOK_STATE_ROOT");
const targets = join(root, "targets.jsonl");
const generation = existsSync(targets) ? readFileSync(targets, "utf8").split("\n").filter((line) => line !== "").length + 1 : 1;
const claimed = await claimNeuroBook({stateRoot: root, kind: "product", report: (event, error) => console.error(event, error)});
if (!claimed.ok) process.exit(9);
appendFileSync(targets, `${JSON.stringify({generation, pid: process.pid, supervisor: process.ppid})}\n`);

if (process.env.NBOOK_TEST_TARGET_STOP === "ignore") {
    process.stdin.on("data", () => undefined);
    process.on("SIGTERM", () => undefined);
} else {
    process.stdin.on("data", (chunk) => {
        if (!String(chunk).includes("stop")) return;
        appendFileSync(join(root, "stopped.jsonl"), `${JSON.stringify({generation})}\n`);
        void claimed.claim.release().then(() => process.exit(0));
    });
}

const held = (process.env.NBOOK_TEST_TARGET_HOLD ?? "").split(",").includes(String(generation));
const release = join(root, `release-${String(generation)}`);
while (held && !existsSync(release)) await Bun.sleep(20);
claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/rpc", extra: {plugins: {safeMode: false, items: []}}});
setInterval(() => undefined, 1000);

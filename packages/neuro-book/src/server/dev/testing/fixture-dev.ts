/**
 * 开发会话合同测试的子进程入口：与 `dev/main.ts` 相同的会话流程，后端换成宿主测试的子进程入口
 * （`NBOOK_TEST_PLUGINS` 照常传递），监视根由 `NBOOK_TEST_WATCH_ROOT` 指定。只由测试启动。
 */

import {join, resolve} from "node:path";

import {readDevConfig} from "nbook/server/dev/config";
import {runDev} from "nbook/server/dev/run";

const packageRoot = resolve(import.meta.dir, "../../../..");
const watchRoot = process.env.NBOOK_TEST_WATCH_ROOT;
if (!watchRoot) throw new Error("缺少 NBOOK_TEST_WATCH_ROOT");

const code = await runDev({
    config: readDevConfig(process.env, packageRoot),
    configFile: join(packageRoot, "vite.config.ts"),
    watchRoots: [watchRoot],
    backend: (env) => ({command: [process.execPath, join(packageRoot, "src/server/testing/fixture-entry.ts"), "--stop-stdin"], cwd: packageRoot, env}),
});
process.exit(code);

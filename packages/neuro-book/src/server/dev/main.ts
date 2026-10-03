/**
 * 开发命令入口：`bun run dev`。页面在 `NBOOK_DEV_PORT`（缺省 3000），后端改动后有序重启；参数见 `config.ts`。
 */

import {join, resolve} from "node:path";

import {DevConfigError, readDevConfig} from "./config";
import type {DevConfig} from "./config";
import {runDev} from "./run";
import {backendWatchRoots} from "./watch";

const packageRoot = resolve(import.meta.dir, "../../..");

function readConfigOrExit(): DevConfig {
    try {
        return readDevConfig(process.env, packageRoot);
    } catch (error) {
        if (!(error instanceof DevConfigError)) throw error;
        process.stderr.write(`[dev] config-invalid ${error.message}\n`);
        process.exit(1);
    }
}

const code = await runDev({
    config: readConfigOrExit(),
    configFile: join(packageRoot, "vite.config.ts"),
    watchRoots: backendWatchRoots(packageRoot),
    backend: (env) => ({command: [process.execPath, join(packageRoot, "src/server/main.ts"), "--stop-stdin"], cwd: packageRoot, env}),
});
process.exit(code);

// 测试用的进程入口：与 `main.ts` 同一个 `runCli`，模块换成 `NB_SITE_FIXTURE` 选出的夹具模块（`modules.ts`）。

import {runCli} from "../cli";
import {fixtureModules} from "./modules";

process.exit(await runCli(process.argv.slice(2), fixtureModules(process.env.NB_SITE_FIXTURE)));

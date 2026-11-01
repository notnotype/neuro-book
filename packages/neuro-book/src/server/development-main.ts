/**
 * 后端进程入口（开发）：`bun run dev` 的监督进程启动它，在产品清单之外加载开发清单（Lab）。参数与产品入口相同，另认
 * `NBDEV_SAMPLE=1`：运行实例可用之后在后台放样例作品（`dev/sample.ts`）。生产构建只打包 `main.ts`，不含本入口。
 */

// 第一条导入：启动环境要在任何导入 OMP 的模块之前拍下（startup-env.ts）。
import "./startup-env";
// 第二条：接管 OMP 装的进程级处理（omp-process.ts）。
import "./omp-process";

import {join, resolve} from "node:path";

import {developmentPlugins} from "nbook/development-manifest";
import {productPlugins} from "nbook/manifest";

import {devSampleEnabled, startDevSample} from "./dev/sample";
import {runServerProcess} from "./process";

const packageRoot = resolve(import.meta.dir, "../..");

await runServerProcess([...productPlugins, ...developmentPlugins], {
    kind: "development",
    projectEntry: join(import.meta.dir, "..", "project", "development-main.ts"),
    devTask: devSampleEnabled(process.env)
        ? ({registry, stateRoot}) => startDevSample({registry, stateRoot, packageRoot, report: (line) => console.log(line)})
        : undefined,
});

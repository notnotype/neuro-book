/**
 * 后端进程入口（开发）：`bun run dev` 的监督进程启动它，在产品清单之外加载开发清单（Lab）。参数与产品入口相同；
 * 生产构建只打包 `main.ts`，不含本入口。
 */

import {developmentPlugins} from "nbook/development-manifest";
import {productPlugins} from "nbook/manifest";

import {runServerProcess} from "./process";

await runServerProcess([...productPlugins, ...developmentPlugins]);

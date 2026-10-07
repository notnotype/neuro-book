/**
 * 项目子进程入口（开发）：开发模式的后端起项目子进程时用它，在产品清单之外加载开发清单，与服务端的开发入口
 * 对称；生产构建只打包 `main.ts`。
 */

import {developmentPlugins} from "nbook/development-manifest";
import {productPlugins} from "nbook/manifest";

import {runProjectProcess} from "./process";

await runProjectProcess([...productPlugins, ...developmentPlugins]);

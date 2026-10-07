/**
 * 项目子进程入口（产品）：服务端为每个打开的项目起一个，经环境变量交入项目与代次、经 IPC 相连；不单独运行。
 * 生产打包为与服务端入口同目录的 `project.js`。
 */

import {productPlugins} from "nbook/manifest";

import {runProjectProcess} from "./process";

await runProjectProcess(productPlugins);

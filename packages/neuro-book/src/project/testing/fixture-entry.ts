/**
 * 项目子进程的测试入口：与 `main.ts` 相同的启动与退出流程，另在产品插件之外加入故障插件
 * （`NBOOK_TEST_PROJECT_FAULT`，缺省 `none`）。服务端的测试入口把它作为项目宿主入口。只由测试启动。
 */

import {productPlugins} from "nbook/manifest";

import {manifestProjectPlugins} from "../plugins";
import {runProjectProcess} from "../process";
import {createProjectFaultPlugin, PROJECT_FAULTS} from "./fault-plugin";
import type {ProjectFault} from "./fault-plugin";

const fault = process.env.NBOOK_TEST_PROJECT_FAULT ?? "none";
if (!(PROJECT_FAULTS as ReadonlyArray<string>).includes(fault)) throw new Error(`未知的项目故障：${fault}`);

await runProjectProcess(productPlugins, (context) => [...manifestProjectPlugins(context), createProjectFaultPlugin(fault as ProjectFault, context.currentProject)]);

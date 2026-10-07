/**
 * 项目子进程的测试入口：与 `main.ts` 相同的启动与退出流程，另在产品插件之外加入故障插件
 * （`NBOOK_TEST_PROJECT_FAULT`，缺省 `none`），`NBOOK_TEST_PLUGINS` 含 `test.remote-probe` 时加入探针的项目入口。
 * 服务端的测试入口把它作为项目宿主入口，环境变量随子进程继承。只由测试启动。
 */

import {productPlugins} from "nbook/manifest";
import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {manifestProjectPlugins} from "../plugins";
import {runProjectProcess} from "../process";
import {createProjectFaultPlugin, PROJECT_FAULTS} from "./fault-plugin";
import type {ProjectFault} from "./fault-plugin";
import {createRemoteProbeProjectPlugin} from "./probe-plugin";

const fault = process.env.NBOOK_TEST_PROJECT_FAULT ?? "none";
if (!(PROJECT_FAULTS as ReadonlyArray<string>).includes(fault)) throw new Error(`未知的项目故障：${fault}`);
const probe = (process.env.NBOOK_TEST_PLUGINS ?? "").split(",").includes(remoteProbeDescriptor.id);

await runProjectProcess(productPlugins, (context) => [
    ...manifestProjectPlugins(context),
    createProjectFaultPlugin(fault as ProjectFault, context.currentProject),
    ...(probe ? [createRemoteProbeProjectPlugin(context.currentProject)] : []),
]);

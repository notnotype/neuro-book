/**
 * e2e 测试外壳的入口：产品清单的浏览器插件，加上测试插件 `test.remote-probe`。由 `vite.e2e.config.ts` 构建到
 * `dist/e2e/web`，服务端用宿主测试入口（`src/server/testing/fixture-entry.ts`）提供它。
 */

import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {bootWindowUi} from "../boot";
import {browserPluginFactories, builtinBrowserPlugins} from "../plugins";

import {createRemoteProbeBrowserPlugin} from "./remote-probe";

await bootWindowUi({
    builtin: [...builtinBrowserPlugins, remoteProbeDescriptor],
    factories: {...browserPluginFactories, [remoteProbeDescriptor.id]: createRemoteProbeBrowserPlugin},
});

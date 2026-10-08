/**
 * e2e 测试外壳的入口：产品清单的浏览器插件，加上测试插件 `test.remote-probe` 与 `test.sample-views`（服务端按
 * `NBOOK_TEST_PLUGINS` 决定引导集合里有没有它们，没列出的不装）。由 `vite.e2e.config.ts` 构建到
 * `dist/e2e/web`，服务端用宿主测试入口（`src/server/testing/fixture-entry.ts`）提供它。
 */

import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";
import {sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

import {bootWindowUi} from "../boot";
import {browserPluginDefinitions, builtinBrowserPlugins} from "../plugins";

import {createRemoteProbeBrowserPlugin} from "./remote-probe";
import {createSampleViewsBrowserPlugin} from "./sample-views";

await bootWindowUi({
    builtin: [...builtinBrowserPlugins, remoteProbeDescriptor, sampleViewsDescriptor],
    definitions: {...browserPluginDefinitions, [remoteProbeDescriptor.id]: createRemoteProbeBrowserPlugin(), [sampleViewsDescriptor.id]: createSampleViewsBrowserPlugin()},
});

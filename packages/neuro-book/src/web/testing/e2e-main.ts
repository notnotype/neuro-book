/**
 * e2e 测试外壳的入口：产品清单的浏览器插件，加上测试插件 `test.remote-probe`、`test.sample-views` 与 `test.menus`（服务端按
 * `NBOOK_TEST_PLUGINS` 决定引导集合里有没有它们，没列出的不装）。由 `vite.e2e.config.ts` 构建到
 * `dist/e2e/web`，服务端用宿主测试入口（`src/server/testing/fixture-entry.ts`）提供它。
 */

import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";
import {testMenusDescriptor} from "nbook/shared/testing/menus-contract";
import {projectViewDescriptor} from "nbook/shared/testing/project-view-contract";
import {sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

import {bootWindowUi} from "../boot";
import {browserPluginDefinitions, builtinBrowserPlugins} from "../plugins";

import {createRemoteProbeBrowserPlugin} from "./remote-probe";
import {createProjectViewBrowserPlugin} from "./project-view";
import {createSampleViewsBrowserPlugin} from "./sample-views";
import {createTestMenusBrowserPlugin} from "./test-menus";

await bootWindowUi({
    builtin: [...builtinBrowserPlugins, remoteProbeDescriptor, sampleViewsDescriptor, testMenusDescriptor, projectViewDescriptor],
    definitions: {...browserPluginDefinitions, [remoteProbeDescriptor.id]: createRemoteProbeBrowserPlugin(), [sampleViewsDescriptor.id]: createSampleViewsBrowserPlugin(), [testMenusDescriptor.id]: createTestMenusBrowserPlugin(), [projectViewDescriptor.id]: createProjectViewBrowserPlugin()},
});

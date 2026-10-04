import type {PluginDescriptor} from "nbook/manifest";

/**
 * Component Lab（ui.component-lab）：只在开发模式加载，向 `workbench.pages` 贡献 `/lab` 页面。列在开发清单
 * （`src/development-manifest.ts`）而不是产品清单，生产构建不含它的代码。
 */
export const descriptor: PluginDescriptor = {id: "nbook.lab", version: "0.1.0", locations: ["browser"]};

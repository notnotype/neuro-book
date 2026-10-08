import type {PluginDescriptor} from "nbook/manifest";

import {localeSetting} from "./shared/contracts";

/**
 * 配置：拥有贡献点 `settings.properties`，按默认值、用户层（`<状态根>/settings.json`）与项目层
 * （`<项目目录>/.nbook/settings.json`）合成有效值并推到每个实例（docs/specs/settings/configuration.md）。
 */
export const descriptor: PluginDescriptor = {id: "nbook.settings", version: "0.1.0", locations: ["server", "project", "browser"], contributions: [localeSetting.contribution]};

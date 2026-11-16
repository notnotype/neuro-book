/**
 * 通用插件管理自己的测试用的平台档案：一个叫 acme 的应用。这个目录的测试不用 NeuroBook 的档案，用它们证明通用部分不依赖
 * 任何一个应用（design 见 w00027 t13）。
 */

import {createManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";

import type {PlatformProfile} from "../shared/profile";
import {npmVersions} from "../shared/versions";

export const ACME_PROFILE: PlatformProfile = {
    format: createManifestFormat({engine: "acme", reservedPublishers: ["acme"]}, npmVersions),
    productName: "Acme",
    productVersion: "0.1.0",
    pluginApiSince: "0.1.0",
    registrySchema: "acme.plugins/v1",
    safeModeEnv: "ACME_SAFE_MODE",
    authorField: "acme",
    registryGlobal: "__ACME_PLUGIN_REGISTRY__",
    styleDataset: "acmePluginStyle",
    filesMount: "/acme/files-api",
    buildTempPrefix: ".acme-plugin-build-",
    hostPackages: ["@acme/sdk"],
    notSharedHints: [],
    sharedModules: {browser: ["vue", "@vue/reactivity", "@acme/sdk"], server: ["@vue/reactivity", "@acme/sdk"]},
};

/** 换一个产品版本的同一份档案（兼容检查的用例）；兼容起点缺省等于这个版本，即只看当前版本。 */
export function acmeAt(productVersion: string, pluginApiSince = productVersion): PlatformProfile {
    return {...ACME_PROFILE, productVersion, pluginApiSince};
}

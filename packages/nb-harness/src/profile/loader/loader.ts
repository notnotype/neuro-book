/**
 * 子入口 `@notnotype/nb-harness/profile/loader`：加载 Profile 文件会执行它的模块代码（Profile 文件全部信任）。
 */

import {pathToFileURL} from "node:url";
import {profileFromModule} from "../define";
import * as jsxDevRuntime from "../jsx-dev-runtime";
import * as jsxRuntime from "../jsx-runtime";
import * as profileModule from "../profile";
import type {Profile, ProfileResult} from "../types";

export {profileFromModule} from "../define";

const PACKAGE_SUBPATH = "@notnotype/nb-harness/profile";

let resolverInstalled = false;

/**
 * Profile 文件在用户的目录里，旁边没有 node_modules，`import … from "@notnotype/nb-harness/profile"` 与 `@jsxImportSource`
 * 都解析不到本包。这里给 Bun 注册同名的虚拟模块，导出就是本包已加载的模块实例（同一份实例，defineProfile 的标记才认得）。
 * 用 `build.module` 而不是 `onResolve`：Bun 1.4 的运行时 onResolve 不会为解析失败的裸包名调用。进程内只注册一次，
 * 是本模块唯一的进程级状态；只影响这四个确切的包名，别的导入照常。
 */
function installResolver(): void {
    if (resolverInstalled) return;
    resolverInstalled = true;
    Bun.plugin({
        name: "nb-harness-profile-imports",
        setup(build) {
            build.module(PACKAGE_SUBPATH, () => ({exports: profileModule, loader: "object"}));
            build.module(`${PACKAGE_SUBPATH}/jsx-runtime`, () => ({exports: jsxRuntime, loader: "object"}));
            build.module(`${PACKAGE_SUBPATH}/jsx-dev-runtime`, () => ({exports: jsxDevRuntime, loader: "object"}));
            build.module(`${PACKAGE_SUBPATH}/loader`, () => ({exports: {loadProfile, profileFromModule}, loader: "object"}));
        },
    });
}

export async function loadProfile(path: string): Promise<ProfileResult<Profile>> {
    installResolver();
    let module: unknown;
    try {
        module = await import(pathToFileURL(path).href);
    } catch (error) {
        return {ok: false, code: "module-load-failed", detail: `加载 ${path} 失败：${error instanceof Error ? error.message : String(error)}`, diagnostics: []};
    }
    return profileFromModule(module, path);
}

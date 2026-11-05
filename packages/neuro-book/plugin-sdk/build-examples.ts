/**
 * 把仓库里的示例插件（`plugin-sdk/examples/plugins/<名>`）构建成可以安装的插件目录，供 e2e 与手动安装。示例按第三方插件写，只从
 * SDK 包名导入；仓库里没有安装 SDK 包，这里把包名指到应用源码（与 tsconfig、Vite 的别名相同），并把应用源码列为不许打进
 * 产物的目录：示例要是绕过 SDK 直接引用了应用内部，构建就失败。
 *
 * 用法：`bun run build:examples [名…]`，缺省构建全部有 `package.json` 的示例，产物到各自的 `dist/`（git 忽略）。
 */

import {existsSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {isInside} from "../src/plugin-platform/backend/paths";
import {SDK_ENTRIES} from "../src/sdk/entries";

import {buildPlugin, PluginBuildError} from "./build";
import type {BuildPluginResult} from "./build";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const EXAMPLES_ROOT = join(packageRoot, "plugin-sdk/examples/plugins");

/** 仓库里构建示例的别名与禁止目录。 */
export const IN_REPO_BUILD = {
    alias: [
        ...SDK_ENTRIES.map((entry) => ({find: new RegExp(`^${entry.specifier.replaceAll("/", "\\/")}$`, "u"), replacement: join(packageRoot, "src/sdk", entry.file)})),
        {find: /^nbook\//u, replacement: join(packageRoot, "src/")},
    ],
    forbiddenDirectories: [join(packageRoot, "src")],
} as const;

/**
 * 构建一个示例；`outDir` 缺省为它的 `dist/`。输出目录不存在、为空，或者里面是这个示例上次的产物（或中断的构建留下的中间
 * 目录）时先清空再构建；否则拒绝，不递归删除不是自己生成的目录（`outDir` 可以从命令行之外的调用方传进来）。输出目录不能是
 * 示例目录本身或它的上级：那里的 `package.json` 就是作者写的那份，按清单字段认不出来。
 */
export async function buildExample(name: string, outDir: string = join(EXAMPLES_ROOT, name, "dist")): Promise<BuildPluginResult> {
    const root = join(EXAMPLES_ROOT, name);
    const target = resolve(outDir);
    if (isInside(root, target)) throw new PluginBuildError("输出目录不能是示例目录或它的上级", [{path: "", message: target}]);
    return buildPlugin({root, outDir: target, clean: true, ...IN_REPO_BUILD});
}

if (import.meta.main) {
    const requested = process.argv.slice(2);
    const names = requested.length > 0 ? requested : (await readdir(EXAMPLES_ROOT)).filter((name) => existsSync(join(EXAMPLES_ROOT, name, "package.json")));
    for (const name of names) {
        const result = await buildExample(name);
        for (const warning of result.warnings) console.warn(`${name}：${warning}`);
        console.log(`${name}：${result.files.join("、")}`);
    }
}

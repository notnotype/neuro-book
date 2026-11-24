#!/usr/bin/env bun
/**
 * 示例应用（`examples/*`）的类型检查与构建：`bun scripts/examples.ts typecheck|build [名字…]`，不给名字就是全部。
 *
 * 示例不是工作区成员：第三方把一个目录拷走、装依赖就能跑。在仓库里它们的 `@notnotype/nb-layout`、`vue`、`vite`
 * 从根 `node_modules` 解析（nb-layout 是指到本包源码的工作区链接），所以这里直接用根上的 `vue-tsc` 与 `vite`，
 * 不在示例目录里装依赖：装了会留一份 `node_modules`，里面的 Vue 盖住根上的那份。
 */

import {existsSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {join} from "node:path";

const PACKAGE = join(import.meta.dir, "..");
const EXAMPLES = join(PACKAGE, "examples");
const BIN = join(PACKAGE, "..", "..", "node_modules", ".bin");

/** 示例的名字：`examples/` 下带 `package.json` 的目录。 */
export async function exampleNames(): Promise<string[]> {
    const entries = await readdir(EXAMPLES, {withFileTypes: true});
    return entries.filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES, entry.name, "package.json"))).map((entry) => entry.name).sort();
}

export function exampleDir(name: string): string {
    return join(EXAMPLES, name);
}

async function run(command: string[], cwd: string): Promise<number> {
    const child = Bun.spawn(command, {cwd, stdout: "inherit", stderr: "inherit"});
    return await child.exited;
}

if (import.meta.main) {
    const [task, ...requested] = process.argv.slice(2);
    if (task !== "typecheck" && task !== "build") {
        console.error("用法：bun scripts/examples.ts typecheck|build [示例名…]");
        process.exit(2);
    }
    const names = requested.length > 0 ? requested : await exampleNames();
    let failed = 0;
    for (const name of names) {
        const cwd = exampleDir(name);
        const command = task === "typecheck" ? [join(BIN, "vue-tsc"), "--noEmit", "-p", "tsconfig.json"] : [join(BIN, "vite"), "build", "--logLevel", "warn"];
        const code = await run(command, cwd);
        if (code !== 0) {
            console.error(`示例 ${name} 的 ${task} 失败（退出码 ${code}）`);
            failed += 1;
        }
    }
    process.exit(failed === 0 ? 0 : 1);
}

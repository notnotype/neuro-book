/**
 * 打官方站的镜像（包脚本 `build:image`）：在构建机上用 `Bun.build` 把进程入口打成单个 `server.js`，连同 Dockerfile 放进
 * `dist/image/`，再以这个目录为构建上下文 `docker build`。镜像里不跑 `bun install`：根 `package.json` 带着旧应用的整套依赖
 * 与 `postinstall`，在镜像里装工作区要逐个拷各包的清单（w00037 t05 计划的技术选型一节）。
 *
 * 构建上下文只有 `dist/image/`，仓库根的 `.dockerignore`（给旧应用写的）不参与。
 * 迁移的 SQL 经 `with {type: "text"}` 导入，打包时已内联进 `server.js`；`bun:sqlite`、`bun:ffi`（nb-flock）是运行时内置模块，
 * 不进产物，所以基础镜像的 Bun 要提供它们，见 Dockerfile 的说明。
 *
 * 用法：`bun run build:image [--no-docker] [--tag <名字>]`。`--no-docker` 只出产物（CI 的合同测试对着它跑）；`--tag` 缺省
 * `nb-site:local`。不推送镜像。
 */

import {copyFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const OUT_DIR = join(PACKAGE_ROOT, "dist", "image");

const {values} = parseArgs({
    args: process.argv.slice(2),
    options: {
        "no-docker": {type: "boolean", default: false},
        tag: {type: "string", default: "nb-site:local"},
    },
    strict: true,
});

// dist/ 被 .gitignore 忽略，整个目录都是上一次构建的产物；先清掉，免得旧文件（例如改名前的产物）混进构建上下文。
await rm(OUT_DIR, {recursive: true, force: true});

const result = await Bun.build({
    entrypoints: [join(PACKAGE_ROOT, "src", "main.ts")],
    target: "bun",
    outdir: OUT_DIR,
    naming: {entry: "server.[ext]"},
    sourcemap: "linked",
});
if (!result.success) {
    for (const message of result.logs) console.error(message);
    process.exit(1);
}
await copyFile(join(import.meta.dir, "Dockerfile"), join(OUT_DIR, "Dockerfile"));
const server = result.outputs.find((output) => output.kind === "entry-point");
console.log(`built ${server?.path ?? join(OUT_DIR, "server.js")} (${String(server?.size ?? 0)} bytes)`);

if (!values["no-docker"]) {
    const docker = Bun.spawn(["docker", "build", "--tag", values.tag, OUT_DIR], {stdio: ["ignore", "inherit", "inherit"]});
    const exitCode = await docker.exited;
    if (exitCode !== 0) {
        console.error(`docker build exited with ${String(exitCode)}`);
        process.exit(1);
    }
    console.log(`built image ${values.tag}`);
}

/**
 * 准备桌面壳的 Hutch 工程（docs/specs/runtime/desktop-shell.md）：在仓库里把主进程打成一个文件 `bundle/main.js`（Electrobun 的
 * `electrobun/*` 留给 Hutch 解析），按发布清单组装 Windows 载荷到 `payload/`，把产品版本写进 `bundle/version.json`（`electrobun.config.ts` 读它）。之后在
 * Windows 上进这个目录 `hutch electrobun build --env=stable`（见 README）；打便携包时在解压出的程序根目录放便携标记。
 *
 * 用法：`bun desktop/scripts/build.ts [<release-manifest.json>] [--os win32 --cpu x64]`（在 `packages/neuro-book` 下运行）。
 * 不给发布清单时只打主进程。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {parseArgs} from "node:util";

import {assembleDesktopPayload} from "../../scripts/desktop-payload";
import {PRODUCT_VERSION} from "../../src/shared/product";

const desktop = join(import.meta.dir, "..");
const {positionals, values} = parseArgs({allowPositionals: true, options: {os: {type: "string"}, cpu: {type: "string"}}});

const built = await Bun.build({
    entrypoints: [join(desktop, "src", "bun", "index.ts")],
    outdir: join(desktop, "bundle"),
    naming: "main.js",
    target: "bun",
    external: ["electrobun", "electrobun/*"],
});
if (!built.success) throw new AggregateError(built.logs, "打包桌面壳的主进程失败");
const bundle = await readFile(join(desktop, "bundle", "main.js"), "utf8");
// 主进程不该把服务端的外部依赖（OMP）带进来：它只用认领、配置解析与进程托管。
if (bundle.includes("@oh-my-pi/")) throw new Error("bundle/main.js 引用了 @oh-my-pi：桌面壳的主进程不该依赖服务端的外部包");

await writeFile(join(desktop, "bundle", "version.json"), `${JSON.stringify({version: PRODUCT_VERSION})}\n`);

const [manifest] = positionals;
if (manifest !== undefined) {
    const payload = await assembleDesktopPayload({releaseManifest: manifest, outDir: join(desktop, "payload"), os: values.os ?? "win32", cpu: values.cpu ?? "x64"});
    console.log(`载荷：${payload.target.os}-${payload.target.cpu}，${String(payload.files.length)} 个文件`);
}
console.log(`桌面壳主进程：${join(desktop, "bundle", "main.js")}（${(bundle.length / 1024).toFixed(0)} KB），版本 ${PRODUCT_VERSION}`);

/**
 * 应用的 npm 包（`scripts/pack-app.ts`）：真实打包两个服务端入口与 `bun pm pack`，Web 产物用一个只有 `index.html` 与许可清单的
 * 目录代替（真实的前端构建与从 tarball 安装、启动、打开作品由 `e2e/app-package.e2e.ts` 验收）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {BUN_ENGINE, PRODUCT_VERSION} from "../src/shared/product";

import {locateDocsRoot} from "../src/plugins/agent/backend/docs-root";
import {APP_NAME, bundleProblems, packApp} from "./pack-app";

let tmp = "";
let web = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-pack-app", "pack-app");
    web = join(tmp, "web");
    await mkdir(join(web, ".vite"), {recursive: true});
    await writeFile(join(web, "index.html"), "<!doctype html><title>t</title>");
    await mkdir(join(web, "assets"), {recursive: true});
    await writeFile(join(web, "assets", "codicon-abc123.ttf"), "font");
    await writeFile(join(web, ".vite", "license.json"), JSON.stringify([{name: "example-lib", version: "1.2.3", identifier: "MIT", text: "MIT License (example-lib)"}]));
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function tarEntries(tarball: string): string[] {
    const listed = Bun.spawnSync(["tar", "tzf", tarball]);
    if (listed.exitCode !== 0) throw new Error(listed.stderr.toString());
    return listed.stdout.toString().split("\n").filter((line) => line !== "" && !line.endsWith("/")).sort();
}

describe("应用包", () => {
    it("只有白名单里的文件；依赖只有不打进 bundle 的 OMP、版本是产品版本、bin 是 nbook；许可清单含打进去的包、前端的包与字体", async () => {
        const out = join(tmp, "out", "neuro-book");
        const {directory, tarball} = await packApp({webRoot: web, outDir: out});
        expect(directory).toBe(out);
        expect(tarball).toBe(join(tmp, "out", `notnotype-neuro-book-${PRODUCT_VERSION}.tgz`));
        // 命令行开代码分割：入口旁边有它的 chunk（名字带内容哈希），其余文件固定。
        const entries = tarEntries(tarball);
        const chunks = entries.filter((name) => /^package\/server\/(?:nbook|project)-[\w-]+\.js$/u.test(name));
        expect(chunks.some((name) => name.startsWith("package/server/nbook-"))).toBe(true);
        // Agent 读的产品文档（docs/specs/agent/resources.md 输出 8）：SDK 的作者文档与 Agent 自己的文档。
        const docs = entries.filter((name) => name.startsWith("package/docs/"));
        expect(docs).toEqual(expect.arrayContaining(["package/docs/builtin/sdk/README.md", "package/docs/builtin/sdk/docs/exports.md", "package/docs/agent/addresses.md"]));
        expect(entries.filter((name) => !chunks.includes(name) && !docs.includes(name))).toEqual(["LICENSE", "README.md", "THIRD-PARTY-NOTICES.md", "package.json", "server/nbook.js", "server/project.js", "web/assets/codicon-abc123.ttf", "web/index.html"].map((name) => `package/${name}`).sort());

        const manifest = JSON.parse(await readFile(join(out, "package.json"), "utf8")) as Record<string, unknown>;
        expect(manifest).toMatchObject({name: APP_NAME, version: PRODUCT_VERSION, bin: {nbook: "./server/nbook.js"}, engines: {bun: BUN_ENGINE}, license: "AGPL-3.0-only", publishConfig: {access: "public"}});
        // npm 上搜得到、页面上有主页与问题入口。
        expect(manifest).toMatchObject({keywords: expect.arrayContaining(["neurobook", "writing"]), homepage: expect.stringContaining("github.com/notnotype/neuro-book"), bugs: {url: expect.stringContaining("/issues")}});
        // 只有 OMP 不打进 bundle（决定 33）：写成依赖，版本是本仓库装的那个。
        const ompAi = JSON.parse(await readFile(join(import.meta.dir, "../../../node_modules/@oh-my-pi/pi-ai/package.json"), "utf8")) as {version: string};
        expect(manifest).toMatchObject({dependencies: expect.objectContaining({"@oh-my-pi/pi-ai": ompAi.version})});
        expect(Object.keys(manifest.dependencies as Record<string, string>).every((name) => name.startsWith("@oh-my-pi/"))).toBe(true);
        expect(manifest).not.toHaveProperty("private");
        expect((await stat(join(out, "server", "nbook.js"))).mode & 0o111).not.toBe(0);
        expect((await readFile(join(out, "server", "nbook.js"), "utf8")).startsWith("#!/usr/bin/env bun\n")).toBe(true);

        const notices = await readFile(join(out, "THIRD-PARTY-NOTICES.md"), "utf8");
        expect(notices).toContain("### commander@");
        expect(notices).toContain("### example-lib@1.2.3（MIT）");
        expect(notices).toContain("### web/assets/codicon-abc123.ttf");
        expect(notices).toContain("CC BY 4.0");
        const readme = await readFile(join(out, "README.md"), "utf8");
        expect(readme).not.toContain("{{");
        expect(readme).toContain(BUN_ENGINE);

        // 解到仓库外：服务端按安装布局找到文档目录（与运行时同一个定位函数，起点是服务端代码所在的 `server/`）。
        const unpacked = join(tmp, "unpacked");
        await mkdir(unpacked, {recursive: true});
        const extracted = Bun.spawnSync(["tar", "xzf", tarball, "-C", unpacked]);
        expect(extracted.exitCode).toBe(0);
        const located = locateDocsRoot(join(unpacked, "package", "server"));
        expect(located).toBe(join(unpacked, "package", "docs"));
        expect(await readFile(join(located as string, "builtin", "sdk", "README.md"), "utf8")).toContain("docs/exports.md");

        // 再打一次：上次生成的目录清掉重建。
        expect((await packApp({webRoot: web, outDir: out})).tarball).toBe(tarball);
    }, 60_000);

    it("从仓库以外的目录运行：许可清单读的是本仓库 node_modules 里打进去的包", async () => {
        // Bun 的 metafile 路径相对当前工作目录；在 worktree 里从包目录运行时，按仓库根解析会碰巧落到主工作区，所以换到无关的目录。
        const out = join(tmp, "elsewhere", "neuro-book");
        const previous = process.cwd();
        process.chdir(tmp);
        try {
            await packApp({webRoot: web, outDir: out});
        } finally {
            process.chdir(previous);
        }
        const commander = JSON.parse(await readFile(join(import.meta.dir, "../../../node_modules/commander/package.json"), "utf8")) as {version: string};
        expect(await readFile(join(out, "THIRD-PARTY-NOTICES.md"), "utf8")).toContain(`### commander@${commander.version}`);
    }, 60_000);

    it("输出目录不是空的、也不是上次生成的应用包（没有标记，哪怕 package.json 同名）：拒绝，不删里面的东西", async () => {
        const out = join(tmp, "foreign");
        await mkdir(out, {recursive: true});
        await writeFile(join(out, "package.json"), JSON.stringify({name: APP_NAME}));
        await writeFile(join(out, "important.txt"), "keep");
        await expect(packApp({webRoot: web, outDir: out})).rejects.toThrow("不清理");
        expect(await readFile(join(out, "important.txt"), "utf8")).toBe("keep");
    });

    it("Web 产物里有没登记许可的字体：失败，说明去登记", async () => {
        const fonts = join(tmp, "fonts-web");
        await mkdir(join(fonts, ".vite"), {recursive: true});
        await mkdir(join(fonts, "assets"), {recursive: true});
        await writeFile(join(fonts, "index.html"), "<!doctype html>");
        await writeFile(join(fonts, ".vite", "license.json"), "[]");
        await writeFile(join(fonts, "assets", "mystery-font.woff2"), "font");
        await expect(packApp({webRoot: fonts, outDir: join(tmp, "fonts-out")})).rejects.toThrow("FONT_NOTICES");
    });

    it("Web 产物没有许可清单：失败，说明要用 vite build 构建", async () => {
        const bare = join(tmp, "bare-web");
        await mkdir(bare, {recursive: true});
        await writeFile(join(bare, "index.html"), "<!doctype html>");
        const out = join(tmp, "bare-out");
        await expect(packApp({webRoot: bare, outDir: out})).rejects.toThrow("vite build");
        // 失败留下的半成品带着标记：补上前端产物再打一次就能清掉重建，不用手工删目录。
        expect((await packApp({webRoot: web, outDir: out})).directory).toBe(out);
    }, 60_000);
});

describe("bundle 的核对", () => {
    it("只许 Bun 与 Node 的内置模块；抬头行不影响扫描；运行时按路径找文件的写法也拦下", () => {
        expect(bundleProblems("#!/usr/bin/env bun\nimport {readFile} from \"node:fs/promises\";\nimport fs from \"fs\";\nimport {Database} from \"bun:sqlite\";\n")).toEqual([]);
        expect(bundleProblems("import pad from \"left-pad\";\nimport(\"@scope/thing\");\n")).toEqual(["引用了外部模块 left-pad：依赖要打进 bundle", "引用了外部模块 @scope/thing：依赖要打进 bundle"]);
        expect(bundleProblems("const worker = new Worker(new URL(\"./w.js\", import.meta.url));")).toEqual(["出现了 new Worker(：运行时按路径找文件，装到别处会找不到"]);
        // 计算出来的动态导入只许插件平台装载插件入口的那一处。
        expect(bundleProblems("const name = pick(); await import(name);")).toEqual(["有 1 处计算出来的动态导入：打包看不见它要的模块"]);
        expect(bundleProblems("module = await (attempt === 0 ? import(file) : import(`${file}?attempt=${String(attempt)}`));")).toEqual([]);
        // 名叫 import 的对象方法不是动态导入；同样以行首 import( 开头、后面接 .then 的照样算。
        expect(bundleProblems("const scope = {\n    import(...names) {\n        return names;\n    },\n};")).toEqual([]);
        expect(bundleProblems("import(name).then(() => {\n});")).toEqual(["有 1 处计算出来的动态导入：打包看不见它要的模块"]);
        // 没有参数的 import() 只会是文字，例如解析器的报错。
        expect(bundleProblems("this.raise(pos, \"Trailing comma is not allowed in import()\");")).toEqual([]);
    });
});

/**
 * 应用的 npm 包（`scripts/pack-app.ts`）：真实打包两个服务端入口与 `bun pm pack`，Web 产物用一个只有 `index.html` 与许可清单的
 * 目录代替（真实的前端构建与从 tarball 安装、启动、打开作品由 `e2e/app-package.e2e.ts` 验收）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BUN_ENGINE, PRODUCT_VERSION} from "../src/shared/product";

import {locateDocsRoot} from "../src/plugins/agent/backend/docs-root";
import {locateBuiltinStickers} from "../src/plugins/stickers/backend/builtin-root";
import {locateBuiltinBots} from "../src/plugins/bots/backend/builtin-root";
import {queryNeuroBook} from "../src/server/instance";
import {APP_NAME, bundleProblems, checkManagedEntry, packApp} from "./pack-app";

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
        // 命令行与托管入口开代码分割、共用旁边的 chunk（名字带内容哈希），其余文件固定。
        const entries = tarEntries(tarball);
        const chunks = entries.filter((name) => /^package\/server\/(?:chunk|project)-[\w-]+\.js$/u.test(name));
        expect(chunks.some((name) => name.startsWith("package/server/chunk-"))).toBe(true);
        // Agent 读的产品文档（docs/specs/agent/resources.md 输出 8）：SDK 的作者文档与 Agent 自己的文档。
        const docs = entries.filter((name) => name.startsWith("package/docs/"));
        expect(docs).toEqual(expect.arrayContaining(["package/docs/builtin/sdk/README.md", "package/docs/builtin/sdk/docs/exports.md", "package/docs/agent/addresses.md"]));
        // 内置表情包（docs/specs/agent/stickers.md 的内置来源）：两个包的清单与图片。
        const stickers = entries.filter((name) => name.startsWith("package/stickers/"));
        expect(stickers).toEqual(expect.arrayContaining(["package/stickers/lyra/stickers.json", "package/stickers/lyra/开心.webp", "package/stickers/lyra-chibi/stickers.json"]));
        // 缺省 bot 的预设文件（docs/specs/bots/bots.md 输出 2、验收 1 的安装包形态）。
        const bots = entries.filter((name) => name.startsWith("package/bots/"));
        expect(bots.sort()).toEqual(["package/bots/lyra/avatar.webp", "package/bots/lyra/persona.md"]);
        expect(entries.filter((name) => !chunks.includes(name) && !docs.includes(name) && !stickers.includes(name) && !bots.includes(name))).toEqual(["LICENSE", "README.md", "THIRD-PARTY-NOTICES.md", "package.json", "server/eval-kernel.js", "server/main.js", "server/nbook.js", "server/project.js", "web/assets/codicon-abc123.ttf", "web/index.html"].map((name) => `package/${name}`).sort());

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
        expect(locateBuiltinStickers(join(unpacked, "package", "server"))).toBe(join(unpacked, "package", "stickers"));
        const botsRoot = locateBuiltinBots(join(unpacked, "package", "server"));
        expect(botsRoot).toBe(join(unpacked, "package", "bots"));
        expect(await readFile(join(botsRoot as string, "lyra", "persona.md"), "utf8")).toContain("星璃");
        expect((await stat(join(botsRoot as string, "lyra", "avatar.webp"))).size).toBeGreaterThan(0);

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

describe("托管入口", () => {
    /** 以托管方式起包里的 `server/main.js`（docs/specs/runtime/server-host.md 的“托管宿主”）；外部依赖经链到包旁边的仓库 node_modules 解析。 */
    function startManaged(out: string, stateRoot: string): Bun.Subprocess<"pipe", "ignore", "pipe"> {
        return Bun.spawn(["bun", join(out, "server", "main.js"), "--stop-stdin"], {
            env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_WEB_ROOT: join(out, "web")},
            stdin: "pipe",
            stdout: "ignore",
            stderr: "pipe",
        });
    }

    it("标准输入结束即有序停止、以 0 退出；状态根已被占用时第二个以 1 退出，不碰第一个", async () => {
        const out = join(tmp, "managed", "neuro-book");
        await packApp({webRoot: web, outDir: out});
        await symlink(join(import.meta.dir, "../../../node_modules"), join(out, "node_modules"), "dir");
        const stateRoot = join(tmp, "managed-state");
        const first = startManaged(out, stateRoot);
        let second: ReturnType<typeof startManaged> | null = null;
        try {
            const ready = await waitUntil("托管入口就绪", async () => {
                const query = await queryNeuroBook(stateRoot);
                return query.state === "running" && query.instance.status === "ready" ? query.instance : null;
            }, {timeoutMs: 30_000, intervalMs: 100});
            expect(ready.kind).toBe("product");
            expect(ready.version).toBe(PRODUCT_VERSION);

            second = startManaged(out, stateRoot);
            second.stdin.end();
            expect(await second.exited).toBe(1);
            expect(await new Response(second.stderr).text()).toContain("runtime.state-root.busy");
            expect((await queryNeuroBook(stateRoot)).state).toBe("running");

            first.stdin.end();
            expect(await first.exited).toBe(0);
            expect((await queryNeuroBook(stateRoot)).state).toBe("none");
        } finally {
            for (const child of [first, second]) {
                if (child !== null && child.exitCode === null) child.kill("SIGKILL");
                await child?.exited;
            }
        }
    }, 90_000);

    /**
     * 打包时的托管核对（`checkManagedEntry`）拦得住的几种坏入口：用替身的 `server/main.js` 代替真实服务端。替身经产品自己的
     * 认领档案认领状态根、发布就绪与地址，与真实服务端对 `checkManagedEntry` 可观察的部分相同。
     */
    async function fakeEntry(name: string, body: string): Promise<string> {
        const directory = join(tmp, "fake-entries", name);
        await mkdir(join(directory, "server"), {recursive: true});
        await mkdir(join(directory, "web"), {recursive: true});
        const instance = join(import.meta.dir, "../src/server/instance.ts");
        await writeFile(join(directory, "server", "main.js"), `import {claimNeuroBook} from ${JSON.stringify(instance)};\n${body}\n`);
        return directory;
    }
    const claimAndServe = `
const claimed = await claimNeuroBook({stateRoot: process.env.NBOOK_STATE_ROOT, kind: "product", report: () => {}});
if (!claimed.ok) process.exit(9);
const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Response(globalThis.healthStatus === undefined ? "ok" : "bad", {status: globalThis.healthStatus ?? 200})});
`;
    const publish = `claimed.claim.publish({url: \`http://127.0.0.1:\${server.port}/\`, rpcUrl: "ws://127.0.0.1:1/rpc", extra: {plugins: {safeMode: false, items: []}}});`;

    it("打包时的托管核对：就绪前退出、health 不是 200、停止后退出码不是 0、超时都失败，并说明是哪一种", async () => {
        const early = await fakeEntry("early", "process.exit(3);");
        await expect(checkManagedEntry(early)).rejects.toThrow("在就绪前退出，退出码 3");

        const unhealthy = await fakeEntry("unhealthy", `globalThis.healthStatus = 500;${claimAndServe}${publish}\nfor await (const _ of console) break;\nprocess.exit(0);`);
        await expect(checkManagedEntry(unhealthy)).rejects.toThrow("health 是 500");

        const badStop = await fakeEntry("bad-stop", `${claimAndServe}${publish}\nfor await (const _ of console) break;\nprocess.exit(7);`);
        await expect(checkManagedEntry(badStop)).rejects.toThrow("经标准输入停止，退出码 7");

        const neverReady = await fakeEntry("never-ready", `${claimAndServe}\nawait new Promise(() => {});`);
        await expect(checkManagedEntry(neverReady, 1_500)).rejects.toThrow("秒内没有完成");
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

#!/usr/bin/env bun
/**
 * 发布冒烟（`bun run release:smoke`，ADR 0029、docs/specs/story/cli-skill.md 验收 6）：把发布清单里的包装进仓库外的
 * 空项目，像用户那样用一遍，不调用模型。
 *
 * - 缺省（`--from pack`）：先生成应用包与 SDK 包（`BUILT_PACKAGES`），对全部要发的包跑发布清单检查，再逐个 `bun pm pack`
 *   到 `dist/release/`，查包里的文件，写下 `release-manifest.json`（提交、包名、版本、SHA-256）：`release:publish` 只发这些
 *   tarball，发出去的就是这里验过的字节。装的时候用 `overrides` 让 `@notnotype/*` 全部来自这些 tarball（它们的版本号还不在
 *   registry 上，有一个漏到 registry 就会装不上）。
 * - `--from registry`：不打包，按 `package.json` 的版本从 registry 装；发布之后在发布用的那个提交上跑一次，作为发布
 *   证据（装上的版本与 checkout 的对不上就失败）。
 *
 * 用户与作者的闭环（ADR 0033，docs/specs/runtime/cli.md 验收 1、7）：临时 `BUN_INSTALL` 下 `bun add -g` 应用包、`nbook start`
 * 打开书架；`bunx -p` SDK 生成插件、构建并类型检查；`nbook plugin install` 之后重启，实例的启动集合里有它。
 *
 * 项目放在系统临时目录下（`@notnotype/neuro-book-test-support/tmp`），不在仓库里：Bun 按目录往上找 `node_modules`，
 * 放在仓库里会用到仓库根提升的依赖，漏写的依赖就查不出来。第三方依赖从 registry 装，直连慢时整条命令前加 `prox`。
 */

import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {basename, join} from "node:path";

import {chromium} from "playwright-core";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {RELEASE_DIRECTORY, RELEASE_MANIFEST, releaseFilesChangedSince, sha256Of, type ReleaseManifest} from "#scripts/release/manifest";
import {APP_PACKAGE, BUILT_PACKAGES, checkReleasePackages, loadBuiltPackages, loadReleasePackages, publishOrder, releaseDirectories, SDK_PACKAGE, type ReleasePackage} from "#scripts/release/packages";

const REPOSITORY = join(import.meta.dir, "..", "..");
/** 包里不该有的文件。`testing/` 目录是 exports 里公开的测试替身入口，照发。 */
const FORBIDDEN = [/\.test\.tsx?$/u, /\.typecheck\.ts$/u, /\/corpus\//u, /(^|\/)AGENTS\.md$/u, /(^|\/)tsconfig[^/]*\.json$/u, /(^|\/)\.env/u, /^package\/(tests|e2e|playground|docs)\//u, /^package\/src\/web\//u];

type Source = "pack" | "registry";

/** nb-form 只给 `./vue` 用的可选 peer：只用核心的消费者（nb-story）不该装上它们。 */
const VUE_SIDE = ["@notnotype/nb-ui", "vue", "typescript"] as const;

class SmokeFailure extends Error {}

function step(message: string): void {
    console.log(`✓ ${message}`);
}

function fail(message: string): never {
    throw new SmokeFailure(message);
}

async function run(argv: readonly string[], options: {cwd: string; env?: Record<string, string>}): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn([...argv], {cwd: options.cwd, stdout: "pipe", stderr: "pipe", env: {...process.env, ...options.env}});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

async function mustRun(label: string, argv: readonly string[], options: {cwd: string; env?: Record<string, string>}): Promise<string> {
    const result = await run(argv, options);
    if (result.code !== 0) fail(`${label} 退出码 ${result.code}\n${result.stderr || result.stdout}`);
    return result.stdout;
}

/**
 * 打包一个包并检查里面的文件：不该发的没有，exports 与 bin 指向的文件都在。`FORBIDDEN` 只对源码包：生成的包按自己的
 * 白名单生成（SDK 的 `docs/` 是作者文档的附表），由各自的打包测试核对。
 */
async function packPackage(entry: ReleasePackage, destination: string, built: boolean): Promise<string> {
    const output = await mustRun(`${entry.manifest.name} 打包`, ["bun", "pm", "pack", "--destination", destination, "--quiet"], {cwd: entry.path});
    const name = output.trim().split("\n").at(-1) as string;
    if (!name.endsWith(".tgz")) fail(`${entry.manifest.name} 打包没有给出 tarball：${output}`);
    const tarball = join(destination, basename(name));
    const listing = (await mustRun("列出包里的文件", ["tar", "-tzf", tarball], {cwd: destination})).trim().split("\n");
    const forbidden = built ? [] : listing.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
    if (forbidden.length > 0) fail(`${entry.manifest.name} 打进了不该发的文件：${forbidden.join("、")}`);
    for (const target of entryTargets(entry)) {
        const pattern = new Bun.Glob(`package/${target.replace(/^\.\//u, "")}`);
        if (!listing.some((file) => pattern.match(file))) fail(`${entry.manifest.name} 的入口 ${target} 不在包里`);
    }
    return tarball;
}

function entryTargets(entry: ReleasePackage): string[] {
    const manifest = entry.manifest as ReleasePackage["manifest"] & {exports?: Record<string, unknown>; bin?: Record<string, string>};
    // 条件导出（`{types, import}`）展开成各条件指向的文件。
    const targets = (value: unknown): string[] => (typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(targets) : []);
    return [...targets(manifest.exports ?? {}), ...Object.values(manifest.bin ?? {})];
}

/** 让 `@notnotype/*` 来自哪里：打包模式下指向 tarball，registry 模式下写版本号。 */
function sources(packages: readonly ReleasePackage[], tarballs: ReadonlyMap<string, string>): {spec: (name: string) => string; overrides: Record<string, string>; expected: ReadonlyMap<string, string>} {
    const expected = new Map(packages.map((entry) => [entry.manifest.name, entry.manifest.version]));
    const overrides = Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`]));
    return {spec: (name) => overrides[name] ?? (expected.get(name) as string), overrides, expected};
}

/**
 * 装进项目的 `@notnotype/*` 版本必须就是这次要验的版本（当前 checkout 的 package.json）。registry 模式下这把冒烟
 * 绑在发布用的那个提交上：checkout 的版本往前推了，装到的就不是刚发布的那批，这里会报出来。
 */
async function installedVersions(project: string, expected: ReadonlyMap<string, string>): Promise<string> {
    const scope = join(project, "node_modules", "@notnotype");
    const found: string[] = [];
    for (const dir of await readdir(scope)) {
        const {name, version} = JSON.parse(await Bun.file(join(scope, dir, "package.json")).text()) as {name: string; version: string};
        const wanted = expected.get(name);
        if (wanted !== undefined && wanted !== version) fail(`${name} 装上的是 ${version}，要验的是 ${wanted}`);
        found.push(`${name}@${version}`);
    }
    return found.sort().join("、");
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`);
}

async function smokeStory(root: string, from: ReturnType<typeof sources>): Promise<void> {
    const app = join(root, "app");
    await mkdir(app);
    await writeJson(join(app, "package.json"), {name: "nbstory-smoke", private: true, type: "module", dependencies: {"@notnotype/nb-story": from.spec("@notnotype/nb-story")}, overrides: from.overrides});
    await mustRun("安装 nb-story", ["bun", "install"], {cwd: app});
    step(`从包装上 @notnotype/nb-story：${await installedVersions(app, from.expected)}`);
    // nb-story 经 nb-harness 依赖 nb-form，只用它的核心入口；nb-form 的 nb-ui、vue、typescript 只给 `./vue` 用，是可选 peer。
    // 它们被装上，说明可选 peer 失效了，nb-story 的用户会白装一套 Vue 组件库（w00032 t32）。
    const pulled: string[] = [];
    for (const name of VUE_SIDE) if (await Bun.file(join(app, "node_modules", name, "package.json")).exists()) pulled.push(name);
    if (pulled.length > 0) fail(`装 nb-story 不该连带装上 ${pulled.join("、")}（nb-form 的可选 peer）`);
    step(`nb-story 的安装里没有 ${VUE_SIDE.join("、")}`);

    const nbstory = join(app, "node_modules", ".bin", "nbstory");
    const library = join(root, "library");
    const home = join(root, "home");
    await mkdir(home);
    // HOME 换成临时目录：书库、配置与 Skill 的缺省位置都在它下面，冒烟不碰开发者自己的。
    const env = {HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share")};

    await mustRun("nbstory --help", [nbstory, "--help"], {cwd: app, env});
    const books = JSON.parse(await mustRun("nbstory books", [nbstory, "books", "--library", library, "--json"], {cwd: app, env})) as {ok: boolean; data?: {books?: unknown[]}};
    if (!books.ok || books.data?.books?.length !== 0) fail(`空书库上 nbstory books 应成功且没有书：${JSON.stringify(books)}`);
    step("nbstory --help 与空书库上的 books");

    // config show 会加载 OMP 的模型目录（nb-harness 与它的原生模块）；没写配置时以 qa_unconfigured 退出 1。
    const show = await run([nbstory, "config", "show", "--json"], {cwd: app, env});
    const shown = JSON.parse(show.stdout) as {ok: boolean; error?: {code: string}};
    if (shown.error?.code !== "qa_unconfigured") fail(`nbstory config show 应报 qa_unconfigured：退出码 ${show.code}\n${show.stdout}${show.stderr}`);
    step("nbstory config show 加载模型目录");

    const skills = join(root, "skills");
    const states: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const installed = JSON.parse(await mustRun("nbstory skill install", [nbstory, "skill", "install", "--dir", skills, "--json"], {cwd: app, env})) as {data: {state: string}};
        states.push(installed.data.state);
    }
    if (states.join() !== "installed,unchanged") fail(`skill install 两次应为 installed、unchanged，实际 ${states.join("、")}`);
    if (!(await readdir(join(skills, "nbstory"))).includes("SKILL.md")) fail("装好的 Skill 目录里没有 SKILL.md");
    step("nbstory skill install 两次：installed、unchanged");

    await smokeServe(nbstory, library, app, env);
}

async function smokeServe(nbstory: string, library: string, cwd: string, env: Record<string, string>): Promise<void> {
    const child = Bun.spawn([nbstory, "serve", "--library", library, "--json"], {cwd, stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
    // 服务一启动就归这里收：浏览器起不来、页面断言失败，都要先停服务再把错误抛出去。两边都失败时报先出的那个，
    // 停服的失败只打印。
    let failure: unknown = null;
    try {
        const reader = child.stdout.getReader();
        const first = await reader.read();
        reader.releaseLock();
        const started = JSON.parse(new TextDecoder().decode(first.value ?? new Uint8Array()).trim().split("\n")[0] || "{}") as {ok?: boolean; data?: {login: string}};
        if (!started.ok || !started.data) fail(`nbstory serve 没有启动：${JSON.stringify(started)}\n${await new Response(child.stderr).text()}`);
        await checkPages(started.data.login);
    } catch (error) {
        failure = error;
    }
    try {
        await stopServe(child);
    } catch (error) {
        if (failure === null) throw error;
        console.error(`另外，停服务也失败了：${(error as Error).message}`);
    }
    if (failure !== null) throw failure;
}

async function checkPages(login: string): Promise<void> {
    const browser = await chromium.launch({channel: "chrome", headless: true});
    try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(login);
        await page.getByTestId("go-import").waitFor({timeout: 15_000});
        await page.getByTestId("go-settings").click();
        await page.getByTestId("settings-page").waitFor({timeout: 15_000});
        if (errors.length > 0) fail(`页面有脚本错误：\n${errors.join("\n")}`);
        step("nbstory serve：登录链接打开书架页与设置页，没有脚本错误");
    } finally {
        await browser.close();
    }
}

/** 发 SIGTERM 等它退出；15 秒还没退就 SIGKILL 并报失败（docs/specs/story/cli-skill.md 输出 5：停服退出码 0）。 */
async function stopServe(child: Bun.Subprocess): Promise<void> {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const code = await child.exited;
    clearTimeout(timer);
    if (child.signalCode === "SIGKILL") fail("nbstory serve 收到 SIGTERM 15 秒后还没退出，已强制结束");
    if (code !== 0) fail(`nbstory serve 收到 SIGTERM 后退出码 ${code}`);
    step("nbstory serve 收到 SIGTERM 后以 0 退出");
}

/** 最小的 Vite + Vue + Tailwind 宿主：导入 Vue 包的公开入口与样式入口，构建通过（ADR 0028、0029）。 */
async function smokeVueHost(root: string, from: ReturnType<typeof sources>): Promise<void> {
    const host = join(root, "host");
    await mkdir(join(host, "src"), {recursive: true});
    const libraries = ["@notnotype/nb-ui", "@notnotype/nb-agent-ui", "@notnotype/nb-form", "@notnotype/nb-markdown"];
    await writeJson(join(host, "package.json"), {
        name: "nb-ui-host-smoke",
        private: true,
        type: "module",
        dependencies: {
            ...Object.fromEntries(libraries.map((name) => [name, from.spec(name)])),
            vue: "^3.5.24",
            vite: "^8.1.4",
            "@vitejs/plugin-vue": "^6.0.7",
            tailwindcss: "^4.3.3",
            "@tailwindcss/vite": "^4.3.3",
        },
        overrides: from.overrides,
    });
    await writeFile(join(host, "vite.config.ts"), `import tailwindcss from "@tailwindcss/vite";\nimport vue from "@vitejs/plugin-vue";\nimport {defineConfig} from "vite";\n\nexport default defineConfig({plugins: [vue(), tailwindcss()]});\n`);
    await writeFile(join(host, "index.html"), `<!doctype html>\n<html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`);
    await writeFile(join(host, "src", "style.css"), ['@import "tailwindcss";', '@import "@notnotype/nb-ui/tailwind.css";', '@import "@notnotype/nb-agent-ui/tailwind.css";', '@import "@notnotype/nb-markdown/tailwind.css";', '@source "./**/*.ts";', ""].join("\n"));
    // 整个命名空间都用到，打包器就要编译每一个导出的组件。
    const entries = ["@notnotype/nb-ui", "@notnotype/nb-agent-ui", "@notnotype/nb-agent-ui/vue", "@notnotype/nb-form", "@notnotype/nb-form/vue", "@notnotype/nb-markdown", "@notnotype/nb-markdown/display", "@notnotype/nb-markdown/prompt"];
    await writeFile(
        join(host, "src", "main.ts"),
        [
            `import "./style.css";`,
            `import {createApp, h} from "vue";`,
            ...entries.map((entry, index) => `import * as entry${index} from "${entry}";`),
            `const sizes = [${entries.map((_entry, index) => `Object.keys(entry${index}).length`).join(", ")}];`,
            `createApp({render: () => h("pre", {class: "text-sm"}, JSON.stringify(sizes))}).mount("#app");`,
            "",
        ].join("\n"),
    );
    await mustRun("安装 Vue 宿主", ["bun", "install"], {cwd: host});
    await installedVersions(host, from.expected);
    await mustRun("构建 Vue 宿主", [join(host, "node_modules", ".bin", "vite"), "build"], {cwd: host});
    step(`Vite 宿主导入 ${entries.length} 个公开入口与样式入口，构建通过`);
}

/** 读子进程标准输出的第一行（`--json` 的结果对象写在第一行）。 */
async function firstLine(child: {readonly stdout: ReadableStream<Uint8Array>}): Promise<string> {
    const reader = child.stdout.getReader();
    let text = "";
    try {
        while (!text.includes("\n")) {
            const {value, done} = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
        }
    } finally {
        reader.releaseLock();
    }
    return text.split("\n")[0] ?? "";
}

/** 前台运行 `nbook start`，读到结果对象就交给 `use`；不管 `use` 成不成，最后发 SIGINT（终端的 Ctrl-C）并要求以 0 退出。 */
async function withNbook(nbook: string, stateRoot: string, env: Record<string, string>, use: (url: string) => Promise<void>): Promise<void> {
    const child = Bun.spawn([nbook, "start", "--state-root", stateRoot, "--port", "0", "--no-open", "--json"], {cwd: stateRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
    let failure: unknown = null;
    try {
        // 启动卡住时不能一直等：60 秒没有结果对象就结束它（下面照常收口）。
        const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
        const line = await firstLine(child).finally(() => clearTimeout(timer));
        const started = JSON.parse(line || "{}") as {ok?: boolean; url?: string};
        if (!started.ok || typeof started.url !== "string") fail(`nbook start 没有启动：${line}\n${await new Response(child.stderr).text()}`);
        await use(started.url);
    } catch (error) {
        failure = error;
    }
    if (child.exitCode === null) child.kill("SIGINT");
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    const code = await child.exited;
    clearTimeout(timer);
    if (failure !== null) throw failure;
    if (code !== 0) fail(`nbook 收到 SIGINT 后退出码 ${code}（${child.signalCode ?? "没有被强制结束"}）`);
}

/**
 * 以托管方式运行装好的应用包里的 `server/main.js`（docs/specs/runtime/server-host.md 的“托管宿主”，桌面壳就这样运行它）：
 * 等它认领了状态根（标准输出的第一行 `RPC listening on` 在认领之后才打印），再用 `nbook start --json` 找到它（同一状态根上已有
 * 同版本实例时只报告它，`started: false`；还在启动就等它就绪），交给 `use`；最后经标准输入写 `stop`，要求以 0 退出。
 * 不先等认领的话，`nbook start` 可能抢先认领、自己在前台运行下去。每一步都有截止，超时结束子进程。
 */
async function withManagedEntry(packageDirectory: string, nbook: string, stateRoot: string, env: Record<string, string>, use: (url: string) => Promise<void>): Promise<void> {
    const server = Bun.spawn(["bun", join(packageDirectory, "server", "main.js"), "--stop-stdin"], {
        cwd: stateRoot,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {...process.env, ...env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_WEB_ROOT: join(packageDirectory, "web")},
    });
    const stderr = new Response(server.stderr).text();
    let failure: unknown = null;
    try {
        const claimTimer = setTimeout(() => server.kill("SIGKILL"), 60_000);
        const first = await firstLine(server).finally(() => clearTimeout(claimTimer));
        // 余下的标准输出照样读掉，免得管道写满挡住服务端（读过一次的流不能再交给 Response，只能接着用读取器）。
        void (async () => {
            const reader = server.stdout.getReader();
            while (!(await reader.read()).done);
        })();
        if (!first.startsWith("RPC listening on")) fail(`托管入口没有起来：${first}\n${await stderr}`);
        const finder = Bun.spawn([nbook, "start", "--state-root", stateRoot, "--no-open", "--json"], {cwd: stateRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
        const finderTimer = setTimeout(() => finder.kill("SIGKILL"), 90_000);
        const [output, code] = await Promise.all([new Response(finder.stdout).text(), finder.exited]).finally(() => clearTimeout(finderTimer));
        const found = JSON.parse(output || "{}") as {ok?: boolean; started?: boolean; url?: string; pid?: number};
        if (code !== 0 || found.started !== false || found.pid !== server.pid || typeof found.url !== "string") fail(`nbook start 没有报告托管运行的实例（退出码 ${code}）：${output}${await new Response(finder.stderr).text()}`);
        await use(found.url);
    } catch (error) {
        failure = error;
    }
    if (server.exitCode === null) {
        void server.stdin.write("stop\n");
        await server.stdin.flush();
    }
    const timer = setTimeout(() => server.kill("SIGKILL"), 60_000);
    const code = await server.exited;
    clearTimeout(timer);
    if (failure !== null) throw failure;
    if (code !== 0) fail(`托管入口写 stop 后退出码 ${code}（${server.signalCode ?? "没有被强制结束"}）\n${await stderr}`);
}

async function checkWorkbench(url: string): Promise<void> {
    const browser = await chromium.launch({channel: "chrome", headless: true});
    try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url);
        await page.locator("[data-workbench-root][data-rpc-state='online']").waitFor({timeout: 30_000});
        if (errors.length > 0) fail(`页面有脚本错误：\n${errors.join("\n")}`);
    } finally {
        await browser.close();
    }
}

/**
 * 桌面载荷（`packages/neuro-book/scripts/desktop-payload.ts`）：用这次打的应用包按本机平台组装，以托管方式运行 `app/server/main.js`。
 * 正式的发布清单要等冒烟全部通过才写，这里另写一份只给组装用的清单，tarball 写绝对路径。
 */
async function smokeDesktopPayload(root: string, manifest: ReleaseManifest, nbook: string, env: Record<string, string>): Promise<void> {
    const pending = join(root, "release-manifest.json");
    await writeJson(pending, {...manifest, packages: manifest.packages.map((entry) => ({...entry, tarball: join(RELEASE_DIRECTORY, entry.tarball)}))});
    const payload = join(root, "desktop-payload");
    await mustRun("组装桌面载荷", ["bun", join(REPOSITORY, "packages", "neuro-book", "scripts", "desktop-payload.ts"), pending, payload], {cwd: root, env});
    const listed = JSON.parse(await readFile(join(payload, "payload-manifest.json"), "utf8")) as {commit?: string; tarball?: {sha256?: string}};
    const app = manifest.packages.find((entry) => entry.name === APP_PACKAGE);
    if (listed.commit !== manifest.commit || listed.tarball?.sha256 !== app?.sha256) fail(`载荷清单的提交或 tarball 摘要与发布清单不同：${JSON.stringify(listed.tarball)}`);
    const managedState = join(root, "payload-state");
    await mkdir(managedState);
    await withManagedEntry(join(payload, "app"), nbook, managedState, env, checkWorkbench);
    step("桌面载荷：由同一个应用包 tarball 组装，依赖与仓库根 bun.lock 一致，托管入口打开书架、写 stop 后以 0 退出");
}

/**
 * 用户装应用、作者写插件、用户装插件：都在 `root` 下的空目录里，`BUN_INSTALL`、`HOME` 指向临时目录，不碰开发者自己的
 * 全局包、缓存与数据。
 */
async function smokeAppAndPlugin(root: string, from: ReturnType<typeof sources>, tarballs: ReadonlyMap<string, string>, manifest: ReleaseManifest | null): Promise<void> {
    const appName = APP_PACKAGE;
    const sdkName = SDK_PACKAGE;
    const bunHome = join(root, "bun-home");
    const home = join(root, "user-home");
    const stateRoot = join(root, "state");
    const authors = join(root, "authors");
    for (const directory of [bunHome, home, stateRoot, authors]) await mkdir(directory, {recursive: true});
    const temp = join(root, "user-tmp");
    await mkdir(temp);
    // TMPDIR 也换掉：`bunx -p` 把包缓存在 $TMPDIR/bunx-<uid>-…，不随 HOME 与 BUN_INSTALL 走；不换的话重跑冒烟用的是上次那份 SDK。
    const env = {BUN_INSTALL: bunHome, HOME: home, TMPDIR: temp, XDG_DATA_HOME: join(home, ".local", "share"), XDG_CONFIG_HOME: join(home, ".config"), PATH: `${join(bunHome, "bin")}:${process.env.PATH ?? ""}`};
    const appSpec = tarballs.get(appName) ?? `${appName}@${from.expected.get(appName) as string}`;
    const sdkSpec = tarballs.get(sdkName) ?? `${sdkName}@${from.expected.get(sdkName) as string}`;

    await mustRun("bun add -g 应用包", ["bun", "add", "-g", appSpec], {cwd: home, env});
    const nbook = join(bunHome, "bin", "nbook");
    const version = await mustRun("nbook --version", [nbook, "--version"], {cwd: home, env});
    if (!version.includes(`NeuroBook ${from.expected.get(appName) as string}`)) fail(`nbook --version 报的不是要验的版本：${version}`);
    await withNbook(nbook, stateRoot, env, checkWorkbench);
    step(`bun add -g ${appName}：nbook 启动、页面打开书架并连上服务端，Ctrl-C 以 0 退出`);
    const installed = join(bunHome, "install", "global", "node_modules", ...appName.split("/"));
    const managedState = join(root, "managed-state");
    await mkdir(managedState);
    await withManagedEntry(installed, nbook, managedState, env, checkWorkbench);
    step("托管入口 server/main.js：以 --stop-stdin 起来，页面打开书架，写 stop 后以 0 退出");
    if (manifest !== null) await smokeDesktopPayload(root, manifest, nbook, env);

    const sdkFlags = tarballs.has(sdkName) ? ["--sdk", `file:${sdkSpec}`] : [];
    await mustRun("bunx -p SDK nbooke create", ["bunx", "-p", sdkSpec, "nbooke", "create", "hello", "--publisher", "smoke", ...sdkFlags], {cwd: authors, env});
    const plugin = join(authors, "hello");
    await mustRun("插件 bun install", ["bun", "install"], {cwd: plugin, env});
    const installedSdk = (JSON.parse(await readFile(join(plugin, "node_modules", sdkName, "package.json"), "utf8")) as {version: string}).version;
    if (installedSdk !== from.expected.get(sdkName)) fail(`插件项目装上的 SDK 是 ${installedSdk}，要验的是 ${from.expected.get(sdkName) as string}`);
    await mustRun("插件 bun run build", ["bun", "run", "build"], {cwd: plugin, env});
    await mustRun("插件 bun run typecheck", ["bun", "run", "typecheck"], {cwd: plugin, env});
    step(`bunx -p ${sdkName} nbooke create：插件装上同版本的 SDK，构建与类型检查通过`);

    await mustRun("nbook plugin install", [nbook, "plugin", "install", join(plugin, "dist"), "--state-root", stateRoot, "--json"], {cwd: home, env});
    await withNbook(nbook, stateRoot, env, async () => {
        // 没有运行中的实例时 list 按下一次启动预演，结果也是“已加载”；先确认它读的是正在运行的那一个。
        const listed = JSON.parse(await mustRun("nbook plugin list", [nbook, "plugin", "list", "--state-root", stateRoot, "--json"], {cwd: home, env})) as {running?: {pid?: unknown} | null; plugins?: Array<{id: string; pending: unknown[]; notLoaded: unknown}>};
        if (typeof listed.running?.pid !== "number") fail(`nbook plugin list 没有读到运行中的实例：${JSON.stringify(listed.running ?? null)}`);
        const entry = listed.plugins?.find((item) => item.id === "smoke.hello");
        if (entry === undefined || entry.pending.length !== 0 || entry.notLoaded !== null) fail(`重启后插件不在运行中的实例里：${JSON.stringify(entry ?? listed)}`);
    });
    step("nbook plugin install 后重启：插件已加载，没有待生效的变化");
}

/** 会发布的目录没有未提交的改动或未跟踪的文件时返回 HEAD，否则失败。 */
async function cleanCommit(): Promise<string> {
    const status = await mustRun("检查会发布的目录", ["git", "status", "--porcelain", "--untracked-files=all", "--", ...releaseDirectories()], {cwd: REPOSITORY});
    if (status.trim() !== "") fail(`会发布的目录里有未提交的改动或未跟踪的文件，打出来的包对不上任何提交；先提交或清掉：\n${status}`);
    return (await mustRun("取当前提交", ["git", "rev-parse", "HEAD"], {cwd: REPOSITORY})).trim();
}

function parseArguments(argv: readonly string[]): {from: Source; keep: boolean} {
    let from: Source = "pack";
    let keep = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--keep") keep = true;
        else if (argument === "--from" && (argv[index + 1] === "pack" || argv[index + 1] === "registry")) from = argv[(index += 1)] as Source;
        else throw new SmokeFailure(`未知参数或取值：${argument}（用法：release:smoke [--from pack|registry] [--keep]）`);
    }
    return {from, keep};
}

if (import.meta.main) {
    let root: string | null = null;
    let keep = false;
    try {
        const options = parseArguments(Bun.argv.slice(2));
        keep = options.keep;
        root = await createTestTmpRoot("release-smoke", "release-smoke");
        const tarballs = new Map<string, string>();
        let packages: ReleasePackage[];
        let manifest: ReleaseManifest | null = null;
        if (options.from === "pack") {
            // 清单是“这些 tarball 验过了”的凭据：先删掉上一次的，冒烟全部通过后最后才写。中途失败就没有清单，publish 不会发。
            await rm(RELEASE_DIRECTORY, {recursive: true, force: true});
            await mkdir(RELEASE_DIRECTORY, {recursive: true});
            // 字节从工作区打出来，所以打之前就要求会发布的目录是干净的、记下是哪个提交；结束时再核对那些目录没变。
            const commit = await cleanCommit();
            for (const entry of BUILT_PACKAGES) await mustRun(`生成 ${entry.name}`, ["bun", "run", entry.script], {cwd: join(REPOSITORY, "packages", entry.source)});
            const built = loadBuiltPackages(REPOSITORY);
            packages = publishOrder([...loadReleasePackages(REPOSITORY), ...built]);
            const findings = checkReleasePackages(REPOSITORY, packages);
            if (findings.length > 0) fail(`发布清单检查失败：\n${findings.map((finding) => `${finding.package} [${finding.code}] ${finding.message}`).join("\n")}`);
            const builtPaths = new Set(built.map((entry) => entry.path));
            for (const entry of packages) tarballs.set(entry.manifest.name, await packPackage(entry, RELEASE_DIRECTORY, builtPaths.has(entry.path)));
            manifest = {commit, packages: await Promise.all(packages.map(async (entry) => {
                const tarball = tarballs.get(entry.manifest.name) as string;
                return {name: entry.manifest.name, version: entry.manifest.version, tarball: basename(tarball), sha256: await sha256Of(tarball)};
            }))};
            step(`生成 ${built.length} 个包，${packages.length} 个包的发布清单检查、打包与入口检查通过；tarball 在 dist/release/`);
        } else {
            // registry 模式不生成：生成的包的版本就是产品版本，与源码包一起按 package.json 取。
            const product = loadReleasePackages(REPOSITORY, [BUILT_PACKAGES[0].source])[0] as ReleasePackage;
            packages = [...loadReleasePackages(REPOSITORY), ...BUILT_PACKAGES.map((entry): ReleasePackage => ({dir: entry.source, path: product.path, repositoryDirectory: entry.repositoryDirectory, manifest: {...product.manifest, name: entry.name}}))];
        }
        const from = sources(packages, tarballs);
        await smokeStory(root, from);
        await smokeVueHost(root, from);
        await smokeAppAndPlugin(root, from, tarballs, manifest);
        if (manifest !== null) {
            // master 被几个会话共用，冒烟期间别处的提交照常进来；只要会发布的目录没变，打出的字节就还是开始时那份代码的。
            const changed = releaseFilesChangedSince(manifest.commit, releaseDirectories());
            if (changed.length > 0) fail(`冒烟期间会发布的目录改过：${changed.slice(0, 5).join("、")}；重跑 release:smoke`);
            await writeJson(RELEASE_MANIFEST, manifest);
            step("写下 dist/release/release-manifest.json：release:publish 只发这些 tarball");
        }
        console.log(`发布冒烟通过（${options.from === "pack" ? "本地打包" : "registry"}）`);
    } catch (error) {
        console.error(error instanceof SmokeFailure ? `发布冒烟失败：${error.message}` : error);
        process.exitCode = 1;
    } finally {
        if (root && !keep) await rm(root, {recursive: true, force: true});
        else if (root) console.log(`留下了冒烟目录：${root}`);
    }
}

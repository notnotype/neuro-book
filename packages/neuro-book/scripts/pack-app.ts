/**
 * 生成应用的 npm 包 `@notnotype/neuro-book`（ADR 0033，docs/specs/runtime/cli.md）：发构建产物，不发源码。
 *
 * - `server/nbook.js` 与它旁边的 `nbook-<hash>.js`：命令行 `nbook`（`src/cli/main.ts`，开代码分割，理由见该文件），里面是整个服务端；`server/project.js`：项目宿主
 *   （`src/project/main.ts`），服务端从 `nbook.js` 旁边找它。两个都由这里用 Bun 打包，依赖打进去，只有 OMP（`@oh-my-pi/*`）
 *   例外：它带每个平台约 122 MB 的原生插件，按平台从 npm 装，所以不打进 bundle，写进包的 `dependencies`（w00032 t09 决定 33）。
 * - `web/`：前端构建产物（`vite build` 的 `dist/web`），不含 Vite 的元数据目录 `.vite/`。
 * - `LICENSE`（仓库根的 AGPL）、给用户的 `README.md`（`scripts/app-package/README.md`，填上 Bun 版本与构建所用的提交）、
 *   `THIRD-PARTY-NOTICES.md`：打进服务端 bundle 的包（按 Bun 的 metafile）与前端产物里的包（Vite 的许可清单）的许可
 *   文本与 NOTICE，加上随 Web 产物分发的 Fraunces 字体的 OFL。打包把各依赖文件头的版权声明去掉了，许可义务靠这份文件履行。
 * - `package.json`：名字、版本（产品版本）、`bin`、`files`、`engines.bun`、`publishConfig` 与 `repository` 按仓库的发布门禁
 *   （`scripts/release/packages.ts`）写，接进发布时不必改产物结构。
 *
 * 打包前核对：两个 bundle 只引用 Bun 与 Node 的内置模块和 `SERVER_EXTERNALS`；不出现 `new Worker(` 与 `import.meta.resolve(`（运行时按路径
 * 找文件，装到别处会找不到）；`nbook.js --version` 报的是产品版本。最后 `bun pm pack` 打成 tarball，放在目录旁边。
 * 应用的源码包是 `private`，只有这里生成的目录能发布。
 *
 * 用法：`bun scripts/pack-app.ts [输出目录]`，Web 产物取 `dist/web`（先 `bun run build`），缺省输出到 `dist/app-package/`，
 * 最后一行打印 tarball 的路径。输出目录只在不存在、为空或者是上次生成的应用包时清空重建，否则拒绝。
 */

import {execFile, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {chmod, cp, mkdir, readdir, readFile, rm, symlink, unlink, writeFile} from "node:fs/promises";
import {isBuiltin} from "node:module";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {BUN_ENGINE, PRODUCT_VERSION} from "../src/shared/product";

import {noticeSection, packageDirectories, packageNotices, viteLicenseNotices} from "./third-party-notices";

export const APP_NAME = "@notnotype/neuro-book";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const REPOSITORY = {type: "git", url: "git+https://github.com/notnotype/neuro-book.git", directory: "packages/neuro-book"};
/** 运行时按路径找文件的写法：打包看不见它们要的文件，装到别处就找不到。 */
const FORBIDDEN_TEXT = ["new Worker(", "import.meta.resolve("];
/**
 * 允许的计算出来的动态导入，路径都来自状态根、不是打包要管的依赖：插件平台装载第三方插件入口
 * （`src/plugin-platform/backend/loader.ts`），`nbook.agent` 装载用户写的 Profile 打好的包
 * （`src/plugins/agent/backend/profile-bundles.ts`）。别的计算出来的 `import(…)` 都拒绝：打包看不见它要的模块。
 */
const ALLOWED_DYNAMIC_IMPORTS = ["attempt === 0 ? import(file) : import(`${file}?attempt=${String(attempt)}`)", "import(bundleFile)"];
/**
 * 不打进服务端 bundle、由包的 `dependencies` 安装的模块（决定 33）。`package.json` 的 `build:server` 与命令行测试的构建用同一组。
 */
export const SERVER_EXTERNALS: readonly string[] = ["@oh-my-pi/*"];
const isServerExternal = (path: string): boolean => SERVER_EXTERNALS.some((pattern) => (pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern));
/** 模块路径所属的包名：`@scope/name/sub` → `@scope/name`。 */
const packageOf = (path: string): string => path.split("/").slice(0, path.startsWith("@") ? 2 : 1).join("/");


/**
 * 名叫 `import` 的对象方法的定义（例如 `@oh-my-pi/omptype` 作用域对象上的 `import(...names) {`）：一行里只有方法名、
 * 参数表与左花括号。它不是动态导入，按文本找时先去掉；真正的 `import(x).then(() => {` 在右括号后还有东西，不会被去掉。
 */
const IMPORT_METHOD_DEFINITION = /^\s*import\((?:\s*(?:\.\.\.)?[\w$]+\s*,?)*\)\s*\{\s*$/gmu;
/** 生成的目录里的标记：只有带它的目录才是上次生成的应用包，可以清空重建。它不在 `files` 里，不进 tarball。 */
const MARKER = ".nbook-app-package";
/** Web 产物里的字体与它们的许可声明（字体不是 JS 模块，Vite 的许可清单不收）。没有登记的字体让打包失败。 */
const FONT_NOTICES: ReadonlyArray<{readonly pattern: RegExp; readonly notice: string}> = [
    {pattern: /^fraunces-latin-[\w-]+\.woff2$/u, notice: "../nb-ui/themes/nbook/assets/fonts/OFL-Fraunces.txt"},
    {pattern: /^codicon-[\w-]+\.ttf$/u, notice: "scripts/app-package/codicon-NOTICE.txt"},
];
const FONT_FILE = /\.(ttf|otf|woff2?)$/u;

export interface PackOptions {
    /** 前端构建产物（`dist/web`），要带 `.vite/license.json`。 */
    readonly webRoot: string;
    readonly outDir: string;
}

export interface PackedApp {
    readonly directory: string;
    readonly tarball: string;
}

/** 清空上次生成的应用包。输出目录来自命令行，传错了不能被递归删除：只认不存在、为空，或者带标记文件的目录。 */
export async function clearPreviousApp(outDir: string): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    const marker = await readFile(join(outDir, MARKER), "utf8").catch(() => null);
    if (marker?.trim() !== APP_NAME) throw new Error(`输出目录 ${outDir} 不是空的，也不是上次生成的 ${APP_NAME}（没有 ${MARKER}），不清理`);
    await rm(outDir, {recursive: true});
}

/** bundle 里不该有的东西：内置模块之外的导入，以及运行时按路径找文件的写法。返回问题列表，空表示通过。 */
export function bundleProblems(source: string): string[] {
    // scanImports 不认文件开头的 shebang，只清掉那一行，行号不变（同 scripts/release/packages.ts）。
    const imports = new Bun.Transpiler({loader: "js"}).scanImports(source.replace(/^#!.*/u, ""));
    // `./` 开头的是代码分割出来的同目录 chunk，随包发出（打包时核对它们都在，见 packApp）。
    const external = imports.map((entry) => entry.path).filter((path) => !path.startsWith("bun:") && path !== "bun" && !isBuiltin(path) && !isServerExternal(path) && !path.startsWith("./"));
    // scanImports 只报字面的导入；计算出来的 `import(x)` 按文本找：去掉允许的那一处之后，`import(` 后面不是引号的都算。
    const computed = ALLOWED_DYNAMIC_IMPORTS.reduce((text, allowed) => text.replaceAll(allowed, ""), source).replace(IMPORT_METHOD_DEFINITION, "").match(/\bimport\(\s*(?!["'])/gu)?.length ?? 0;
    return [
        ...[...new Set(external)].map((path) => `引用了外部模块 ${path}：依赖要打进 bundle`),
        ...(computed === 0 ? [] : [`有 ${String(computed)} 处计算出来的动态导入：打包看不见它要的模块`]),
        ...FORBIDDEN_TEXT.filter((text) => source.includes(text)).map((text) => `出现了 ${text}：运行时按路径找文件，装到别处会找不到`),
    ];
}

/**
 * 打一个服务端入口（开代码分割：入口动态导入的部分进旁边的 chunk），返回打进去的第三方包所在的目录（metafile 的输入路径，
 * 见 `packageDirectories`）。
 */
async function bundle(entry: string, outDir: string, naming: {readonly entry: string; readonly chunk: string}): Promise<Set<string>> {
    const built = await Bun.build({entrypoints: [join(packageRoot, entry)], target: "bun", outdir: outDir, naming, splitting: true, metafile: true, external: [...SERVER_EXTERNALS]});
    if (!built.success) throw new AggregateError(built.logs, `打包 ${entry} 失败`);
    return packageDirectories(Object.keys(built.metafile?.inputs ?? {}));
}

/** 外部依赖写进 `dependencies` 的版本：本仓库装的那个，精确版本（原生插件与 JS 部分要同一版）。 */
async function installedVersions(names: ReadonlySet<string>): Promise<Record<string, string>> {
    const versions: Record<string, string> = {};
    for (const name of [...names].sort()) {
        const manifest = JSON.parse(await readFile(join(repoRoot, "node_modules", name, "package.json"), "utf8")) as {version: string};
        versions[name] = manifest.version;
    }
    return versions;
}

async function thirdPartyNotices(serverPackages: ReadonlySet<string>, webRoot: string): Promise<string> {
    const web = await viteLicenseNotices(join(webRoot, ".vite", "license.json"), join(repoRoot, "node_modules"));
    const fonts = await fontNotices(webRoot);
    return [
        "# 第三方许可",
        "这个包里的 `server/` 与 `web/` 是打包产物，打包时去掉了各依赖文件头的版权声明。下面是打进去的每个第三方包的许可与声明。",
        noticeSection("服务端（server/nbook.js、server/project.js）", await packageNotices(serverPackages)),
        noticeSection("前端（web/）", web),
        ["## 字体", ...fonts.map(({file, text}) => `### web/assets/${file}\n\n\`\`\`\n${text}\n\`\`\``)].join("\n\n"),
    ].join("\n\n") + "\n";
}

/** Web 产物里每个字体文件的许可声明；有没登记的字体时失败。 */
async function fontNotices(webRoot: string): Promise<Array<{readonly file: string; readonly text: string}>> {
    const assets = join(webRoot, "assets");
    const files = existsSync(assets) ? (await readdir(assets)).filter((name) => FONT_FILE.test(name)).sort() : [];
    return Promise.all(files.map(async (file) => {
        const known = FONT_NOTICES.find((entry) => entry.pattern.test(file));
        if (known === undefined) throw new Error(`web/assets/${file} 是没有登记许可的字体：在 scripts/pack-app.ts 的 FONT_NOTICES 里登记它的许可声明`);
        return {file, text: (await readFile(join(packageRoot, known.notice), "utf8")).trim()};
    }));
}

function buildCommit(): string {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {cwd: packageRoot, encoding: "utf8"});
    return result.status === 0 ? result.stdout.trim() : "未知";
}

export async function packApp(options: PackOptions): Promise<PackedApp> {
    const outDir = resolve(options.outDir);
    await clearPreviousApp(outDir);
    if (!existsSync(join(options.webRoot, "index.html"))) throw new Error(`${options.webRoot} 里没有 index.html：先 bun run build`);
    // 标记先于内容写下：中途失败留下的半成品下次照样能被清掉，不用手工删目录。
    await mkdir(outDir, {recursive: true});
    await writeFile(join(outDir, MARKER), `${APP_NAME}\n`);
    const serverDir = join(outDir, "server");
    const serverPackages = new Set([
        ...await bundle("src/cli/main.ts", serverDir, {entry: "nbook.js", chunk: "nbook-[hash].[ext]"}),
        ...await bundle("src/project/main.ts", serverDir, {entry: "project.js", chunk: "project-[hash].[ext]"}),
    ]);
    await chmod(join(outDir, "server", "nbook.js"), 0o755);
    const dependencies = new Set<string>();
    for (const file of (await readdir(serverDir)).filter((name) => name.endsWith(".js"))) {
        const source = await readFile(join(outDir, "server", file), "utf8");
        const problems = bundleProblems(source);
        if (problems.length > 0) throw new Error(`server/${file} 不能发布：\n${problems.join("\n")}`);
        for (const entry of new Bun.Transpiler({loader: "js"}).scanImports(source.replace(/^#!.*/u, ""))) {
            if (isServerExternal(entry.path)) dependencies.add(packageOf(entry.path));
            else if (entry.path.startsWith("./") && !existsSync(join(serverDir, entry.path))) throw new Error(`server/${file} 引用的 ${entry.path} 不在包里`);
        }
    }
    await cp(options.webRoot, join(outDir, "web"), {recursive: true, filter: (source) => basename(source) !== ".vite"});
    await writeFile(join(outDir, "THIRD-PARTY-NOTICES.md"), await thirdPartyNotices(serverPackages, options.webRoot));
    await cp(join(repoRoot, "LICENSE"), join(outDir, "LICENSE"));
    const readme = (await readFile(join(packageRoot, "scripts/app-package/README.md"), "utf8")).replaceAll("{{bun}}", BUN_ENGINE).replaceAll("{{commit}}", buildCommit());
    await writeFile(join(outDir, "README.md"), readme);
    const description = (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {description: string}).description;
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: APP_NAME,
        version: PRODUCT_VERSION,
        description,
        type: "module",
        bin: {nbook: "./server/nbook.js"},
        files: ["server/", "web/", "LICENSE", "README.md", "THIRD-PARTY-NOTICES.md"],
        engines: {bun: BUN_ENGINE},
        license: "AGPL-3.0-only",
        repository: REPOSITORY,
        keywords: ["neurobook", "writing", "novel", "fiction", "markdown", "local-first", "bun"],
        homepage: "https://github.com/notnotype/neuro-book#readme",
        bugs: {url: "https://github.com/notnotype/neuro-book/issues"},
        publishConfig: {access: "public"},
        ...(dependencies.size === 0 ? {} : {dependencies: await installedVersions(dependencies)}),
    }, null, 4)}\n`);
    // 外部依赖要装好才跑得起来：核对版本时临时把本仓库的 node_modules 链到包旁边（相当于装过），核对完删掉，不进 tarball。
    const linked = join(outDir, "node_modules");
    await symlink(join(repoRoot, "node_modules"), linked, "dir");
    try {
        const version = spawnSync("bun", [join(outDir, "server", "nbook.js"), "--version"], {encoding: "utf8"});
        if (version.status !== 0 || !version.stdout.includes(`NeuroBook ${PRODUCT_VERSION}`)) throw new Error(`server/nbook.js --version 没有报出 ${PRODUCT_VERSION}：${version.stdout}${version.stderr}`);
    } finally {
        await unlink(linked);
    }
    const tarball = join(dirname(outDir), `${APP_NAME.replace(/^@/u, "").replace("/", "-")}-${PRODUCT_VERSION}.tgz`);
    await promisify(execFile)("bun", ["pm", "pack", "--quiet", "--filename", tarball], {cwd: outDir});
    if (!existsSync(tarball)) throw new Error(`bun pm pack 没有打出 ${tarball}`);
    return {directory: outDir, tarball};
}

if (import.meta.main) {
    const {directory, tarball} = await packApp({webRoot: join(packageRoot, "dist/web"), outDir: process.argv[2] ?? join(packageRoot, "dist/app-package")});
    console.log(`应用包已生成：${directory}`);
    console.log(tarball);
}

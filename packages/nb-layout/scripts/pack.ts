#!/usr/bin/env bun
/**
 * nb-layout 的编译产物（ADR 0054 第 6 条；做法见 w00026 t47 的计划）。仓库里的使用方照旧走源码（`package.json` 的 `exports`
 * 指向 `src`），发到 npm 的是这里生成的目录。
 *
 * - `bun run build:package`：完整构建，写 `dist/package/`（JS、`style.css`、四个入口的声明、`package.json`、README、LICENSE）。
 *   只有它写这个目录：发布冒烟在它之后还会跑 nb-story 的网页构建，两者共用一个目录时声明会被冲掉。
 * - `bun run build:package --web`：只出 JS 与 CSS，写 `dist/web-build/`，给 nb-story 的网页构建读。
 *
 * 两种都写 `inputs.json`：Vite 实际处理过的源文件（相对包目录），nb-story 的网页包新旧记录据此记 nb-layout 的源码
 * （`docs/specs/story/cli-skill.md` 输出 19）。
 *
 * 字节要稳定：发布计划比的是整个 tarball，同一份源码两次构建不同，整轮重跑就会失败。JS 与 CSS 本来就稳定；声明不用
 * `rolldown-plugin-dts` 的 `vue: true` 直接出（它按文件被处理的先后给字面量类型编号，组件的事件与属性每次排得不一样，
 * t47 探针 4 次 3 种），改成 `vue-tsc` 一次出全部声明（一个程序、固定顺序），再只打包这些 `.d.ts`。
 */

import {cp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {join, relative} from "node:path";

import {moduleExports} from "@notnotype/neuro-book-test-support/module-exports";
import vue from "@vitejs/plugin-vue";
import {rolldown} from "rolldown";
import {dts} from "rolldown-plugin-dts";
import {build, type Plugin} from "vite";

import {componentTags, tagComponentDeclarations} from "./component-tags";
import {ENTRIES} from "./entries";
import {exportDiff, forbiddenFile, reachablePackages, specNumbers} from "./pack-check";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const SOURCE = join(PACKAGE_ROOT, "src");

const EXTERNAL = [/^vue($|\/)/u, /^tabbable($|\/)/u];

type SourceManifest = {
    name: string;
    version: string;
    description?: string;
    license?: string;
    private?: boolean;
    repository?: unknown;
    publishConfig?: unknown;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

/** 记下 Vite 处理过的包内源文件（去掉 `?vue&type=…` 这类查询）。 */
function collectInputs(inputs: Set<string>): Plugin {
    return {
        name: "nb-layout-inputs",
        transform(_code, id) {
            const file = id.split("?")[0]!;
            if (file.startsWith(`${SOURCE}/`)) inputs.add(relative(PACKAGE_ROOT, file));
            return null;
        },
    };
}

async function buildScripts(outDir: string): Promise<string[]> {
    const inputs = new Set<string>();
    await build({
        configFile: false,
        root: PACKAGE_ROOT,
        logLevel: "warn",
        plugins: [vue(), collectInputs(inputs)],
        build: {
            outDir,
            emptyOutDir: true,
            // 压缩同时去掉注释：源码注释里的 Spec 编号与中文说明不进包。
            minify: true,
            lib: {
                entry: Object.fromEntries(ENTRIES.map((entry) => [entry.name, join(PACKAGE_ROOT, entry.source)])),
                formats: ["es"],
                fileName: (_format, name) => `${name}.js`,
                cssFileName: "style",
            },
            rolldownOptions: {external: EXTERNAL, output: {chunkFileNames: "shared-[hash].js"}},
        },
    });
    return [...inputs].sort();
}

/** 先用 vue-tsc 把全部声明出到临时目录，再打成四个入口。临时目录放在包目录下的固定位置：打包出的 `//#region` 注释带它的相对路径。 */
async function buildTypes(outDir: string): Promise<void> {
    const types = join(PACKAGE_ROOT, "dist/.types");
    await rm(types, {recursive: true, force: true});
    // 成功、失败都删临时目录。清理本身失败不盖掉构建的错误，只打一条诊断（下次构建开始时会先清空它）。
    try {
        await emitTypes(types, outDir);
    } finally {
        await rm(types, {recursive: true, force: true}).catch((error: unknown) => {
            console.warn(`could not remove the temporary declaration directory ${types}`, error);
        });
    }
}

/** `buildTypes` 的主体：vue-tsc 出到 `types`，再打包到 `outDir`。 */
async function emitTypes(types: string, outDir: string): Promise<void> {
    const vueTsc = createRequire(import.meta.url).resolve("vue-tsc/bin/vue-tsc.js");
    // 用 Node 跑：vue-tsc 靠改写 TypeScript 的模块加载认出 `.vue`，在 Bun 里跑时认不出（每个 `.vue` 导入都报 TS2307）。
    const child = Bun.spawn(["node", vueTsc, "-p", "tsconfig.package.json", "--outDir", types], {cwd: PACKAGE_ROOT, stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`vue-tsc failed with exit code ${code}\n${stdout}${stderr}`);
    const logs: string[] = [];
    const bundle = await rolldown({
        cwd: PACKAGE_ROOT,
        // 入口名带 `.d`：`dtsInput` 时插件按这个认出声明入口，产物名是 `<名>.d.ts`。
        input: Object.fromEntries(ENTRIES.map((entry) => [`${entry.name}.d`, join(types, relative(SOURCE, entry.source).replace(/\.ts$/u, ".d.ts"))])),
        external: EXTERNAL,
        plugins: [dts({dtsInput: true, emitDtsOnly: true})],
        onLog: (level, log) => {
            logs.push(`${level}: ${log.code ?? ""} ${log.message}`);
        },
        checks: {pluginTimings: false},
    });
    try {
        await bundle.write({dir: outDir, chunkFileNames: "shared-[hash].d.ts"});
    } finally {
        await bundle.close();
    }
    if (logs.length > 0) throw new Error(`bundling declarations reported:\n${logs.join("\n")}`);
}

/**
 * 生成包的 `package.json`。键的先后固定，同一份源码清单写出同一份字节。`typescript` 这个对等依赖不抄：源码包要它是因为
 * 以前发的是 `.ts`，产物不需要。`private` 照抄：源码包还是 `private` 时，发布脚本只冒烟、不发（首发由开发者决定）。
 */
function publishedManifest(source: SourceManifest): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    for (const entry of ENTRIES) exports[entry.subpath] = {types: `./${entry.name}.d.ts`, import: `./${entry.name}.js`};
    exports["./style.css"] = "./style.css";
    const vuePeer = source.peerDependencies?.vue;
    const tabbable = source.dependencies?.tabbable;
    if (vuePeer === undefined || tabbable === undefined) throw new Error("package.json must declare the vue peer dependency and the tabbable dependency");
    return {
        name: source.name,
        version: source.version,
        ...(source.private === true ? {private: true} : {}),
        description: source.description,
        license: source.license,
        repository: source.repository,
        publishConfig: source.publishConfig,
        type: "module",
        sideEffects: ["**/*.css"],
        exports,
        files: ["*.js", "*.d.ts", "style.css", "README.md", "LICENSE"],
        dependencies: {tabbable},
        peerDependencies: {vue: vuePeer},
    };
}

/** 构建完的自查；有问题就抛出，不留一个看起来完整的坏目录。 */
async function check(outDir: string, withTypes: boolean): Promise<void> {
    const problems: string[] = [];
    const names = await readdir(outDir);
    const texts = new Map<string, string>();
    for (const name of names) {
        if (forbiddenFile(name)) problems.push(`${name} must not be published`);
        if (/\.(js|css|ts)$/u.test(name)) texts.set(name, await readFile(join(outDir, name), "utf8"));
    }
    // 只查 JS 与 CSS（压缩已去掉注释，有编号说明压缩漏了）。声明里的 JSDoc 原样留着：它是维护者写的说明，引的 Spec 在公开仓库里查得到。
    for (const [name, text] of texts) {
        if (name.endsWith(".d.ts")) continue;
        const cited = specNumbers(text);
        if (cited.length > 0) problems.push(`${name} cites spec items: ${cited.slice(0, 5).join(", ")}`);
    }
    const scripts = new Map([...texts].filter(([name]) => name.endsWith(".js")));
    for (const entry of ENTRIES) {
        const expected = moduleExports(await readFile(join(PACKAGE_ROOT, entry.source), "utf8"));
        const values = expected.filter((item) => item.kind === "value").map((item) => item.name);
        const actual = Object.keys((await import(join(outDir, `${entry.name}.js`))) as Record<string, unknown>);
        const diff = exportDiff(values, actual);
        if (diff.missing.length > 0 || diff.extra.length > 0) problems.push(`${entry.name}.js exports differ from ${entry.source}: missing ${diff.missing.join(", ") || "none"}, extra ${diff.extra.join(", ") || "none"}`);
        // 纯 TS 的入口经共享块也不能拉进 Vue：只用核心的使用方不装 Vue 也要能导入。
        const packages = reachablePackages(scripts, `${entry.name}.js`);
        if (!entry.vue && packages.length > 0) problems.push(`${entry.name}.js reaches ${packages.join(", ")}`);
        if (withTypes) {
            const declared = moduleExports(texts.get(`${entry.name}.d.ts`) ?? "").map((item) => item.name);
            const missingTypes = exportDiff(expected.map((item) => item.name), declared).missing;
            if (missingTypes.length > 0) problems.push(`${entry.name}.d.ts lacks ${missingTypes.join(", ")}`);
        }
    }
    if (problems.length > 0) throw new Error(`build output check failed:\n- ${problems.join("\n- ")}`);
}

async function main(argv: readonly string[]): Promise<void> {
    const web = argv.includes("--web");
    const unknown = argv.filter((arg) => arg !== "--web");
    if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(" ")} (usage: pack.ts [--web])`);
    const outDir = join(PACKAGE_ROOT, web ? "dist/web-build" : "dist/package");
    const inputs = await buildScripts(outDir);
    if (!web) {
        await buildTypes(outDir);
        // 组件声明上带不了注释，稳定性标注从入口的行尾插进去（见 `component-tags.ts`）。
        const vueTypes = join(outDir, "vue.d.ts");
        const tags = componentTags(await readFile(join(PACKAGE_ROOT, "src/vue/index.ts"), "utf8"));
        await writeFile(vueTypes, tagComponentDeclarations(await readFile(vueTypes, "utf8"), tags));
        const source = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")) as SourceManifest;
        await writeFile(join(outDir, "package.json"), `${JSON.stringify(publishedManifest(source), null, 4)}\n`);
        await cp(join(PACKAGE_ROOT, "README.md"), join(outDir, "README.md"));
        await cp(join(PACKAGE_ROOT, "LICENSE"), join(outDir, "LICENSE"));
    }
    await writeFile(join(outDir, "inputs.json"), `${JSON.stringify(inputs, null, 4)}\n`);
    await check(outDir, !web);
    console.log(`built ${relative(PACKAGE_ROOT, outDir)} (${inputs.length} source files)`);
}

if (import.meta.main) {
    await main(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}

import {appendFile, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig, type Plugin} from "vite";

import {withPrebuiltSources, writeWebStamp} from "./src/server/web-stamp";

const packageRoot = import.meta.dirname;
const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

/**
 * 网页构建读 nb-layout 的编译产物，不读它的源码（w00026 t47）：第三方装到的就是产物，nb-story 的 e2e 每次都跑在它上面，
 * 两条路（仓库里走源码、发布包走产物）每次构建都比一次。产物由 `build:web` 先跑 `build:package --web` 生成在
 * `dist/web-build/`（与发布用的 `dist/package/` 分开）；不在时别名解析失败、构建失败，不退回源码。
 */
const LAYOUT_ROOT = resolve(packageRoot, "../nb-layout");
const LAYOUT_BUILD = resolve(LAYOUT_ROOT, "dist/web-build");
const LAYOUT_ALIASES = [
    {find: /^@notnotype\/nb-layout$/u, replacement: `${LAYOUT_BUILD}/index.js`},
    {find: /^@notnotype\/nb-layout\/vue$/u, replacement: `${LAYOUT_BUILD}/vue.js`},
    {find: /^@notnotype\/nb-layout\/text$/u, replacement: `${LAYOUT_BUILD}/text.js`},
    {find: /^@notnotype\/nb-layout\/locales$/u, replacement: `${LAYOUT_BUILD}/locales.js`},
    {find: /^@notnotype\/nb-layout\/style\.css$/u, replacement: `${LAYOUT_BUILD}/style.css`},
];

/**
 * 构建结束时记下打进包的源文件的摘要（`dist/web/build-stamp.json`），从源码运行 `nbstory serve` 时据此发现网页包比源码旧
 * （issue 267，src/server/web-stamp.ts）。入口 index.html 不经 transform，单独补上。
 */
function webStamp(): Plugin {
    const ids = new Set<string>([resolve(packageRoot, "src/web/index.html")]);
    return {
        name: "nb-story-web-stamp",
        transform(_code, id) {
            ids.add(id);
            return null;
        },
        async writeBundle(options) {
            // 打进去的 nb-layout 产物换成生成它的源文件：它的源码改了，网页包照样算旧（cli-skill 输出 19）。
            await writeWebStamp(options.dir ?? resolve(packageRoot, "dist/web"), packageRoot, await withPrebuiltSources(ids, [{directory: LAYOUT_BUILD, packageRoot: LAYOUT_ROOT}]));
        },
    };
}

/**
 * 第三方声明（`dist/web/THIRD-PARTY-NOTICES.md`，随 `dist/web` 进包）：Vite 的 `build.license` 列出打进去的 node_modules 里的包；
 * 工作区的包经链接解析到 `packages/<目录>`，它看不见，这里补上许可不是 AGPL-3.0-only 的那些（nb-layout 的 MIT）。
 * 声明了依赖就当打进去了：网页把用到的工作区包都打进产物，多列不碍事，漏列才是问题。
 */
function workspaceNotices(): Plugin {
    return {
        name: "nb-story-workspace-notices",
        apply: "build",
        async writeBundle(options) {
            const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {dependencies?: Record<string, string>; devDependencies?: Record<string, string>};
            const names = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])].filter((name) => name.startsWith("@notnotype/")).sort();
            const sections: string[] = [];
            for (const name of names) {
                const directory = resolve(packageRoot, "..", name.slice("@notnotype/".length));
                const own = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {version: string; license?: string; private?: boolean};
                // 没写许可的私有包是不发布的工具（测试支持包），不会打进网页。
                if (own.license === "AGPL-3.0-only" || (own.license === undefined && own.private === true)) continue;
                sections.push(`## ${name} - ${own.license ?? "see below"} (${own.version})\n\n\`\`\`\n${(await readFile(join(directory, "LICENSE"), "utf8")).trim()}\n\`\`\``);
            }
            if (sections.length > 0) await appendFile(join(options.dir ?? resolve(packageRoot, "dist/web"), NOTICES_FILE), `\n${sections.join("\n\n")}\n`);
        },
    };
}


/** 查看器前端：根是 src/web，产物进 dist/web（不入库，`nbstory serve` 发现没有产物时先构建）。设置照 dev-panel 的 vite.config.ts。 */
export default defineConfig(({command}) => ({
    // 只在构建时读产物；手动起 Vite 开发服务时照旧走源码（nb-story 平时没有开发服务，`nbstory serve` 发的是 dist/web）。
    resolve: command === "build" ? {alias: LAYOUT_ALIASES} : {},
    root: resolve(packageRoot, "src/web"),
    base: "/",
    plugins: [vue(), tailwindcss(), webStamp(), workspaceNotices()],
    build: {
        license: {fileName: NOTICES_FILE},
        outDir: resolve(packageRoot, "dist/web"),
        emptyOutDir: true,
        // 只在本机开，产物大小不是问题；图的依赖（sigma、graphology）占大头。
        chunkSizeWarningLimit: 3_000,
        // Lightning CSS 会把 backdrop-filter 与它的 -webkit- 前缀当成同一属性只留一条（见 dev-panel 的 vite.config.ts），换回 esbuild。
        cssMinify: "esbuild",
        rolldownOptions: {checks: {pluginTimings: false}},
    },
}));

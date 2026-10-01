import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {basename, dirname} from "node:path";
import type {Plugin} from "esbuild";

const GAXIOS_SOURCE_PATTERN = /[\\/]gaxios[\\/]build[\\/](?:cjs|esm)[\\/]src[\\/]gaxios\.js$/;
const GAXIOS_NODE_FETCH_IMPORT = "(await import('node-fetch')).default";
// 同时提供 import/require 入口，且 CJS 消费者把 require 结果当作默认函数或构造器的包，
// 不能由全局 import 条件改成模块命名空间，必须保留调用者的 require 入口。
const COMMONJS_DEFAULT_EXPORT_PACKAGES = ["buffer-crc32", "bignumber.js"];
const COMMONJS_DEFAULT_EXPORT_PATTERN = new RegExp(
    `^(?:${COMMONJS_DEFAULT_EXPORT_PACKAGES.map((name) => name.replaceAll(".", "\\.")).join("|")})$`,
);
const WEB_EXTRACTION_COMMONJS_IMPORT_PATTERN = /^(?:@mozilla\/readability|turndown-plugin-gfm)$/;
const WEB_EXTRACTION_COMMONJS_NAMESPACE = "nbook-product-web-extraction-esm";
const WEB_EXTRACTION_COMMONJS_MODULES = [
    {
        specifier: "@mozilla/readability",
        expectedSource: [
            "module.exports = {",
            "  Readability,",
            "  isProbablyReaderable,",
            "};",
        ].join("\n"),
        exportNames: ["Readability", "isProbablyReaderable"],
    },
    {
        specifier: "turndown-plugin-gfm",
        expectedSource: "exports.gfm = gfm;",
        exportNames: ["gfm"],
    },
] as const;
const PI_AI_ROOT_PATTERN = String.raw`[\\/]@earendil-works[\\/]pi-ai[\\/]dist[\\/]`;
const PI_AI_BEDROCK_PATTERN = new RegExp(String.raw`${PI_AI_ROOT_PATTERN}api[\\/]bedrock-converse-stream\.lazy\.js$`);
const PI_AI_ENV_KEYS_PATTERN = new RegExp(`${PI_AI_ROOT_PATTERN}env-api-keys\\.js$`);
const PI_AI_OAUTH_PATTERN = new RegExp(String.raw`${PI_AI_ROOT_PATTERN}utils[\\/]oauth[\\/]load\.js$`);

/**
 * 把现代 Bun 已内置的 fetch 投影为 gaxios 的 node-fetch fallback。
 *
 * bundler 会有意保留字面量 dynamic import，因此 `onResolve` 无法接管这里；
 * 必须在 gaxios 的稳定源码边界精确改写。上游形状变化时 fail closed，不能把
 * `node-fetch` 留到没有该 package 的 Product 中。
 */
export function productRuntimeCompatibilityPlugin(): Plugin {
    const requireFromBuilder = createRequire(import.meta.url);
    const webExtractionModules = new Map(WEB_EXTRACTION_COMMONJS_MODULES.map((definition) => [
        definition.specifier,
        {...definition, entry: requireFromBuilder.resolve(definition.specifier)},
    ]));
    return {
        name: "nbook-product-runtime-compatibility",
        setup(build) {
            build.onResolve({filter: COMMONJS_DEFAULT_EXPORT_PATTERN}, (args) => {
                if (args.kind !== "require-call") return;
                return {path: createRequire(args.importer || import.meta.url).resolve(args.path)};
            });
            build.onLoad({filter: GAXIOS_SOURCE_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                const first = source.indexOf(GAXIOS_NODE_FETCH_IMPORT);
                const second = first < 0 ? -1 : source.indexOf(GAXIOS_NODE_FETCH_IMPORT, first + 1);
                if (first < 0 || second >= 0) {
                    throw new Error(`gaxios node-fetch fallback 形状变化：${args.path}`);
                }
                return {
                    loader: "js",
                    contents: source.replace(
                        GAXIOS_NODE_FETCH_IMPORT,
                        "globalThis.fetch.bind(globalThis)",
                    ),
                };
            });
            build.onResolve({filter: WEB_EXTRACTION_COMMONJS_IMPORT_PATTERN}, (args) => ({
                path: args.path,
                namespace: WEB_EXTRACTION_COMMONJS_NAMESPACE,
            }));
            build.onLoad({filter: /.*/, namespace: WEB_EXTRACTION_COMMONJS_NAMESPACE}, async (args) => {
                const definition = webExtractionModules.get(args.path);
                if (!definition) throw new Error(`未登记的Web提取CommonJS入口：${args.path}`);
                const source = (await readFile(definition.entry, "utf8")).replaceAll("\r\n", "\n");
                const first = source.indexOf(definition.expectedSource);
                const second = first < 0
                    ? -1
                    : source.indexOf(definition.expectedSource, first + definition.expectedSource.length);
                if (first < 0 || second >= 0) {
                    throw new Error(`${definition.specifier} CommonJS 入口形状变化：${definition.entry}`);
                }
                const bindingNames = definition.exportNames.join(", ");
                const missingFunctions = definition.exportNames
                    .map((name) => `typeof ${name} !== \"function\"`)
                    .join(" || ");
                return {
                    loader: "js",
                    resolveDir: dirname(definition.entry),
                    contents: [
                        `import * as commonJsNamespace from ${JSON.stringify(`./${basename(definition.entry)}`)};`,
                        "const commonJsModule = commonJsNamespace.default ?? commonJsNamespace;",
                        `const {${bindingNames}} = commonJsModule;`,
                        `if (${missingFunctions}) {`,
                        `    throw new Error(${JSON.stringify(`${definition.specifier} ESM 投影缺少函数导出。`)});`,
                        "}",
                        `export {${bindingNames}};`,
                        "export default commonJsModule;",
                    ].join("\n"),
                };
            });
        },
    };
}

/**
 * 把 pi-ai 为浏览器 bundle 保留的已知变量 import 投影成 Bun Product 的字面量入口。
 * auth/context 的 Node builtin loader 有意保留为唯一 pi-ai opaque seam；其他上游形状
 * 变化必须在 onLoad 中 fail closed，不能随平台 tree-shaking 漂移。
 */
export function productPiAiImportPlugin(): Plugin {
    return {
        name: "nbook-pi-ai-runtime-imports",
        setup(build) {
            build.onLoad({filter: PI_AI_BEDROCK_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                return {
                    contents: replaceRequired(
                        source,
                        'return import(__rewriteRelativeImportExtension(runtimeSpecifier));',
                        'return import("./bedrock-converse-stream.js");',
                        args.path,
                    ),
                    loader: "js",
                };
            });
            build.onLoad({filter: PI_AI_ENV_KEYS_PATTERN}, async (args) => {
                let source = await readFile(args.path, "utf8");
                for (const [specifier, literal] of [
                    ["NODE_FS_SPECIFIER", "node:fs"],
                    ["NODE_OS_SPECIFIER", "node:os"],
                    ["NODE_PATH_SPECIFIER", "node:path"],
                ] as const) {
                    source = replaceRequired(
                        source,
                        `dynamicImport(${specifier})`,
                        `import(${JSON.stringify(literal)})`,
                        args.path,
                    );
                }
                return {contents: source, loader: "js"};
            });
            build.onLoad({filter: PI_AI_OAUTH_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                const replacement = [
                    'export const loadAnthropicOAuth = async () => (await import("./anthropic.js")).anthropicOAuth;',
                    'export const loadOpenAICodexOAuth = async () => (await import("./openai-codex.js")).openaiCodexOAuth;',
                    'export const loadGitHubCopilotOAuth = async () => (await import("./github-copilot.js")).githubCopilotOAuth;',
                ].join("\n");
                const start = source.indexOf("export const loadAnthropicOAuth");
                const endMarker = "//# sourceMappingURL=load.js.map";
                const end = source.indexOf(endMarker);
                if (start < 0 || end < start) throw new Error(`pi-ai OAuth loader 形状变化：${args.path}`);
                return {contents: `${source.slice(0, start)}${replacement}\n${source.slice(end)}`, loader: "js"};
            });
        },
    };
}

/** 精确替换一处上游动态 import；缺失或重复都说明依赖形状已经变化。 */
function replaceRequired(source: string, search: string, replacement: string, filePath: string): string {
    const first = source.indexOf(search);
    const second = first < 0 ? -1 : source.indexOf(search, first + search.length);
    if (first < 0 || second >= 0) throw new Error(`pi-ai runtime import 形状变化：${filePath}`);
    return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

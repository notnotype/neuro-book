/**
 * 包的依赖边界（packages/nb-markdown/AGENTS.md）：纯 TS 入口（`src/` 根上的文件）只引 `entities`，后端的字数也用它；
 * 全包不引宿主的源码（`nbook/…` 应用别名、跨包相对路径）与插件内核；源码里 import 的第三方包都要在 package.json 里声明
 * （仓库根目录把依赖全部提升，漏声明时本机照样能跑）。扫描的写法见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const PACKAGE_JSON = JSON.parse(readFileSync(join(SOURCE_ROOT, "..", "package.json"), "utf8")) as {dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; devDependencies?: Record<string, string>};

/** 包名本身与它的子路径：`@tiptap/pm` 也认 `@tiptap/pm/model`。 */
const exactly = (name: string): RegExp => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/.*)?$`, "u");
const DECLARED = Object.keys({...PACKAGE_JSON.dependencies, ...PACKAGE_JSON.peerDependencies}).map(exactly);
/** 只给类型检查用的（端口的类型断言引 nb-agent-ui）：只许 `import type`。 */
const DEV_ONLY = Object.keys(PACKAGE_JSON.devDependencies ?? {}).map(exactly);

/** 纯 TS 入口：`src/` 根上的文件；它们之间互相引用，不引子目录。 */
const coreFiles = readdirSync(SOURCE_ROOT, {withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")).map((entry) => join(SOURCE_ROOT, entry.name));

/** 纯 TS 子路径 `./prompt-text` 的入口与它引到的文件（服务端认 `$` 标签用）：与纯 TS 入口同样的规则。 */
const promptTextFiles = ["text.ts", "prompt-text.ts", "prompt-selection.ts", "prompt-editor.types.ts"].map((name) => join(SOURCE_ROOT, "prompt", name));

/**
 * 纯 TS 子路径 `./marked`（不带编辑器的词法，世界引擎内核在后端与浏览器里都引它）：`src/marked/` 下的文件，加上它们引到的
 * `language/syntax/tags.ts`（只引 `markdown-dialect.ts`）。运行时只许引 `marked`、`marked-cjk-friendly`、`entities`。
 */
const MARKED_ROOT = join(SOURCE_ROOT, "marked");
const markedFiles = [...readdirSync(MARKED_ROOT).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => join(MARKED_ROOT, name)), join(SOURCE_ROOT, "language", "syntax", "tags.ts")];
const marked: ImportRule = {packages: [/^marked$/u, /^marked-cjk-friendly$/u, /^entities$/u], within: SOURCE_ROOT};

/** `@notnotype/nb-ui/text` 是文字值的纯数据层（docs/specs/ui/i18n.md），没有外部依赖、不引 Vue 与 DOM。 */
const core: ImportRule = {packages: [/^entities$/u, /^@notnotype\/nb-ui\/text$/u], typeOnly: [/^@tiptap\//u, /^marked$/u], within: SOURCE_ROOT};

/** `files` 里不满足 `allowed`（按解析后的路径判断）的相对导入。 */
function relativeImportsOutside(files: readonly string[], allowed: (target: string) => boolean): string[] {
    return files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*"(\.[^"]*)"/gu)]
        .map((match) => match[1]!)
        .filter((specifier) => !allowed(resolve(dirname(file), specifier)))
        .map((specifier) => `${file}: ${specifier}`));
}

describe("包的导入", () => {
    it("纯 TS 入口只引 entities、nb-ui 的纯数据层与 src 根上的文件，编辑内核只许 import type", () => {
        expect(scanImports(coreFiles, core)).toEqual([]);
        // 相对导入解析后要正好是 src 根上的文件：`./host`、`./language` 这类目录入口与 `./chip/chip` 都算子目录。
        const intoSubdirectories = coreFiles.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*"(\.[^"]*)"/gu)]
            .map((match) => match[1]!)
            .filter((specifier) => {
                const target = resolve(dirname(file), specifier);
                return dirname(target) !== SOURCE_ROOT || (existsSync(target) && statSync(target).isDirectory());
            })
            .map((specifier) => `${file}: ${specifier}`));
        expect(intoSubdirectories).toEqual([]);
    });

    it("纯 TS 子路径 prompt-text 同样只引 entities 与 nb-ui 的纯数据层，相对导入只到 src 根上的文件与它自己的几份", () => {
        expect(scanImports(promptTextFiles, core)).toEqual([]);
        const allowed = (target: string): boolean => (dirname(target) === SOURCE_ROOT && !(existsSync(target) && statSync(target).isDirectory())) || promptTextFiles.includes(`${target}.ts`) || promptTextFiles.includes(target);
        expect(relativeImportsOutside(promptTextFiles, allowed)).toEqual([]);
    });

    it("纯 TS 子路径 marked 只引 marked、marked-cjk-friendly、entities，相对导入只到 src/marked、src 根上的文件与 tags.ts", () => {
        expect(scanImports(markedFiles, marked)).toEqual([]);
        const allowed = (target: string): boolean => markedFiles.includes(`${target}.ts`) || markedFiles.includes(target) || (dirname(target) === SOURCE_ROOT && !(existsSync(target) && statSync(target).isDirectory()));
        expect(relativeImportsOutside(markedFiles, allowed)).toEqual([]);
    });

    it("全包只引 package.json 里声明的包与本包的文件（宿主源码与插件内核都不在声明里），开发依赖只许 import type", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT), {packages: DECLARED, typeOnly: DEV_ONLY, within: SOURCE_ROOT})).toEqual([]);
    });
});

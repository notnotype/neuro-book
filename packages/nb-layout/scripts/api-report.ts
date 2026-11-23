#!/usr/bin/env bun
/**
 * nb-layout 的 API 报告（w00026 t48 计划第 4 稿“API 报告”）。每个发布入口一份 `api/<入口>.api.txt`，入库作对照：
 *
 * - `bun run api:report`：先 `build:package`，再读 `dist/package` 的声明写报告。
 * - `bun run api:check`：同样先构建（`--no-build` 跳过，CI 在 `build:package` 之后用），生成一份与 `api/` 比；有差异就失败。
 *
 * 公开面怎么读见 `api-surface.ts`（非组件）与 `api-components.ts`（组件）。报告头记生成它的工具版本：Vue 或 TypeScript 升级会让
 * 报告整批变化，头不同时单独提示，好和真改动分开看。
 */

import {readFileSync} from "node:fs";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join, relative} from "node:path";

import ts from "typescript";
import {createChecker} from "vue-component-meta";

import {componentSurface, componentTypeTexts, type ComponentSurface} from "./api-components";
import {byCodeUnit, readSurface, type EntrySurface, type Surface, type SurfaceProblem} from "./api-surface";
import {componentTags} from "./component-tags";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "../..");
const DIST = join(PACKAGE_ROOT, "dist/package");
const API_DIR = join(PACKAGE_ROOT, "api");

/** 发布入口：报告文件名与子路径，同 `pack.ts` 的 `ENTRIES`。 */
const ENTRIES = [
    {name: "index", subpath: "."},
    {name: "vue", subpath: "./vue"},
    {name: "text", subpath: "./text"},
    {name: "locales", subpath: "./locales"},
] as const;

const HEADER_PREFIX = "// tool ";
/** 这几个名字是快照格式：变了要同批核对工作台层的 `LAYOUT_DOC_VERSION` 与迁移（ADR 0054 第 10 条）。 */
const SNAPSHOT_NAMES = /^(?:GridSnapshot\w*|GRID_SNAPSHOT_VERSION)$/u;

/** 工具版本，每个按自己的包解析：vue-tsc 与 vue-component-meta 用的 TypeScript 可能和报告脚本的不是同一份。 */
export function toolVersions(): string[] {
    const here = createRequire(import.meta.url);
    const version = (require: NodeJS.Require, name: string): string => (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as {version: string}).version;
    const from = (name: string) => createRequire(here.resolve(`${name}/package.json`));
    return [
        `typescript ${version(here, "typescript")} (report)`,
        `vue-tsc ${version(here, "vue-tsc")}`,
        `typescript ${version(from("vue-tsc"), "typescript")} (vue-tsc)`,
        `vue-component-meta ${version(here, "vue-component-meta")}`,
        `typescript ${version(from("vue-component-meta"), "typescript")} (vue-component-meta)`,
        `rolldown-plugin-dts ${version(here, "rolldown-plugin-dts")}`,
        `vue ${version(here, "vue")}`,
    ].map((line) => `${HEADER_PREFIX}${line}`);
}

/** 类型文字里的绝对路径换成包名（`node_modules` 之后的部分）或去掉包目录前缀：报告不随检出位置变。 */
export function rewritePaths(text: string, roots: readonly string[]): string {
    let result = text.replace(/import\("[^"]*\/node_modules\/([^"]+)"\)/gu, 'import("$1")');
    for (const root of roots) result = result.split(`${root}/`).join("");
    return result;
}

export function formatEntry(subpath: string, entry: EntrySurface, components: ReadonlyMap<string, ComponentSurface>, header: readonly string[]): string {
    const lines: string[] = [`// API 报告：@notnotype/nb-layout${subpath === "." ? "" : subpath.slice(1)}（bun run api:report 生成，不手改）`, ...header, ""];
    for (const item of entry.names) {
        lines.push(`### ${item.stability ?? "untagged"} ${item.kind} ${item.name}${item.deprecated ? " @deprecated" : ""}`);
        const component = components.get(item.name);
        lines.push(...referenceLines(item), ...(component === undefined ? item.declarations : componentLines(component)), "");
    }
    if (entry.unexported.length > 0) {
        lines.push("## 由公开名字引到、没有导出的声明", "");
        for (const item of entry.unexported) lines.push(`### ${item.kind} ${item.name}`, ...referenceLines(item), ...item.declarations, "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
}

/** “引用”行：公开名字一行，没导出的另一行（SDK 的快照沿两行取闭包）。 */
function referenceLines(item: {readonly references: readonly string[]; readonly unexportedReferences: readonly string[]}): string[] {
    return [...(item.references.length > 0 ? [`引用：${item.references.join(", ")}`] : []), ...(item.unexportedReferences.length > 0 ? [`引用（没导出）：${item.unexportedReferences.join(", ")}`] : [])];
}

function componentLines(component: ComponentSurface): string[] {
    const section = (title: string, items: readonly string[]) => (items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `  ${item}`)]);
    return [...section("props", component.props), ...section("attrs", component.attrs), ...section("events", component.events), ...section("slots", component.slots), ...section("exposed", component.exposed)];
}

type Segment = {readonly stability: string; readonly text: string};

/** 拆出头与按名字的段（`### <标注> <种类> <名字>` 起头）。 */
export function parseReport(text: string): {header: string[]; body: string; segments: Map<string, Segment>} {
    const lines = text.split("\n");
    const header = lines.filter((line) => line.startsWith(HEADER_PREFIX));
    const bodyLines = lines.filter((line) => !line.startsWith(HEADER_PREFIX));
    const segments = new Map<string, Segment>();
    let current: {name: string; stability: string; lines: string[]} | null = null;
    const flush = () => {
        if (current !== null) segments.set(current.name, {stability: current.stability, text: current.lines.join("\n").trimEnd()});
    };
    for (const line of bodyLines) {
        const head = /^### (\S+) \S+ (\S+)/u.exec(line);
        if (head !== null || line.startsWith("## ")) {
            flush();
            current = head === null ? null : {name: head[2]!, stability: head[1]!, lines: [line]};
        } else if (current !== null) {
            current.lines.push(line);
        }
    }
    flush();
    return {header, body: bodyLines.join("\n"), segments};
}

/** `CHANGELOG.md` 的 `[Unreleased]` 一节。 */
export function unreleased(changelog: string): string {
    const start = changelog.indexOf("## [Unreleased]");
    if (start === -1) return "";
    const next = changelog.indexOf("\n## [", start + 1);
    return changelog.slice(start, next === -1 ? undefined : next);
}

export type ReportComparison = {
    readonly headerChanged: boolean;
    readonly changedNames: readonly string[];
    readonly errors: readonly string[];
    readonly hints: readonly string[];
};

/**
 * 比一个入口的旧报告与新报告。正文有差异就算失败（报告是入库的对照）；差异涉及新旧任一侧带 `@stable` 的名字时（含降级与删除），
 * 另要求 `[Unreleased]` 里有一条提到这个名字的记录。
 */
export function compareReport(file: string, before: string | null, after: string, changelog: string): ReportComparison {
    const old = parseReport(before ?? "");
    const next = parseReport(after);
    const headerChanged = before !== null && old.header.join("\n") !== next.header.join("\n");
    const names = [...new Set([...old.segments.keys(), ...next.segments.keys()])].sort(byCodeUnit);
    const changedNames = before === null ? names : names.filter((name) => old.segments.get(name)?.text !== next.segments.get(name)?.text);
    const errors: string[] = [];
    const hints: string[] = [];
    if (before === null) errors.push(`${file}: missing; run bun run api:report`);
    else if (old.body !== next.body) errors.push(`${file}: public surface changed (${changedNames.join(", ") || "unexported declarations"}); review, then run bun run api:report`);
    const notes = unreleased(changelog);
    for (const name of changedNames) {
        const stable = old.segments.get(name)?.stability === "stable" || next.segments.get(name)?.stability === "stable";
        if (stable && before !== null && !notes.includes(`\`${name}\``)) errors.push(`${file}: @stable ${name} changed; CHANGELOG.md [Unreleased] must have an entry naming \`${name}\``);
        if (SNAPSHOT_NAMES.test(name)) hints.push(`${file}: ${name} changed; check the workbench layer's LAYOUT_DOC_VERSION and its migration (ADR 0054 item 10)`);
    }
    if (headerChanged) hints.push(`${file}: toolchain versions changed; the regenerated report belongs in its own commit`);
    return {headerChanged, changedNames, errors, hints};
}

async function build(): Promise<void> {
    const child = Bun.spawn(["bun", join(PACKAGE_ROOT, "scripts/pack.ts")], {cwd: PACKAGE_ROOT, stdout: "inherit", stderr: "inherit"});
    if ((await child.exited) !== 0) throw new Error("build:package failed");
}

/** 读产物，出四份报告；有错误（缺标注、闭包、交叉核对不一致）时抛出。 */
export async function generate(): Promise<Map<string, string>> {
    const files = (await readdir(DIST)).filter((name) => name.endsWith(".d.ts")).map((name) => join(DIST, name));
    const program = ts.createProgram(files, {noEmit: true, strict: true, skipLibCheck: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext, types: []});
    // 入口清单在 `pack.ts` 里另有一份：发布的子路径和这里的对不上时（加了第五个入口），宁可报错也不少出一份报告。
    const published = Object.keys((JSON.parse(await readFile(join(DIST, "package.json"), "utf8")) as {exports: Record<string, unknown>}).exports).filter((subpath) => subpath !== "./style.css").sort(byCodeUnit);
    const known = ENTRIES.map((entry) => entry.subpath as string).sort(byCodeUnit);
    if (published.join("\n") !== known.join("\n")) throw new Error(`published entries ${published.join(", ")} differ from the report's ${known.join(", ")}; update ENTRIES in api-report.ts`);
    const tags = componentTags(await readFile(join(PACKAGE_ROOT, "src/vue/index.ts"), "utf8"));
    const problems: SurfaceProblem[] = [];

    const meta = createChecker(join(PACKAGE_ROOT, "tsconfig.vue.json"), {schema: false, forceUseTs: true, noDeclarations: false});
    const ownSource = (file: string) => file.startsWith(join(PACKAGE_ROOT, "src") + "/");
    const components = new Map<string, ComponentSurface>();
    for (const name of tags.keys()) {
        const file = join(PACKAGE_ROOT, `src/vue/${name}.vue`);
        components.set(name, componentSurface(meta.getComponentMeta(file), file, ownSource));
    }
    const surface: Surface = readSurface(program, new Map(ENTRIES.map((entry) => [entry.name, join(DIST, `${entry.name}.d.ts`)])), new Map([...components].map(([name, component]) => [name, componentTypeTexts(component)])));
    problems.push(...surface.problems);
    for (const [name, component] of components) {
        const declared = declaredProps(program, join(DIST, "vue.d.ts"), name);
        const missing = component.propNames.filter((prop) => !declared.has(prop));
        if (missing.length > 0) problems.push({severity: "error", name, message: `props from the source are missing on the published declaration's $props: ${missing.join(", ")}`});
    }

    for (const problem of problems) console.error(`${problem.severity}: ${problem.name}: ${problem.message}`);
    const errors = problems.filter((problem) => problem.severity === "error");
    if (errors.length > 0) throw new Error(`api report: ${errors.length} error(s)`);

    const header = toolVersions();
    const reports = new Map<string, string>();
    for (const entry of ENTRIES) {
        const read = surface.entries.find((item) => item.entry === entry.name)!;
        reports.set(`${entry.name}.api.txt`, rewritePaths(formatEntry(entry.subpath, read, components, header), [PACKAGE_ROOT, REPO_ROOT]));
    }
    return reports;
}

/** 发布声明里组件实例类型 `$props` 上的名字。 */
function declaredProps(program: ts.Program, file: string, name: string): Set<string> {
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file)!;
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).find((symbol) => symbol.name === name);
    if (exported === undefined) throw new Error(`${name} is not exported from vue.d.ts`);
    const type = checker.getTypeOfSymbolAtLocation(exported, source);
    const instance = type.getConstructSignatures()[0]?.getReturnType();
    const props = instance?.getProperty("$props");
    if (props === undefined) throw new Error(`${name} has no $props on its instance type`);
    return new Set(checker.getTypeOfSymbolAtLocation(props, source).getProperties().map((property) => property.name));
}

async function main(argv: readonly string[]): Promise<number> {
    const [command, ...rest] = argv;
    const noBuild = rest.includes("--no-build");
    const unknown = rest.filter((arg) => arg !== "--no-build");
    if ((command !== "report" && command !== "check") || unknown.length > 0) throw new Error("usage: api-report.ts report|check [--no-build]");
    if (!noBuild) await build();
    const reports = await generate();
    if (command === "report") {
        await mkdir(API_DIR, {recursive: true});
        for (const [name, text] of reports) await writeFile(join(API_DIR, name), text);
        console.log(`wrote ${relative(PACKAGE_ROOT, API_DIR)}/ (${reports.size} reports)`);
        return 0;
    }
    const changelog = await readFile(join(PACKAGE_ROOT, "CHANGELOG.md"), "utf8");
    const scratch = await mkdtemp(join(tmpdir(), "nb-layout-api-"));
    try {
        let failed = false;
        for (const [name, text] of reports) {
            await writeFile(join(scratch, name), text);
            // 换行按 LF 比：`.gitattributes` 已固定 LF，这里再兜一层，免得别的工具改写了换行时报一整份差异。
            const before = await readFile(join(API_DIR, name), "utf8").then((text) => text.replace(/\r\n/gu, "\n")).catch((error: unknown) => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
                throw error;
            });
            const result = compareReport(`api/${name}`, before, text, changelog);
            for (const hint of result.hints) console.log(`note: ${hint}`);
            for (const error of result.errors) console.error(`error: ${error}`);
            if (result.errors.length > 0) {
                failed = true;
                const diff = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", join(API_DIR, name), join(scratch, name)], {stdout: "pipe"});
                console.error(diff.stdout.toString());
            }
        }
        if (!failed) console.log("api reports are up to date");
        return failed ? 1 : 0;
    } finally {
        await rm(scratch, {recursive: true, force: true});
    }
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

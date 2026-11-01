/**
 * 消息目录的检查（docs/specs/ui/i18n.md 的“目录检查”）：由 `governance:check` 调用，本地与 CI 同一个检查。一组目录是
 * 一个命名空间在各语言下的目录文件，以源语言为准核对：
 *
 * - 各语言相对源语言的缺键与多余键（复数形按不带后缀的键比）；
 * - 同一个键在各语言的占位符 `{{name}}` 集合相同；占位只能是 `{{name}}` 与 `{{name, number}}`，别的 `{{…}}` 写法报错；
 * - 每种语言的复数形齐全：按这种语言的复数规则（`Intl.PluralRules`）要有的后缀都在，英文因此要有 `_one` 与 `_other`；
 * - 英文的 `_one` 与 `_other` 去掉数字与占位后不能相同（为了过上一条把 `_other` 抄一份，`1 items`）；
 * - 值不含 `$t(`，键不含 `:`（目录的格式规则，与安装检查同一套）；
 * - 给了闭合错误域的码表时，源语言目录的 `errors.<码>` 恰好覆盖全部码。
 *
 * 哪些目录要查：带 `l10n` 的插件清单（`package.json`）列出的目录，加上 `CATALOG_DIRECTORIES` 登记的、不经清单的目录
 * （宿主与内置插件的目录随前端构建，不写清单）。作者目录的 `package.json`（示例插件）只写 `l10n.source`，语言由 `locales/`
 * 里的文件得出，与构建预设的规则相同；产物与安装的清单另写 `l10n.locales`，按它列出的查。没有目录的插件没有要查的；`packages/` 下没登记的 `locales/*.json`
 * 报为未登记，免得新加的目录没人查。
 */

import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";

import {git} from "#scripts/ci/agent-governance-contract";
import {readChangeScopeArguments} from "#scripts/ci/change-scope";

/** 一组要查的目录：`catalogs` 是语言到目录文件内容（已解析的 JSON）。 */
export interface CatalogSet {
    /** 报告里用的名字，通常是目录所在的路径。 */
    readonly label: string;
    readonly source: string;
    readonly catalogs: Readonly<Record<string, unknown>>;
    /** 闭合错误域的码表：源语言目录的 `errors` 下要恰好是这些码。不给时不查。 */
    readonly closedCodes?: ReadonlyArray<string>;
}

/** 不经清单的目录：路径相对仓库根，`source` 是源语言。内置插件有了目录时登记在这里。 */
export interface CatalogDirectory {
    readonly path: string;
    readonly source: string;
    readonly closedCodes?: ReadonlyArray<string>;
}

export const CATALOG_DIRECTORIES: ReadonlyArray<CatalogDirectory> = [
    // 宿主自己的文字（命名空间 nbook.host），见 packages/neuro-book/src/web/host/text-engine.ts。
    {path: "packages/neuro-book/src/web/locales", source: "zh-CN"},
    // 作者模板的目录：模板的清单是 `_package.json`（create 时改名），不在上面按 package.json 找到的范围里。
    {path: "packages/neuro-book/plugin-sdk/template/locales", source: "zh-CN"},
    // 内置插件的目录（命名空间是插件 id），由 packages/neuro-book/src/web/plugins.ts 的 builtinPluginCatalogs 登记进窗口。
    {path: "packages/neuro-book/src/plugins/editor/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/explorer/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/html-preview/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/image-viewer/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/markdown/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/models/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/agent/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/plugins/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/projects/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/settings/locales", source: "zh-CN"},
    {path: "packages/neuro-book/src/plugins/workbench/locales", source: "zh-CN"},
];

// 只读的旧应用与历史记录不检查（同 test-conventions.ts）。
const SKIPPED_ROOTS: readonly string[] = ["packages/neuro-book-legacy/", "docs/archived/", ".agents/"];

/** CLDR 的复数类别：目录键 `<键>_<类别>` 是 `<键>` 的一种复数形。 */
const PLURAL_CATEGORIES: ReadonlySet<string> = new Set(["zero", "one", "two", "few", "many", "other"]);

/**
 * 支持的占位写法：`{{name}}` 与 `{{name, number}}`（逗号两边可以没有空格），与最小实现（`packages/nb-ui/src/text/minimal.ts` 的
 * `PLACEHOLDER`）相同。两个翻译器只在这两种写法上结果相同（docs/specs/ui/i18n.md 输出 9）：i18next 认的别的格式（`{{x, date}}`、
 * `{{- x}}`）最小实现原样留着，所以目录里一律不许写。前后紧挨着花括号的（`{{{x}}}`）也不算。
 */
const PLACEHOLDER = /(?<!\{)\{\{\s*(\w+)(?:\s*,\s*number)?\s*\}\}(?!\})/gu;

/** 去掉支持的占位之后还剩下的 `{{…}}` 写法。 */
function unsupportedPlaceholders(value: string): string[] {
    const rest = value.replace(PLACEHOLDER, "");
    const odd = [...rest.matchAll(/\{*\{\{[^{}]*\}\}\}*/gu)].map((match) => match[0]);
    if (odd.length === 0 && /\{\{|\}\}/u.test(rest)) return [rest];
    return odd;
}

/** 一种语言的目录展开后的样子：每个点号键的值与它归属的键（复数形归到不带后缀的键），复数键写了哪些类别。 */
interface Flattened {
    readonly strings: ReadonlyMap<string, {readonly value: string; readonly key: string}>;
    readonly plurals: ReadonlyMap<string, ReadonlySet<string>>;
    readonly problems: ReadonlyArray<string>;
}

/** 返回问题列表，空表示通过。每条以 `<label>/<语言>.json` 开头，写出键路径。 */
export function catalogFailures(set: CatalogSet): string[] {
    const failures: string[] = [];
    const where = (locale: string) => `${set.label}/${locale}.json`;
    if (!(set.source in set.catalogs)) return [`${where(set.source)}：缺源语言目录`];
    const flattened = new Map<string, Flattened>();
    for (const [locale, catalog] of Object.entries(set.catalogs)) {
        const flat = flatten(catalog);
        flattened.set(locale, flat);
        failures.push(...flat.problems.map((problem) => `${where(locale)}：${problem}`));
    }
    const source = flattened.get(set.source)!;
    const sourceKeys = keysOf(source);
    const sourcePlaceholders = placeholdersOf(source);
    for (const [locale, flat] of flattened) {
        const keys = keysOf(flat);
        if (locale !== set.source) {
            for (const key of sourceKeys) if (!keys.has(key)) failures.push(`${where(locale)}：缺键 ${key}（源语言 ${set.source} 有）`);
            for (const key of keys) if (!sourceKeys.has(key)) failures.push(`${where(locale)}：多余的键 ${key}（源语言 ${set.source} 没有）`);
            const placeholders = placeholdersOf(flat);
            for (const [key, names] of placeholders) {
                const expected = sourcePlaceholders.get(key);
                if (expected !== undefined && !sameSet(names, expected)) failures.push(`${where(locale)}：${key} 的占位符 {${[...names].sort().join(", ")}} 与源语言的 {${[...expected].sort().join(", ")}} 不一致`);
            }
        }
        failures.push(...pluralFailures(locale, flat).map((problem) => `${where(locale)}：${problem}`));
    }
    if (set.closedCodes !== undefined) {
        const codes = new Set(set.closedCodes);
        const written = new Set([...sourceKeys].filter((key) => key.startsWith("errors.")).map((key) => key.slice("errors.".length)));
        for (const code of codes) if (!written.has(code)) failures.push(`${where(set.source)}：闭合码 ${code} 没有文案 errors.${code}`);
        for (const code of written) if (!codes.has(code)) failures.push(`${where(set.source)}：errors.${code} 不在码表里`);
    }
    return failures;
}

/** 仓库里全部要查的目录的问题；空表示通过。 */
export function messageCatalogFailures(repoRoot: string, directories: ReadonlyArray<CatalogDirectory> = CATALOG_DIRECTORIES): string[] {
    const files = git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter((path) => path !== "" && !SKIPPED_ROOTS.some((root) => path.startsWith(root)));
    const failures: string[] = [];
    const covered = new Set<string>();
    const sets: Array<{readonly directory: string; readonly source: string; readonly locales: ReadonlyArray<string> | null; readonly closedCodes?: ReadonlyArray<string>}> = [];
    for (const directory of directories) sets.push({directory: directory.path, source: directory.source, locales: null, ...(directory.closedCodes === undefined ? {} : {closedCodes: directory.closedCodes})});
    for (const path of files.filter((file) => file.startsWith("packages/") && (file.endsWith("/package.json")))) {
        const manifest = readJson(join(repoRoot, path));
        if (!manifest.ok) {
            // 解析不了的 package.json 由安装、构建与包管理器报告；这里只关心写了 l10n 的。
            continue;
        }
        const l10n = (manifest.value as {l10n?: unknown} | null)?.l10n;
        if (l10n === undefined) continue;
        const {source, locales} = (l10n ?? {}) as {source?: unknown; locales?: unknown};
        if (typeof source !== "string" || (locales !== undefined && (!Array.isArray(locales) || !locales.every((locale) => typeof locale === "string")))) {
            failures.push(`${path}：l10n 要写 source；写了 locales 时要是语言标签的数组`);
            continue;
        }
        // 没写 locales 的是作者目录的 package.json：按目录里的文件查（见文件头）。
        sets.push({directory: join(dirname(path), "locales"), source, locales: locales === undefined ? null : locales as string[]});
    }
    for (const set of sets) {
        const inDirectory = files.filter((file) => dirname(file) === set.directory && file.endsWith(".json"));
        // 登记的目录在这个仓库里不存在（例如治理检查自己的测试搭的临时仓库）时没有要查的。
        if (set.locales === null && inDirectory.length === 0) continue;
        const locales = set.locales ?? inDirectory.map((file) => file.slice(set.directory.length + 1, -".json".length));
        const catalogs: Record<string, unknown> = {};
        for (const locale of locales) {
            const file = join(set.directory, `${locale}.json`);
            covered.add(file);
            if (!existsSync(join(repoRoot, file))) {
                failures.push(`${file}：目录文件不存在`);
                continue;
            }
            const read = readJson(join(repoRoot, file));
            if (!read.ok) failures.push(`${file}：不是合法的 JSON：${read.message}`);
            else catalogs[locale] = read.value;
        }
        for (const file of inDirectory) {
            if (covered.has(file)) continue;
            covered.add(file);
            failures.push(`${file}：清单的 l10n.locales 没有列出这种语言`);
        }
        if (Object.keys(catalogs).length === locales.length) failures.push(...catalogFailures({label: set.directory, source: set.source, catalogs, ...(set.closedCodes === undefined ? {} : {closedCodes: set.closedCodes})}));
    }
    for (const file of files) {
        // `locales/` 只能是一层 `<语言>.json`（SDK 构建预设同样拒绝）；子目录里的文件不进语言集合，单独报。
        if (file.startsWith("packages/") && /\/locales\/[^/]+\/.+\.json$/u.test(file) && !SKIPPED_ROOTS.some((root) => file.startsWith(root))) {
            failures.push(`${file}：locales/ 下不能有子目录（目录文件只能是 locales/<语言>.json 一层）`);
            continue;
        }
        if (!file.startsWith("packages/") || !/\/locales\/[^/]+\.json$/u.test(file) || covered.has(file)) continue;
        failures.push(`${file}：目录没有登记（插件清单写 l10n，或登记进 scripts/ci/message-catalogs.ts 的 CATALOG_DIRECTORIES）`);
    }
    return failures;
}

function readJson(path: string): {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly message: string} {
    try {
        return {ok: true, value: JSON.parse(readFileSync(path, "utf8"))};
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return {ok: false, message: error.message};
    }
}

/**
 * 展开成点号键。复数形只认同一层里也写了 `_other` 的：`count_one` 旁边没有 `count_other` 时它是普通键，
 * 这样 `step_two` 这类名字不会被误当成复数。
 */
function flatten(catalog: unknown): Flattened {
    const strings = new Map<string, {readonly value: string; readonly key: string}>();
    const plurals = new Map<string, Set<string>>();
    const problems: string[] = [];
    if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) return {strings, plurals, problems: ["目录的根必须是对象"]};
    const pending: Array<{readonly prefix: string; readonly value: object}> = [{prefix: "", value: catalog}];
    while (pending.length > 0) {
        const current = pending.shift()!;
        const entries = Object.entries(current.value);
        const siblings = new Set(entries.map(([key]) => key));
        for (const [key, item] of entries) {
            const path = `${current.prefix}${key}`;
            if (key.includes(":")) problems.push(`${path}：键不能含 :`);
            if (typeof item === "string") {
                if (item.includes("$t(")) problems.push(`${path}：值不能含 $t(`);
                for (const odd of unsupportedPlaceholders(item)) problems.push(`${path}：不支持的占位写法 ${odd}（只能写 {{name}} 与 {{name, number}}）`);
                const plural = pluralOf(key, siblings);
                if (plural === null) {
                    strings.set(path, {value: item, key: path});
                } else {
                    const base = `${current.prefix}${plural.base}`;
                    strings.set(path, {value: item, key: base});
                    let categories = plurals.get(base);
                    if (categories === undefined) plurals.set(base, (categories = new Set()));
                    categories.add(plural.category);
                }
            } else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                pending.push({prefix: `${path}.`, value: item});
            } else {
                problems.push(`${path}：值必须是字符串或嵌套的对象`);
            }
        }
    }
    return {strings, plurals, problems};
}

function pluralOf(key: string, siblings: ReadonlySet<string>): {readonly base: string; readonly category: string} | null {
    const at = key.lastIndexOf("_");
    if (at <= 0) return null;
    const base = key.slice(0, at);
    const category = key.slice(at + 1);
    if (!PLURAL_CATEGORIES.has(category) || !siblings.has(`${base}_other`)) return null;
    return {base, category};
}

/** 用来比较各语言的键：复数形换成不带后缀的键。 */
function keysOf(flat: Flattened): Set<string> {
    return new Set([...flat.strings.values()].map((entry) => entry.key));
}

/** 每个键（复数形合并到不带后缀的键）的占位符名。 */
function placeholdersOf(flat: Flattened): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const {value, key} of flat.strings.values()) {
        let names = result.get(key);
        if (names === undefined) result.set(key, (names = new Set()));
        for (const match of value.matchAll(PLACEHOLDER)) names.add(match[1]!);
    }
    return result;
}

function pluralFailures(locale: string, flat: Flattened): string[] {
    let required: ReadonlyArray<string>;
    try {
        required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    } catch (error) {
        // 标签不合法时 PluralRules 抛 RangeError：这就是要报的问题本身。
        if (!(error instanceof RangeError)) throw error;
        return [`语言标签不合法：${locale}`];
    }
    const failures: string[] = [];
    // 只比英文：别的语言的单数可能本来就与复数同形。
    const english = locale === "en" || locale.startsWith("en-");
    for (const [base, categories] of flat.plurals) {
        const missing = required.filter((category) => !categories.has(category));
        if (missing.length > 0) failures.push(`复数键 ${base} 缺 ${missing.map((category) => `_${category}`).join("、")}（${locale} 的复数规则要有）`);
        const one = flat.strings.get(`${base}_one`)?.value;
        const other = flat.strings.get(`${base}_other`)?.value;
        if (english && one !== undefined && other !== undefined && withoutNumbers(one) === withoutNumbers(other)) {
            failures.push(`复数键 ${base} 的 _one 与 _other 去掉数字后相同：单数要写对（1 item）；单复数写法相同时只写不带后缀的键 ${base}`);
        }
    }
    return failures;
}

/** 去掉占位与数字：`{{count}} items` 与 `1 items` 得到同一个结果。 */
function withoutNumbers(value: string): string {
    return value.replace(/\{\{[^{}]*\}\}/gu, "").replace(/\d/gu, "");
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    return left.size === right.size && [...left].every((item) => right.has(item));
}

// 单独运行：`bun scripts/ci/message-catalogs.ts [--repo-root <目录>]`，有问题时逐条打印并以 1 退出。
if (import.meta.main) {
    const {repoRoot} = readChangeScopeArguments(import.meta.url);
    const failures = messageCatalogFailures(repoRoot);
    for (const failure of failures) console.error(failure);
    if (failures.length > 0) process.exitCode = 1;
}

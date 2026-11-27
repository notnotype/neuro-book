/**
 * 隐私政策与服务条款的正文（t10 计划 3.11；审定 D6 与“B9 开工前的调整”）：`src/legal/<语言>/*.md` 在构建时由这里转成 HTML，
 * 页面导入 `.md` 得到 `{version, html}`（`src/legal/document.ts`）。Markdown 库只在构建时用，不进浏览器的包
 * （`tests/build.test.ts` 按来源查）。
 *
 * 正文文件的头部是 front matter，只认两项：
 *
 * - `version: YYYY-MM-DD`：条款版本，必须是真实存在的日期。所有正文共用一个版本（`site.accounts` 的条款版本，
 *   服务条款与隐私政策共用），不一致时任何构建都失败。上线时它要等于服务端的 `NB_SITE_IDENTITY_TERMS_VERSION`（B10 的冒烟核对）。
 * - `placeholder: true`：正文还是占位。条款文字来了删掉这一行。设了 `NB_SITE_RELEASE=1` 的发布构建遇到占位正文就失败；
 *   不设时照常构建、页面显示占位正文（浏览器场景与 CI 的镜像构建都是生产构建，照计划原文拦所有生产构建会一直失败到文字来）。
 *
 * 正文里的标题从 `##` 起：页面自己画一级标题（取文字目录里的页名，与标签页标题一致），正文再写一级标题就成了两个。
 *
 * 检查放在 `buildStart`：不论这一次构建有没有走到那两页的块，都先查全部正文，发布构建一开始就失败并列出是哪几份文件。
 */

import {readdir, readFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";

import {marked} from "marked";
import type {Token, Tokens} from "marked";
import type {Plugin} from "vite";

import type {LegalDocument} from "../src/legal/document";

/** 一份正文读出来的样子。 */
export interface LegalSource {
    readonly version: string;
    readonly placeholder: boolean;
    /** front matter 之后的 Markdown。 */
    readonly body: string;
}

/** 正文文件本身写得不对（缺 front matter、版本不是日期、有一级标题）。消息里带着文件名。 */
export class LegalDocumentError extends Error {
    override readonly name = "LegalDocumentError";
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** 形如 `2026-11-20` 且真有这一天（`2026-02-30` 不算）。 */
function isRealDate(value: string): boolean {
    if (!DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 正文里任何一层的一级标题（列表、引用里的也算）。 */
function hasTopHeading(tokens: Token[]): boolean {
    let found = false;
    marked.walkTokens(tokens, (token) => {
        if (token.type === "heading" && (token as Tokens.Heading).depth === 1) found = true;
    });
    return found;
}

/** 读一份正文。`label` 是报错时写的文件名。 */
export function parseLegalDocument(text: string, label: string): LegalSource {
    const normalized = text.replace(/\r\n?/gu, "\n");
    const match = FRONT_MATTER.exec(normalized);
    if (match === null) throw new LegalDocumentError(`${label}：开头没有 front matter（--- 包着的 version 等几行）`);
    let version: string | undefined;
    let placeholder = false;
    for (const line of match[1]!.split("\n")) {
        if (line.trim() === "") continue;
        const pair = /^([a-z]+):\s*(.*?)\s*$/u.exec(line);
        if (pair === null) throw new LegalDocumentError(`${label}：front matter 里读不懂这一行：${line}`);
        const [, key, value] = pair as unknown as [string, string, string];
        if (key === "version") version = value;
        else if (key === "placeholder" && value === "true") placeholder = true;
        else throw new LegalDocumentError(`${label}：front matter 只认 version 与 placeholder: true，这一行不认：${line}`);
    }
    if (version === undefined || !isRealDate(version)) throw new LegalDocumentError(`${label}：version 要写成真实存在的日期 YYYY-MM-DD，现在是 ${version ?? "（没写）"}`);
    const body = normalized.slice(match[0].length);
    if (hasTopHeading(marked.lexer(body))) throw new LegalDocumentError(`${label}：正文的标题从 ## 起，一级标题由页面画`);
    return {version, placeholder, body};
}

/** 几份正文合起来能不能用于这次构建；能用时回空数组。 */
export function legalProblems(documents: readonly {readonly label: string; readonly source: LegalSource}[], release: boolean): string[] {
    const problems: string[] = [];
    if (new Set(documents.map(({source}) => source.version)).size > 1) {
        problems.push(`几份正文的版本不一样，要共用一个：${documents.map(({label, source}) => `${label} 是 ${source.version}`).join("，")}`);
    }
    if (release) {
        for (const {label, source} of documents) if (source.placeholder) problems.push(`${label}：发布构建（NB_SITE_RELEASE=1）不收占位正文，换成定稿的文字并删掉 placeholder 那一行`);
    }
    return problems;
}

/** 这次是不是发布构建：`NB_SITE_RELEASE` 只认 `1`；没设或空着不是；别的值直接报错，免得写成 `true` 时悄悄放过占位正文。 */
export function isReleaseBuild(env: Readonly<Record<string, string | undefined>>): boolean {
    const value = env.NB_SITE_RELEASE;
    if (value === undefined || value === "") return false;
    if (value === "1") return true;
    throw new Error(`NB_SITE_RELEASE 只认 1（发布构建）或不设，现在是 ${JSON.stringify(value)}`);
}

export interface LegalDocumentsOptions {
    /** 正文的根目录，下面一层是语言目录（`src/legal`）。 */
    readonly root: string;
    readonly release: boolean;
}

/** 构建时把正文转成 HTML 的 Vite 插件，并在构建开始时查全部正文（见文件头）。 */
export function legalDocuments(options: LegalDocumentsOptions): Plugin {
    const root = resolve(options.root);
    // 报错里的文件名从根目录的上两级起写（根是 `src/legal` 时就是包根），写成 `src/legal/zh-CN/privacy.md`。
    const labelOf = (file: string): string => relative(dirname(dirname(root)), file);
    const isDocument = (file: string): boolean => file.endsWith(".md") && dirname(dirname(file)) === root;

    return {
        name: "nb-site-legal-documents",
        enforce: "pre",
        async buildStart() {
            const files = (await readdir(root, {recursive: true})).map((name) => join(root, name)).filter(isDocument).sort();
            const documents: {label: string; source: LegalSource}[] = [];
            const problems: string[] = [];
            for (const file of files) {
                this.addWatchFile(file);
                try {
                    documents.push({label: labelOf(file), source: parseLegalDocument(await readFile(file, "utf8"), labelOf(file))});
                } catch (error) {
                    if (!(error instanceof LegalDocumentError)) throw error;
                    problems.push(error.message);
                }
            }
            if (files.length === 0) problems.push(`${root} 下没有正文`);
            problems.push(...legalProblems(documents, options.release));
            if (problems.length > 0) this.error(`条款正文不能用于这次构建：\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
        },
        transform(code, id) {
            const file = id.split("?", 1)[0]!;
            if (!isDocument(file)) return null;
            const source = parseLegalDocument(code, labelOf(file));
            // 正文是仓库自己的文件，转出来的 HTML 原样交给页面的 `v-html`（`src/pages/legal/LegalPage.vue`）。
            const document: LegalDocument = {version: source.version, html: marked.parse(source.body, {async: false})};
            return {code: `export default ${JSON.stringify(document)};`, map: null};
        },
    };
}

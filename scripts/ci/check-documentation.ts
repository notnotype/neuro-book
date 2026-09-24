#!/usr/bin/env bun
import {existsSync, lstatSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {posix} from "node:path";
import type {Nodes, Root} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import GithubSlugger from "github-slugger";
import {parse as parseYaml} from "yaml";

import {defaultRepoRoot, git} from "#scripts/ci/agent-governance-contract";

export type DocumentationCheckReport = {
    failures: string[];
    checkedFiles: number;
};

const REQUIRED_DOC_INDEXES = [
    "docs/specs/README.md",
    "docs/standards/README.md",
    "docs/standards/code/README.md",
    "docs/proposals/README.md",
    "docs/testing/README.md",
    "docs/testing/manual-eval/README.md",
    "packages/neuro-book/docs/adr/README.md",
    "packages/neuro-book/docs/migrations/README.md",
    "packages/neuro-book/docs/runbooks/README.md",
    "packages/neuro-book/docs/research/README.md",
    "packages/neuro-book/docs/archived/README.md",
] as const;
const REQUIRED_SPEC_GOVERNANCE = ["docs/AGENTS.md", "docs/specs/AGENTS.md", "docs/specs/TEMPLATE.md"] as const;
const SPEC_SUPPORT_FILENAMES = new Set(["README.md", "AGENTS.md", "TEMPLATE.md"]);
const SPEC_KINDS = new Set(["behavior", "architecture", "glossary"]);
const SPEC_STATUSES = new Set(["planned", "implemented"]);
const SPEC_PLACEHOLDER_CAPABILITY = "replace.with-stable-capability";
const SPEC_PLACEHOLDER_OWNER = "replace-with-owning-module";
const BEHAVIOR_SPEC_HEADINGS = [
    "目标与非目标",
    "术语与参与者",
    "输入与前置条件",
    "输出与可观察行为",
    "状态与转换",
    "副作用与数据",
    "失败与恢复",
    "边界与兼容",
    "验收与 Smoke",
] as const;
const PLACEHOLDER_SECTION_PATTERN = /^(?:(?:TODO|FIXME|TBD|WIP|待补(?:充)?|待定|占位(?:内容)?|尚未实现|无内容)\s*)+$/iu;

type SpecMetadata = {
    kind: string;
    status: string;
    capability: string;
};

const ROOT_DOCUMENTS: Record<string, true> = {
    "AGENTS.md": true,
    "CLAUDE.md": true,
    "CONTEXT.md": true,
    "CONTRIBUTING.md": true,
    "CONTRIBUTING.en.md": true,
    "PROJECT-STATUS.md": true,
    "README.md": true,
    "README.en.md": true,
    "RELEASE.md": true,
    "WATCHDOG.md": true,
};

export function checkDocumentation(repoRoot: string, paths?: readonly string[]): DocumentationCheckReport {
    const normalizedRoot = resolve(repoRoot);
    const candidates = paths ?? git(normalizedRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter(Boolean);
    const files = [...new Set(candidates.map(normalizeRepoPath))]
        .filter((path) => isRegularFile(normalizedRoot, path))
        .sort();
    const fileSet = new Set(files);
    const failures: string[] = [];

    checkRequiredIndexes(fileSet, failures);
    checkDocsRoot(files, failures);
    checkRetiredDocumentationPaths(files, failures);
    checkVitepressStructure(normalizedRoot, files, fileSet, failures);
    checkAdrs(normalizedRoot, files, failures);
    checkActiveLinks(normalizedRoot, files, fileSet, failures);
    checkSpecRegistry(normalizedRoot, fileSet, failures);
    checkSpecs(normalizedRoot, files, failures);
    checkFrozenReference(normalizedRoot, files, failures);
    checkCurrentTaskContracts(normalizedRoot, files, fileSet, failures);

    return {failures, checkedFiles: files.length};
}


function normalizeRepoPath(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isRegularFile(repoRoot: string, path: string): boolean {
    const absolutePath = resolve(repoRoot, path);
    if (!existsSync(absolutePath)) return false;
    const stats = lstatSync(absolutePath);
    return stats.isFile() && !stats.isSymbolicLink();
}

function checkRequiredIndexes(fileSet: ReadonlySet<string>, failures: string[]): void {
    if (!fileSet.has("docs/README.md")) failures.push("缺少文档治理入口：docs/README.md");
    for (const path of REQUIRED_DOC_INDEXES) {
        if (!fileSet.has(path)) failures.push(`文档分类缺少 README：${path}`);
    }
    for (const path of REQUIRED_SPEC_GOVERNANCE) {
        if (!fileSet.has(path)) failures.push(`缺少 Spec 治理文件：${path}`);
    }
}

function checkDocsRoot(files: readonly string[], failures: string[]): void {
    for (const path of files) {
        if (/^docs\/[^/]+\.md$/u.test(path) && path !== "docs/README.md" && path !== "docs/AGENTS.md") {
            failures.push(`docs 根层只允许 README.md 和 AGENTS.md：${path}`);
        }
    }
}

function checkRetiredDocumentationPaths(files: readonly string[], failures: string[]): void {
    for (const path of files.filter((candidate) => candidate.startsWith("docs/manual-eval/"))) {
        failures.push(`人工评测已迁入 docs/testing/manual-eval：${path}`);
    }
    if (files.includes("docs/standards/code.md")) {
        failures.push("编码规范已按领域迁入 docs/standards/code/：docs/standards/code.md");
    }
}

function checkVitepressStructure(
    repoRoot: string,
    files: readonly string[],
    fileSet: ReadonlySet<string>,
    failures: string[],
): void {
    const localeRoots = ["zh-Hans", "en-US"] as const;
    const markdownByLocale = new Map(localeRoots.map((locale) => [locale, new Set<string>()]));

    for (const path of files.filter((candidate) => candidate.startsWith("vitepress/"))) {
        if (path.startsWith("vitepress/.vitepress/staged/")) {
            failures.push(`VitePress staged 生成物不得跟踪：${path}`);
        }
        if (path.startsWith("vitepress/en/")) failures.push(`英文正文已迁入 locales/en-US：${path}`);
        if (path.startsWith("vitepress/images/")) failures.push(`VitePress 静态图片必须位于 public/images：${path}`);
        if (/^vitepress\/(?!locales\/|public\/|\.vitepress\/).+\.md$/u.test(path)) {
            failures.push(`VitePress 正文必须位于 locales/<BCP47>：${path}`);
        }
        const localeMatch = /^vitepress\/locales\/([^/]+)\/(.+)$/u.exec(path);
        if (!localeMatch) continue;
        const [, locale, relativePath] = localeMatch;
        if (!localeRoots.includes(locale as typeof localeRoots[number])) {
            failures.push(`VitePress locale 未登记：${path}`);
            continue;
        }
        if (relativePath.startsWith("public/")) failures.push(`VitePress locale 内不得包含 public：${path}`);
        if (relativePath.endsWith(".md")) markdownByLocale.get(locale as typeof localeRoots[number])!.add(relativePath);
    }

    const zhPaths = markdownByLocale.get("zh-Hans")!;
    const enPaths = markdownByLocale.get("en-US")!;
    for (const path of zhPaths) if (!enPaths.has(path)) failures.push(`VitePress 英文 locale 缺少对等页面：${path}`);
    for (const path of enPaths) if (!zhPaths.has(path)) failures.push(`VitePress 中文 locale 缺少对等页面：${path}`);

    for (const source of files.filter((path) => /^vitepress\/locales\/(?:zh-Hans|en-US)\/.+\.md$/u.test(path))) {
        const tree = fromMarkdown(readFileSync(resolve(repoRoot, source), "utf8"));
        for (const url of collectImageUrls(tree)) {
            if (!url.startsWith("/")) continue;
            const target = `vitepress/public/${url.slice(1).split("#", 1)[0].split("?", 1)[0]}`;
            if (!fileSet.has(target)) failures.push(`VitePress public 图片不存在：${source} -> ${url}（${target}）`);
        }
    }
}

function checkAdrs(repoRoot: string, files: readonly string[], failures: string[]): void {
    const byNumber = new Map<string, string[]>();
    for (const path of files.filter((candidate) => candidate.startsWith("packages/neuro-book/docs/adr/") && candidate.endsWith(".md") && candidate !== "packages/neuro-book/docs/adr/README.md")) {
        const filename = path.slice("packages/neuro-book/docs/adr/".length);
        const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.exec(filename);
        if (!match) {
            failures.push(`ADR 文件名必须为 NNNN-kebab-case.md：${path}`);
            continue;
        }
        const number = match[1];
        const sameNumber = byNumber.get(number) ?? [];
        sameNumber.push(path);
        byNumber.set(number, sameNumber);
        const heading = readFileSync(resolve(repoRoot, path), "utf8").match(/^# ADR (\d{4})(?:\b|：)/mu)?.[1];
        if (heading !== number) failures.push(`ADR 标题编号与文件名不一致：${path}（标题 ${heading ?? "缺失"}，文件名 ${number}）`);
    }
    for (const [number, paths] of byNumber) {
        if (paths.length > 1) failures.push(`ADR 编号重复 ${number}：${paths.join(", ")}`);
    }
}

const VITEPRESS_PAGE_PATTERN = /^vitepress\/locales\/(?:zh-Hans|en-US)\/.+\.md$/u;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const VITEPRESS_SLUG_SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/gu;

type AnchorRule = "github" | "vitepress";

/**
 * 校验活跃文档的链接目标与 `#锚点`。
 * 锚点按来源的渲染方式计算：VitePress 站点页面用 VitePress 规则，其余仓库文档用 GitHub 规则；
 * 仅校验指向 Markdown 的锚点，站点绝对路径只在带锚点时解析到 locale 页面。
 */
function checkActiveLinks(repoRoot: string, files: readonly string[], fileSet: ReadonlySet<string>, failures: string[]): void {
    const anchorCache = new Map<string, ReadonlySet<string>>();
    const anchorsOf = (path: string, rule: AnchorRule): ReadonlySet<string> => {
        const key = `${rule}:${path}`;
        let anchors = anchorCache.get(key);
        if (anchors === undefined) {
            anchors = collectAnchors(readFileSync(resolve(repoRoot, path), "utf8"), rule);
            anchorCache.set(key, anchors);
        }
        return anchors;
    };
    for (const source of files.filter((path) => isActiveMarkdown(path) || isCurrentTaskContract(repoRoot, path))) {
        const text = readFileSync(resolve(repoRoot, source), "utf8");
        let tree: Root;
        try {
            tree = fromMarkdown(text);
        } catch (error) {
            failures.push(`Markdown 无法解析：${source}：${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        const rule: AnchorRule = VITEPRESS_PAGE_PATTERN.test(source) ? "vitepress" : "github";
        for (const url of collectLinkUrls(tree, true)) {
            if (url.includes("\\")) {
                failures.push(`相对链接必须使用正斜杠：${source} -> ${url}`);
                continue;
            }
            const fragment = linkFragment(url);
            const target = resolveRelativeLink(source, url);
            let anchorTarget: string | null = null;
            if (target !== null) {
                if (target.startsWith("../") || target === "..") {
                    failures.push(`相对链接越出仓库：${source} -> ${url}`);
                    continue;
                }
                const resolved = resolveLinkTarget(target, fileSet);
                if (resolved === null) {
                    failures.push(`相对链接目标不存在：${source} -> ${url}（${target}）`);
                    continue;
                }
                anchorTarget = resolved;
            } else if (fragment !== null && url.trim().startsWith("#")) {
                anchorTarget = source;
            } else if (fragment !== null && rule === "vitepress" && /^\/(?!\/)/u.test(url.trim())) {
                anchorTarget = resolveVitepressRoute(url, fileSet);
                if (anchorTarget === null) {
                    failures.push(`站内链接目标不存在：${source} -> ${url}`);
                    continue;
                }
            }
            if (fragment === null || anchorTarget === null || !anchorTarget.endsWith(".md")) continue;
            if (!anchorsOf(anchorTarget, rule).has(fragment)) {
                failures.push(`链接锚点不存在：${source} -> ${url}（${anchorTarget}#${fragment}）`);
            }
        }
    }
}

function linkFragment(rawUrl: string): string | null {
    const url = rawUrl.trim();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(url) || url.startsWith("//")) return null;
    const index = url.indexOf("#");
    if (index < 0 || index === url.length - 1) return null;
    const fragment = url.slice(index + 1);
    try {
        return decodeURIComponent(fragment);
    } catch {
        return fragment;
    }
}

/** 解析 VitePress 站点绝对路径：`/` 对应 zh-Hans，`/en/` 对应 en-US，末尾 `/` 指向目录 index。 */
function resolveVitepressRoute(rawUrl: string, fileSet: ReadonlySet<string>): string | null {
    let route = rawUrl.trim().split("#", 1)[0].split("?", 1)[0];
    try {
        route = decodeURIComponent(route);
    } catch {
        // 保留原始路径，按不存在报告。
    }
    const english = route === "/en" || route.startsWith("/en/");
    const localeRoot = `vitepress/locales/${english ? "en-US" : "zh-Hans"}`;
    const page = route.slice(english ? 3 : 0).replace(/^\//u, "").replace(/\.(?:html|md)$/u, "");
    const candidate = page === "" || page.endsWith("/")
        ? `${localeRoot}/${page}index.md`
        : `${localeRoot}/${page}.md`;
    return fileSet.has(candidate) ? candidate : null;
}

function collectAnchors(text: string, rule: AnchorRule): ReadonlySet<string> {
    let tree: Root;
    try {
        tree = fromMarkdown(text.replace(FRONTMATTER_PATTERN, ""));
    } catch {
        return new Set();
    }
    const anchors = new Set<string>();
    const githubSlugger = new GithubSlugger();
    const vitepressSlugCounts = new Map<string, number>();
    const visit = (node: Nodes | Root): void => {
        if (node.type === "heading") {
            const title = markdownNodeText(node);
            if (rule === "github") {
                anchors.add(githubSlugger.slug(title));
            } else {
                const custom = /\s*\{#([^}\s]+)\}\s*$/u.exec(title);
                if (custom) {
                    anchors.add(custom[1]);
                } else {
                    const slug = vitepressSlug(title);
                    const count = vitepressSlugCounts.get(slug);
                    vitepressSlugCounts.set(slug, (count ?? 0) + 1);
                    anchors.add(count === undefined ? slug : `${slug}-${count}`);
                }
            }
        }
        if (node.type === "html") {
            for (const match of node.value.matchAll(/\s(?:id|name)\s*=\s*["']([^"']+)["']/gu)) anchors.add(match[1]);
        }
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return anchors;
}

/** 与 VitePress 默认 slugify 逐步一致；该函数未从 `vitepress` 公开导出，升级 VitePress 时需复核。 */
function vitepressSlug(text: string): string {
    return text
        .normalize("NFKD")
        .replace(/[\u0300-\u036F]/gu, "")
        .replace(/[\u0000-\u001f]/gu, "")
        .replace(VITEPRESS_SLUG_SPECIAL, "-")
        .replace(/-{2,}/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .replace(/^(\d)/u, "_$1")
        .toLowerCase();
}

function isActiveMarkdown(path: string): boolean {
    if (!path.endsWith(".md")) return false;
    if (ROOT_DOCUMENTS[path] || path === ".omp/RULES.md") return true;
    if (path.startsWith("docs/")) return !path.startsWith("docs/archived/") && !path.startsWith("docs/research/");
    if (path.startsWith("packages/neuro-book/assets/reference/")) return true;
    if (path.startsWith("reference/")) return true;
    if (path.startsWith("vitepress/locales/")) return !path.startsWith("vitepress/locales/zh-Hans/changelog/")
        && !path.startsWith("vitepress/locales/en-US/changelog/");
    if (path.startsWith("vitepress/")) return !path.startsWith("vitepress/public/");
    if (path === ".agents/README.md" || path === ".agents/AGENTS.md") return true;
    return path.startsWith(".agents/skills/");
}

function isCurrentTaskContract(repoRoot: string, path: string): boolean {
    if (!/^(?:\.agents\/tasks|packages\/neuro-book\/.agents\/tasks)\/[^/]+\/README\.md$/u.test(path)) return false;
    const text = readFileSync(resolve(repoRoot, path), "utf8");
    const frontmatter = FRONTMATTER_PATTERN.exec(text)?.[1];
    if (!frontmatter) return false;
    try {
        const metadata = parseYaml(frontmatter) as {schema?: unknown} | null;
        return metadata?.schema === "nbook.task/v1";
    } catch {
        return false;
    }
}

function checkCurrentTaskContracts(
    repoRoot: string,
    files: readonly string[],
    fileSet: ReadonlySet<string>,
    failures: string[],
): void {
    for (const path of files.filter((candidate) => isCurrentTaskContract(repoRoot, candidate))) {
        const text = readFileSync(resolve(repoRoot, path), "utf8");
        const links = collectLinkUrls(fromMarkdown(text));
        const hasConcreteSpec = links.some((url) => {
            const target = resolveRelativeLink(path, url);
            if (target === null) return false;
            const candidate = target.endsWith(".md") ? target : `${target}.md`;
            return isSpecDocument(candidate) && fileSet.has(candidate);
        });
        if (!hasConcreteSpec && !text.includes("行为合同未变")) {
            failures.push(`新 Task 必须链接具体 Spec，或明确说明“行为合同未变”：${path}`);
        }
    }
}

function collectLinkUrls(tree: Root, includeImages = false): string[] {
    const urls: string[] = [];
    const visit = (node: Nodes | Root): void => {
        if (node.type === "link" || node.type === "definition" || (includeImages && node.type === "image")) urls.push(node.url);
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return urls;
}

function collectImageUrls(tree: Root): string[] {
    const urls: string[] = [];
    const visit = (node: Nodes | Root): void => {
        if (node.type === "image") urls.push(node.url);
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return urls;
}

function resolveRelativeLink(source: string, rawUrl: string): string | null {
    const url = rawUrl.trim();
    if (!url || url.startsWith("#") || url.startsWith("/") || url.startsWith("//")) return null;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(url)) return null;
    const withoutFragment = url.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(withoutFragment);
    } catch {
        decoded = withoutFragment;
    }
    return posix.normalize(posix.join(posix.dirname(source), decoded));
}

/** 返回链接实际落到的受管文件；目录链接无 README/index 时返回目录本身。 */
function resolveLinkTarget(target: string, fileSet: ReadonlySet<string>): string | null {
    const normalizedTarget = normalizeRepoPath(target).replace(/\/$/u, "");
    const candidates = [normalizedTarget];
    if (!normalizedTarget.endsWith(".md")) candidates.push(`${normalizedTarget}.md`);
    candidates.push(`${normalizedTarget}/README.md`, `${normalizedTarget}/index.md`);
    const file = candidates.find((candidate) => fileSet.has(candidate));
    if (file !== undefined) return file;
    const directoryPrefix = `${normalizedTarget}/`;
    return [...fileSet].some((candidate) => candidate.startsWith(directoryPrefix)) ? normalizedTarget : null;
}

function checkSpecRegistry(repoRoot: string, fileSet: ReadonlySet<string>, failures: string[]): void {
    const registryPath = "docs/specs/README.md";
    if (!fileSet.has(registryPath)) return;
    const text = readFileSync(resolve(repoRoot, registryPath), "utf8");
    const frozenSection = markdownSection(text, "冻结过渡规范");
    if (frozenSection === null) failures.push(`${registryPath} 缺少“冻结过渡规范”章节`);
    for (const url of collectLinkUrls(fromMarkdown(frozenSection ?? ""))) {
        const target = resolveRelativeLink(registryPath, url);
        if (target === null) continue;
        if (["docs/proposals/", "docs/research/", "docs/archived/", "packages/neuro-book/docs/proposals/", "packages/neuro-book/docs/research/", "packages/neuro-book/docs/archived/", ".agents/tasks/"].some((prefix) => target.startsWith(prefix))) {
            failures.push(`冻结过渡规范指向非规范资料：${registryPath} -> ${url}（${target}）`);
        }
    }
}

function checkSpecs(repoRoot: string, files: readonly string[], failures: string[]): void {
    const registryPath = "docs/specs/README.md";
    if (!files.includes(registryPath)) return;
    const registry = readFileSync(resolve(repoRoot, registryPath), "utf8");
    const specPaths = files.filter(isSpecDocument);
    const specPathSet = new Set(specPaths);
    const implementedTargets = registeredSpecTargets(registryPath, registry, "已实现规范", specPathSet, failures);
    const plannedTargets = registeredSpecTargets(registryPath, registry, "待实现规范", specPathSet, failures);
    const byCapability = new Map<string, string[]>();

    for (const path of specPaths) {
        const text = readFileSync(resolve(repoRoot, path), "utf8");
        const metadata = parseSpecMetadata(path, text, failures);
        if (metadata === null) continue;
        const sameCapability = byCapability.get(metadata.capability) ?? [];
        sameCapability.push(path);
        byCapability.set(metadata.capability, sameCapability);

        const expectedTargets = metadata.status === "implemented" ? implementedTargets : plannedTargets;
        const expectedSection = metadata.status === "implemented" ? "已实现规范" : "待实现规范";
        const otherTargets = metadata.status === "implemented" ? plannedTargets : implementedTargets;
        if (!expectedTargets.has(path)) failures.push(`Spec 未登记在“${expectedSection}”：${path}`);
        if (otherTargets.has(path)) failures.push(`Spec 登记的成熟度与 frontmatter 不一致：${path}（${metadata.status}）`);
        if (text.includes("本模板中的说明在填写后删除")) failures.push(`Spec 仍包含模板说明：${path}`);

        if (metadata.kind === "behavior") {
            const sections = markdownSections(text);
            for (const heading of BEHAVIOR_SPEC_HEADINGS) checkRequiredSpecSection(path, sections, heading, "Behavior Spec", failures);
            checkRequiredSpecSection(path, sections, "证据", metadata.status === "implemented" ? "Implemented Spec" : "Planned Spec", failures);
            if (metadata.status === "implemented") {
                checkRequiredSpecSection(path, sections, "实现合同", "Implemented Spec", failures);
                const evidence = sections.get("证据");
                const evidenceLinks = evidence === undefined ? [] : collectLinkUrls(fromMarkdown(evidence));
                if (evidence !== undefined && evidenceLinks.every((url) => resolveRelativeLink(path, url) === null)) {
                    failures.push(`Implemented Spec 的“证据”必须链接仓库内实现或验证入口：${path}`);
                }
            }
        }
    }

    for (const [capability, paths] of byCapability) {
        if (paths.length > 1) failures.push(`Spec capability 重复 ${capability}：${paths.join(", ")}`);
    }
}

function isSpecDocument(path: string): boolean {
    if (!(path.startsWith("docs/specs/") || path.startsWith("packages/neuro-book/docs/specs/")) || !path.endsWith(".md")) return false;
    return !SPEC_SUPPORT_FILENAMES.has(posix.basename(path));
}

function checkRequiredSpecSection(
    path: string,
    sections: ReadonlyMap<string, string>,
    heading: string,
    label: string,
    failures: string[],
): void {
    const section = sections.get(heading);
    if (section === undefined) {
        failures.push(`${label} 缺少“${heading}”章节：${path}`);
        return;
    }
    const content = markdownPlainText(section);
    if (!content || PLACEHOLDER_SECTION_PATTERN.test(content)) failures.push(`${label} 的“${heading}”章节没有实义内容：${path}`);
}

function markdownSection(text: string, heading: string): string | null {
    return markdownSections(text).get(heading) ?? null;
}

function markdownSections(text: string): ReadonlyMap<string, string> {
    let tree: Root;
    try {
        tree = fromMarkdown(text);
    } catch {
        return new Map();
    }
    const headings = tree.children.filter((node) => node.type === "heading" && node.depth === 2);
    const sections = new Map<string, string>();
    for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        const name = markdownNodeText(heading).trim();
        const bodyStart = heading.position?.end.offset;
        const bodyEnd = headings[index + 1]?.position?.start.offset ?? text.length;
        if (!name || bodyStart === undefined || bodyEnd === undefined) continue;
        sections.set(name, text.slice(bodyStart, bodyEnd));
    }
    return sections;
}

function markdownNodeText(node: Nodes | Root): string {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value;
    if (!("children" in node)) return "";
    return node.children.map(markdownNodeText).join("");
}

function markdownPlainText(markdown: string): string {
    let tree: Root;
    try {
        tree = fromMarkdown(markdown);
    } catch {
        return "";
    }
    const values: string[] = [];
    const visit = (node: Nodes | Root): void => {
        if (node.type === "text" || node.type === "inlineCode" || node.type === "code") values.push(node.value);
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return values.join(" ").trim();
}

function registeredSpecTargets(
    registryPath: string,
    registry: string,
    heading: string,
    specPaths: ReadonlySet<string>,
    failures: string[],
): ReadonlySet<string> {
    const section = markdownSection(registry, heading);
    if (section === null) {
        failures.push(`${registryPath} 缺少“${heading}”章节`);
        return new Set();
    }
    const targets = new Set<string>();
    for (const url of collectLinkUrls(fromMarkdown(section))) {
        const resolved = resolveRelativeLink(registryPath, url);
        if (resolved === null || !(resolved.startsWith("docs/specs/") || resolved.startsWith("packages/neuro-book/docs/specs/"))) continue;
        const candidates = resolved.endsWith(".md") ? [resolved] : [`${resolved}.md`];
        const target = candidates.find((candidate) => specPaths.has(candidate));
        if (target === undefined) {
            failures.push(`“${heading}”只能登记具体 Spec 文件：${registryPath} -> ${url}`);
            continue;
        }
        if (targets.has(target)) failures.push(`“${heading}”重复登记 Spec：${target}`);
        targets.add(target);
    }
    return targets;
}

function parseSpecMetadata(path: string, text: string, failures: string[]): SpecMetadata | null {
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match) {
        failures.push(`Spec 缺少 YAML frontmatter：${path}`);
        return null;
    }
    let raw: unknown;
    try {
        raw = parseYaml(match[1]);
    } catch (error) {
        failures.push(`Spec frontmatter 无法解析：${path}：${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        failures.push(`Spec frontmatter 必须是对象：${path}`);
        return null;
    }
    const fields = raw as Record<string, unknown>;
    const schema = fields.schema;
    const kind = fields.kind;
    const status = fields.status;
    const capability = fields.capability;
    const owners = fields.owners;
    if (schema !== "nbook.spec/v1") failures.push(`Spec schema 必须是 nbook.spec/v1：${path}`);
    if (typeof kind !== "string" || !SPEC_KINDS.has(kind)) failures.push(`Spec kind 必须是 behavior、architecture 或 glossary：${path}`);
    if (typeof status !== "string" || !SPEC_STATUSES.has(status)) failures.push(`Spec status 必须是 planned 或 implemented：${path}`);
    if (typeof capability !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)) failures.push(`Spec capability 必须是稳定的点分小写标识：${path}`);
    if (capability === SPEC_PLACEHOLDER_CAPABILITY) failures.push(`Spec capability 仍是模板占位值：${path}`);
    if (!Array.isArray(owners) || owners.length === 0 || owners.some((owner) => typeof owner !== "string" || !owner.trim())) {
        failures.push(`Spec owners 必须是非空模块列表：${path}`);
    } else if (owners.includes(SPEC_PLACEHOLDER_OWNER)) {
        failures.push(`Spec owners 仍包含模板占位值：${path}`);
    }
    if (schema !== "nbook.spec/v1" || typeof kind !== "string" || !SPEC_KINDS.has(kind)
        || typeof status !== "string" || !SPEC_STATUSES.has(status)
        || typeof capability !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)
        || capability === SPEC_PLACEHOLDER_CAPABILITY
        || !Array.isArray(owners) || owners.length === 0 || owners.some((owner) => typeof owner !== "string" || !owner.trim())
        || owners.includes(SPEC_PLACEHOLDER_OWNER)) return null;
    return {kind, status, capability};
}

function checkFrozenReference(_repoRoot: string, files: readonly string[], failures: string[]): void {
    for (const path of files.filter((candidate) => candidate.startsWith("reference/"))) {
        failures.push(`运行期 Reference 必须位于 packages/neuro-book/assets/reference：${path}`);
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const repoArgument = args.indexOf("--repo-root");
    const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
    const report = checkDocumentation(repoRoot);
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length > 0) process.exitCode = 1;
}

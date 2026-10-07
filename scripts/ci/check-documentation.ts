#!/usr/bin/env bun
import {existsSync, lstatSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {posix} from "node:path";
import type {Nodes, Root} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import GithubSlugger from "github-slugger";
import {parse as parseYaml} from "yaml";

import {git} from "#scripts/ci/agent-governance-contract";
import {changedFiles, readChangeScopeArguments, scopeWarnings, type FileWarning, type ScopedWarnings} from "#scripts/ci/change-scope";

export type DocumentationCheckReport = ScopedWarnings & {
    failures: string[];
    checkedFiles: number;
};

export type DocumentationCheckOptions = {
    /** 受管文件集合；省略时取 Git 跟踪与未忽略的文件。 */
    paths?: readonly string[];
    /** 警告只逐条列出这些文件的，其余合成一行计数；省略时全部列出。 */
    warningScope?: ReadonlySet<string>;
};

const REQUIRED_DOC_INDEXES = [
    "docs/specs/README.md",
    "docs/standards/README.md",
    "docs/standards/code/README.md",
    "docs/proposals/README.md",
    "docs/testing/README.md",
    "docs/adr/README.md",
    "docs/research/README.md",
    "docs/archived/README.md",
] as const;
const REQUIRED_SPEC_GOVERNANCE = ["docs/AGENTS.md", "docs/specs/AGENTS.md"] as const;
const SPEC_SUPPORT_FILENAMES = new Set(["README.md", "AGENTS.md"]);
const SPEC_KINDS = new Set(["behavior", "architecture", "glossary"]);
const SPEC_STATUSES = new Set(["planned", "implemented"]);
/** `writing-specs` 模板里的占位写法 `<…>`：照抄模板没有替换时拦下。 */
const TEMPLATE_PLACEHOLDER_PATTERN = /[<>]/u;
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
const EVIDENCE_LABELS = ["实现入口", "合同测试", "Smoke"] as const;
const EVIDENCE_LABEL_PATTERN = /^(?:[-*]\s+)?(?:\*\*)?(实现入口|合同测试|Smoke)(?:\*\*)?[：:]\s*(.*)$/u;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const EXECUTABLE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|sh|ps1|py)$/u;
const SMOKE_NOT_APPLICABLE_PATTERN = /^不适用[—–-]{1,2}\s*\S/u;
const WORK_TASK_README_PATTERN = /^\.agents\/works\/[^/]+\/tasks\/[^/]+\/README\.md$/u;
const NB_UI_COMPONENT_BARREL = "packages/nb-ui/src/components/index.ts";
const NB_UI_COMPONENT_EXPORT_PATTERN = /export \{default as \w+\} from "\.\/([\w/.-]+)\.vue";/gu;
const PROPOSAL_STATUSES = new Set(["draft", "reviewing", "accepted", "rejected", "superseded"]);
/** 这些状态的提案仍在活跃目录，必须登记在索引里；其余状态的应移入归档。 */
const ACTIVE_PROPOSAL_STATUSES = new Set(["draft", "reviewing", "accepted"]);
const ADR_STATUSES = new Set(["accepted", "superseded"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PROPOSAL_INDEX = "docs/proposals/README.md";
/** Spec 正文里的 Task 引用：`t52`、`w00017`（含“随 t55”、Task 目录链接）。 */
const TASK_REFERENCE_PATTERN = /\b(?:t\d{2}|w\d{5})\b/gu;
/** “证据”一节允许的固定标签行；批准依据之外的叙述属于 Task。 */
const EVIDENCE_LINE_PATTERN = /^(?:[-*]\s+)?(?:\*\*)?(?:实现入口|合同测试|Smoke|批准依据)(?:\*\*)?[：:]/u;
const COMPONENT_TAGS = new Set([
    "state:local", "state:shared-read", "state:shared-write", "state:inject",
    "persist:local", "persist:session", "persist:idb",
    "io:read", "io:mutate", "io:stream",
    "env:timer", "env:route", "env:global", "env:clipboard", "env:portal",
]);

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
    "WATCHDOG.md": true,
};

export function checkDocumentation(repoRoot: string, options: DocumentationCheckOptions = {}): DocumentationCheckReport {
    const normalizedRoot = resolve(repoRoot);
    const candidates = options.paths ?? git(normalizedRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter(Boolean);
    const files = [...new Set(candidates.map(normalizeRepoPath))]
        .filter((path) => isRegularFile(normalizedRoot, path))
        .sort();
    const fileSet = new Set(files);
    const failures: string[] = [];
    const warnings: FileWarning[] = [];

    checkRequiredIndexes(fileSet, failures);
    checkDocsRoot(files, failures);
    checkAdrs(normalizedRoot, files, failures);
    checkProposals(normalizedRoot, files, fileSet, failures);
    checkActiveLinks(normalizedRoot, files, fileSet, failures, warnings);
    checkSpecRegistry(normalizedRoot, fileSet, failures);
    checkSpecs(normalizedRoot, files, fileSet, failures, warnings);
    checkComponentDocuments(normalizedRoot, fileSet, failures);
    checkCurrentTaskContracts(normalizedRoot, files, fileSet, warnings);

    return {failures, ...scopeWarnings(warnings, options.warningScope ?? null), checkedFiles: files.length};
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

function checkAdrs(repoRoot: string, files: readonly string[], failures: string[]): void {
    const byNumber = new Map<string, string[]>();
    for (const path of files.filter((candidate) => candidate.startsWith("docs/adr/") && candidate.endsWith(".md") && candidate !== "docs/adr/README.md")) {
        const filename = path.slice("docs/adr/".length);
        const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.exec(filename);
        if (!match) {
            failures.push(`ADR 文件名必须为 NNNN-kebab-case.md：${path}`);
            continue;
        }
        const number = match[1];
        const sameNumber = byNumber.get(number) ?? [];
        sameNumber.push(path);
        byNumber.set(number, sameNumber);
        const text = readFileSync(resolve(repoRoot, path), "utf8");
        const heading = text.match(/^# ADR (\d{4})(?:\b|：)/mu)?.[1];
        if (heading !== number) failures.push(`ADR 标题编号与文件名不一致：${path}（标题 ${heading ?? "缺失"}，文件名 ${number}）`);
        checkDecisionFrontmatter(path, text, {kind: "ADR", schema: "nbook.adr/v1", statuses: ADR_STATUSES, decidedRequiredFor: ADR_STATUSES}, failures);
    }
    for (const [number, paths] of byNumber) {
        if (paths.length > 1) failures.push(`ADR 编号重复 ${number}：${paths.join(", ")}`);
    }
}

/**
 * 提案的 frontmatter 与索引登记（docs/proposals/README.md 的“frontmatter”）：状态只写在 frontmatter；
 * draft、reviewing、accepted 的提案必须登记在索引里，rejected、superseded 的不留在活跃目录。
 */
function checkProposals(repoRoot: string, files: readonly string[], fileSet: ReadonlySet<string>, failures: string[]): void {
    const proposals = files.filter((path) => path.startsWith("docs/proposals/") && path.endsWith(".md") && !SPEC_SUPPORT_FILENAMES.has(posix.basename(path)));
    if (proposals.length === 0) return;
    const indexed = new Set<string>();
    if (fileSet.has(PROPOSAL_INDEX)) {
        for (const url of collectLinkUrls(fromMarkdown(readFileSync(resolve(repoRoot, PROPOSAL_INDEX), "utf8")))) {
            const target = resolveRelativeLink(PROPOSAL_INDEX, url);
            const resolved = target === null ? null : resolveLinkTarget(target, fileSet);
            if (resolved !== null) indexed.add(resolved);
        }
    }
    for (const path of proposals) {
        const status = checkDecisionFrontmatter(path, readFileSync(resolve(repoRoot, path), "utf8"), {
            kind: "提案",
            schema: "nbook.proposal/v1",
            statuses: PROPOSAL_STATUSES,
            decidedRequiredFor: new Set(["accepted", "rejected"]),
        }, failures);
        if (status === null) continue;
        if (ACTIVE_PROPOSAL_STATUSES.has(status)) {
            if (!indexed.has(path)) failures.push(`提案未登记在 ${PROPOSAL_INDEX}：${path}（${status}）`);
        } else {
            failures.push(`${status} 的提案应移入 docs/archived/proposals/：${path}`);
        }
    }
}

type DecisionDocumentRules = {
    kind: "提案" | "ADR";
    schema: string;
    statuses: ReadonlySet<string>;
    decidedRequiredFor: ReadonlySet<string>;
};

/** 提案与 ADR 共用的 frontmatter 校验；返回合法的 status，frontmatter 缺失或 status 非法时返回 null。 */
function checkDecisionFrontmatter(path: string, text: string, rules: DecisionDocumentRules, failures: string[]): string | null {
    // 中文与英文之间留空格：“提案的 schema”“ADR 的 schema”。
    const subject = rules.kind === "ADR" ? "ADR " : rules.kind;
    const frontmatter = readFrontmatter(text);
    if (frontmatter.status === "missing") {
        failures.push(`${subject}缺少 YAML frontmatter：${path}`);
        return null;
    }
    if (frontmatter.status === "invalid") {
        failures.push(`${subject}的 frontmatter ${frontmatter.message}：${path}`);
        return null;
    }
    const fields = frontmatter.fields;
    if (fields.schema !== rules.schema) failures.push(`${subject}的 schema 必须是 ${rules.schema}：${path}`);
    const status = fields.status;
    if (typeof status !== "string" || !rules.statuses.has(status)) {
        failures.push(`${subject}的 status 必须是 ${[...rules.statuses].join("、")} 之一：${path}`);
        return null;
    }
    if (rules.decidedRequiredFor.has(status) && !(typeof fields.decided === "string" && DATE_PATTERN.test(fields.decided))) {
        failures.push(`${subject}的 status 为 ${status} 时 decided 必须是 YYYY-MM-DD 日期：${path}`);
    }
    if (status === "superseded" && !(typeof fields["superseded-by"] === "string" && fields["superseded-by"].trim() !== "")) {
        failures.push(`${subject}的 status 为 superseded 时必须填写 superseded-by：${path}`);
    }
    return status;
}

type FrontmatterRead =
    | {status: "missing"}
    | {status: "invalid"; message: string}
    | {status: "ok"; fields: Record<string, unknown>};

function readFrontmatter(text: string): FrontmatterRead {
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match) return {status: "missing"};
    let raw: unknown;
    try {
        raw = parseYaml(match[1]);
    } catch (error) {
        return {status: "invalid", message: `无法解析：${error instanceof Error ? error.message : String(error)}`};
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {status: "invalid", message: "必须是对象"};
    return {status: "ok", fields: raw as Record<string, unknown>};
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/**
 * 校验活跃文档的链接目标与 `#锚点`。
 * 锚点按 GitHub 的标题 slug 规则计算，仅校验指向 Markdown 的锚点。
 * current Task 快照按其 v2 合同只是协作参考，命中问题进 `warnings` 而不阻断。
 */
function checkActiveLinks(
    repoRoot: string,
    files: readonly string[],
    fileSet: ReadonlySet<string>,
    failures: string[],
    warnings: FileWarning[],
): void {
    const anchorCache = new Map<string, ReadonlySet<string>>();
    const anchorsOf = (path: string): ReadonlySet<string> => {
        let anchors = anchorCache.get(path);
        if (anchors === undefined) {
            anchors = collectAnchors(readFileSync(resolve(repoRoot, path), "utf8"));
            anchorCache.set(path, anchors);
        }
        return anchors;
    };
    for (const source of files.filter((path) => isActiveMarkdown(path) || isCurrentTaskContract(repoRoot, path))) {
        const report = isActiveMarkdown(source)
            ? (label: string, detail: string) => failures.push(`${label}：${detail}`)
            : (label: string, detail: string) => warnings.push({path: source, label, detail});
        const text = readFileSync(resolve(repoRoot, source), "utf8");
        let tree: Root;
        try {
            tree = fromMarkdown(text);
        } catch (error) {
            report("Markdown 无法解析", `${source}：${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        for (const url of collectLinkUrls(tree, true)) {
            if (url.includes("\\")) {
                report("相对链接必须使用正斜杠", `${source} -> ${url}`);
                continue;
            }
            const fragment = linkFragment(url);
            const target = resolveRelativeLink(source, url);
            let anchorTarget: string | null = null;
            if (target !== null) {
                if (target.startsWith("../") || target === "..") {
                    report("相对链接越出仓库", `${source} -> ${url}`);
                    continue;
                }
                const resolved = resolveLinkTarget(target, fileSet);
                if (resolved === null) {
                    report("相对链接目标不存在", `${source} -> ${url}（${target}）`);
                    continue;
                }
                anchorTarget = resolved;
            } else if (fragment !== null && url.trim().startsWith("#")) {
                anchorTarget = source;
            }
            if (fragment === null || anchorTarget === null || !anchorTarget.endsWith(".md")) continue;
            if (!anchorsOf(anchorTarget).has(fragment)) {
                report("链接锚点不存在", `${source} -> ${url}（${anchorTarget}#${fragment}）`);
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

function collectAnchors(text: string): ReadonlySet<string> {
    let tree: Root;
    try {
        tree = fromMarkdown(text.replace(FRONTMATTER_PATTERN, ""));
    } catch {
        return new Set();
    }
    const anchors = new Set<string>();
    const githubSlugger = new GithubSlugger();
    const visit = (node: Nodes | Root): void => {
        if (node.type === "heading") anchors.add(githubSlugger.slug(markdownNodeText(node)));
        if (node.type === "html") {
            for (const match of node.value.matchAll(/\s(?:id|name)\s*=\s*["']([^"']+)["']/gu)) anchors.add(match[1]);
        }
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return anchors;
}

function isActiveMarkdown(path: string): boolean {
    if (!path.endsWith(".md")) return false;
    if (ROOT_DOCUMENTS[path] || path === ".omp/RULES.md") return true;
    if (path.startsWith("docs/")) return !path.startsWith("docs/archived/") && !path.startsWith("docs/research/");
    if (path === ".agents/README.md" || path === ".agents/AGENTS.md") return true;
    return path.startsWith(".agents/skills/");
}

/**
 * current Task 的唯一入口是 `.agents/works/<work>/tasks/<task>/README.md` 的 `nbook.task/v2`；
 * legacy `.agents/tasks/` 只保存 `nbook.task/v1` provenance，其门禁由 `governance:check` 负责。
 */
function isCurrentTaskContract(repoRoot: string, path: string): boolean {
    if (!WORK_TASK_README_PATTERN.test(path)) return false;
    const text = readFileSync(resolve(repoRoot, path), "utf8");
    const frontmatter = FRONTMATTER_PATTERN.exec(text)?.[1];
    if (!frontmatter) return false;
    try {
        const metadata = parseYaml(frontmatter) as {schema?: unknown} | null;
        return metadata?.schema === "nbook.task/v2";
    } catch {
        return false;
    }
}

/**
 * current Task 必须链接具体 Spec，或明确说明“行为合同未变”。
 * v2 合同下 Task 正文只是协作参考，命中问题进 `warnings` 而不阻断。
 */
function checkCurrentTaskContracts(
    repoRoot: string,
    files: readonly string[],
    fileSet: ReadonlySet<string>,
    warnings: FileWarning[],
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
            warnings.push({path, label: "新 Task 必须链接具体 Spec，或明确说明“行为合同未变”", detail: path});
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
        if (["docs/proposals/", "docs/research/", "docs/archived/", "packages/neuro-book-legacy/docs/", ".agents/tasks/"].some((prefix) => target.startsWith(prefix))) {
            failures.push(`冻结过渡规范指向非规范资料：${registryPath} -> ${url}（${target}）`);
        }
    }
}

function checkSpecs(repoRoot: string, files: readonly string[], fileSet: ReadonlySet<string>, failures: string[], warnings: FileWarning[]): void {
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
        checkSpecProse(path, text, warnings);

        if (metadata.kind === "behavior") {
            const sections = markdownSections(text);
            for (const heading of BEHAVIOR_SPEC_HEADINGS) checkRequiredSpecSection(path, sections, heading, "Behavior Spec", failures);
            checkRequiredSpecSection(path, sections, "证据", metadata.status === "implemented" ? "Implemented Spec" : "Planned Spec", failures);
            if (metadata.status === "implemented") {
                checkRequiredSpecSection(path, sections, "实现合同", "Implemented Spec", failures);
                const evidence = sections.get("证据");
                if (evidence !== undefined) checkImplementedEvidence(path, evidence, fileSet, failures);
            }
        }
    }

    for (const [capability, paths] of byCapability) {
        if (paths.length > 1) failures.push(`Spec capability 重复 ${capability}：${paths.join(", ")}`);
    }
}

/**
 * Spec 只写行为（docs/specs/README.md 的“Spec 写什么、不写什么”）：历程属于 Task，所以正文里的 Task 引用、
 * “证据”一节里固定标签与批准依据之外的叙述都给警告。存量 Spec 改到哪份清理哪份，所以不阻断。
 */
function checkSpecProse(path: string, text: string, warnings: FileWarning[]): void {
    const body = text.replace(FRONTMATTER_PATTERN, "");
    let tree: Root;
    try {
        tree = fromMarkdown(body);
    } catch {
        // 无法解析的 Markdown 已由 checkActiveLinks 报为失败，这里不重复报告。
        return;
    }
    const headings = tree.children.filter((node) => node.type === "heading" && node.depth === 2);
    const evidenceIndex = headings.findIndex((heading) => markdownNodeText(heading).trim() === "证据");
    let prose = body;
    if (evidenceIndex >= 0) {
        const start = headings[evidenceIndex].position?.start.offset ?? body.length;
        const evidenceStart = headings[evidenceIndex].position?.end.offset ?? body.length;
        const end = headings[evidenceIndex + 1]?.position?.start.offset ?? body.length;
        prose = body.slice(0, start) + body.slice(end);
        const extraLines = body.slice(evidenceStart, end).split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line !== "" && !EVIDENCE_LINE_PATTERN.test(line));
        if (extraLines.length > 0) {
            warnings.push({path, label: "Spec 的“证据”一节有固定标签与批准依据之外的行", detail: `${path}（${String(extraLines.length)} 行）`});
        }
    }
    const references = [...new Set([...prose.matchAll(TASK_REFERENCE_PATTERN)].map((match) => match[0]))];
    if (references.length > 0) {
        warnings.push({path, label: "Spec 正文引用了 Task（只能出现在“证据”一节）", detail: `${path}（${references.slice(0, 5).join("、")}${references.length > 5 ? " 等" : ""}）`});
    }
}

function isSpecDocument(path: string): boolean {
    if (!path.startsWith("docs/specs/") || !path.endsWith(".md")) return false;
    return !SPEC_SUPPORT_FILENAMES.has(posix.basename(path));
}

type EvidenceLabel = typeof EVIDENCE_LABELS[number];

/**
 * implemented Spec 的“证据”用三条固定标签给出实现入口、合同测试与 smoke。
 * 每条至少链接一个存在的仓库文件，且类型对应；没有 smoke 时写「不适用——<理由>」。
 */
function checkImplementedEvidence(
    path: string,
    evidence: string,
    fileSet: ReadonlySet<string>,
    failures: string[],
): void {
    const labels: Partial<Record<EvidenceLabel, string>> = {};
    for (const line of evidence.split(/\r?\n/u)) {
        const match = EVIDENCE_LABEL_PATTERN.exec(line.trim());
        if (match) labels[match[1] as EvidenceLabel] ??= match[2];
    }
    for (const label of EVIDENCE_LABELS) {
        if (labels[label] === undefined) failures.push(`Implemented Spec 的“证据”缺少「${label}：」标签行：${path}`);
    }
    const targetsOf = (value: string | undefined): string[] => {
        if (value === undefined) return [];
        const targets: string[] = [];
        for (const url of collectLinkUrls(fromMarkdown(value))) {
            const target = resolveRelativeLink(path, url);
            if (target === null) continue;
            const resolved = resolveLinkTarget(target, fileSet);
            if (resolved !== null) targets.push(resolved);
        }
        return targets;
    };
    if (labels.实现入口 !== undefined && !targetsOf(labels.实现入口).some((target) => fileSet.has(target) && !target.endsWith(".md"))) {
        failures.push(`Implemented Spec 的「实现入口：」必须链接存在的源码文件（非 .md）：${path}`);
    }
    if (labels.合同测试 !== undefined && !targetsOf(labels.合同测试).some((target) => fileSet.has(target) && TEST_FILE_PATTERN.test(target))) {
        failures.push(`Implemented Spec 的「合同测试：」必须链接存在的测试文件：${path}`);
    }
    if (labels.Smoke !== undefined && !targetsOf(labels.Smoke).some((target) => fileSet.has(target) && EXECUTABLE_FILE_PATTERN.test(target))
        && !SMOKE_NOT_APPLICABLE_PATTERN.test(labels.Smoke.trim())) {
        failures.push(`Implemented Spec 的「Smoke：」必须链接存在的可执行入口，或写「不适用——<理由>」：${path}`);
    }
}

/**
 * 受管组件目前只有 nb-ui barrel 导出的组件；缺少同名契约文档时阻断 docs:check。
 * 新应用的通用组件目录随 workbench 底座确定后加入。
 */
function checkComponentDocuments(
    repoRoot: string,
    fileSet: ReadonlySet<string>,
    failures: string[],
): void {
    const barrel = resolve(repoRoot, NB_UI_COMPONENT_BARREL);
    const exported = existsSync(barrel)
        ? [...readFileSync(barrel, "utf8").matchAll(NB_UI_COMPONENT_EXPORT_PATTERN)].map((match) => `packages/nb-ui/src/components/${match[1]}.vue`)
        : [];
    const managed = new Set(exported.filter((path) => fileSet.has(path)));
    for (const path of [...managed].sort()) {
        const documentPath = `${path.slice(0, -".vue".length)}.md`;
        if (!fileSet.has(documentPath)) {
            failures.push(`受管组件缺少同名文档：${path}（应为 ${documentPath}）`);
            continue;
        }
        const text = readFileSync(resolve(repoRoot, documentPath), "utf8");
        const frontmatter = FRONTMATTER_PATTERN.exec(text)?.[1];
        if (frontmatter === undefined) {
            failures.push(`受管组件文档缺少 frontmatter：${documentPath}`);
            continue;
        }
        let metadata: unknown;
        try {
            metadata = parseYaml(frontmatter);
        } catch {
            failures.push(`受管组件文档 frontmatter 无法解析：${documentPath}`);
            continue;
        }
        const tags = metadata !== null && typeof metadata === "object" && "标签" in metadata ? metadata.标签 : undefined;
        if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !COMPONENT_TAGS.has(tag))) {
            failures.push(`受管组件文档必须声明封闭清单内的「标签」数组：${documentPath}`);
        }
    }
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
        if (resolved === null || !resolved.startsWith("docs/specs/")) continue;
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
    const capabilityPlaceholder = typeof capability === "string" && TEMPLATE_PLACEHOLDER_PATTERN.test(capability);
    if (capabilityPlaceholder) failures.push(`Spec capability 仍是模板占位值：${path}`);
    else if (typeof capability !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)) failures.push(`Spec capability 必须是稳定的点分小写标识：${path}`);
    const ownersValid = Array.isArray(owners) && owners.length > 0 && owners.every((owner) => typeof owner === "string" && owner.trim() !== "");
    const ownerPlaceholder = ownersValid && owners.some((owner: string) => TEMPLATE_PLACEHOLDER_PATTERN.test(owner));
    if (!ownersValid) failures.push(`Spec owners 必须是非空模块列表：${path}`);
    else if (ownerPlaceholder) failures.push(`Spec owners 仍包含模板占位值：${path}`);
    if (schema !== "nbook.spec/v1" || typeof kind !== "string" || !SPEC_KINDS.has(kind)
        || typeof status !== "string" || !SPEC_STATUSES.has(status)
        || typeof capability !== "string" || capabilityPlaceholder || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)
        || !ownersValid || ownerPlaceholder) return null;
    return {kind, status, capability};
}

if (import.meta.main) {
    const {repoRoot, since, all} = readChangeScopeArguments(import.meta.url);
    const report = checkDocumentation(repoRoot, {warningScope: all ? undefined : changedFiles(repoRoot, since)});
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length > 0) process.exitCode = 1;
}

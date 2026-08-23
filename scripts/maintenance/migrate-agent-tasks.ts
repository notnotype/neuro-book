#!/usr/bin/env bun
import {createHash, randomBytes} from "node:crypto";
import {lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {dirname, relative, resolve, sep} from "node:path";
import {canonicalSha256, defaultRepoRoot, git, gitRevision, readGitTextAttributes} from "#scripts/ci/agent-governance-contract";
import {resolveAgentRunRoot} from "@notnotype/neuro-book-test-support/paths";

type Mapping = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: boolean;
};

type Blocker = {path: string; reason: string; worktree?: string; branch?: string};
type Warning = {path?: string; message: string};
type SourceFile = {absolute: string; relative: string};
type PreparedFile = SourceFile & {destination: string; sourceBytes: Uint8Array; outputBytes: Uint8Array; linkRewrite: boolean; preserveSource: boolean};
type PreparedRepositoryLink = {absolute: string; relative: string; sourceBytes: Uint8Array; outputBytes: Uint8Array};
type Worktree = {path: string; head: string; branch?: string; prunable?: string};

const args = process.argv.slice(2);
const repoArgument = args.indexOf("--repo-root");
const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
const apply = args.includes("--apply");
const preserveLocalFiles = args.includes("--preserve-local-files");
const includedLocalPaths = parseIncludedLocalPaths(args);
const runId = randomBytes(4).toString("hex");
const runRoot = resolveAgentRunRoot("task-migration", runId);
const stagingRoot = resolve(runRoot, "staging");
const sourceRoot = resolve(repoRoot, "docs", "tasks");
const destinationRoot = resolve(repoRoot, ".agents", "tasks");
const blockers: Blocker[] = [];
const warnings: Warning[] = [];

function repoPath(path: string): string {
    return relative(repoRoot, path).replaceAll(sep, "/");
}

function sourceRelative(path: string): string {
    return relative(sourceRoot, path).replaceAll(sep, "/");
}

function destinationRelative(sourceRelativePath: string): string {
    if (sourceRelativePath === "README.md" || sourceRelativePath === "TEMPLATE.md") {
        return `archived/docs-tasks-legacy/${sourceRelativePath}`;
    }
    return sourceRelativePath.split("/").map((segment) => segment === "evidence" ? "evidences" : segment).join("/");
}

function destinationForRelative(sourceRelativePath: string): string {
    return resolve(destinationRoot, ...destinationRelative(sourceRelativePath).split("/"));
}

/** 解析显式允许复制的未跟踪 Task 文件，并拒绝越出源目录的路径。 */
function parseIncludedLocalPaths(values: string[]): Set<string> {
    const paths = new Set<string>();
    for (let index = 0; index < values.length; index += 1) {
        if (values[index] !== "--include-untracked") continue;
        const value = values[index + 1];
        if (!value || value.startsWith("--")) throw new Error("--include-untracked 需要一个 docs/tasks 下的文件路径。");
        const normalized = value.replaceAll("\\", "/");
        if (!normalized.startsWith("docs/tasks/") || normalized.split("/").includes("..")) {
            throw new Error(`--include-untracked 只能指向 docs/tasks 下的文件：${value}`);
        }
        paths.add(normalized.slice("docs/tasks/".length));
        index += 1;
    }
    return paths;
}

async function rawSha256(bytesOrPath: Uint8Array | string): Promise<string> {
    const bytes = typeof bytesOrPath === "string" ? await readFile(bytesOrPath) : bytesOrPath;
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}


async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
    try {
        return await stat(path);
    } catch {
        return null;
    }
}

async function safeRegularFile(path: string): Promise<boolean> {
    const info = await safeStat(path);
    return Boolean(info?.isFile());
}

async function safeDirectory(path: string): Promise<boolean> {
    const info = await safeStat(path);
    return Boolean(info?.isDirectory());
}

async function walk(directory: string): Promise<SourceFile[]> {
    const entries = await readdir(directory, {withFileTypes: true});
    const result: SourceFile[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...await walk(absolute));
        } else if (entry.isFile()) {
            result.push({absolute, relative: sourceRelative(absolute)});
        } else {
            blockers.push({path: repoPath(absolute), reason: "特殊文件或链接不能作为历史 Task 输入"});
        }
    }
    return result;
}

function decodeUtf8(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        return null;
    }
}

function splitLinkTarget(rawTarget: string): {path: string; suffix: string} | null {
    const target = rawTarget.trim();
    if (!target || target.startsWith("<")) return null;
    const index = target.search(/[?#]/u);
    return index < 0 ? {path: target, suffix: ""} : {path: target.slice(0, index), suffix: target.slice(index)};
}

function isGitHubTaskLink(path: string): boolean {
    return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\/master\/docs\/tasks\//u.test(path);
}

async function rewriteMarkdown(text: string, source: string): Promise<{text: string; changed: boolean}> {
    const pattern = /(!?\[[^\]]*\]\()([^)]*)(\))/gu;
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) return {text, changed: false};
    const pieces: string[] = [];
    let cursor = 0;
    let changed = false;
    for (const match of matches) {
        const index = match.index ?? 0;
        const whole = match[0];
        const prefix = match[1] ?? "";
        const rawTarget = match[2] ?? "";
        const closing = match[3] ?? ")";
        pieces.push(text.slice(cursor, index));
        const split = splitLinkTarget(rawTarget);
        if (!split) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        if (isGitHubTaskLink(split.path)) {
            const rewrittenTarget = split.path.replace("/blob/master/docs/tasks/", "/blob/master/.agents/tasks/");
            pieces.push(`${prefix}${rewrittenTarget}${split.suffix}${closing}`);
            changed = true;
            cursor = index + whole.length;
            continue;
        }
        if (split.path.startsWith("http://") || split.path.startsWith("https://") || split.path.startsWith("mailto:") || split.path.startsWith("#")) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        let decodedPath: string;
        try {
            decodedPath = decodeURIComponent(split.path);
        } catch {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        const target = resolve(dirname(source), decodedPath);
        if (!target.startsWith(`${sourceRoot}${sep}`) && target !== sourceRoot) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        if (!await safeStat(target)) {
            warnings.push({path: repoPath(source), message: `迁移前已断开的本地链接：${split.path}`});
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        const targetRelative = sourceRelative(target);
        const fromDestination = relative(dirname(destinationForRelative(sourceRelative(source))), destinationForRelative(targetRelative)).replaceAll(sep, "/") || ".";
        pieces.push(`${prefix}${fromDestination}${split.suffix}${closing}`);
        changed = true;
        cursor = index + whole.length;
    }
    pieces.push(text.slice(cursor));
    return {text: pieces.join(""), changed};
}

/** 准备仓库外部 Markdown 中指向历史 Task 的链接重写；源码 Task 文件由 prepareFiles 自己处理。 */
async function prepareRepositoryLinkRewrites(mappings: readonly Mapping[]): Promise<PreparedRepositoryLink[]> {
    const sourceToDestination = new Map(mappings.map((mapping) => [
        resolve(repoRoot, mapping.source),
        resolve(repoRoot, mapping.destination),
    ]));
    const trackedMarkdown = git(repoRoot, ["ls-files"])
        .split(/\r?\n/u)
        .filter((path) => path.endsWith(".md") && !path.startsWith("docs/tasks/"));
    const prepared: PreparedRepositoryLink[] = [];
    for (const relativePath of trackedMarkdown) {
        const absolute = resolve(repoRoot, relativePath);
        const sourceBytes = new Uint8Array(await readFile(absolute));
        const sourceText = decodeUtf8(sourceBytes);
        if (sourceText === null) continue;
        const rewritten = rewriteRepositoryMarkdown(sourceText, absolute, sourceToDestination);
        if (rewritten.changed) {
            prepared.push({absolute, relative: relativePath, sourceBytes, outputBytes: new TextEncoder().encode(rewritten.text)});
        }
    }
    return prepared;
}

/** 把仓库外部的相对、根相对和 GitHub Task 链接指向新 canonical 目录。 */
function rewriteRepositoryMarkdown(
    text: string,
    source: string,
    sourceToDestination: ReadonlyMap<string, string>,
): {text: string; changed: boolean} {
    const pattern = /(!?\[[^\]]*\]\()([^)]*)(\))/gu;
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) return {text, changed: false};
    const pieces: string[] = [];
    let cursor = 0;
    let changed = false;
    for (const match of matches) {
        const index = match.index ?? 0;
        const whole = match[0];
        const prefix = match[1] ?? "";
        const rawTarget = match[2] ?? "";
        const closing = match[3] ?? ")";
        pieces.push(text.slice(cursor, index));
        const split = splitLinkTarget(rawTarget);
        if (!split) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        if (isGitHubTaskLink(split.path)) {
            const marker = "/blob/master/docs/tasks/";
            const markerIndex = split.path.indexOf(marker);
            const sourceRelative = decodeURIComponent(split.path.slice(markerIndex + marker.length));
            const destination = sourceToDestination.get(resolve(sourceRoot, sourceRelative));
            if (destination) {
                const destinationPath = repoPath(destination);
                const rewrittenTarget = `${split.path.slice(0, markerIndex)}/blob/master/${destinationPath}`;
                pieces.push(`${prefix}${rewrittenTarget}${split.suffix}${closing}`);
                changed = true;
                cursor = index + whole.length;
                continue;
            }
        }
        if (split.path.startsWith("http://") || split.path.startsWith("https://") || split.path.startsWith("mailto:") || split.path.startsWith("#")) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        let decodedPath: string;
        try {
            decodedPath = decodeURIComponent(split.path);
        } catch {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        const destination = sourceToDestination.get(resolve(dirname(source), decodedPath));
        if (!destination) {
            pieces.push(whole);
            cursor = index + whole.length;
            continue;
        }
        let rewrittenTarget = relative(dirname(source), destination).replaceAll(sep, "/") || ".";
        if (!rewrittenTarget.startsWith(".")) rewrittenTarget = `./${rewrittenTarget}`;
        pieces.push(`${prefix}${rewrittenTarget}${split.suffix}${closing}`);
        changed = true;
        cursor = index + whole.length;
    }
    pieces.push(text.slice(cursor));
    return {text: pieces.join(""), changed};
}

function repositoryLinkStagingPath(file: PreparedRepositoryLink): string {
    return resolve(stagingRoot, "repository-links", ...file.relative.split("/"));
}

async function writeRepositoryLinkStaging(files: readonly PreparedRepositoryLink[]): Promise<void> {
    for (const file of files) {
        const staged = repositoryLinkStagingPath(file);
        await mkdir(dirname(staged), {recursive: true});
        await writeFile(staged, file.outputBytes);
    }
}

async function verifyRepositoryLinkStaging(files: readonly PreparedRepositoryLink[]): Promise<void> {
    for (const file of files) {
        const staged = repositoryLinkStagingPath(file);
        if (!await safeRegularFile(staged)) {
            blockers.push({path: repoPath(staged), reason: "仓库外部链接 staging 文件缺失"});
            continue;
        }
        if (await rawSha256(staged) !== await rawSha256(file.outputBytes)) {
            blockers.push({path: repoPath(staged), reason: "仓库外部链接 staging SHA-256 不匹配"});
        }
    }
}

async function prepareFiles(files: SourceFile[], preservedSourcePaths: ReadonlySet<string>, textAttributes: ReadonlyMap<string, string>): Promise<PreparedFile[]> {
    const prepared: PreparedFile[] = [];
    const destinations = new Map<string, string>();
    for (const file of files) {
        const sourceBytes = new Uint8Array(await readFile(file.absolute));
        const destination = destinationForRelative(file.relative);
        const destinationKey = destination.toLocaleLowerCase("en-US");
        const previous = destinations.get(destinationKey);
        if (previous && previous !== destination) {
            blockers.push({path: file.relative, reason: `目标大小写路径碰撞：${repoPath(previous)} 与 ${repoPath(destination)}`});
            continue;
        }
        if (destinations.has(destinationKey)) {
            blockers.push({path: file.relative, reason: `目标路径碰撞：${repoPath(destination)}`});
            continue;
        }
        destinations.set(destinationKey, destination);
        let outputBytes: Uint8Array = sourceBytes;
        let linkRewrite = false;
        if (file.relative.endsWith(".md")) {
            const text = decodeUtf8(sourceBytes);
            if (text === null) {
                blockers.push({path: repoPath(file.absolute), reason: "Markdown 不是可安全解码的 UTF-8 文本"});
            } else {
                const rewritten = await rewriteMarkdown(text, file.absolute);
                outputBytes = new TextEncoder().encode(rewritten.text);
                linkRewrite = rewritten.changed;
            }
        }
        const existing = await safeStat(destination);
        if (existing && !existing.isFile()) {
            blockers.push({path: repoPath(destination), reason: "目标已存在且不是普通文件"});
        } else if (existing && await rawSha256(destination) !== await rawSha256(outputBytes)) {
            blockers.push({path: repoPath(destination), reason: "目标已存在但 bytes 不同"});
        }
        prepared.push({...file, destination, sourceBytes, outputBytes, linkRewrite, preserveSource: preservedSourcePaths.has(file.relative)});
    }
    return prepared;
}

function parseWorktrees(text: string): Worktree[] {
    return text.split(/\r?\n\r?\n/u).filter(Boolean).map((block) => {
        const values: Partial<Worktree> = {};
        for (const line of block.split(/\r?\n/u)) {
            const separator = line.indexOf(" ");
            if (separator < 0) continue;
            const key = line.slice(0, separator);
            const value = line.slice(separator + 1);
            if (key === "worktree" || key === "head" || key === "branch" || key === "prunable") {
                if (key === "worktree") values.path = value;
                else values[key] = value;
            }
        }
        return {path: values.path ?? "", head: values.head ?? "", branch: values.branch, prunable: values.prunable};
    }).filter((entry) => entry.path && entry.head);
}

async function compareWorktrees(): Promise<void> {
    const currentPath = resolve(repoRoot);
    const currentHead = gitRevision(repoRoot);
    let worktrees: Worktree[];
    try {
        worktrees = parseWorktrees(git(repoRoot, ["worktree", "list", "--porcelain"]));
    } catch (error) {
        blockers.push({path: ".git/worktrees", reason: `无法读取 worktree 列表：${String(error)}`});
        return;
    }
    for (const worktree of worktrees) {
        if (resolve(worktree.path) === currentPath) continue;
        if (worktree.prunable) {
            warnings.push({path: worktree.path, message: `worktree 已标记 prunable，未读取其文件：${worktree.prunable}`});
            continue;
        }
        let status = "";
        try {
            status = git(worktree.path, ["status", "--porcelain=v1", "--untracked-files=all", "--", "docs/tasks"]);
        } catch (error) {
            warnings.push({path: worktree.path, message: `无法读取 worktree 状态：${String(error)}`});
            continue;
        }
        for (const line of status.split(/\r?\n/u).filter(Boolean)) {
            const pathText = line.slice(3).replace(/^"|"$/gu, "").replaceAll("\\", "/");
            if (!pathText.startsWith("docs/tasks/")) continue;
            const candidate = resolve(worktree.path, pathText);
            const ours = resolve(repoRoot, pathText);
            const same = await safeRegularFile(candidate) && await safeRegularFile(ours)
                && await rawSha256(candidate) === await rawSha256(ours);
            if (!same) blockers.push({path: pathText, worktree: worktree.path, branch: worktree.branch, reason: "停工 worktree 工作区有独有 Task bytes，不能静默覆盖或合并"});
        }
        let mergeBase: string;
        try {
            mergeBase = git(repoRoot, ["merge-base", currentHead, worktree.head]);
        } catch (error) {
            blockers.push({path: worktree.path, worktree: worktree.path, branch: worktree.branch, reason: `无法建立三方比较 base：${String(error)}`});
            continue;
        }
        let changed = "";
        try {
            changed = git(repoRoot, ["diff", "--name-only", `${mergeBase}..${worktree.head}`, "--", "docs/tasks"]);
        } catch (error) {
            blockers.push({path: worktree.path, worktree: worktree.path, branch: worktree.branch, reason: `无法读取 committed Task diff：${String(error)}`});
            continue;
        }
        for (const pathText of changed.split(/\r?\n/u).filter(Boolean)) {
            const candidate = resolve(worktree.path, pathText);
            const ours = resolve(repoRoot, pathText);
            const same = await safeRegularFile(candidate) && await safeRegularFile(ours)
                && await rawSha256(candidate) === await rawSha256(ours);
            if (!same) warnings.push({path: pathText, message: `worktree committed branch 含与当前 master 不同的 Task bytes，需人工确认吸收：${worktree.path}`});
        }
    }
}

async function writeStaging(prepared: PreparedFile[]): Promise<void> {
    await mkdir(stagingRoot, {recursive: true});
    for (const file of prepared) {
        const destination = resolve(stagingRoot, ...destinationRelative(file.relative).split("/"));
        await mkdir(dirname(destination), {recursive: true});
        await writeFile(destination, file.outputBytes);
    }
}

async function verifyStaging(prepared: PreparedFile[]): Promise<void> {
    for (const file of prepared) {
        const staged = resolve(stagingRoot, ...destinationRelative(file.relative).split("/"));
        if (!await safeRegularFile(staged)) {
            blockers.push({path: repoPath(staged), reason: "staging 文件缺失"});
            continue;
        }
        if (await rawSha256(staged) !== await rawSha256(file.outputBytes)) blockers.push({path: repoPath(staged), reason: "staging SHA-256 不匹配"});
    }
}

async function pruneEmptyDirectories(directory: string): Promise<void> {
    if (!await safeDirectory(directory)) return;
    const entries = await readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory()) await pruneEmptyDirectories(resolve(directory, entry.name));
    }
    if ((await readdir(directory)).length === 0) await rmdir(directory);
}

async function applyMigration(
    prepared: PreparedFile[],
    repositoryLinkRewrites: readonly PreparedRepositoryLink[],
    sourceRevision: string,
    mappings: Mapping[],
    trackedFileCount: number,
    localOnlyFiles: string[],
): Promise<void> {
    await writeStaging(prepared);
    await writeRepositoryLinkStaging(repositoryLinkRewrites);
    await verifyStaging(prepared);
    await verifyRepositoryLinkStaging(repositoryLinkRewrites);
    if (blockers.length > 0) return;
    for (const file of prepared) {
        const staged = resolve(stagingRoot, ...destinationRelative(file.relative).split("/"));
        await mkdir(dirname(file.destination), {recursive: true});
        await writeFile(file.destination, await readFile(staged));
    }
    for (const file of repositoryLinkRewrites) {
        await writeFile(file.absolute, await readFile(repositoryLinkStagingPath(file)));
    }
    const preservedSourceFiles = prepared.filter((file) => file.preserveSource).map((file) => repoPath(file.absolute));
    const repositoryLinkPaths = repositoryLinkRewrites.map((file) => repoPath(file.absolute));
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: repositoryLinkPaths, preservedSourceFiles};
    const manifestSha256 = await rawSha256(new TextEncoder().encode(JSON.stringify(manifest)));
    await writeFile(resolve(destinationRoot, "legacy-index.json"), `${JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: new Date().toISOString(), mappings, repositoryLinkRewrites: repositoryLinkPaths, preservedSourceFiles, trackedFileCount, localOnlyFiles}, null, 2)}\n`, "utf8");
    await writeFile(resolve(destinationRoot, ".migration-complete"), `${JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256, completedAt: new Date().toISOString(), repositoryLinkRewrites: repositoryLinkPaths, preservedSourceFiles, trackedFileCount, localOnlyFiles}, null, 2)}\n`, "utf8");
    for (const file of prepared) {
        if (!file.preserveSource) await rm(file.absolute, {recursive: false, force: false});
    }
    await pruneEmptyDirectories(sourceRoot);
}

async function main(): Promise<void> {
    const sourceRevision = gitRevision(repoRoot);
    if (!await safeDirectory(sourceRoot)) blockers.push({path: "docs/tasks", reason: "源 Task 目录不存在"});
    const files = await safeDirectory(sourceRoot) ? await walk(sourceRoot) : [];
    const tracked = new Set(git(repoRoot, ["ls-files", "docs/tasks"]).split(/\r?\n/u).filter(Boolean).map((path) => path.startsWith("docs/tasks/") ? path.slice("docs/tasks/".length) : path));
    const localFiles = files.filter((file) => !tracked.has(file.relative));
    const includedLocalFiles = localFiles.filter((file) => includedLocalPaths.has(file.relative));
    const includedLocalSet = new Set(includedLocalFiles.map((file) => file.relative));
    for (const requested of includedLocalPaths) {
        if (!localFiles.some((file) => file.relative === requested)) {
            blockers.push({path: `docs/tasks/${requested}`, reason: "--include-untracked 必须指向当前存在且未跟踪的源文件"});
        }
    }
    for (const file of localFiles) {
        const path = `docs/tasks/${file.relative}`;
        if (includedLocalSet.has(file.relative)) {
            warnings.push({path, message: "按 --include-untracked 显式复制到 canonical Task 目录；源文件保留"});
        } else if (preserveLocalFiles) {
            warnings.push({path, message: "按 --preserve-local-files 原地保留，不复制也不删除"});
        } else {
            blockers.push({path, reason: "源目录包含未跟踪或被忽略文件，拒绝静默迁移"});
        }
    }
    const hasExplicitLocalPolicy = preserveLocalFiles || includedLocalPaths.size > 0;
    const migrationFiles = hasExplicitLocalPolicy
        ? files.filter((file) => tracked.has(file.relative) || includedLocalSet.has(file.relative))
        : files;
    const preservedSourcePaths = new Set(includedLocalFiles.map((file) => file.relative));
    await compareWorktrees();
    const canonicalPaths = migrationFiles.flatMap((file) => [`docs/tasks/${file.relative}`, repoPath(destinationForRelative(file.relative))]);
    const textAttributes = readGitTextAttributes(repoRoot, canonicalPaths);
    const prepared = await prepareFiles(migrationFiles, preservedSourcePaths, textAttributes);
    const mappings: Mapping[] = prepared.map((file) => ({source: repoPath(file.absolute), destination: repoPath(file.destination), sourceSha256: "", destinationSha256: "", kind: "file", linkRewrite: file.linkRewrite}));
    for (let index = 0; index < prepared.length; index += 1) {
        const file = prepared[index];
        const mapping = mappings[index];
        mapping.sourceSha256 = canonicalSha256(file.sourceBytes, textAttributes.get(`docs/tasks/${file.relative}`) ?? "unspecified");
        mapping.destinationSha256 = canonicalSha256(file.outputBytes, textAttributes.get(repoPath(file.destination)) ?? "unspecified");
    }
    const repositoryLinkRewrites = await prepareRepositoryLinkRewrites(mappings);
    const repositoryLinkPaths = repositoryLinkRewrites.map((file) => repoPath(file.absolute));
    const preservedLocalFiles = localFiles.filter((file) => !includedLocalSet.has(file.relative)).map((file) => `docs/tasks/${file.relative}`);
    const preservedSourceFiles = prepared.filter((file) => file.preserveSource).map((file) => repoPath(file.absolute));
    const trackedFileCount = prepared.filter((file) => tracked.has(file.relative)).length;
    const localOnlyFiles = includedLocalFiles.map((file) => `docs/tasks/${file.relative}`);
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: repositoryLinkPaths, preservedSourceFiles};
    const manifestSha256 = await rawSha256(new TextEncoder().encode(JSON.stringify(manifest)));
    const report = {schema: "nbook.task-migration-report/v1", mode: apply ? "apply" : "dry-run", repoRoot, sourceRevision, runId, stagingRoot, sourceRoot: "docs/tasks", destinationRoot: ".agents/tasks", fileCount: mappings.length, trackedFileCount, localOnlyFiles, manifestSha256, includedLocalFiles: includedLocalFiles.map((file) => `docs/tasks/${file.relative}`), preservedLocalFiles, repositoryLinkRewrites: repositoryLinkPaths, mappings, blockers, warnings};
    await mkdir(stagingRoot, {recursive: true});
    await writeFile(resolve(stagingRoot, "migration-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(resolve(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (apply && blockers.length === 0) await applyMigration(prepared, repositoryLinkRewrites, sourceRevision, mappings, trackedFileCount, localOnlyFiles);
    console.log(JSON.stringify(report, null, 2));
    if (blockers.length > 0) process.exitCode = 1;
}


await main();

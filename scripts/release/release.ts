#!/usr/bin/env bun
import {readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

import {Command} from "commander";

import {run, runCapture} from "nbook/scripts/utils/process.mjs";

type CommonOptions = {
    dryRun: boolean;
    push: boolean;
    repo: string;
    watch: boolean;
    yes: boolean;
};

type PrereleaseChannel = "alpha" | "beta" | "canary" | "rc" | "rp";

type PrereleaseOptions = CommonOptions & {
    allowDirty: boolean;
    channel?: PrereleaseChannel;
    currentPatch: boolean;
    draft: boolean;
    next?: ReleaseIncrement;
    sequence?: string;
    tag?: string;
    target?: string;
    version?: string;
};

type ReleaseIncrement = "major" | "minor" | "patch";

type StableOptions = CommonOptions & {
    draft: boolean;
    next?: ReleaseIncrement;
    version?: string;
};

type ReleaseNotesInput = {
    channel: PrereleaseChannel;
    packageVersion: string;
    tag: string;
    target: string;
};

type WorkflowRun = {
    databaseId?: number;
    displayTitle?: string;
    headSha?: string;
};

type ParsedVersion = {
    major: number;
    minor: number;
    patch: number;
};

type ParsedPrereleaseTag = {
    baseVersion: string;
    channel: PrereleaseChannel;
    packageVersion: string;
    tag: string;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_REPO = "notnotype/neuro-book";
const RELEASE_WORKFLOW = "release-container.yml";
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");

/** CLI 入口。 */
async function main(): Promise<void> {
    process.chdir(REPO_ROOT);

    const program = new Command()
        .name("release")
        .description("NeuroBook release helper.")
        .showHelpAfterError("(使用 --help 查看可用参数)");

    addStableCommand(program);
    addPrereleaseCommand(program);
    addPrereleaseAliasCommand(program, "canary");
    addPrereleaseAliasCommand(program, "alpha");
    addPrereleaseAliasCommand(program, "beta");
    addPrereleaseAliasCommand(program, "rc");
    addPrereleaseAliasCommand(program, "rp");

    await program.parseAsync(process.argv);
}

/** 注册正式版发布子命令。 */
function addStableCommand(program: Command): void {
    program
        .command("stable")
        .description("Create a stable NeuroBook release.")
        .option("--version <version>", "正式版本号，例如 0.1.3 或 v0.1.3。")
        .option("--next <part>", "自动增长正式版本：patch、minor、major。", parseReleaseIncrement)
        .option("--draft", "创建 draft release。draft 不会等待 release workflow。", false)
        .option("--dry-run", "只打印将执行的命令，不写文件、不提交、不创建 release。", false)
        .option("--push", "发布前推送当前分支和 tag。", false)
        .option("--repo <repo>", "GitHub repository，例如 owner/name。", process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO)
        .option("--watch", "等待 release workflow 完成。", true)
        .option("--no-watch", "创建 release 后不等待 release workflow。")
        .option("-y, --yes", "确认创建远端 stable release。", false)
        .action((options: StableOptions) => runStable(options));
}

/** 注册通用先行版本发布子命令。 */
function addPrereleaseCommand(program: Command): void {
    program
        .command("prerelease")
        .description("Create a NeuroBook SemVer prerelease.")
        .option("--allow-dirty", "允许 tracked worktree 不干净。真实发布通常不建议使用。", false)
        .option("--channel <channel>", "先行版本标识符：canary、alpha、beta、rc、rp。", parsePrereleaseChannel, "canary")
        .option("--draft", "创建 draft release。draft 不会等待 release workflow。", false)
        .option("--dry-run", "只打印将执行的 gh release create 命令。", false)
        .option("--current-patch", "基于当前 package patch 生成 prerelease；默认使用下一 patch。通常只用于补发当前版本线。", false)
        .option("--next <part>", "自动增长 prerelease 基础版本：patch、minor、major。默认等同 patch。", parseReleaseIncrement)
        .option("--push", "发布前把当前 HEAD 推送到当前分支。", false)
        .option("--repo <repo>", "GitHub repository，例如 owner/name。", process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO)
        .option("--sequence <id>", "手动指定先行版本序号或标识；alpha/beta/rc 默认自动递增，canary 默认使用 UTC 时间戳和短 SHA。")
        .option("--tag <tag>", "指定完整 tag。会按 SemVer tag 校验，例如 v0.1.3-beta.1。")
        .option("--target <commit>", "指定 release target commit。默认使用当前 HEAD。")
        .option("--version <version>", "指定基础版本号，例如 0.1.3 或 v0.1.3；不能带 prerelease。")
        .option("--watch", "等待 release workflow 完成。", true)
        .option("--no-watch", "创建 release 后不等待 release workflow。")
        .option("-y, --yes", "确认创建远端 prerelease。", false)
        .action((options: PrereleaseOptions) => runPrerelease(options));
}

/** 注册 alpha/beta/rc/canary 快捷子命令。 */
function addPrereleaseAliasCommand(program: Command, channel: PrereleaseChannel): void {
    program
        .command(channel)
        .description(`Create a NeuroBook ${channel} prerelease.`)
        .option("--allow-dirty", "允许 tracked worktree 不干净。真实发布通常不建议使用。", false)
        .option("--draft", "创建 draft release。draft 不会等待 release workflow。", false)
        .option("--dry-run", "只打印将执行的 gh release create 命令。", false)
        .option("--current-patch", "基于当前 package patch 生成 prerelease；默认使用下一 patch。通常只用于补发当前版本线。", false)
        .option("--next <part>", "自动增长 prerelease 基础版本：patch、minor、major。默认等同 patch。", parseReleaseIncrement)
        .option("--push", "发布前把当前 HEAD 推送到当前分支。", false)
        .option("--repo <repo>", "GitHub repository，例如 owner/name。", process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO)
        .option("--sequence <id>", "手动指定先行版本序号或标识；alpha/beta/rc 默认自动递增，canary 默认使用 UTC 时间戳和短 SHA。")
        .option("--tag <tag>", "指定完整 tag。会按 SemVer tag 校验，例如 v0.1.3-beta.1。")
        .option("--target <commit>", "指定 release target commit。默认使用当前 HEAD。")
        .option("--version <version>", "指定基础版本号，例如 0.1.3 或 v0.1.3；不能带 prerelease。")
        .option("--watch", "等待 release workflow 完成。", true)
        .option("--no-watch", "创建 release 后不等待 release workflow。")
        .option("-y, --yes", `确认创建远端 ${channel} prerelease。`, false)
        .action((options: PrereleaseOptions) => runPrerelease({...options, channel}));
}

/** 正式版发布主流程。 */
async function runStable(options: StableOptions): Promise<void> {
    const currentPackageVersion = await readPackageVersion();
    const version = resolveStableVersion(options, currentPackageVersion);
    const tag = `v${version}`;
    assertVersionNotLower(version, releaseVersionOf(currentPackageVersion), "stable version");
    const branch = await currentBranch();
    const initialHead = await currentHead();
    const shouldBumpPackage = currentPackageVersion !== version;

    if (options.dryRun) {
        await printStableDryRun({
            branch,
            currentPackageVersion,
            initialHead,
            options,
            shouldBumpPackage,
            tag,
            version,
        });
        return;
    }

    if (!options.yes) {
        throw new Error("即将创建远端 stable release。确认执行请加 --yes；预览请加 --dry-run。");
    }
    if (!options.push) {
        throw new Error("stable release 需要 --push，确保 release commit 和 tag 都先到远端后再创建 GitHub Release。");
    }

    await assertGhAvailable();
    await assertReleaseDoesNotExist(tag, options.repo);
    await assertGitTagDoesNotExist(tag);
    await assertCleanWorktree();
    await run("bun", ["run", "manager:verify-public"], {cwd: REPO_ROOT});

    if (shouldBumpPackage) {
        await writePackageVersion(version);
        await run("git", ["add", "package.json"], {cwd: REPO_ROOT});
        await run("git", ["commit", "-m", `chore(release): ${tag}`], {cwd: REPO_ROOT});
    }

    const releaseHead = await currentHead();
    await run("git", ["tag", tag], {cwd: REPO_ROOT});

    await pushCurrentHead(branch);
    await run("git", ["push", "origin", tag], {cwd: REPO_ROOT});

    const ghArgs = stableReleaseArgs({
        draft: options.draft,
        repo: options.repo,
        tag,
    });
    await run("gh", ghArgs, {cwd: REPO_ROOT});
    console.log(`Created stable release: ${tag}`);

    if (options.watch && !options.draft) {
        await watchReleaseWorkflow({head: releaseHead, repo: options.repo, tag});
    }
}

/** 先行版本发布主流程。 */
async function runPrerelease(options: PrereleaseOptions): Promise<void> {
    const packageVersion = await readPackageVersion();
    const branch = await currentBranch();
    const head = await currentHead();
    const shortHead = (await runCapture("git", ["rev-parse", "--short", "HEAD"], {cwd: REPO_ROOT})).trim();
    const tagPlan = await resolvePrereleaseTag({
        channel: options.channel ?? "canary",
        currentVersion: packageVersion,
        currentPatch: options.currentPatch,
        next: options.next,
        sequence: options.sequence,
        shortHead,
        tag: options.tag,
        version: options.version,
    });
    const channel = tagPlan.channel;
    const tag = tagPlan.tag;
    const shouldBumpPackage = packageVersion !== tagPlan.packageVersion;
    const target = options.target ?? (shouldBumpPackage ? "<release-commit>" : head);

    if (options.target && shouldBumpPackage) {
        throw new Error("prerelease 需要更新 package.json 时不能同时使用 --target；请从当前分支发布，或先手动提交目标版本。");
    }

    if (options.dryRun) {
        const notes = await prereleaseNotes({
            channel,
            tag,
            target,
            packageVersion: tagPlan.packageVersion,
        }, options.repo);
        const ghArgs = prereleaseArgs({
            draft: options.draft,
            notes,
            repo: options.repo,
            tag,
            target,
        });
        await printCanaryDryRun({
            branch,
            channel,
            currentPackageVersion: packageVersion,
            ghArgs,
            options,
            shouldBumpPackage,
            tag,
            target,
            packageVersion: tagPlan.packageVersion,
        });
        return;
    }

    if (!options.yes) {
        throw new Error("即将创建远端 prerelease。确认执行请加 --yes；预览请加 --dry-run。");
    }
    if (shouldBumpPackage && !options.push) {
        throw new Error("prerelease 需要更新 package.json 时必须加 --push，确保 release commit 先到远端；预览请加 --dry-run。");
    }

    await assertGhAvailable();
    await assertReleaseDoesNotExist(tag, options.repo);
    await assertGitTagDoesNotExist(tag);
    if (shouldBumpPackage || !options.allowDirty) {
        await assertCleanTrackedWorktree();
    }
    await run("bun", ["run", "manager:verify-public"], {cwd: REPO_ROOT});
    if (shouldBumpPackage) {
        await writePackageVersion(tagPlan.packageVersion);
        await run("git", ["add", "package.json"], {cwd: REPO_ROOT});
        await run("git", ["commit", "-m", `chore(release): ${tag}`], {cwd: REPO_ROOT});
    }
    const releaseHead = options.target ?? await currentHead();
    if (options.push && !options.dryRun) {
        await pushCurrentHead(branch);
    } else if (!options.target && !options.dryRun) {
        await assertCurrentHeadPushed(branch, releaseHead);
    }

    const notes = await prereleaseNotes({
        channel,
        tag,
        target: releaseHead,
        packageVersion: tagPlan.packageVersion,
    }, options.repo);
    const ghArgs = prereleaseArgs({
        draft: options.draft,
        notes,
        repo: options.repo,
        tag,
        target: releaseHead,
    });

    await run("gh", ghArgs, {cwd: REPO_ROOT});
    console.log(`Created ${channel} prerelease: ${tag}`);

    if (options.watch && !options.draft) {
        await watchReleaseWorkflow({head: releaseHead, repo: options.repo, tag});
    }
}

/** 打印正式版 dry-run 计划。 */
async function printStableDryRun(input: {
    branch: string;
    currentPackageVersion: string;
    initialHead: string;
    options: StableOptions;
    shouldBumpPackage: boolean;
    tag: string;
    version: string;
}): Promise<void> {
    const releaseHead = input.shouldBumpPackage ? "<release-commit>" : input.initialHead;
    console.log(`mode: stable`);
    console.log(`version: ${input.version}`);
    console.log(`tag: ${input.tag}`);
    console.log(`repo: ${input.options.repo}`);
    console.log(`branch: ${input.branch}`);
    console.log(`package version: ${input.currentPackageVersion}`);
    if (await worktreeIsDirty()) {
        console.log("warning: 真实 stable release 要求工作区完全干净。");
    }
    await printDryRunTagWarnings(input.tag, input.options.repo);
    console.log("command: bun run manager:verify-public");
    if (input.shouldBumpPackage) {
        console.log(`command: update package.json version ${input.currentPackageVersion} -> ${input.version}`);
        console.log("command: git add package.json");
        console.log(`command: git commit -m ${shellQuote(`chore(release): ${input.tag}`)}`);
    } else {
        console.log("note: package.json.version 已是目标版本，不会创建版本 bump commit。");
    }
    console.log(`command: git tag ${input.tag}`);
    if (input.options.push) {
        console.log(`command: git push origin HEAD:${input.branch}`);
        console.log(`command: git push origin ${input.tag}`);
    } else {
        console.log("warning: 未传 --push；真实 stable release 会提前停止，避免留下未推送 tag。");
    }
    console.log(`command: gh ${stableReleaseArgs({
        draft: input.options.draft,
        repo: input.options.repo,
        tag: input.tag,
    }).map(shellQuote).join(" ")}`);
    if (input.options.watch && !input.options.draft) {
        console.log(`command: gh run watch <release-workflow-run-id> --repo ${input.options.repo} --exit-status`);
    }
    console.log(`target: ${releaseHead}`);
}

/** 打印 canary dry-run 计划。 */
async function printCanaryDryRun(input: {
    branch: string;
    channel: PrereleaseChannel;
    currentPackageVersion: string;
    ghArgs: string[];
    options: PrereleaseOptions;
    shouldBumpPackage: boolean;
    tag: string;
    target: string;
    packageVersion: string;
}): Promise<void> {
    console.log("mode: prerelease");
    console.log(`channel: ${input.channel}`);
    console.log(`package version: ${input.packageVersion}`);
    console.log(`tag: ${input.tag}`);
    console.log(`target: ${input.target}`);
    console.log(`repo: ${input.options.repo}`);
    console.log(`branch: ${input.branch}`);
    console.log(`current package version: ${input.currentPackageVersion}`);
    await printDryRunTagWarnings(input.tag, input.options.repo);
    console.log("command: bun run manager:verify-public");
    if (input.shouldBumpPackage) {
        console.log(`command: update package.json version ${input.currentPackageVersion} -> ${input.packageVersion}`);
        console.log("command: git add package.json");
        console.log(`command: git commit -m ${shellQuote(`chore(release): ${input.tag}`)}`);
    } else {
        console.log("note: package.json.version 已是目标 package version，不会创建版本 bump commit。");
    }
    if (!input.options.allowDirty && await trackedWorktreeIsDirty()) {
        console.log("warning: tracked worktree 不干净；真实 canary release 会停止。");
    }
    if (input.options.push) {
        console.log(`command: git push origin HEAD:${input.branch}`);
    } else if (input.shouldBumpPackage) {
        console.log("warning: 未传 --push；真实 prerelease 需要推送 release commit，会提前停止。");
    } else if (!input.options.target) {
        console.log("note: dry-run 未检查 HEAD 是否已推送；真实 release 会检查，或可加 --push。");
    }
    console.log(`command: gh ${input.ghArgs.map(shellQuote).join(" ")}`);
}

/** dry-run 模式下尽量提示已有 release/tag，但不让远端检查阻断预览。 */
async function printDryRunTagWarnings(tag: string, repo: string): Promise<void> {
    const releaseExists = await runCapture("gh", ["release", "view", tag, "--repo", repo], {cwd: REPO_ROOT})
        .then(() => true)
        .catch(() => false);
    if (releaseExists) {
        console.log(`warning: GitHub release 已存在：${tag}`);
    }

    const localTag = await runCapture("git", ["tag", "--list", tag], {cwd: REPO_ROOT})
        .then((value: string) => value.trim())
        .catch(() => "");
    if (localTag) {
        console.log(`warning: 本地 tag 已存在：${tag}`);
    }

    const remoteTag = await runCapture("git", ["ls-remote", "--tags", "origin", tag], {cwd: REPO_ROOT})
        .then((value: string) => value.trim())
        .catch(() => "");
    if (remoteTag) {
        console.log(`warning: 远端 tag 已存在：${tag}`);
    }
}

/** 读取 package.json 版本号。 */
async function readPackageVersion(): Promise<string> {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as {version?: unknown};
    return String(packageJson.version);
}

/** 写入 package.json 版本号，保持现有格式缩进。 */
async function writePackageVersion(version: string): Promise<void> {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as {version?: unknown};
    packageJson.version = version;
    await writeFile(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

/** 规范化正式版版本号。 */
function normalizeReleaseVersion(input: string): string {
    const version = input.trim().replace(/^v/u, "");
    if (!isReleaseVersion(version)) {
        throw new Error(`stable version 必须是 SemVer release 形式 x.y.z：${input}`);
    }
    return version;
}

/** 解析 prerelease channel。 */
function parsePrereleaseChannel(input: string): PrereleaseChannel {
    if (input === "alpha" || input === "beta" || input === "canary" || input === "rc" || input === "rp") {
        return input;
    }
    throw new Error(`prerelease channel 只支持 canary、alpha、beta、rc、rp：${input}`);
}

/** 解析正式版自动增长类型。 */
function parseReleaseIncrement(input: string): ReleaseIncrement {
    if (input === "major" || input === "minor" || input === "patch") {
        return input;
    }
    throw new Error(`--next 只支持 patch、minor、major：${input}`);
}

/** 解析 stable 目标版本；--version 和 --next 必须二选一。 */
function resolveStableVersion(options: StableOptions, currentPackageVersion: string): string {
    if (options.version && options.next) {
        throw new Error("stable --version 和 --next 只能选一个。");
    }
    if (options.version) {
        return normalizeReleaseVersion(options.version);
    }
    if (options.next) {
        return incrementReleaseVersion(currentPackageVersion, options.next);
    }
    throw new Error("stable 需要 --version <x.y.z>，或用 --next patch|minor|major 自动增长。");
}

/** 解析 prerelease tag 计划。 */
async function resolvePrereleaseTag(input: {
    channel: PrereleaseChannel;
    currentVersion: string;
    currentPatch: boolean;
    next?: ReleaseIncrement;
    sequence?: string;
    shortHead: string;
    tag?: string;
    version?: string;
}): Promise<ParsedPrereleaseTag> {
    if (input.tag) {
        if (input.version || input.next || input.currentPatch) {
            throw new Error("prerelease --tag 不能和 --version、--next 或 --current-patch 同时使用。");
        }
        const parsed = parsePrereleaseTag(input.tag);
        if (input.channel !== parsed.channel) {
            throw new Error(`显式 tag channel 与命令 channel 不一致：${parsed.channel} != ${input.channel}`);
        }
        assertVersionNotLower(parsed.baseVersion, releaseVersionOf(input.currentVersion), "prerelease tag version");
        return parsed;
    }

    const baseVersion = await resolvePrereleaseBaseVersion(input);
    assertVersionNotLower(baseVersion, releaseVersionOf(input.currentVersion), "prerelease base version");
    const sequence = input.sequence ?? await defaultPrereleaseSequence(input.channel, baseVersion, input.shortHead);
    const prerelease = `${input.channel}.${sequence}`;
    if (!isPrereleaseIdentifierList(prerelease)) {
        throw new Error(`先行版本标识不符合 SemVer：${prerelease}`);
    }
    return {
        baseVersion,
        channel: input.channel,
        packageVersion: `${baseVersion}-${prerelease}`,
        tag: `v${baseVersion}-${prerelease}`,
    };
}

/** 解析 prerelease 基础版本；默认基于当前发布线执行 --next patch。 */
async function resolvePrereleaseBaseVersion(input: {
    currentPatch: boolean;
    currentVersion: string;
    next?: ReleaseIncrement;
    version?: string;
}): Promise<string> {
    const selected = [input.version ? "--version" : "", input.next ? "--next" : "", input.currentPatch ? "--current-patch" : ""]
        .filter(Boolean);
    if (selected.length > 1) {
        throw new Error(`prerelease 基础版本参数只能选一个：${selected.join("、")}`);
    }
    if (input.version) {
        return normalizeReleaseVersion(input.version);
    }
    if (input.currentPatch) {
        return normalizeReleaseVersion(releaseVersionOf(input.currentVersion));
    }
    return incrementReleaseVersion(await prereleaseNextBaseline(input.currentVersion), input.next ?? "patch");
}

/** prerelease 自动增长基准：package version 和当前 HEAD 最近 SemVer tag 中较新的版本线。 */
async function prereleaseNextBaseline(currentVersion: string): Promise<string> {
    const packageVersion = releaseVersionOf(currentVersion);
    const tagVersion = await latestReachableTagVersion();
    if (!tagVersion) {
        return packageVersion;
    }
    return compareReleaseVersions(parseReleaseVersion(tagVersion, "latest tag version"), parseReleaseVersion(packageVersion, "package version")) > 0
        ? tagVersion
        : packageVersion;
}

/** 读取当前 HEAD 最近可达的 SemVer tag，避免旧历史上的高版本 tag 误导自动增长。 */
async function latestReachableTagVersion(): Promise<string | null> {
    const tag = await runCapture("git", ["describe", "--tags", "--abbrev=0", "HEAD"], {cwd: REPO_ROOT})
        .then((value: string) => value.trim())
        .catch(() => "");
    return semverTagVersion(tag);
}

/** 默认先行版本序号。 */
async function defaultPrereleaseSequence(channel: PrereleaseChannel, baseVersion: string, shortHead: string): Promise<string> {
    if (channel !== "canary") {
        return String(await nextPrereleaseNumber(baseVersion, channel));
    }
    const stamp = new Date()
        .toISOString()
        .replace(/[-:]/gu, "")
        .replace(/\.\d{3}Z$/u, "Z")
        .replace("T", ".");
    return `${stamp}.${shortHead}`;
}

/** 按 SemVer release part 自动增长正式版。 */
function incrementReleaseVersion(version: string, increment: ReleaseIncrement): string {
    const parsed = parseReleaseVersion(releaseVersionOf(version), "package.json version");
    if (increment === "major") {
        return `${parsed.major + 1}.0.0`;
    }
    if (increment === "minor") {
        return `${parsed.major}.${parsed.minor + 1}.0`;
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/** 查找 alpha/beta/rc 当前版本线的下一个数字序号。 */
async function nextPrereleaseNumber(baseVersion: string, channel: PrereleaseChannel): Promise<number> {
    const tags = await listMatchingTags(`v${baseVersion}-${channel}.*`);
    const prefix = `v${baseVersion}-${channel}.`;
    const usedNumbers = tags
        .map((tag) => tag.startsWith(prefix) ? tag.slice(prefix.length).split(/[+.-]/u)[0] : "")
        .filter((part) => /^\d+$/u.test(part))
        .map((part) => Number(part));
    return usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
}

/** 合并本地和远端 tag，用于 dry-run/真实发布前生成下一个 prerelease 序号。 */
async function listMatchingTags(pattern: string): Promise<string[]> {
    const localTags = await runCapture("git", ["tag", "--list", pattern], {cwd: REPO_ROOT})
        .then((value: string) => value.split(/\r?\n/u))
        .catch(() => []);
    const remoteTags = await runCapture("git", ["ls-remote", "--tags", "origin", pattern], {cwd: REPO_ROOT})
        .then((value: string) => value.split(/\r?\n/u).map((line) => line.split(/\s+/u)[1] ?? ""))
        .catch(() => []);
    return [...new Set([...localTags, ...remoteTags]
        .map(normalizeGitTagRef)
        .filter(Boolean))];
}

/** 把 ls-remote 的 refs/tags/name 规范化成裸 tag 名。 */
function normalizeGitTagRef(input: string): string {
    return input.trim()
        .replace(/^refs\/tags\//u, "")
        .replace(/\^\{\}$/u, "");
}

/** 校验并解析显式 prerelease tag。 */
function parsePrereleaseTag(input: string): ParsedPrereleaseTag {
    const tag = input.trim();
    const version = tag.replace(/^v/u, "");
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+)(?:\.([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version);
    if (!match || !isPrereleaseIdentifierList(match[4]) || (match[5] && !isPrereleaseIdentifierList(match[5]))) {
        throw new Error(`prerelease tag 必须是 vX.Y.Z-<prerelease> 形式：${input}`);
    }
    const channel = parsePrereleaseChannel(match[4]);
    return {
        baseVersion: `${match[1]}.${match[2]}.${match[3]}`,
        channel,
        packageVersion: version,
        tag: tag.startsWith("v") ? tag : `v${tag}`,
    };
}

/** 是否是 SemVer release 版本。 */
function isReleaseVersion(version: string): boolean {
    return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version);
}

/** 是否是 SemVer prerelease 标识符列表。 */
function isPrereleaseIdentifierList(value: string): boolean {
    return value.split(".").every((part) => {
        if (!/^[0-9A-Za-z-]+$/u.test(part)) {
            return false;
        }
        return !/^\d+$/u.test(part) || part === "0" || !part.startsWith("0");
    });
}

/** 从 package version 中取 release 版本本体。 */
function releaseVersionOf(version: string): string {
    return version.trim().replace(/^v/u, "").split("-")[0].split("+")[0];
}

/** 从 SemVer tag 中提取 release 版本；非 SemVer tag 返回 null。 */
function semverTagVersion(input: string): string | null {
    const version = input.trim().replace(/^v/u, "");
    if (isReleaseVersion(version)) {
        return version;
    }
    const prerelease = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version);
    if (!prerelease || !isPrereleaseIdentifierList(prerelease[2])) {
        return null;
    }
    return prerelease[1];
}

/** 解析 release 版本。 */
function parseReleaseVersion(version: string, label: string): ParsedVersion {
    const normalized = normalizeReleaseVersion(version);
    const [major, minor, patch] = normalized.split(".").map((item) => Number(item));
    return {major, minor, patch};
}

/** 防止 release / prerelease 基础版本倒退。 */
function assertVersionNotLower(nextVersion: string, currentVersion: string, label: string): void {
    const next = parseReleaseVersion(nextVersion, label);
    const current = parseReleaseVersion(currentVersion, "current package version");
    if (compareReleaseVersions(next, current) < 0) {
        throw new Error(`${label} 不能低于当前 package version：${nextVersion} < ${currentVersion}`);
    }
}

/** 比较 release 版本。 */
function compareReleaseVersions(left: ParsedVersion, right: ParsedVersion): number {
    if (left.major !== right.major) {
        return left.major - right.major;
    }
    if (left.minor !== right.minor) {
        return left.minor - right.minor;
    }
    return left.patch - right.patch;
}

/** 当前 HEAD 完整 SHA。 */
async function currentHead(): Promise<string> {
    return (await runCapture("git", ["rev-parse", "HEAD"], {cwd: REPO_ROOT})).trim();
}

/** 返回当前命名分支。 */
async function currentBranch(): Promise<string> {
    const branch = (await runCapture("git", ["branch", "--show-current"], {cwd: REPO_ROOT})).trim();
    if (!branch) {
        throw new Error("当前不是命名分支。请切到 release 分支，或用 --target 指定已推送 commit。");
    }
    return branch;
}

/** 检查 GitHub CLI 可用且已登录。 */
async function assertGhAvailable(): Promise<void> {
    await runCapture("gh", ["--version"], {cwd: REPO_ROOT});
    await runCapture("gh", ["auth", "status"], {cwd: REPO_ROOT});
}

/** 检查远端 GitHub release 尚不存在。 */
async function assertReleaseDoesNotExist(tag: string, repo: string): Promise<void> {
    try {
        await runCapture("gh", ["release", "view", tag, "--repo", repo], {cwd: REPO_ROOT});
    } catch {
        return;
    }
    throw new Error(`GitHub release 已存在：${tag}`);
}

/** 检查本地和远端 git tag 尚不存在。 */
async function assertGitTagDoesNotExist(tag: string): Promise<void> {
    const localTag = await runCapture("git", ["tag", "--list", tag], {cwd: REPO_ROOT});
    if (localTag.trim()) {
        throw new Error(`本地 tag 已存在：${tag}`);
    }
    const remoteTag = await runCapture("git", ["ls-remote", "--tags", "origin", tag], {cwd: REPO_ROOT});
    if (remoteTag.trim()) {
        throw new Error(`远端 tag 已存在：${tag}`);
    }
}

/** 正式发布前要求整个工作区干净。 */
async function assertCleanWorktree(): Promise<void> {
    const status = await runCapture("git", ["status", "--porcelain", "-uall"], {cwd: REPO_ROOT});
    if (status.trim()) {
        throw new Error(`工作区不干净，停止 stable release：\n${status.trim()}\n请先单独提交或 stash 业务改动。`);
    }
}

/** Canary 发布默认只要求 tracked worktree 干净。 */
async function assertCleanTrackedWorktree(): Promise<void> {
    const status = await runCapture("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: REPO_ROOT});
    if (status.trim()) {
        throw new Error(`tracked worktree 不干净，停止 release：\n${status.trim()}\n先提交或 stash，或仅本地预览时使用 --allow-dirty --dry-run。`);
    }
}

/** 返回工作区是否有任何 tracked/untracked 改动。 */
async function worktreeIsDirty(): Promise<boolean> {
    const status = await runCapture("git", ["status", "--porcelain", "-uall"], {cwd: REPO_ROOT});
    return Boolean(status.trim());
}

/** 返回 tracked worktree 是否有改动。 */
async function trackedWorktreeIsDirty(): Promise<boolean> {
    const status = await runCapture("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: REPO_ROOT});
    return Boolean(status.trim());
}

/** 把当前 HEAD 推送到同名远端分支。 */
async function pushCurrentHead(branch: string): Promise<void> {
    await run("git", ["push", "origin", `HEAD:${branch}`], {cwd: REPO_ROOT});
}

/** 真实发布前确认当前 HEAD 已包含在远端分支。 */
async function assertCurrentHeadPushed(branch: string, head: string): Promise<void> {
    await run("git", ["fetch", "origin", branch], {cwd: REPO_ROOT});
    const remoteRef = `origin/${branch}`;
    const remoteExists = await runCapture("git", ["rev-parse", "--verify", remoteRef], {cwd: REPO_ROOT})
        .then(() => true)
        .catch(() => false);
    if (!remoteExists) {
        throw new Error(`远端分支不存在：${remoteRef}。请先 push，或运行 release 脚本时加 --push。`);
    }
    const containsHead = await runCapture("git", ["merge-base", "--is-ancestor", head, remoteRef], {cwd: REPO_ROOT})
        .then(() => true)
        .catch(() => false);
    if (!containsHead) {
        throw new Error(`当前 HEAD 尚未包含在 ${remoteRef}。请先 push，或运行 release 脚本时加 --push。`);
    }
}

/** 生成 prerelease GitHub release notes 文本。 */
async function prereleaseNotes(input: ReleaseNotesInput, repo: string): Promise<string> {
    const previousTag = await runCapture("git", ["describe", "--tags", "--abbrev=0", `${input.target}^`], {cwd: REPO_ROOT})
        .then((value: string) => value.trim())
        .catch(() => "");
    const compareLine = previousTag
        ? `Compare: https://github.com/${repo}/compare/${previousTag}...${input.tag}`
        : "";
    return [
        `${input.channel} prerelease for early validation.`,
        "",
        `- Tag: ${input.tag}`,
        `- Commit: ${input.target}`,
        `- Package version: ${input.packageVersion}`,
        `- Channel: ${input.channel}`,
        compareLine ? `- ${compareLine}` : "",
        "",
        "Windows portable and container images are produced by the release workflow.",
    ].filter(Boolean).join("\n");
}

/** 组装正式版 release 命令。 */
function stableReleaseArgs(input: {draft: boolean; repo: string; tag: string}): string[] {
    const args = [
        "release",
        "create",
        input.tag,
        "--repo",
        input.repo,
        "--verify-tag",
        "--title",
        `NeuroBook ${input.tag}`,
        "--generate-notes",
    ];
    if (input.draft) {
        args.push("--draft");
    }
    return args;
}

/** 组装 prerelease release 命令。 */
function prereleaseArgs(input: {draft: boolean; notes: string; repo: string; tag: string; target: string}): string[] {
    const args = [
        "release",
        "create",
        input.tag,
        "--repo",
        input.repo,
        "--target",
        input.target,
        "--title",
        `NeuroBook ${input.tag}`,
        "--notes",
        input.notes,
        "--prerelease",
    ];
    if (input.draft) {
        args.push("--draft");
    }
    return args;
}

/** 等待 GitHub release workflow 完成。 */
async function watchReleaseWorkflow({head, repo, tag}: {head: string; repo: string; tag: string}): Promise<void> {
    const runId = await findWorkflowRun({head, repo, tag});
    if (!runId) {
        throw new Error(`未找到 ${RELEASE_WORKFLOW} 的 release run。可稍后手动查看 GitHub Actions。`);
    }
    await run("gh", ["run", "watch", runId, "--repo", repo, "--exit-status"], {cwd: REPO_ROOT});
}

/** 轮询查找 release 事件触发出的 workflow run。 */
async function findWorkflowRun({head, repo, tag}: {head: string; repo: string; tag: string}): Promise<string | null> {
    for (let attempt = 0; attempt < 18; attempt += 1) {
        const output = await runCapture("gh", [
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            RELEASE_WORKFLOW,
            "--event",
            "release",
            "--limit",
            "10",
            "--json",
            "databaseId,headSha,displayTitle,status,createdAt",
        ], {cwd: REPO_ROOT});
        const runs = JSON.parse(output) as WorkflowRun[];
        const match = runs.find((item) => item.headSha === head || item.displayTitle?.includes(tag));
        if (match?.databaseId) {
            return String(match.databaseId);
        }
        await sleep(10_000);
    }
    return null;
}

/** 等待指定毫秒数。 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 返回适合展示在 shell 命令中的参数文本。 */
function shellQuote(value: string): string {
    return /^[a-zA-Z0-9_./:=@-]+$/u.test(value)
        ? value
        : JSON.stringify(value);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

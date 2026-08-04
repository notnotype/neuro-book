import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";

const execFileAsync = promisify(execFile);

const NEUROBOOK_ROOT = path.resolve(import.meta.dir, "../..");
const NB_WORKFLOW_TARGET_ROOT = path.resolve(NEUROBOOK_ROOT, "server", "vendor", "nb-workflow");
const VENDOR_MANIFEST_NAME = "VENDOR.json";

/** 目标目录里不属于镜像面的文件：由本脚本维护或 NeuroBook 侧生成，删除多余文件时跳过。 */
const NON_MIRRORED_TARGET_FILES = new Set([VENDOR_MANIFEST_NAME]);

type VendorManifest = {
    package: string;
    sourceCommit: string;
    syncedAt: string;
    note: string;
};

type SyncOptions = {
    sourceRepo: string;
    dryRun: boolean;
};

type SyncPlan = {
    sourceFiles: string[];
    targetFiles: string[];
    copied: string[];
    unchanged: string[];
    removed: string[];
    sourceCommit: string;
    manifestChanged: boolean;
};

/**
 * 从 sibling nb-workflow 开发仓把 src/ 源码镜像到 NeuroBook vendored snapshot。
 * 真相源永远是 ../nb-workflow；vendor 目录是机器同步产物，勿手改。
 * 幂等：内容无变化且源 commit 未变时零写入（VENDOR.json 也不动）。
 */
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const sourceRoot = path.join(options.sourceRepo, "src");
    await assertWorkflowSource(options.sourceRepo, sourceRoot);
    assertExpectedTarget(NB_WORKFLOW_TARGET_ROOT);

    const sourceFiles = await listRelativeFiles(sourceRoot);
    if (sourceFiles.length === 0) {
        throw new Error(`nb-workflow src 目录为空: ${sourceRoot}`);
    }
    const targetFiles = await listRelativeFiles(NB_WORKFLOW_TARGET_ROOT);
    const sourceSet = new Set(sourceFiles);
    const removed = targetFiles.filter((relativePath) => !sourceSet.has(relativePath) && !NON_MIRRORED_TARGET_FILES.has(relativePath));
    const copied: string[] = [];
    const unchanged: string[] = [];
    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
        const targetPath = path.join(NB_WORKFLOW_TARGET_ROOT, ...relativePath.split("/"));
        if (await sameFile(sourcePath, targetPath)) {
            unchanged.push(relativePath);
            continue;
        }
        copied.push(relativePath);
    }

    const sourceCommit = await readSourceCommit(options.sourceRepo);
    const manifestChanged = await vendorManifestNeedsUpdate({
        sourceCommit,
        contentChanged: copied.length > 0 || removed.length > 0,
    });
    const plan: SyncPlan = {sourceFiles, targetFiles, copied, unchanged, removed, sourceCommit, manifestChanged};

    if (options.dryRun) {
        printDryRun(plan, options.sourceRepo);
        return;
    }

    await applySync(plan, sourceRoot);
    await writeVendorManifestIfChanged({sourceCommit, contentChanged: copied.length > 0 || removed.length > 0});

    console.log(`synced nb-workflow vendor: copied=${copied.length}, unchanged=${unchanged.length}, removed=${removed.length}, manifest=${manifestChanged ? "updated" : "unchanged"}, sourceCommit=${sourceCommit}`);
}

/** 解析同步源和 dry-run 开关；source 默认为 sibling nb-workflow。 */
function parseArgs(args: string[]): SyncOptions {
    let sourceRepo = path.resolve(NEUROBOOK_ROOT, "..", "nb-workflow");
    let dryRun = false;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (arg === "--source") {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) {
                throw new Error("--source 必须提供 nb-workflow worktree 路径");
            }
            sourceRepo = path.resolve(value);
            index += 1;
            continue;
        }
        throw new Error(`未知参数: ${arg}。支持 --source <worktree> 和 --dry-run`);
    }
    return {sourceRepo, dryRun};
}

/** 只打印即将发生的 vendor 文件操作，不创建、删除或写入任何文件。 */
function printDryRun(plan: SyncPlan, sourceRepo: string): void {
    console.log(`[dry-run] source=${sourceRepo}`);
    for (const relativePath of plan.copied) {
        console.log(`[dry-run] copy ${relativePath}`);
    }
    for (const relativePath of plan.removed) {
        console.log(`[dry-run] remove ${relativePath}`);
    }
    if (plan.manifestChanged) {
        console.log(`[dry-run] update ${VENDOR_MANIFEST_NAME} sourceCommit=${plan.sourceCommit}`);
    }
    console.log(`[dry-run] summary copied=${plan.copied.length}, unchanged=${plan.unchanged.length}, removed=${plan.removed.length}, manifest=${plan.manifestChanged ? "updated" : "unchanged"}`);
}

/** 将已计算的同步计划落到 vendor 目录。 */
async function applySync(plan: SyncPlan, sourceRoot: string): Promise<void> {
    await fs.mkdir(NB_WORKFLOW_TARGET_ROOT, {recursive: true});
    for (const relativePath of plan.removed) {
        await fs.rm(path.join(NB_WORKFLOW_TARGET_ROOT, ...relativePath.split("/")), {force: true});
    }
    for (const relativePath of plan.copied) {
        const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
        const targetPath = path.join(NB_WORKFLOW_TARGET_ROOT, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.copyFile(sourcePath, targetPath);
    }
}

/**
 * 验证 source 是真实 nb-workflow 开发仓（防误指向其它 sibling 目录整目录镜像）。
 */
async function assertWorkflowSource(sourceRepo: string, sourceRoot: string): Promise<void> {
    const stat = await fs.stat(sourceRoot).catch(() => null);
    if (!stat?.isDirectory()) {
        throw new Error(`nb-workflow src 不存在: ${sourceRoot}`);
    }
    const packagePath = path.join(sourceRepo, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf-8")) as {name?: string};
    if (packageJson.name !== "@notnotype/nb-workflow") {
        throw new Error(`nb-workflow package.json.name 必须是 @notnotype/nb-workflow: ${packagePath}`);
    }
}

/**
 * 防止同步脚本误删 NeuroBook 之外或意料之外的目录。
 */
function assertExpectedTarget(targetRoot: string): void {
    const expected = path.join(NEUROBOOK_ROOT, "server", "vendor", "nb-workflow");
    if (path.resolve(targetRoot) !== path.resolve(expected)) {
        throw new Error(`nb-workflow vendor target 路径异常: ${targetRoot}`);
    }
    if (!isInside(NEUROBOOK_ROOT, targetRoot)) {
        throw new Error(`nb-workflow vendor target 必须位于 NeuroBook 仓库内: ${targetRoot}`);
    }
}

/**
 * 读取源仓当前 HEAD commit，用于 VENDOR.json 溯源。
 */
async function readSourceCommit(sourceRepo: string): Promise<string> {
    const {stdout} = await execFileAsync("git", ["-C", sourceRepo, "rev-parse", "HEAD"]);
    return stdout.trim();
}

/**
 * 内容或源 commit 变化时更新 VENDOR.json；否则保持不动（保证重复同步零 diff）。
 */
async function writeVendorManifestIfChanged(input: {sourceCommit: string; contentChanged: boolean}): Promise<boolean> {
    const manifestPath = path.join(NB_WORKFLOW_TARGET_ROOT, VENDOR_MANIFEST_NAME);
    const existing = await fs.readFile(manifestPath, "utf-8")
        .then((text) => JSON.parse(text) as VendorManifest)
        .catch(() => null);
    if (!input.contentChanged && existing?.sourceCommit === input.sourceCommit) {
        return false;
    }
    const manifest: VendorManifest = {
        package: "@notnotype/nb-workflow",
        sourceCommit: input.sourceCommit,
        syncedAt: new Date().toISOString(),
        note: "机器同步产物,勿手改。真相源在 sibling 仓 ../nb-workflow;更新流程: 改源仓 -> bun run sync:nb-workflow -> commit。",
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, "utf-8");
    return true;
}

/** 判断 VENDOR.json 是否会因内容或 source commit 变化而更新。 */
async function vendorManifestNeedsUpdate(input: {sourceCommit: string; contentChanged: boolean}): Promise<boolean> {
    const manifestPath = path.join(NB_WORKFLOW_TARGET_ROOT, VENDOR_MANIFEST_NAME);
    const existing = await fs.readFile(manifestPath, "utf-8")
        .then((text) => JSON.parse(text) as VendorManifest)
        .catch(() => null);
    return input.contentChanged || existing?.sourceCommit !== input.sourceCommit;
}

/**
 * 递归列出相对文件路径，统一 POSIX 分隔符。
 */
async function listRelativeFiles(root: string, current = ""): Promise<string[]> {
    const absolute = path.join(root, ...current.split("/").filter(Boolean));
    const entries = await fs.readdir(absolute, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    });
    const files: string[] = [];
    for (const entry of entries) {
        const relativePath = current ? `${current}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...await listRelativeFiles(root, relativePath));
            continue;
        }
        if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

/**
 * 用 SHA-256 比较文件，内容一致则跳过复制。
 */
async function sameFile(left: string, right: string): Promise<boolean> {
    const [leftHash, rightHash] = await Promise.all([
        hashFile(left),
        hashFile(right).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        }),
    ]);
    return rightHash !== null && leftHash === rightHash;
}

async function hashFile(filePath: string): Promise<string> {
    return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

/**
 * 判断 child 是否位于 parent 内或等于 parent。
 */
function isInside(parent: string, child: string): boolean {
    const relativePath = path.relative(path.resolve(parent), path.resolve(child));
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

await main();

#!/usr/bin/env bun
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {currentProductPlatform} from "#scripts/utils/product-platform";
import {
    compileProfileArtifacts,
    compileVariableDefinitions,
    resolveProfileArtifactPathContext,
    resolveVariableDefinitionArtifactPathContext,
    SystemAssetsProjection,
} from "@notnotype/neuro-book/build";
import {assertProductSystemArtifactContract} from "#scripts/build/product-system-artifact-contract";
import {buildProductAuthoringKit} from "#scripts/build/product-authoring-kit";
import {buildProductCommands} from "#scripts/build/product-command-bundle";
import {bundleProductRuntime, normalizePackageManagerMetadata} from "#scripts/build/product-runtime-bundle";
import {assertProductRuntimeModuleClosure} from "#scripts/build/product-runtime-module-closure.mjs";
import {PRODUCT_RUNTIME_CONTRACT_PATH} from "@notnotype/neuro-book-contracts/product-runtime";
import {
    assertProductRuntimeContractFiles,
    readProductRuntimeContract,
} from "@notnotype/neuro-book/product-verification";

const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
const applicationSourceRoot = resolve(process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || process.cwd());
const productArtifactGeneratedAt = new Date(0).toISOString();
const serverRoot = resolve(outputRoot, "server");
const productAgentRoot = resolve(serverRoot, "assets", "workspace", ".nbook", "agent");
const configuredScratchRoot = process.env.NEURO_BOOK_PRODUCT_SCRATCH_ROOT?.trim();
if (!configuredScratchRoot) {
    throw new Error("Product 后处理必须由 Product Runtime Image Builder 注入 operation scratch root。");
}
const scratchRoot = resolve(configuredScratchRoot);
const buildStateRoot = resolve(scratchRoot, "system-artifacts");
const timings = [];

const scratchRelativePath = relative(outputRoot, scratchRoot);
if (scratchRelativePath === "" || scratchRelativePath === ".." || scratchRelativePath.startsWith(`..${sep}`)
    || isAbsolute(scratchRelativePath)) {
    throw new Error(`Product build scratch 必须位于候选镜像内：${scratchRoot}`);
}

assertRawOutput();

await measure("project static system assets", async () => {
    const target = resolve(serverRoot, "assets", "workspace", ".nbook");
    await rm(resolve(serverRoot, "assets"), {recursive: true, force: true});
    await new SystemAssetsProjection().copyToEmpty({
        sourceRoot: resolve(applicationSourceRoot, "assets", "workspace", ".nbook"),
        targetRoot: target,
        compiledArtifactMode: "exclude",
    });
    const referenceSource = resolve(applicationSourceRoot, "assets", "reference");
    if (!existsSync(referenceSource)) throw new Error(`缺少应用运行期 Reference 书架：${referenceSource}`);
    await cp(referenceSource, resolve(serverRoot, "assets", "reference"), {recursive: true, force: true});
});

await measure("build Profile Authoring Kit", async () => {
    await buildProductAuthoringKit(outputRoot);
});
await measure("write Product package manifest", async () => {
    await writeProductPackageJson();
});

await measure("compile clean Product system artifacts", async () => {
    const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;
    const previousImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
    process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = outputRoot;
    await rm(buildStateRoot, {recursive: true, force: true});
    try {
        const variableRoot = resolve(productAgentRoot, "variables");
        const variableArtifactPathContext = await resolveVariableDefinitionArtifactPathContext(
            variableRoot,
            "assets/workspace/.nbook/agent/variables",
            applicationSourceRoot,
        );
        await compileVariableDefinitions({
            definitionRoot: variableRoot,
            artifactPathContext: variableArtifactPathContext,
            skipFresh: false,
            manifestGeneratedAt: productArtifactGeneratedAt,
            stagingRoot: buildStateRoot,
        });
        const profileRoot = resolve(productAgentRoot, "profiles");
        const profileArtifactPathContext = await resolveProfileArtifactPathContext(
            profileRoot,
            "assets/workspace/.nbook/agent/profiles",
            applicationSourceRoot,
        );
        await compileProfileArtifacts({
            profileRoot,
            artifactPathContext: profileArtifactPathContext,
            skipFresh: false,
            manifestGeneratedAt: productArtifactGeneratedAt,
            stagingRoot: buildStateRoot,
            orphanBudgetPolicy: "product",
        });
        await new SystemAssetsProjection().verify(resolve(serverRoot, "assets", "workspace", ".nbook"));
        await assertProductSystemArtifactContract(applicationSourceRoot, outputRoot);
    } finally {
        await rm(buildStateRoot, {recursive: true, force: true});
        if (previousProductBuild === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        else process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild;
        if (previousImageRoot === undefined) delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        else process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = previousImageRoot;
    }
});
const commands = await measure("bundle Product commands", async () => {
    return await buildProductCommands(outputRoot, applicationSourceRoot);
});
await measure("write Product Runtime Contract", async () => {
    await writeFile(
        resolve(outputRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")),
        `${JSON.stringify(commands.contract, null, 4)}\n`,
        "utf8",
    );
    await assertProductRuntimeContractFiles(commands.contract, outputRoot);
});
const runtime = await measure("bundle Nitro and native islands", async () => {
    return await bundleProductRuntime(outputRoot, scratchRoot);
});
await measure("normalize Product public assets", async () => {
    await normalizeProductPublicAssets();
});
await measure("clean Product build scratch", async () => {
    await rm(scratchRoot, {recursive: true, force: true});
});
await measure("prune raw Product build state", async () => {
    await pruneRawServerState();
    await assertFinalRuntimeShape();
});


console.log(`Product commands: ${commands.commands.join(", ")} (${commands.files} files / ${commands.bytes} bytes)`);
console.log(`Product bundle: inputs=${runtime.bundledInputs}, entry=${runtime.entryBytes} bytes`);
console.log(`Product native islands: packages=${runtime.islands.length}, files=${runtime.islandFiles}, bytes=${runtime.islandBytes}`);
console.log(`Product TypeScript projection: ${runtime.typescriptProjection.files.length}/${runtime.typescriptProjection.sourceFiles} files, ${runtime.typescriptProjection.bytes}/${runtime.typescriptProjection.sourceBytes} bytes`);
console.log(`Product island imports: files=${runtime.islandImportFiles}, references=${runtime.islandImportReferences}`);
console.log(`Product runtime specifiers: rawModules=${runtime.rawModuleFiles}, declaredSeeds=${runtime.islands.join(",")}, discoveredSeeds=${runtime.discoveredSeeds.join(",")}, rewrites=${runtime.specifierRewrites}`);
console.log(`Product post-process timings: ${timings.map((item) => `${item.label}=${item.seconds.toFixed(2)}s`).join(", ")}`);

/** 记录后处理阶段耗时，定位 Windows 小文件或 bundle 回归。 */
async function measure(label, action) {
    const startedAt = performance.now();
    try {
        return await action();
    } finally {
        timings.push({label, seconds: (performance.now() - startedAt) / 1000});
    }
}

/** raw Nuxt output 是本脚本唯一输入，不允许对空目录补造 Product。 */
function assertRawOutput() {
    if (!existsSync(resolve(serverRoot, "index.mjs")) || !existsSync(resolve(outputRoot, "public"))) {
        throw new Error(`缺少 Nuxt raw output：${outputRoot}`);
    }
}
/** 最终 public 资源不得携带 Bun/pnpm store 的物理 module id。 */
async function normalizeProductPublicAssets() {
    const publicRoot = resolve(outputRoot, "public");
    for (const filePath of await listRegularFiles(publicRoot)) {
        const bytes = await readFile(filePath);
        if (!isUtf8(bytes)) {
            if (hasPackageManagerBytes(bytes)) {
                throw new Error(`Product public 二进制资产仍含包管理器物理路径：${filePath}`);
            }
            continue;
        }
        if (!isTextAsset(filePath)) {
            if (hasPackageManagerBytes(bytes)) {
                throw new Error(`Product public 非文本资产仍含包管理器物理路径：${filePath}`);
            }
            continue;
        }
        const source = bytes.toString("utf8");
        if (!hasPackageManagerMetadata(source)) continue;
        const normalized = normalizePackageManagerMetadata(source);
        if (normalized !== source) await writeFile(filePath, normalized, "utf8");
        if (hasPackageManagerMetadata(normalized)) {
            throw new Error(`Product public 资产仍含包管理器物理路径：${filePath}`);
        }
    }
}

function isUtf8(bytes) {
    return Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
}

function isTextAsset(filePath) {
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return [".css", ".js", ".json", ".map", ".txt", ".xml", ".svg", ".html", ".htm"].includes(extension);
}

function hasPackageManagerBytes(bytes) {
    return ["node_modules/.bun/", "node_modules/.pnpm/"].some((marker) => bytes.includes(Buffer.from(marker, "utf8")));
}

async function listRegularFiles(root) {
    const files = [];
    async function walk(directory) {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile()) files.push(filePath);
        }
    }
    await walk(root);
    return files.sort();
}

function hasPackageManagerMetadata(source) {
    const normalized = source.replaceAll("\\\\", "\\").replaceAll("\\", "/");
    return normalized.includes("node_modules/.bun/") || normalized.includes("node_modules/.pnpm/");
}


/** Product 内所有可执行命令只指向预编译入口。 */
async function writeProductPackageJson() {
    const source = JSON.parse(await readFile(resolve(applicationSourceRoot, "package.json"), "utf8"));
    const packageJson = {
        name: "neuro-book-output",
        version: source.version ?? "0.0.0",
        description: source.description,
        license: source.license,
        repository: source.repository,
        private: true,
        type: "module",
        scripts: {
            start: "bun --no-install --no-env-file commands/product-command.mjs command start",
            "create-admin": "bun --no-install --no-env-file commands/product-command.mjs command create-admin",
            "migrate:deploy": "bun --no-install --no-env-file commands/product-command.mjs command migrate-database",
            "migrate:application-state": "bun --no-install --no-env-file commands/product-command.mjs command migrate-application-state",
            "profile:check": "bun --no-install --no-env-file commands/product-command.mjs command profile check",
            "profile:compile": "bun --no-install --no-env-file commands/product-command.mjs command profile compile",
        },
    };
    await writeFile(resolve(serverRoot, "package.json"), `${JSON.stringify(packageJson, null, 4)}\n`, "utf8");
}

/** 删除 raw Nitro chunks、源码投影、source map 与旧 runtime dependency tree。 */
async function pruneRawServerState() {
    const removable = [
        ".nuxt",
        "AGENTS.md",
        "chunks",
        "docs",
        "reference",
        "scripts",
        "server",
        "shared",
        "timing.js",
        "tsconfig.json",
        "index.mjs.map",
        "prisma.config.ts",
    ];
    for (const name of removable) {
        await rm(resolve(serverRoot, name), {recursive: true, force: true});
    }
}

/** 最终 Runtime Image 只允许这些 owner 路径，防止上游 Nuxt 新目录静默进入发行包。 */
async function assertFinalRuntimeShape() {
    const allowedRoot = new Set(["nitro.json", "public", "server"]);
    const rootEntries = await readdir(outputRoot);
    const unexpectedRoot = rootEntries.filter((name) => !allowedRoot.has(name));
    if (unexpectedRoot.length > 0) {
        throw new Error(`Product Runtime Image 根出现未登记路径：${unexpectedRoot.join(", ")}`);
    }
    const allowedServer = new Set([
        "assets",
        "authoring",
        "commands",
        "index.mjs",
        "runtime-contract.json",
        "native-islands.json",
        "node_modules",
        "package.json",
        "prisma",
    ]);
    const serverEntries = await readdir(serverRoot);
    const unexpectedServer = serverEntries.filter((name) => !allowedServer.has(name));
    if (unexpectedServer.length > 0) {
        throw new Error(`Product server 出现未登记路径：${unexpectedServer.join(", ")}`);
    }
    for (const required of [
        "index.mjs",
        "authoring/profile-compile-worker.mjs",
        "native-islands.json",
        "prisma/migrations/sqlite",
    ]) {
        if (!existsSync(resolve(serverRoot, required))) throw new Error(`Product server 缺少 ${required}`);
    }
    const runtimeContract = await readProductRuntimeContract(outputRoot);
    await assertProductRuntimeContractFiles(runtimeContract, outputRoot);
    await assertProductRuntimeModuleClosure({
        imageRoot: outputRoot,
        buildRoots: [process.cwd()],
        expectedPlatform: currentProductPlatform(),
    });
    const inventory = await directoryInventory(outputRoot);
    if (inventory.files > 6_000 || inventory.bytes > 360 * 1024 * 1024) {
        throw new Error(`Product Runtime Image 超出桌面前置门禁：${inventory.files} files / ${inventory.bytes} bytes`);
    }
}

async function directoryInventory(root) {
    let files = 0;
    let bytes = 0;
    const walk = async (directory) => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile()) {
                files += 1;
                bytes += (await stat(filePath)).size;
            } else {
                throw new Error(`Product Runtime Image 不允许特殊文件：${filePath}`);
            }
        }
    };
    await walk(root);
    return {files, bytes};
}

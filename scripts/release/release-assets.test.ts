import {mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {strToU8, unzipSync, zipSync} from "fflate";
import {afterEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

import {currentProductPlatform, PRODUCT_ASSET_NAMES} from "nbook/packages/neuro-book-manager/src/platform";
import {PRODUCT_PLATFORMS} from "nbook/packages/neuro-book-manager/src/types";
import {
    ProductRuntimeImageBuilder,
    productRuntimeBuildPolicy,
    type ProductRuntimeImageManifest,
} from "nbook/scripts/build/product-runtime-image-builder";
import {createProductRuntimeContract} from "nbook/shared/product-runtime-contract";
import {
    buildProductArchive,
    buildReleaseManifest,
    buildSourceArchive,
    parseReleaseBuild,
    readReleaseBuildArchive,
    releaseBuildId,
} from "nbook/scripts/release/release-assets";
import {runCapture} from "nbook/scripts/utils/process.mjs";
import {
    assertStateMigrationSourceFiles,
    readReleaseStateMigrationDeclaration,
} from "nbook/scripts/release/state-migration-declaration";
import {releaseAssetsVitestConfig} from "nbook/scripts/release/release-assets-vitest.config";

vi.mock("nbook/scripts/build/product-system-artifact-contract", () => ({
    assertProductSystemArtifactContract: vi.fn(async () => undefined),
}));

const ROOT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];

type WorkflowStep = {
    env?: {[name: string]: string};
    id?: string;
    if?: string;
    name?: string;
    run?: string;
    "timeout-minutes"?: number;
    uses?: string;
    with?: {
        "include-hidden-files"?: boolean;
        key?: string;
        outputs?: string;
        path?: string;
        pattern?: string;
        platforms?: string;
    };
};

type WorkflowJob = {
    needs?: string | string[];
    "runs-on"?: string;
    steps: WorkflowStep[];
};

type ReleaseWorkflow = {
    on?: {
        workflow_dispatch?: {
            inputs?: {[name: string]: {required?: boolean; type?: string}};
        };
    };
    concurrency?: {
        group?: string;
        "cancel-in-progress"?: string | boolean;
    };
    jobs: {
        preflight: WorkflowJob;
        "build-container": WorkflowJob & {
            strategy: {matrix: {include: Array<{arch: string; platform: string; runner: string}>}};
        };
        "merge-container-images": WorkflowJob;
        source: WorkflowJob;
        "product-linux": WorkflowJob;
        "product-linux-aarch64": WorkflowJob;
        "product-darwin-x64": WorkflowJob;
        "product-windows": WorkflowJob;
        "verify-windows": WorkflowJob;
    };
};

type ProductWorkflow = {
    jobs: {
        product: WorkflowJob & {
            strategy: {
                matrix: {
                    include: Array<{platform: string; browser: string}>;
                };
            };
        };
    };
};

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Release宿主合同", () => {
    it("从仓库级文件读取当前版本迁移声明，并拒绝缺失声明或缺失 manual guide", async () => {
        await expect(readReleaseStateMigrationDeclaration(ROOT)).resolves.toEqual({
            policy: "automatic",
            steps: [
                "app-sqlite",
                "agent-attachment-v1",
                "agent-session-v2",
                "agent-session-v2-review-repair",
            ],
            guide: "docs/migrations/0.9.0-session-v2.md",
        });

        const fixtureRoot = await mkdtemp(join(tmpdir(), "nbook-release-state-migration-"));
        roots.push(fixtureRoot);
        await expect(readReleaseStateMigrationDeclaration(fixtureRoot)).rejects.toThrow("缺少有状态升级声明");

        await writeFile(join(fixtureRoot, "release-state-migration.json"), JSON.stringify({
            policy: "manual",
            steps: [],
            guide: "docs/migrations/manual.md",
        }), "utf8");
        await expect(readReleaseStateMigrationDeclaration(fixtureRoot)).rejects.toThrow("guide 不存在");

        await mkdir(join(fixtureRoot, "docs", "migrations"), {recursive: true});
        await writeFile(join(fixtureRoot, "docs", "migrations", "manual.md"), "# Manual\n", "utf8");
        await expect(readReleaseStateMigrationDeclaration(fixtureRoot)).resolves.toMatchObject({policy: "manual"});
    });

    it("Release 构建边界拒绝 automatic 声明引用当前 Product catalog 不存在的 step", async () => {
        const fixtureRoot = await mkdtemp(join(tmpdir(), "nbook-release-state-migration-catalog-"));
        roots.push(fixtureRoot);
        await writeFile(join(fixtureRoot, "release-state-migration.json"), `${JSON.stringify({
            policy: "automatic",
            steps: ["future-step"],
        })}\n`, "utf8");

        await expect(readReleaseStateMigrationDeclaration(fixtureRoot)).rejects.toThrow("catalog 不存在");
    });

    it("Source archive 必须包含统一迁移入口与 Release guide", () => {
        const declaration = {
            policy: "automatic" as const,
            steps: ["app-sqlite" as const],
            guide: "docs/migrations/0.9.0-session-v2.md",
        };
        const files = [
            "release-state-migration.json",
            "docs/migrations/README.md",
            "docs/migrations/0.9.0-session-v2.md",
            "scripts/db/migrate-application-state.ts",
            "server/runtime/application-state-command.ts",
            "server/runtime/application-state-migration/app-sqlite-step.ts",
            "server/runtime/application-state-migration/catalog-registry.ts",
            "server/runtime/application-state-migration/catalog.ts",
            "server/runtime/application-state-migration/lease.ts",
            "server/runtime/application-state-migration/runner.ts",
            "server/runtime/application-state-migration/types.ts",
            "server/agent/session/migrations/session-v2-review-repair/journal.ts",
            "server/agent/session/migrations/session-v2-review-repair/migration.ts",
            "server/agent/session/migrations/session-v2-review-repair/types.ts",
        ];
        expect(() => assertStateMigrationSourceFiles(files, declaration)).not.toThrow();
        expect(() => assertStateMigrationSourceFiles(
            files.filter((path) => path !== "server/runtime/application-state-migration/runner.ts"),
            declaration,
        )).toThrow("Source archive 缺少 Application State migration 文件");
    });

    it("Product runtime staging 只复制并重新验证 ready Runtime Image", async () => {
        const productRuntime = await readFile(resolve(ROOT, "scripts/deploy/product-runtime.mjs"), "utf8");
        expect(productRuntime).toContain("new ProductRuntimeImageBuilder(REPO_ROOT)");
        expect(productRuntime).toContain("await openVerifiedImage(BUILD_OUTPUT_ROOT)");
        expect(productRuntime).toContain("await openVerifiedImage(targetOutput, source.manifest)");
        expect(productRuntime).not.toContain('resolve(REPO_ROOT, "scripts", "db", "agent-session-v2-review-repair")');
    });

    it("Source archive 写入可重建 build identity，并拒绝 dirty Source 与覆盖已有目标", async () => {
        const repository = await releaseRepositoryFixture();
        const output = join(repository, "dist", "neuro-book-source.zip");
        await buildSourceArchive(output, repository);

        const metadata = await readReleaseBuildArchive(output);
        expect(metadata).toMatchObject({
            schema: "nbook.release-build/v1",
            kind: "source",
            version: "1.2.3",
            dirty: false,
        });
        expect(metadata.buildId).toBe(releaseBuildId(metadata));
        const sourceEntries = Object.keys(unzipSync(await readFile(output)));
        expect(sourceEntries).toContain("source-build.json");
        expect(sourceEntries).not.toContain("product-build.json");
        expect(sourceEntries).not.toContain(".output/runtime-image.json");

        await expect(buildSourceArchive(output, repository)).rejects.toThrow("输出目标已存在，拒绝覆盖");
        await writeFile(join(repository, "package.json"), `${JSON.stringify({name: "fixture", version: "1.2.4"})}\n`, "utf8");
        await expect(buildSourceArchive(
            join(repository, "dist", "dirty-source.zip"),
            repository,
        )).rejects.toThrow("dirty=true");
    });

    it("Product archive 只消费 verified image，并钉死 Source、平台与 image identity", async () => {
        const repository = await releaseRepositoryFixture();
        const platform = currentProductPlatform();
        const builder = new ProductRuntimeImageBuilder(repository);
        const image = await builder.buildCandidate({
            operationId: "release-product-fixture",
            platform,
            owners: productRuntimeBuildPolicy(platform).owners,
            budget: productRuntimeBuildPolicy(platform).budget,
            async build({imageRoot}) {
                const commandRoot = join(imageRoot, "server", "commands");
                await mkdir(commandRoot, {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
                await writeFile(join(commandRoot, "all.mjs"), "export default true;\n", "utf8");
                await writeFile(join(commandRoot, "product-command.mjs"), "export default true;\n", "utf8");
                const entry = "server/commands/all.mjs";
                const contract = createProductRuntimeContract({
                    productStart: entry,
                    sqliteMigrate: entry,
                    applicationStateMigration: entry,
                    createAdmin: entry,
                    profile: entry,
                    variable: entry,
                    workspace: entry,
                    prepareSystemAssets: entry,
                    checkMigrations: entry,
                    profileAuthoringSmoke: entry,
                    variableAuthoringSmoke: entry,
                    imageVariantSmoke: entry,
                    sqliteVecSmoke: entry,
                    webFetchSmoke: entry,
                    worldEngineConfigSmoke: entry,
                });
                await writeFile(join(imageRoot, "server", "runtime-contract.json"), `${JSON.stringify(contract)}\n`, "utf8");
            },
        });
        await rename(image.path, join(repository, ".output"));
        const assetName = PRODUCT_ASSET_NAMES[platform];
        const output = join(repository, "artifacts", "valid", assetName);
        await buildProductArchive(platform, output, repository);

        const metadata = await readReleaseBuildArchive(output);
        expect(metadata).toMatchObject({
            kind: "product",
            buildId: releaseBuildId(image.manifest),
            platform,
            imageId: image.manifest.imageId,
            sourceDigest: image.manifest.sourceDigest,
            treeDigest: image.manifest.treeDigest,
            builderContractVersion: image.manifest.builderContractVersion,
        });
        const productEntries: string[] = platform === "windows-x64"
            ? Object.keys(unzipSync(await readFile(output)))
            : String(await runCapture("tar", ["-tzf", output], {cwd: repository})).split(/\r?\n/u);
        expect(productEntries.some((entry) => entry.replace(/^\.\//u, "") === ".output/runtime-image.json")).toBe(true);
        expect(productEntries.some((entry) => entry.replace(/^\.\//u, "") === ".output/runtime-image.ready")).toBe(true);

        const runtimeManifestPath = join(repository, ".output", "runtime-image.json");
        const runtimeManifestText = await readFile(runtimeManifestPath, "utf8");
        const loosePolicyManifest = JSON.parse(runtimeManifestText) as ProductRuntimeImageManifest;
        loosePolicyManifest.policy.budget.maxFiles += 1;
        await writeFile(runtimeManifestPath, `${JSON.stringify(loosePolicyManifest, null, 2)}\n`, "utf8");
        await expect(buildProductArchive(
            platform,
            join(repository, "artifacts", "loose-policy", assetName),
            repository,
        )).rejects.toThrow("policy 摘要");
        await writeFile(runtimeManifestPath, runtimeManifestText, "utf8");

        await writeFile(join(repository, ".output", "server", "index.mjs"), "export default false;\n", "utf8");
        await expect(buildProductArchive(
            platform,
            join(repository, "artifacts", "tampered", assetName),
            repository,
        )).rejects.toThrow("payload digest 不一致");

        await writeFile(join(repository, ".output", "server", "index.mjs"), "export default true;\n", "utf8");
        await writeFile(join(repository, "package.json"), `${JSON.stringify({name: "fixture", version: "1.2.4"})}\n`, "utf8");
        await git(repository, ["add", "package.json"]);
        await git(repository, ["-c", "user.name=NeuroBook Test", "-c", "user.email=test@nbook.local", "commit", "--quiet", "-m", "next-source"]);
        await expect(buildProductArchive(
            platform,
            join(repository, "artifacts", "stale", assetName),
            repository,
        )).rejects.toThrow("身份不一致");
    }, 30_000);

    it("构建身份元数据拒绝不可重建 buildId 与未知字段", () => {
        const identity = {
            schema: "nbook.release-build/v1",
            kind: "source",
            buildId: `sha256:${"0".repeat(64)}`,
            version: "1.2.3",
            revision: "a".repeat(40),
            dirty: false,
            lockfileSha256: `sha256:${"b".repeat(64)}`,
        };
        expect(() => parseReleaseBuild(JSON.stringify(identity))).toThrow("buildId 无法由");
        expect(() => parseReleaseBuild(JSON.stringify({...identity, extra: true}))).toThrow("字段集合无效");
    });

    it("Release Manifest 从五平台归档写入 Runtime Image 身份，并把 manifest 最后发布", async () => {
        const repository = await releaseRepositoryFixture();
        const directory = join(repository, "artifacts", "manifest");
        await mkdir(directory, {recursive: true});
        const sourcePath = join(directory, "neuro-book-source.zip");
        await buildSourceArchive(sourcePath, repository);
        const source = await readReleaseBuildArchive(sourcePath);
        if (source.kind !== "source") throw new Error("测试 Source metadata kind 错误。");
        const {kind: _sourceKind, ...commonBuild} = source;
        const revision = source.revision;
        const lockfileSha256 = source.lockfileSha256;

        const productPaths = {} as Record<(typeof PRODUCT_PLATFORMS)[number], string>;
        for (const [index, platform] of PRODUCT_PLATFORMS.entries()) {
            const metadata = {
                ...commonBuild,
                kind: "product" as const,
                platform,
                imageId: `sha256:${index.toString(16).repeat(64)}`,
                sourceDigest: `sha256:${(index + 5).toString(16).repeat(64)}`,
                treeDigest: `sha256:${(index + 10).toString(16).repeat(64)}`,
                builderContractVersion: "1",
            };
            const productPath = join(directory, PRODUCT_ASSET_NAMES[platform]);
            productPaths[platform] = productPath;
            if (platform === "windows-x64") {
                await writeFile(productPath, zipSync({
                    "product-build.json": strToU8(`${JSON.stringify(metadata)}\n`),
                }));
            } else {
                const metadataRoot = join(directory, `metadata-${platform}`);
                await mkdir(metadataRoot, {recursive: true});
                await writeFile(join(metadataRoot, "product-build.json"), `${JSON.stringify(metadata)}\n`, "utf8");
                await runCapture("tar", ["-czf", productPath, "-C", metadataRoot, "product-build.json"], {cwd: directory});
            }
        }

        const portable = join(directory, "neuro-book-windows-x64.zip");
        const stage0Windows = join(directory, "install.ps1");
        const stage0WindowsCmd = join(directory, "install.cmd");
        const stage0Linux = join(directory, "install.sh");
        await Promise.all([
            writeFile(portable, zipSync({"portable.txt": strToU8("portable") })),
            writeFile(stage0Windows, "stage0-windows\n", "utf8"),
            writeFile(stage0WindowsCmd, "stage0-windows-cmd\n", "utf8"),
            writeFile(stage0Linux, "stage0-linux\n", "utf8"),
        ]);
        const output = join(directory, "release-manifest.json");
        const manifestOptions = {
            tag: source.version,
            revision,
            managerVersion: "0.0.1",
            source: sourcePath,
            windowsProduct: productPaths["windows-x64"],
            linuxProduct: productPaths["linux-x64-glibc"],
            linuxAarch64Product: productPaths["linux-aarch64-glibc"],
            darwinProduct: productPaths["darwin-x64"],
            darwinAarch64Product: productPaths["darwin-aarch64"],
            portable,
            stage0Windows,
            stage0WindowsCmd,
            stage0Linux,
            ghcrRef: `ghcr.io/notnotype/neuro-book@sha256:${"f".repeat(64)}`,
            ghcrDigest: `sha256:${"f".repeat(64)}`,
            output,
        } satisfies Parameters<typeof buildReleaseManifest>[0];
        await buildReleaseManifest(manifestOptions, repository);

        const manifest = JSON.parse(await readFile(output, "utf8")) as {
            products: Array<{platform: string; imageId: string; sourceDigest: string; lockfileSha256: string; builderContractVersion: string}>;
        };
        for (const [index, platform] of PRODUCT_PLATFORMS.entries()) {
            expect(manifest.products.find((product) => product.platform === platform)).toMatchObject({
                platform,
                imageId: `sha256:${index.toString(16).repeat(64)}`,
                sourceDigest: `sha256:${(index + 5).toString(16).repeat(64)}`,
                lockfileSha256,
                builderContractVersion: "1",
            });
        }
        expect(await readFile(join(directory, "SHA256SUMS"), "utf8")).toContain("  release-manifest.json");
        await expect(buildReleaseManifest(manifestOptions, repository)).rejects.toThrow("输出目标已存在，拒绝覆盖");

        await expect(buildReleaseManifest({
            ...manifestOptions,
            source: join(directory, "missing-source.zip"),
        }, repository)).rejects.toThrow("输出目标已存在，拒绝覆盖");

        await writeFile(join(repository, "dirty-marker.txt"), "dirty\n", "utf8");
        await expect(buildReleaseManifest({
            ...manifestOptions,
            output: join(repository, "artifacts", "dirty", "release-manifest.json"),
        }, repository)).rejects.toThrow("dirty=true");
    }, 30_000);

    it("拒绝把当前.output包装成其他平台资产", async () => {
        const current = currentProductPlatform();
        const foreign = PRODUCT_PLATFORMS.find((platform) => platform !== current)!;

        await expect(runCapture("bun", [
            "scripts/release/release-assets.ts",
            "product",
            "--platform", foreign,
        ], {cwd: ROOT})).rejects.toThrow(`当前宿主${current}不能包装${foreign}`);
    });

    it("在任何GHCR或资产构建前集中执行Release Preflight", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        const scriptsTsconfig = JSON.parse(await readFile(resolve(ROOT, "scripts/tsconfig.json"), "utf8")) as {include?: string[]};
        const publicManagerVerifier = await readFile(resolve(ROOT, "scripts/release/verify-public-manager.ts"), "utf8");
        expect(workflow.jobs.preflight.steps).toContainEqual(
            expect.objectContaining({run: "bun run manager:verify-public"}),
        );
        expect(publicManagerVerifier).toContain('["cat-file", "-e", `${publicPackage.gitHead}^{commit}`]');
        expect(publicManagerVerifier).toContain('["fetch", "--no-tags", "origin", publicPackage.gitHead]');
        expect(publicManagerVerifier).not.toContain('"--depth=1"');
        const generatedSourcesStep = workflow.jobs.preflight.steps.findIndex(({run}) => run === "bun run generate");
        const productGraphStep = workflow.jobs.preflight.steps.findIndex(({run}) => run?.includes("scripts/deploy/product-start.test.ts"));
        const agentStateRootStep = workflow.jobs.preflight.steps.find(({run}) => run?.includes("product-agent-state-root-smoke.ts"));
        expect(generatedSourcesStep).toBeGreaterThan(-1);
        expect(productGraphStep).toBeGreaterThan(generatedSourcesStep);
        expect(agentStateRootStep?.["timeout-minutes"]).toBe(10);
        const preflightRun = workflow.jobs.preflight.steps.map(({run}) => run ?? "").join("\n");
        expect(preflightRun).toContain("bun run test:install");
        expect(preflightRun).toContain("bun run manager:test");
        expect(preflightRun).toContain("bun x tsc --noEmit -p scripts/tsconfig.json");
        expect(preflightRun).toContain("bun run --cwd packages/owned-process typecheck");
        expect(preflightRun).toContain("scripts/deploy/product-start.test.ts");
        expect(preflightRun).toContain("product-agent-state-root-smoke.ts");
        expect(preflightRun).toContain("--config scripts/release/release-assets-vitest.config.ts");
        expect(scriptsTsconfig.include).toContain("deploy/windows-owned-process-smoke.ts");
        expect(releaseAssetsVitestConfig.test.include).toEqual([
            "scripts/release/install-dependencies.test.ts",
            "scripts/release/installation-state-root.test.ts",
            "scripts/release/release-assets.test.ts",
            "scripts/release/release-checksums.test.ts",
        ]);
        expect(releaseAssetsVitestConfig.test).not.toHaveProperty("globalSetup");
        expect(releaseAssetsVitestConfig.test).not.toHaveProperty("setupFiles");
        expect(workflow.jobs["build-container"].needs).toBe("preflight");
        expect(workflow.jobs["merge-container-images"].needs).toBe("build-container");
        expect(workflow.jobs.source.needs).toBe("preflight");
        expect(workflow.jobs["product-linux"].needs).toBe("preflight");
        expect(workflow.jobs["product-linux-aarch64"].needs).toBe("source");
        const productLinuxRun = workflow.jobs["product-linux"].steps.map(({run}) => run ?? "").join("\n");
        expect(productLinuxRun).not.toContain("bun run test:install");
        expect(productLinuxRun).not.toContain("bun run manager:test");
        const macosRun = workflow.jobs["product-darwin-x64"].steps.map(({run}) => run ?? "").join("\n");
        expect(macosRun).toContain("bun run test:install");
        expect(macosRun).toContain("bun run manager:test");
        const windowsRun = workflow.jobs["product-windows"].steps.map(({run}) => run ?? "").join("\n");
        expect(windowsRun).toContain("bun run manager:test");
    });

    it("正式POSIX Product消费路径保留归档中的文件权限", async () => {
        const workflow = await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8");
        const verifier = await readFile(resolve(ROOT, "scripts/release/verify-posix-product.sh"), "utf8");

        expect(workflow).toContain("tar -xpzf candidate-assets/neuro-book-product-linux-x64-glibc.tar.gz");
        expect(verifier).toContain('tar -xpzf "$PRODUCT_ARCHIVE" -C "$APPLICATION_ROOT"');
    });

    it("Release Candidate按release ID隔离且绝不互相取消", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        expect(workflow.on?.workflow_dispatch?.inputs).toMatchObject({
            release_id: {required: true, type: "string"},
            tag: {required: true, type: "string"},
            revision: {required: true, type: "string"},
            prerelease: {required: true, type: "boolean"},
        });
        expect(workflow.concurrency?.group).toContain("inputs.release_id");
        expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
        const cache = workflow.jobs["product-windows"].steps.find(({uses}) => uses === "actions/cache@v4");
        expect(cache?.with?.path).toContain("node_modules");
        expect(cache?.with?.path).toContain("~/.bun/install/cache");
        expect(cache?.with?.key).toContain("steps.setup-bun.outputs.bun-version");
        expect(cache?.with?.key).toContain("hashFiles('bun.lock', 'package.json', 'packages/neuro-book-manager/package.json')");
        expect(workflow.jobs["product-windows"].steps).toContainEqual(expect.objectContaining({
            run: "bun scripts/release/install-dependencies.ts --linker hoisted",
        }));
        expect(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8"))
            .not.toMatch(/run:\s*bun install\b/u);
    });

    it("Draft资产摘要幂等上传，最终才公开Release并激活OCI别名", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {
                "activate-container-tags": WorkflowJob;
                "publish-index": WorkflowJob;
                "publish-payload": WorkflowJob;
            };
        };
        const source = await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8");
        expect(source).not.toContain("softprops/action-gh-release");
        expect(workflow.jobs["publish-payload"].steps.some(
            ({run}) => run?.includes("draft-release-assets.ts") && run.includes("inputs.release_id"),
        )).toBe(true);
        expect(workflow.jobs["verify-public-payload"].permissions).toMatchObject({
            contents: "write",
            packages: "read",
        });

        const finalSteps = workflow.jobs["publish-index"].steps.map(({name}) => name ?? "");
        expect(finalSteps.indexOf("Publish release index last"))
            .toBeLessThan(finalSteps.indexOf("Publish verified Release"));
        const publishRun = workflow.jobs["publish-index"].steps.map(({run}) => run ?? "").join("\n");
        expect(publishRun).toContain("releases/${RELEASE_ID}");
        expect(publishRun).toContain("{draft: false, prerelease: $prerelease}");

        const activation = workflow.jobs["activate-container-tags"];
        expect(activation.needs).toBe("publish-index");
        expect(activation.steps.map(({name}) => name ?? ""))
            .toContain("Verify published Release identity before OCI activation");
        const activationRun = activation.steps.map(({run}) => run ?? "").join("\n");
        expect(activationRun).toContain(".draft");
        expect(activationRun).toContain('tags=(--tag "${image}:${RELEASE_TAG}")');
        expect(activationRun).toContain('if [[ "${PRERELEASE}" != "true" ]]');

        const releaseCli = await readFile(resolve(ROOT, "scripts/release/release.ts"), "utf8");
        expect(releaseCli).toContain("item.headSha === head && item.displayTitle?.includes(tag)");
    });

    it("Linux AArch64 Product必须安装并执行真实浏览器smoke", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/product-platforms.yml"), "utf8")) as ProductWorkflow;
        const releaseWorkflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        const linuxArm = workflow.jobs.product.strategy.matrix.include.find(({platform}) => platform === "linux-aarch64-glibc");
        expect(linuxArm?.browser).toBe("playwright");
        expect(workflow.jobs.product.steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps.some(
            ({run}) => run?.includes("verify-posix-product.sh") && run.includes("playwright"),
        )).toBe(true);
    });

    it("Product失败诊断必须包含最终Runtime Image而不是复制整份Source", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/product-platforms.yml"), "utf8")) as ProductWorkflow;
        const diagnostics = workflow.jobs.product.steps.find(({name}) => name === "Upload native Product diagnostics");

        expect(diagnostics?.with?.["include-hidden-files"]).toBe(true);
        expect(diagnostics?.with?.path).toContain("/application/.output");
        expect(diagnostics?.with?.path).toContain("/state");
        expect(diagnostics?.with?.path).not.toContain("-smoke/*");
    });

    it("五平台 Product 与 GHCR 必须携带 sharp native island 并执行最终图片命令", async () => {
        const [nuxtConfig, commandBundle, runtimeIslands, posixVerify, releaseWorkflow, ghcrVerify, extractedVerifier] = await Promise.all([
            readFile(resolve(ROOT, "nuxt.config.ts"), "utf8"),
            readFile(resolve(ROOT, "scripts/build/product-command-bundle.ts"), "utf8"),
            readFile(resolve(ROOT, "scripts/build/product-runtime-islands.ts"), "utf8"),
            readFile(resolve(ROOT, "scripts/release/verify-posix-product.sh"), "utf8"),
            readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8"),
            readFile(resolve(ROOT, "scripts/release/verify-public-ghcr.sh"), "utf8"),
            readFile(resolve(ROOT, "scripts/release/verify-extracted-product.ts"), "utf8"),
        ]);

        expect(nuxtConfig).toContain("...productRuntimeIslandPackageNames()");
        expect(runtimeIslands).toContain('packages: ["sharp", "@img/colour", "semver"]');
        expect(commandBundle).toContain('"product-image-variant-smoke": "scripts/deploy/product-image-variant-smoke.ts"');
        for (const platformPackage of [
            "@img/sharp-win32-x64",
            "@img/sharp-linux-x64",
            "@img/sharp-linux-arm64",
            "@img/sharp-darwin-x64",
            "@img/sharp-darwin-arm64",
            "@img/sharp-libvips-linux-x64",
            "@img/sharp-libvips-linux-arm64",
            "@img/sharp-libvips-darwin-x64",
            "@img/sharp-libvips-darwin-arm64",
        ]) {
            expect(runtimeIslands).toContain(platformPackage);
        }
        expect(posixVerify).toContain(".output/server/commands/product-command.mjs check all");
        expect(releaseWorkflow).toContain(".output/server/commands/product-command.mjs");
        expect(releaseWorkflow).toContain("check all");
        expect(ghcrVerify).toContain(".output/server/commands/product-command.mjs check all");
        expect(posixVerify).toContain(".output/server/node_modules/@img/colour/");
        expect(posixVerify).toContain("verify-extracted-product.ts --product-root");
        expect(extractedVerifier).toContain("new ProductRuntimeImageVerifier().openVerified");
        expect(extractedVerifier).toContain("image.manifest.treeDigest !== build.treeDigest");
    });

    it("Linux Product与Windows Portable验收根必须位于checkout之外", async () => {
        const workflow = await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8");

        expect(workflow).toContain('smoke_root="${RUNNER_TEMP:?}/neuro-book-linux-product-smoke"');
        expect(workflow).toContain('$portableRoot = Join-Path $env:RUNNER_TEMP "neuro-book-portable-smoke"');
        expect(workflow).not.toContain('product_root="$PWD/product-browser-smoke"');
        expect(workflow).not.toContain("Resolve-Path portable");
    });

    it("GHCR同时构建并验收linux amd64、arm64与rootless Podman", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {
                "publish-index": WorkflowJob;
                "verify-public-ghcr-amd64": WorkflowJob;
                "verify-public-ghcr-arm64": WorkflowJob;
                "verify-public-ghcr-podman": WorkflowJob;
                "verify-public-windows-data-reuse": WorkflowJob;
            };
        };
        expect(workflow.jobs["build-container"]["runs-on"]).toBe("${{ matrix.runner }}");
        expect(workflow.jobs["build-container"].strategy.matrix.include).toEqual([
            {arch: "amd64", platform: "linux/amd64", runner: "ubuntu-latest"},
            {arch: "arm64", platform: "linux/arm64", runner: "ubuntu-24.04-arm"},
        ]);
        const buildSteps = workflow.jobs["build-container"].steps.filter(({uses}) => uses === "docker/build-push-action@v6");
        expect(buildSteps).toHaveLength(1);
        for (const step of buildSteps) {
            expect(step.with?.platforms).toBe("${{ matrix.platform }}");
            expect(step.with?.outputs).toContain("push-by-digest=true");
        }
        const mergeSteps = workflow.jobs["merge-container-images"].steps;
        const mergeRun = mergeSteps.map(({run}) => run ?? "").join("\n");
        expect(mergeRun).toContain("docker buildx imagetools create");
        expect(mergeRun).toContain("imagetools inspect");
        expect(mergeRun).toContain("--raw | sha256sum");
        expect(mergeRun).toContain('test "${#digests[@]}" -eq 2');
        expect(mergeSteps.find(({id}) => id === "merge")?.env?.CANDIDATE_TAG)
            .toBe("candidate-${{ inputs.release_id }}");
        expect(mergeRun).not.toContain("${APP_IMAGE}:${RELEASE_TAG}");
        expect(workflow.jobs["verify-public-ghcr-arm64"]["runs-on"]).toBe("ubuntu-24.04-arm");
        expect(workflow.jobs["verify-public-ghcr-podman"].steps.some(
            ({run}) => run?.includes("PODMAN_COMPOSE_PROVIDER=podman-compose podman compose version"),
        )).toBe(true);
        expect(workflow.jobs["verify-public-ghcr-podman"].steps.some(({run}) => run?.includes("verify-public-ghcr.sh") && run.includes("podman"))).toBe(true);
        const publicGhcr = await readFile(resolve(ROOT, "scripts/release/verify-public-ghcr.sh"), "utf8");
        expect(publicGhcr).toContain('scripts/release/installation-state-root.ts "$root"');
        expect(publicGhcr).toContain('state_root="$(resolve_state_root)"');
        expect(publicGhcr).toContain('--filter "label=com.docker.compose.project.working_dir=$compose_working_dir"');
        expect(publicGhcr).toContain('--filter "label=com.docker.compose.service=app"');
        expect(publicGhcr).toContain('compose ps --all --quiet app');
        expect(publicGhcr).not.toContain('--env-file "$root/.env"');
        expect(publicGhcr).toContain('"$engine" stop --time 10 "$container_id"');
        expect(publicGhcr).toContain('manager_cwd="${manager_home}/bunx"');
        expect(publicGhcr).toContain('(cd "$manager_cwd" && bunx --bun "@notnotype/neuro-book-manager@${manager_version}" "$@")');
        expect(publicGhcr).not.toContain('\n    bunx --bun "@notnotype/neuro-book-manager@${manager_version}" "$@"\n');
        expect(publicGhcr).toContain('if ! manager --root "$root" update');
        expect(publicGhcr).toContain('cat "$recovery_log" >&2');
        expect(publicGhcr).toContain('".deploy/operations/release-recovery.json"');
        expect(publicGhcr).toContain('".deploy/staging/release-recovery-marker"');
        expect(publicGhcr).toContain('".deploy/backups/release-recovery"');
        expect(publicGhcr).not.toContain('outcome !== "rolled-back"');
        const interruptedOperation = await readFile(resolve(ROOT, "scripts/release/create-interrupted-operation.ts"), "utf8");
        const scriptsTsconfig = JSON.parse(await readFile(resolve(ROOT, "scripts/tsconfig.json"), "utf8")) as {include?: string[]};
        expect(interruptedOperation).not.toContain('from "nbook/');
        expect(interruptedOperation).toContain("schemaVersion: 5");
        expect(interruptedOperation).toContain("await writeJsonAtomic(journalPath, journal)");
        expect(scriptsTsconfig.include).toContain("release/create-interrupted-operation.ts");
        expect(workflow.jobs["publish-index"].needs).toEqual([
            "verify-public-ghcr-amd64",
            "verify-public-ghcr-arm64",
            "verify-public-ghcr-podman",
            "verify-public-windows-data-reuse",
        ]);
    });

    it("GHCR崩溃恢复fixture不依赖Source node_modules", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-release-recovery-fixture-"));
        roots.push(root);
        await mkdir(join(root, ".deploy"), {recursive: true});
        await writeFile(
            join(root, ".deploy", "installation.json"),
            `${JSON.stringify({containerEngine: "docker"})}\n`,
            "utf8",
        );

        await runCapture("bun", ["scripts/release/create-interrupted-operation.ts", root], {cwd: ROOT});

        const journal = JSON.parse(await readFile(
            join(root, ".deploy", "operations", "release-recovery.json"),
            "utf8",
        )) as {
            schemaVersion: number;
            phase: string;
            previousManifest: {containerEngine: string};
            effects: Array<{kind: string; owner: string; path: string; state: string}>;
        };
        expect(journal.schemaVersion).toBe(5);
        expect(journal.phase).toBe("planned");
        expect(journal.previousManifest.containerEngine).toBe("docker");
        expect(journal.effects).toContainEqual({
            kind: "path-create",
            state: "applied",
            owner: "staging",
            path: ".deploy/staging/release-recovery-marker",
        });
        expect((await stat(join(root, ".deploy", "staging", "release-recovery-marker"))).isDirectory()).toBe(true);
    });

    it("Manifest v5首次发布只复用0.8.6完整data目录", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {"verify-public-windows-data-reuse": WorkflowJob};
        };
        const run = workflow.jobs["verify-public-windows-data-reuse"].steps.map((step) => step.run ?? "").join("\n");
        expect(run).toContain("$oldManager --root $baselineRoot admin create");
        expect(run).toContain("Copy-Item -LiteralPath (Join-Path $baselineRoot \"data\")");
        expect(run).toContain("$candidateManifest.schemaVersion -ne 5");
        expect(run).not.toContain("--root $root update --channel");
    });

    it("Windows候选验收直接拥有实际Manager进程", async () => {
        const workflowText = await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8");
        const workflow = parse(workflowText) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {"verify-public-windows-data-reuse": WorkflowJob};
        };
        const candidateRun = workflow.jobs["verify-windows"].steps.map((step) => step.run ?? "").join("\n");
        expect(candidateRun).toContain("verify-windows-portable-restart.ts");
        expect(candidateRun).not.toContain("Start-Process -FilePath $env:ComSpec");
        expect(candidateRun).not.toContain("Stop-Process -Id $managerProcess.Id -Force");
        expect(workflowText).toContain("${{ runner.temp }}/neuro-book-portable-smoke/data/logs/release-browser-smoke*");
        expect(workflowText).toContain("${{ runner.temp }}/neuro-book-portable-smoke/data/logs/release-auth-smoke*");
        expect(candidateRun).toContain("uninstall --yes");
        expect(candidateRun).toContain("uninstall --delete-data --yes");
        expect(candidateRun).toContain("Portable默认卸载Host结果失败");
        expect(candidateRun).toContain("$preserveChildren.Count -ne 1");
        expect(candidateRun).toContain("Portable全量卸载Host结果失败");
        expect(candidateRun).toContain("Portable全量卸载没有在退出后删除Installation Root");

        const restartVerifier = (await readFile(resolve(ROOT, "scripts/release/verify-windows-portable-restart.ts"), "utf8")).replaceAll("\r\n", "\n");
        expect(restartVerifier).toContain("manifest.components.managerRuntime");
        expect(restartVerifier).toContain("manifest.components.manager.path");
        expect(restartVerifier).toContain("--shutdown-on-stdin-end");
        expect(restartVerifier).toContain("acquireAgentSessionStoreExclusiveLease");
        expect(restartVerifier).toContain("const STARTUP_TIMEOUT_MS = 150_000;");
        expect(restartVerifier).toContain('"node",\n        "--import",\n        "tsx"');
        expect(restartVerifier).not.toContain('from "nbook/scripts/deploy/product-browser-smoke"');

        const browserVerifier = await readFile(resolve(ROOT, "scripts/deploy/product-browser-smoke.ts"), "utf8");
        expect(browserVerifier).toContain('process.platform === "win32" && typeof Bun !== "undefined"');
        expect(browserVerifier).toContain("const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;");

        const publicRun = workflow.jobs["verify-public-windows-data-reuse"].steps.map((step) => step.run ?? "").join("\n");
        expect(publicRun).toContain("$managerRuntime = Join-Path $root $candidateManifest.components.managerRuntime.path");
        expect(publicRun).toContain("$managerBundle = Join-Path $root $candidateManifest.components.manager.path");
        expect(publicRun).toContain("Start-Process -FilePath $managerRuntime");
        expect(publicRun).not.toContain("Start-Process -FilePath $manager -ArgumentList");
    });
});

/** 创建最小、干净且能运行 ProductRuntimeImageBuilder 的 Git Source fixture。 */
async function releaseRepositoryFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-release-identity-"));
    roots.push(root);
    const files = new Map<string, string>([
        [".gitignore", "node_modules/\n.deploy/\n.output/\ndist/\nartifacts/\n"],
        ["package.json", `${JSON.stringify({name: "fixture", version: "1.2.3"})}\n`],
        ["bun.lock", "fixture-lock\n"],
        ["release-state-migration.json", `${JSON.stringify({policy: "none", steps: []})}\n`],
        ["docs/migrations/README.md", "# Migrations\n"],
        ["scripts/db/migrate-application-state.ts", "export {};\n"],
        ["server/runtime/application-state-command.ts", "export {};\n"],
        ["server/runtime/application-state-migration/app-sqlite-step.ts", "export {};\n"],
        ["server/runtime/application-state-migration/catalog-registry.ts", "export {};\n"],
        ["server/runtime/application-state-migration/catalog.ts", "export {};\n"],
        ["server/runtime/application-state-migration/lease.ts", "export {};\n"],
        ["server/runtime/application-state-migration/runner.ts", "export {};\n"],
        ["server/runtime/application-state-migration/types.ts", "export {};\n"],
        ["server/agent/session/migrations/session-v2-review-repair/journal.ts", "export {};\n"],
        ["server/agent/session/migrations/session-v2-review-repair/migration.ts", "export {};\n"],
        ["server/agent/session/migrations/session-v2-review-repair/types.ts", "export {};\n"],
        ["node_modules/nuxt/package.json", `${JSON.stringify({name: "nuxt", version: "4.3.1"})}\n`],
        ["node_modules/nitropack/package.json", `${JSON.stringify({name: "nitropack", version: "2.13.4"})}\n`],
    ]);
    for (const [path, content] of files) {
        const absolute = join(root, path);
        await mkdir(resolve(absolute, ".."), {recursive: true});
        await writeFile(absolute, content, "utf8");
    }
    await git(root, ["init", "--quiet"]);
    await git(root, ["add", "."]);
    await git(root, ["-c", "user.name=NeuroBook Test", "-c", "user.email=test@nbook.local", "commit", "--quiet", "-m", "fixture"]);
    return root;
}

/** 在 fixture 内运行 Git，不依赖全局用户配置。 */
async function git(cwd: string, args: string[]): Promise<void> {
    await runCapture("git", args, {cwd});
}

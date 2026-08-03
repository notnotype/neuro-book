import {execFile} from "node:child_process";
import {access, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {promisify} from "node:util";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it} from "vitest";

import {PRODUCT_PLATFORMS} from "nbook/packages/neuro-book-manager/src/types";
import {
    hasProductRuntimeBuildPolicy,
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
    PRODUCT_RUNTIME_MAX_BYTES,
    PRODUCT_RUNTIME_MAX_FILES,
    PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
    ProductRuntimeImageBuilder,
    productRuntimeBuildPolicy,
    type ProductRuntimeExpectedIdentity,
    type ProductRuntimeImageBudget,
    type ProductRuntimeImageManifest,
} from "nbook/scripts/build/product-runtime-image-builder";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    type ProductRuntimeEntryMap,
} from "nbook/shared/product-runtime-contract";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(async (root) => {
        await rm(root, {recursive: true, force: true});
    }));
});

describe("ProductRuntimeImageBuilder", {timeout: 30_000}, () => {
    it("只在 operation staging 中生成带可复核身份和 owner inventory 的 ready image", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        let callbackSourceDigest = "";

        const image = await builder.buildCandidate({
            operationId: "release-001",
            platform: "windows-x64",
            ...fixturePolicy(),
            async build({imageRoot, scratchRoot, sourceDigest}) {
                callbackSourceDigest = sourceDigest;
                expect(scratchRoot).toBe(join(imageRoot, ".build-scratch"));
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await mkdir(join(imageRoot, "public"), {recursive: true});
                await mkdir(scratchRoot, {recursive: true});
                await writeFile(join(scratchRoot, "temporary.txt"), "transient", "utf8");
                await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
                await writeFile(join(imageRoot, "public", "app.js"), "console.log('ready');\n", "utf8");
                await writeRuntimeFixture(imageRoot);
            },
        });

        expect(relative(root, image.path).replaceAll("\\", "/")).toBe(".deploy/staging/release-001");
        expect(image.manifest).toMatchObject({
            schema: "nbook.product-runtime-image/v3",
            builderContractVersion: PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
            version: "1.2.3",
            dirty: false,
            platform: "windows-x64",
            runtime: {nuxt: "4.3.1", nitro: "2.13.4"},
            runtimeContract: {path: PRODUCT_RUNTIME_CONTRACT_PATH},
            policy: {
                schema: "nbook.product-runtime-image-policy/v1",
                sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            },
            inventory: {
                files: 19,
                owners: expect.arrayContaining([
                    expect.objectContaining({name: "frontend", paths: ["public"], files: 1}),
                    expect.objectContaining({
                        name: "server-bundle",
                        paths: ["server/index.mjs", "server/index.mjs.map"],
                        files: 1,
                    }),
                ]),
            },
        });
        expect(image.manifest.imageId).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(image.manifest.treeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(image.manifest.shapeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(callbackSourceDigest).toBe(image.manifest.sourceDigest);
        expect(JSON.parse(await readFile(join(image.path, "runtime-image.ready"), "utf8"))).toMatchObject({
            imageId: image.manifest.imageId,
        });
        await expect(readFile(join(root, ".deploy", "staging-leases", "release-001"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(image.path, ".build-scratch", "temporary.txt"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});

        const reopened = await builder.openVerified(image.path, expectedIdentity(image.manifest));
        expect(reopened.manifest).toEqual(image.manifest);
    });

    it("构建回调失败时删除整个候选及 operation scratch", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = join(root, ".deploy", "staging", "callback-failure");

        await expect(builder.buildCandidate({
            operationId: "callback-failure",
            platform: "windows-x64",
            ...fixturePolicy(),
            async build({imageRoot, scratchRoot}) {
                await mkdir(join(scratchRoot, "runtime-bundle"), {recursive: true});
                await writeFile(join(scratchRoot, "runtime-bundle", "index.mjs"), "partial", "utf8");
                await writeFile(join(imageRoot, "partial.txt"), "partial", "utf8");
                throw new Error("injected build failure");
            },
        })).rejects.toThrow("injected build failure");

        await expect(access(candidate)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("全部正式平台已登记，measurement 返回已登记状态且不留下候选", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);

        for (const platform of PRODUCT_PLATFORMS) {
            expect(hasProductRuntimeBuildPolicy(platform)).toBe(true);
            expect(productRuntimeBuildPolicy(platform).platform).toBe(platform);
        }

        const report = await measureFixture(builder, "registered-measurement", "linux-x64-glibc");
        expect(report).toMatchObject({
            schema: PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
            builderContractVersion: PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
            version: "1.2.3",
            dirty: false,
            platform: "linux-x64-glibc",
            runtime: {nuxt: "4.3.1", nitro: "2.13.4"},
            runtimeContract: {path: PRODUCT_RUNTIME_CONTRACT_PATH},
            policy: {
                registered: true,
                globalBudget: {
                    maxFiles: PRODUCT_RUNTIME_MAX_FILES,
                    maxBytes: PRODUCT_RUNTIME_MAX_BYTES,
                },
            },
        });
        expect(report.policy.owners.map((owner) => owner.name)).toEqual([
            "authoring-kit",
            "commands",
            "frontend",
            "native-islands",
            "runtime-meta",
            "server-bundle",
            "system-assets",
        ]);
        expect(report.inventory.files).toBeGreaterThan(0);
        expect(report.treeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(report.shapeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        await expect(access(join(root, ".deploy", "staging", "registered-measurement")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(root, ".deploy", "staging-leases", "registered-measurement")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("已登记平台 measurement 仍不生成 ready image，失败时也清理 candidate 和 lease", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const registered = await measureFixture(builder, "registered-measurement", "windows-x64");

        expect(registered.policy.registered).toBe(true);
        await expect(access(join(root, ".deploy", "staging", "registered-measurement")))
            .rejects.toMatchObject({code: "ENOENT"});

        await expect(builder.measureCandidate({
            operationId: "measurement-failure",
            platform: "darwin-aarch64",
            async build({imageRoot, scratchRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await mkdir(scratchRoot, {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "partial", "utf8");
                await writeFile(join(scratchRoot, "partial"), "partial", "utf8");
                throw new Error("injected measurement failure");
            },
        })).rejects.toThrow("injected measurement failure");
        await expect(access(join(root, ".deploy", "staging", "measurement-failure")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(root, ".deploy", "staging-leases", "measurement-failure")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("构建期间 tracked Source 变化时拒绝候选且不留下 ready 目录", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = join(root, ".deploy", "staging", "source-race");

        await expect(builder.buildCandidate({
            operationId: "source-race",
            platform: "windows-x64",
            ...fixturePolicy(),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
                await writeFile(join(root, "src", "input.ts"), "export const input = 2;\n", "utf8");
            },
        })).rejects.toThrow(/Product build 期间 Source 输入发生变化[\s\S]*src\/input\.ts/u);
        await expect(readFile(join(candidate, "runtime-image.ready"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("构建前已 dirty 时仍能发现回调新增的 untracked Source", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        await writeFile(join(root, "src", "already-dirty.ts"), "export const before = true;\n", "utf8");

        await expect(builder.buildCandidate({
            operationId: "dirty-untracked-source-race",
            platform: "windows-x64",
            ...fixturePolicy(),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
                await writeFile(join(root, "src", "created-during-build.ts"), "export const after = true;\n", "utf8");
            },
        })).rejects.toThrow(/Product build 期间 Source 输入发生变化[\s\S]*src\/created-during-build\.ts/u);
    });

    it("把 worktree 中已删除的 tracked Source 表达为 dirty 输入而不是 lstat 失败", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        await rm(join(root, "src", "input.ts"));

        const image = await simpleImage(builder, "tracked-deletion");

        expect(image.manifest.dirty).toBe(true);
        expect(image.manifest.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        await expect(builder.openVerified(image.path, expectedIdentity(image.manifest))).resolves.toMatchObject({
            manifest: {imageId: image.manifest.imageId},
        });
    });

    it("分支、detached HEAD 与暂存状态不改变相同 Source 内容的 digest", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const original = await simpleImage(builder, "identity-original");

        await git(root, ["switch", "--quiet", "-c", "identity-branch"]);
        const branch = await simpleImage(builder, "identity-branch");
        await git(root, ["switch", "--quiet", "--detach"]);
        const detached = await simpleImage(builder, "identity-detached");

        expect(branch.manifest.sourceDigest).toBe(original.manifest.sourceDigest);
        expect(detached.manifest.sourceDigest).toBe(original.manifest.sourceDigest);

        await writeFile(join(root, "src", "input.ts"), "export const input = 2;\n", "utf8");
        const unstaged = await simpleImage(builder, "identity-unstaged");
        await git(root, ["add", "src/input.ts"]);
        const staged = await simpleImage(builder, "identity-staged");

        expect(unstaged.manifest.dirty).toBe(true);
        expect(staged.manifest.dirty).toBe(true);
        expect(staged.manifest.sourceDigest).toBe(unstaged.manifest.sourceDigest);
    });

    it("payload、manifest、marker 或 expected identity 任一不一致时 fail closed", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const image = await simpleImage(builder, "tamper");
        const payloadPath = join(image.path, "server", "index.mjs");
        const originalPayload = await readFile(payloadPath, "utf8");

        await writeFile(payloadPath, "export default false;\n", "utf8");
        await expect(builder.openControlPlane(image.path, expectedIdentity(image.manifest))).resolves.toMatchObject({
            manifest: {imageId: image.manifest.imageId},
        });
        await expect(builder.openVerified(image.path, expectedIdentity(image.manifest))).rejects.toThrow("payload digest 不一致");
        await writeFile(payloadPath, originalPayload, "utf8");

        await expect(builder.openVerified(image.path, {
            ...expectedIdentity(image.manifest),
            revision: "f".repeat(40),
        })).rejects.toThrow("身份不一致：revision");
        await expect(builder.openVerified(image.path, {
            ...expectedIdentity(image.manifest),
            platform: "linux-x64-glibc",
        })).rejects.toThrow("身份不一致：platform");
        await expect(builder.openVerified(image.path, {
            ...expectedIdentity(image.manifest),
            lockfileSha256: `sha256:${"f".repeat(64)}`,
        })).rejects.toThrow("身份不一致：lockfileSha256");
        await expect(builder.openVerified(image.path, {
            ...expectedIdentity(image.manifest),
            builderContractVersion: "999",
        })).rejects.toThrow("身份不一致：builderContractVersion");

        const manifestPath = join(image.path, "runtime-image.json");
        const manifestText = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestText) as ProductRuntimeImageManifest;
        manifest.policy.budget.maxFiles += 1;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await expect(builder.openVerified(image.path, expectedIdentity(image.manifest))).rejects.toThrow("policy 摘要");
        await writeFile(manifestPath, manifestText, "utf8");

        const versionManifest = JSON.parse(manifestText) as ProductRuntimeImageManifest;
        versionManifest.version = "9.9.9";
        await writeFile(manifestPath, `${JSON.stringify(versionManifest, null, 2)}\n`, "utf8");
        await expect(builder.openVerified(image.path, expectedIdentity(image.manifest))).rejects.toThrow("ready marker 与 manifest 不一致");

        await rm(join(image.path, "runtime-image.ready"));
        await expect(builder.openVerified(image.path, expectedIdentity(image.manifest))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("同时执行总预算和 owner 登记基线加 10% 门禁", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);

        await expect(builder.buildCandidate({
            operationId: "owner-growth",
            platform: "windows-x64",
            ...fixturePolicy({baselines: {"server-bundle": {files: 1, bytes: 10}}}),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "123456789012", "utf8");
                await writeRuntimeFixture(imageRoot);
            },
        })).rejects.toThrow("owner 超出登记基线 10%");

        await expect(builder.buildCandidate({
            operationId: "total-budget",
            platform: "windows-x64",
            ...fixturePolicy({maxFiles: 1}),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "ok", "utf8");
                await writeRuntimeFixture(imageRoot);
            },
        })).rejects.toThrow("超出总预算");

        await expect(builder.buildCandidate({
            operationId: "missing-owner-baseline",
            platform: "windows-x64",
            owners: fixturePolicy().owners,
            budget: {maxFiles: 10, maxBytes: 1024, ownerBaselines: []},
            async build() {},
        })).rejects.toThrow("缺少 owner 登记基线");

        const canonical = fixturePolicy();
        await expect(builder.buildCandidate({
            operationId: "different-owner-policy",
            platform: "windows-x64",
            owners: canonical.owners.map((owner) => owner.name === "commands"
                ? {...owner, paths: ["server/commands", "server/prisma", "server/extra"]}
                : owner),
            budget: canonical.budget,
            async build() {},
        })).rejects.toThrow("owners 不符合规范平台 policy");

        await expect(builder.buildCandidate({
            operationId: "loose-total-policy",
            platform: "windows-x64",
            owners: canonical.owners,
            budget: {...canonical.budget, maxFiles: canonical.budget.maxFiles + 1},
            async build() {},
        })).rejects.toThrow("总预算放宽了规范平台 policy");

        await expect(builder.buildCandidate({
            operationId: "loose-owner-policy",
            platform: "windows-x64",
            owners: canonical.owners,
            budget: {
                ...canonical.budget,
                ownerBaselines: canonical.budget.ownerBaselines.map((baseline) => baseline.name === "commands"
                    ? {...baseline, files: baseline.files + 1}
                    : baseline),
            },
            async build() {},
        })).rejects.toThrow("owner baseline 放宽了规范平台 policy：commands");
    });

    it("物理总量预算包含 manifest 与 ready 两个控制文件", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);

        await expect(builder.buildCandidate({
            operationId: "physical-total-budget",
            platform: "windows-x64",
            ...fixturePolicy({maxFiles: 17}),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "ok", "utf8");
                await writeRuntimeFixture(imageRoot);
            },
        })).rejects.toThrow("Product Runtime Image 超出总预算：18/17 files");
    });

    it("拒绝 owner 路径逃逸与指向候选外部的 symlink", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);

        await expect(builder.buildCandidate({
            operationId: "owner-escape",
            platform: "windows-x64",
            owners: [{name: "outside", paths: ["../outside"]}],
            budget: {maxFiles: 10, maxBytes: 1024, ownerBaselines: [{name: "outside", files: 10, bytes: 1024}]},
            async build() {},
        })).rejects.toThrow("不能逃逸候选根");

        const outside = join(root, "outside");
        await mkdir(outside);
        await writeFile(join(outside, "secret.txt"), "outside", "utf8");
        await expect(builder.buildCandidate({
            operationId: "symlink-escape",
            platform: "windows-x64",
            ...fixturePolicy(),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
                await writeRuntimeFixture(imageRoot);
                await symlink(outside, join(imageRoot, "outside-link"), "junction");
            },
        })).rejects.toThrow(/不接受绝对 symlink|逃逸允许根/u);
    });

    it("下一次构建只回收超过 24 小时且没有活跃 lease 的 staging", async () => {
        const root = await sourceFixture();
        const stalePath = join(root, ".deploy", "staging", "abandoned");
        const freshPath = join(root, ".deploy", "staging", "fresh");
        await mkdir(stalePath, {recursive: true});
        await mkdir(freshPath, {recursive: true});
        await mkdir(join(stalePath, ".build-scratch", "runtime-bundle"), {recursive: true});
        await writeFile(join(stalePath, "partial.txt"), "stale", "utf8");
        await writeFile(join(stalePath, ".build-scratch", "runtime-bundle", "index.mjs"), "stale", "utf8");
        await writeFile(join(freshPath, "partial.txt"), "fresh", "utf8");
        const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
        await utimes(stalePath, old, old);

        await simpleImage(new ProductRuntimeImageBuilder(root), "sweep-trigger");

        await expect(readFile(join(stalePath, "partial.txt"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(stalePath, ".build-scratch"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(freshPath, "partial.txt"), "utf8")).resolves.toBe("fresh");
    });

    it("活跃 staging lease 的 heartbeat 阻止过期候选被回收", async () => {
        const root = await sourceFixture();
        const candidatePath = join(root, ".deploy", "staging", "owned");
        const leaseTarget = join(root, ".deploy", "staging-leases", "owned");
        await mkdir(candidatePath, {recursive: true});
        await mkdir(join(candidatePath, ".build-scratch", "runtime-bundle"), {recursive: true});
        await mkdir(resolve(leaseTarget, ".."), {recursive: true});
        await writeFile(join(candidatePath, "partial.txt"), "active", "utf8");
        await writeFile(join(candidatePath, ".build-scratch", "runtime-bundle", "index.mjs"), "active", "utf8");
        await writeFile(leaseTarget, "owner\n", "utf8");
        const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
        await utimes(candidatePath, old, old);
        const release = await acquireFileLock(leaseTarget, {
            realpath: false,
            stale: 24 * 60 * 60 * 1000,
            update: 60_000,
            retries: 0,
        });
        try {
            await simpleImage(new ProductRuntimeImageBuilder(root), "lease-sweep-trigger");
            await expect(readFile(join(candidatePath, "partial.txt"), "utf8")).resolves.toBe("active");
            await expect(readFile(join(candidatePath, ".build-scratch", "runtime-bundle", "index.mjs"), "utf8"))
                .resolves.toBe("active");
        } finally {
            await release();
        }
    });

    it("回收没有 candidate 的孤立 marker，但保留仍有活跃 lease 的 marker", async () => {
        const root = await sourceFixture();
        const leaseRoot = join(root, ".deploy", "staging-leases");
        const orphanMarker = join(leaseRoot, "published-candidate");
        const activeMarker = join(leaseRoot, "moving-candidate");
        await mkdir(leaseRoot, {recursive: true});
        await writeFile(orphanMarker, "published\n", "utf8");
        await writeFile(activeMarker, "active\n", "utf8");
        const release = await acquireFileLock(activeMarker, {
            realpath: false,
            stale: 24 * 60 * 60 * 1000,
            update: 60_000,
            retries: 0,
        });

        try {
            await simpleImage(new ProductRuntimeImageBuilder(root), "marker-sweep-trigger");
            await expect(access(orphanMarker)).rejects.toMatchObject({code: "ENOENT"});
            await expect(readFile(activeMarker, "utf8")).resolves.toBe("active\n");
        } finally {
            await release();
        }

        await simpleImage(new ProductRuntimeImageBuilder(root), "marker-sweep-after-release");
        await expect(access(activeMarker)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Git-less Source 必须钉死 revision，并继续检测构建期输入变化", async () => {
        const root = await sourceFixture();
        const revision = (await execFileAsync("git", ["rev-parse", "HEAD"], {cwd: root, windowsHide: true})).stdout.trim();
        await rm(join(root, ".git"), {recursive: true, force: true});
        await mkdir(join(root, "server", "generated", "prisma"), {recursive: true});
        await writeFile(join(root, "server", "generated", "prisma", "client.ts"), "generated-v1\n", "utf8");
        const builder = new ProductRuntimeImageBuilder(root);

        await expect(simpleImage(builder, "gitless-without-identity")).rejects.toThrow(
            "Git-less Product build 必须显式提供",
        );
        const image = await builder.buildCandidate({
            operationId: "gitless-valid",
            platform: "windows-x64",
            expectedSource: {revision, dirty: false},
            ...fixturePolicy(),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await mkdir(join(root, "logs"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "valid", "utf8");
                await writeRuntimeFixture(imageRoot);
                await writeFile(join(root, "logs", "server-current.jsonl"), "generated during build\n", "utf8");
                await writeFile(join(root, "server", "generated", "prisma", "client.ts"), "generated-v2\n", "utf8");
            },
        });
        expect(image.manifest).toMatchObject({revision, dirty: false});

        await expect(builder.buildCandidate({
            operationId: "gitless-source-race",
            platform: "windows-x64",
            expectedSource: {revision, dirty: false},
            ...fixturePolicy(),
            async build({imageRoot}) {
                await mkdir(join(imageRoot, "server"), {recursive: true});
                await writeFile(join(imageRoot, "server", "index.mjs"), "race", "utf8");
                await writeFile(join(root, "src", "input.ts"), "export const input = 2;\n", "utf8");
            },
        })).rejects.toThrow("Source 输入发生变化");
    });
});

/** 建立最小、干净且可由 Builder 读取实际版本的 Git Source fixture。 */
async function sourceFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-runtime-image-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "src"), {recursive: true});
    await mkdir(join(root, "node_modules", "nuxt"), {recursive: true});
    await mkdir(join(root, "node_modules", "nitropack"), {recursive: true});
    await writeFile(join(root, ".gitignore"), ".deploy/\n.output/\nnode_modules/\noutside/\n", "utf8");
    await writeFile(join(root, "package.json"), `${JSON.stringify({name: "fixture", version: "1.2.3"})}\n`, "utf8");
    await writeFile(join(root, "bun.lock"), "fixture-lock\n", "utf8");
    await writeFile(join(root, "src", "input.ts"), "export const input = 1;\n", "utf8");
    await writeFile(join(root, "node_modules", "nuxt", "package.json"), `${JSON.stringify({name: "nuxt", version: "4.3.1"})}\n`, "utf8");
    await writeFile(join(root, "node_modules", "nitropack", "package.json"), `${JSON.stringify({name: "nitropack", version: "2.13.4"})}\n`, "utf8");
    await git(root, ["init", "--quiet"]);
    await git(root, ["add", ".gitignore", "package.json", "bun.lock", "src/input.ts"]);
    await git(root, ["-c", "user.name=NeuroBook Test", "-c", "user.email=test@nbook.local", "commit", "--quiet", "-m", "fixture"]);
    return root;
}

/** 构建一个只含 server entry 的有效候选。 */
async function simpleImage(builder: ProductRuntimeImageBuilder, operationId: string) {
    return await builder.buildCandidate({
        operationId,
        platform: "windows-x64",
        ...fixturePolicy(),
        async build({imageRoot}) {
            await mkdir(join(imageRoot, "server"), {recursive: true});
            await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
            await writeRuntimeFixture(imageRoot);
        },
    });
}

/** 在任意支持平台生成一次不会持久化候选的最小测量。 */
async function measureFixture(
    builder: ProductRuntimeImageBuilder,
    operationId: string,
    platform: "windows-x64" | "linux-x64-glibc",
) {
    return await builder.measureCandidate({
        operationId,
        platform,
        async build({imageRoot}) {
            await mkdir(join(imageRoot, "server"), {recursive: true});
            await writeFile(join(imageRoot, "server", "index.mjs"), "export default true;\n", "utf8");
            await writeRuntimeFixture(imageRoot, platform, true);
        },
    });
}

/** 写入最小但完整的 Product Runtime Contract 与全部被引用入口。 */
async function writeRuntimeFixture(
    imageRoot: string,
    platform: typeof PRODUCT_PLATFORMS[number] = "windows-x64",
    withClosureEvidence = false,
): Promise<void> {
    const entries: ProductRuntimeEntryMap = {
        productStart: "server/commands/start.mjs",
        sqliteMigrate: "server/commands/migrate-database.mjs",
        applicationStateMigration: "server/commands/migrate-application-state.mjs",
        createAdmin: "server/commands/create-admin.mjs",
        profile: "server/commands/profile.mjs",
        variable: "server/commands/variable.mjs",
        workspace: "server/commands/workspace.mjs",
        prepareSystemAssets: "server/commands/prepare-system-assets.mjs",
        checkMigrations: "server/commands/check-migrations.mjs",
        profileAuthoringSmoke: "server/commands/profile-authoring.mjs",
        variableAuthoringSmoke: "server/commands/variable-authoring.mjs",
        imageVariantSmoke: "server/commands/sharp-image-variant.mjs",
        sqliteVecSmoke: "server/commands/sqlite-vec.mjs",
        webFetchSmoke: "server/commands/web-fetch.mjs",
        worldEngineConfigSmoke: "server/commands/world-engine-config.mjs",
    };
    const contract = createProductRuntimeContract(entries);
    const entryPaths = new Set([PRODUCT_RUNTIME_COMMAND_BOOTSTRAP, ...Object.values(entries)]);
    for (const entryPath of entryPaths) {
        const absolutePath = join(imageRoot, ...entryPath.split("/"));
        await mkdir(resolve(absolutePath, ".."), {recursive: true});
        await writeFile(absolutePath, "export {};\n", "utf8");
    }
    const contractPath = join(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/"));
    await mkdir(resolve(contractPath, ".."), {recursive: true});
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
    if (!withClosureEvidence) return;
    await Promise.all([
        mkdir(join(imageRoot, "server", "authoring"), {recursive: true}),
        mkdir(join(imageRoot, "server", "assets"), {recursive: true}),
    ]);
    await Promise.all([
        writeFile(join(imageRoot, "server", "native-islands.json"), `${JSON.stringify({
            schema: "nbook.product-native-islands/v2",
            platform,
            islands: [],
            opaqueImports: [],
        }, null, 4)}\n`, "utf8"),
        writeFile(join(imageRoot, "server", "authoring", "placeholder.mjs"), "export {};\n", "utf8"),
        writeFile(join(imageRoot, "server", "assets", "placeholder.mjs"), "export {};\n", "utf8"),
    ]);
}

/** fixture 只能收窄正式平台策略；无法创造 release 可接受的宽松 policy。 */
function fixturePolicy(options: {
    maxFiles?: number;
    maxBytes?: number;
    baselines?: {[name: string]: {files: number; bytes: number}};
} = {}): {owners: ReturnType<typeof productRuntimeBuildPolicy>["owners"]; budget: ProductRuntimeImageBudget} {
    const policy = productRuntimeBuildPolicy("windows-x64");
    return {
        owners: policy.owners,
        budget: {
            maxFiles: options.maxFiles ?? policy.budget.maxFiles,
            maxBytes: options.maxBytes ?? policy.budget.maxBytes,
            ownerBaselines: policy.budget.ownerBaselines.map((baseline) => ({
                ...baseline,
                ...options.baselines?.[baseline.name],
            })),
        },
    };
}

/** 从刚验证过的 manifest 构造下一次 open 所需的严格代次身份。 */
function expectedIdentity(manifest: ProductRuntimeImageManifest): ProductRuntimeExpectedIdentity {
    return {
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        imageId: manifest.imageId,
        lockfileSha256: manifest.lockfileSha256,
        sourceDigest: manifest.sourceDigest,
        builderContractVersion: manifest.builderContractVersion,
    };
}

/** 在测试 fixture 内运行 Git，不依赖调用者的全局身份配置。 */
async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, {cwd, windowsHide: true});
}

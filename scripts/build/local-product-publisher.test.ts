import {execFile} from "node:child_process";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {LocalProductPublisher} from "nbook/scripts/build/local-product-publisher";
import {
    ProductRuntimeImageBuilder,
    productRuntimeBuildPolicy,
    type ProductRuntimeExpectedIdentity,
    type VerifiedProductRuntimeImage,
} from "nbook/scripts/build/product-runtime-image-builder";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    type ProductRuntimeEntryMap,
} from "nbook/shared/product-runtime-contract";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("LocalProductPublisher", {timeout: 30_000}, () => {
    it("把 candidate 原子发布到调用方给出的空 staging root", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = await candidateImage(builder, "explicit-output", "explicit");
        const outputRoot = join(root, ".agent", "workspace", "manager-build", ".output");
        await mkdir(outputRoot, {recursive: true});

        const published = await new LocalProductPublisher(root, builder).publish({
            candidate,
            explicitOutputRoot: outputRoot,
        });

        expect(published.path).toBe(resolve(outputRoot));
        await expect(readFile(join(outputRoot, "server", "index.mjs"), "utf8")).resolves.toBe("explicit");
        await expect(readFile(join(candidate.path, "runtime-image.ready"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("允许仓库外的空 `.output`，但拒绝受管 Installation Root", async () => {
        const root = await sourceFixture();
        const externalParent = await mkdtemp(join(tmpdir(), "nbook-local-publisher-external-"));
        roots.push(externalParent);
        const builder = new ProductRuntimeImageBuilder(root);
        const publisher = new LocalProductPublisher(root, builder);
        const outputRoot = join(externalParent, ".output");

        const published = await publisher.publish({
            candidate: await candidateImage(builder, "external-output", "external"),
            explicitOutputRoot: outputRoot,
        });

        expect(published.path).toBe(resolve(outputRoot));
        await expect(readFile(join(outputRoot, "server", "index.mjs"), "utf8")).resolves.toBe("external");

        await mkdir(join(externalParent, ".deploy"), {recursive: true});
        await writeFile(join(externalParent, ".deploy", "installation.json"), "{}\n", "utf8");
        await rm(outputRoot, {recursive: true, force: true});
        await expect(publisher.publish({
            candidate: await candidateImage(builder, "managed-external-output", "managed"),
            explicitOutputRoot: outputRoot,
        })).rejects.toThrow("受管 Installation Root 禁止接收显式 Product output");
    });

    it("显式 staging 非空时拒绝覆盖并保留 candidate", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = await candidateImage(builder, "occupied-output", "candidate");
        const outputRoot = join(root, ".agent", "workspace", "occupied", ".output");
        await mkdir(outputRoot, {recursive: true});
        await writeFile(join(outputRoot, "owned.txt"), "caller", "utf8");

        await expect(new LocalProductPublisher(root, builder).publish({
            candidate,
            explicitOutputRoot: outputRoot,
        })).rejects.toThrow("必须不存在或为空目录");
        await expect(readFile(join(outputRoot, "owned.txt"), "utf8")).resolves.toBe("caller");
        await expect(readFile(join(candidate.path, "runtime-image.ready"), "utf8")).resolves.toContain("imageId");
    });

    it("非受管 Git checkout 原子替换本地 .output", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = await candidateImage(builder, "checkout-output", "next");
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "old.txt"), "old", "utf8");

        const published = await new LocalProductPublisher(root, builder).publish({candidate});

        expect(published.path).toBe(resolve(root, ".output"));
        await expect(readFile(join(root, ".output", "server", "index.mjs"), "utf8")).resolves.toBe("next");
        await expect(readFile(join(root, ".output", "old.txt"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("受管 Installation Root 拒绝绕过 Manager", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const candidate = await candidateImage(builder, "managed-output", "managed");
        await mkdir(join(root, ".deploy"), {recursive: true});
        await writeFile(join(root, ".deploy", "installation.json"), "{}\n", "utf8");

        await expect(new LocalProductPublisher(root, builder).publish({candidate})).rejects.toThrow(
            "受管 Installation Root 禁止直接更新",
        );
        await expect(readFile(join(candidate.path, "runtime-image.ready"), "utf8")).resolves.toContain("imageId");
    });

    it("发行读取持有 lease 时阻止 `.output` 切换，并始终消费单一 verified image", async () => {
        const root = await sourceFixture();
        const builder = new ProductRuntimeImageBuilder(root);
        const publisher = new LocalProductPublisher(root, builder);
        const current = await publisher.publish({candidate: await candidateImage(builder, "lease-current", "current")});
        const next = await candidateImage(builder, "lease-next", "next");
        let enterRead!: () => void;
        let releaseRead!: () => void;
        const readStarted = new Promise<void>((resolvePromise) => {
            enterRead = resolvePromise;
        });
        const readGate = new Promise<void>((resolvePromise) => {
            releaseRead = resolvePromise;
        });

        const reading = publisher.withPublishedCheckout(expectedIdentity(current), async (image) => {
            enterRead();
            await readGate;
            return await readFile(join(image.path, "server", "index.mjs"), "utf8");
        });
        await readStarted;
        const publishing = publisher.publish({candidate: next});

        const earlyResult = await Promise.race([
            publishing.then(() => "published" as const),
            new Promise<"blocked">((resolvePromise) => setTimeout(() => resolvePromise("blocked"), 100)),
        ]);
        expect(earlyResult).toBe("blocked");
        await expect(readFile(join(root, ".output", "server", "index.mjs"), "utf8")).resolves.toBe("current");

        releaseRead();
        await expect(reading).resolves.toBe("current");
        await expect(publishing).resolves.toMatchObject({path: resolve(root, ".output")});
        await expect(readFile(join(root, ".output", "server", "index.mjs"), "utf8")).resolves.toBe("next");
        await expect(readdir(join(root, ".deploy", "staging-leases"))).resolves.toEqual([]);
    });
});

/** 建立最小 Git Source 与 Builder 读取的 runtime 版本元数据。 */
async function sourceFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-local-publisher-"));
    roots.push(root);
    await mkdir(join(root, "src"), {recursive: true});
    await mkdir(join(root, "node_modules", "nuxt"), {recursive: true});
    await mkdir(join(root, "node_modules", "nitropack"), {recursive: true});
    await writeFile(join(root, ".gitignore"), ".agent/\n.deploy/\n.output/\nnode_modules/\n", "utf8");
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

/** 构建一个最小但完整的 ready candidate。 */
async function candidateImage(builder: ProductRuntimeImageBuilder, operationId: string, payload: string) {
    return await builder.buildCandidate({
        ...productRuntimeBuildPolicy("windows-x64"),
        operationId,
        async build({imageRoot}) {
            await mkdir(join(imageRoot, "server"), {recursive: true});
            await writeFile(join(imageRoot, "server", "index.mjs"), payload, "utf8");
            await writeRuntimeFixture(imageRoot);
        },
    });
}

/** 写入最小 Product Runtime Contract 及其全部入口。 */
async function writeRuntimeFixture(imageRoot: string): Promise<void> {
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
    for (const path of new Set([PRODUCT_RUNTIME_COMMAND_BOOTSTRAP, ...Object.values(entries)])) {
        const absolute = join(imageRoot, ...path.split("/"));
        await mkdir(resolve(absolute, ".."), {recursive: true});
        await writeFile(absolute, "export {};\n", "utf8");
    }
    const contractPath = join(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/"));
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
}

/** 从 verified image 固定本地读取 lease 的完整身份。 */
function expectedIdentity(image: VerifiedProductRuntimeImage): ProductRuntimeExpectedIdentity {
    return {
        version: image.manifest.version,
        revision: image.manifest.revision,
        dirty: image.manifest.dirty,
        platform: image.manifest.platform,
        imageId: image.manifest.imageId,
        lockfileSha256: image.manifest.lockfileSha256,
        sourceDigest: image.manifest.sourceDigest,
        builderContractVersion: image.manifest.builderContractVersion,
    };
}

/** 在 fixture 内运行 Git。 */
async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, {cwd, windowsHide: true});
}

import {mkdir, mkdtemp, readFile, rename, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {removePath} from "#manager/files";
import {
    commitOperation,
    completeProductRuntimeReceiptSwitch,
    createOperation,
    pathCreateEffect,
    pathRetireEffect,
    prepareProductRuntimeReceiptSwitch,
    recoverInterruptedOperations,
    rollbackOperation,
    updateOperation,
} from "#manager/operation";
import {currentProductPlatform} from "#manager/platform";
import {INSTALLATION_SCOPED_ROOT_LOCATORS, PORTABLE_ROOT_LOCATORS} from "#manager/root-locators";
import {parseOperationJournal} from "#manager/schema";
import {sourceDockerImageName} from "#manager/source-docker-image";
import type {InstallationManifest} from "#manager/types";

const docker = vi.hoisted(() => ({
    removeDeployment: vi.fn(),
    removeImage: vi.fn(),
    start: vi.fn(),
    stopContainer: vi.fn(),
}));
const applicationStateMigration = vi.hoisted(() => ({rollback: vi.fn()}));
const git = vi.hoisted(() => ({revision: vi.fn(), removeMaterialized: vi.fn()}));
const execution = vi.hoisted(() => ({verify: vi.fn()}));

vi.mock("#manager/docker", () => ({
    removeDockerDeployment: docker.removeDeployment,
    removeDockerImage: docker.removeImage,
    startDocker: docker.start,
    stopDockerContainer: docker.stopContainer,
}));
vi.mock("#manager/app-commands", () => ({
    rollbackApplicationStateMigration: applicationStateMigration.rollback,
}));
vi.mock("#manager/git", () => ({
    repositoryRevision: git.revision,
    removeMaterializedRepository: git.removeMaterialized,
}));
vi.mock("#manager/application-execution", () => ({verifyApplicationExecution: execution.verify}));

const roots: string[] = [];
const JOURNAL_ROOT = join(tmpdir(), "neuro-book-operation-fixture");
const OUTSIDE_ROOT = join(tmpdir(), "neuro-book-operation-outside");
const CONTAINER_IMAGE_ID = `sha256:${"8".repeat(64)}`;

beforeEach(() => {
    execution.verify.mockResolvedValue({
        kind: "container-product",
        engine: "docker",
        image: {
            engine: "docker",
            configuredImage: "neuro-book-source:test",
            imageId: CONTAINER_IMAGE_ID,
            profile: "source-docker",
            revision: "a".repeat(40),
        },
    });
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => removePath(root))));
beforeEach(() => {
    vi.clearAllMocks();
    git.revision.mockResolvedValue("a".repeat(40));
});

describe("Operation recovery", () => {
    it("回滚 receipt 切换时恢复旧回执并清除 backup", async () => {
        const root = await operationRoot();
        const receiptPath = join(root, ".deploy", "product-runtime-receipt.json");
        await mkdir(join(root, ".deploy"), {recursive: true});
        await writeFile(receiptPath, "old-receipt\n", "utf8");
        let journal = await createOperation({
            id: "receipt-restore",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "receipt-restore"),
            previousManifest: null,
            nextManifest: null,
        });
        journal = await prepareProductRuntimeReceiptSwitch(journal, receiptPath);
        const receiptEffect = journal.effects.find((effect) => effect.kind === "receipt-switch");
        expect(receiptEffect?.kind).toBe("receipt-switch");
        if (receiptEffect?.kind !== "receipt-switch" || !receiptEffect.backupPath) throw new Error("测试 fixture 缺少 receipt backup");
        await writeFile(receiptPath, "new-receipt\n", "utf8");
        await rollbackOperation(journal);

        expect(await readFile(receiptPath, "utf8")).toBe("old-receipt\n");
        await expect(stat(receiptEffect.backupPath)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".deploy", "operations", "receipt-restore.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("无旧 receipt 的失败回滚会删除新回执而不是留下半成品", async () => {
        const root = await operationRoot();
        const receiptPath = join(root, ".deploy", "product-runtime-receipt.json");
        let journal = await createOperation({
            id: "receipt-missing-restore",
            action: "install",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "receipt-missing-restore"),
            previousManifest: null,
            nextManifest: null,
        });
        journal = await prepareProductRuntimeReceiptSwitch(journal, receiptPath);
        await mkdir(join(root, ".deploy"), {recursive: true});
        await writeFile(receiptPath, "partial-new\n", "utf8");
        await rollbackOperation(journal);

        await expect(stat(receiptPath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("成功提交 receipt 切换会清理旧回执 backup", async () => {
        const root = await operationRoot();
        const receiptPath = join(root, ".deploy", "product-runtime-receipt.json");
        await mkdir(join(root, ".deploy"), {recursive: true});
        await writeFile(receiptPath, "old-receipt\n", "utf8");
        let journal = await createOperation({
            id: "receipt-commit",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "receipt-commit"),
            previousManifest: null,
            nextManifest: null,
        });
        journal = await prepareProductRuntimeReceiptSwitch(journal, receiptPath);
        const receiptEffect = journal.effects.find((effect) => effect.kind === "receipt-switch");
        if (receiptEffect?.kind !== "receipt-switch" || !receiptEffect.backupPath) throw new Error("测试 fixture 缺少 receipt backup");
        await writeFile(receiptPath, "new-receipt\n", "utf8");
        journal = await completeProductRuntimeReceiptSwitch(journal);
        await commitOperation(journal);

        expect(await readFile(receiptPath, "utf8")).toBe("new-receipt\n");
        await expect(stat(receiptEffect.backupPath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("拒绝越界受管路径", () => {
        const journal = operationJournal();
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "staging", path: "../outside"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-retire", state: "planned", owner: "tool", path: "../outside"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "staging", path: "."}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-retire", state: "planned", owner: "tool", path: "./"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "runtime", path: ".runtime//bun"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({
            ...journal,
            applicationStateMigration: {runId: "operation", state: "planned"},
        }, "memory.json")).toThrow("缺少nextManifest");
        const containerJournal = {
            ...journal,
            containerEngine: "docker" as const,
            previousManifest: dockerManifest(JOURNAL_ROOT),
            nextManifest: dockerManifest(JOURNAL_ROOT),
        };
        expect(() => parseOperationJournal({...containerJournal, effects: [{kind: "candidate-container", state: "planned", owner: "application", stopped: false}]}, "memory.json")).not.toThrow();
        expect(() => parseOperationJournal({...containerJournal, effects: [{kind: "candidate-container", state: "applied", owner: "application", stopped: false}]}, "memory.json")).toThrow("缺少容器ID");
        expect(() => parseOperationJournal({...containerJournal, effects: [{kind: "candidate-container", state: "planned", owner: "application", stopped: true}]}, "memory.json")).toThrow("不能标记为已停止");
    });

    it("分别校验backup、SQLite、Compose与wrapper路径合同", () => {
        const journal = {...operationJournal(), previousManifest: nativeManifest("1.0.0", "a".repeat(40))};
        const checkpoint = {busy: 0, log: 1, checkpointed: 1};
        expect(() => parseOperationJournal({...journal, backupRoot: OUTSIDE_ROOT}, "memory.json"))
            .toThrow("backupRoot越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite", stateRoot: "workspace", hostPath: "workspace/.nbook/neuro-book.sqlite", backupPath: "C:/neuro-book/.deploy/backups/operation/database/app.sqlite", checkpoint}]}, "memory.json")).toThrow("绝对stateRoot/hostPath");
        const stateRoot = join(JOURNAL_ROOT, "data");
        const externalDatabase = join(OUTSIDE_ROOT, "neuro-book.sqlite");
        const externalDatabaseUrl = `file:${externalDatabase.replaceAll("\\", "/")}`;
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: externalDatabaseUrl, stateRoot, hostPath: externalDatabase, backupPath: join(OUTSIDE_ROOT, "app.sqlite"), checkpoint}]}, "memory.json")).toThrow("SQLite backup越过允许根目录");
        expect(() => parseOperationJournal({...journal, containerEngine: "docker", effects: [{kind: "compose", state: "planned", owner: "compose", previousState: "stopped", stopped: false, previousCompose: join(OUTSIDE_ROOT, "compose.yml"), created: false}]}, "memory.json")).toThrow("previousCompose越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath: join(OUTSIDE_ROOT, "runtime-bin")}]}, "memory.json")).toThrow("wrapper backup越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present"}]}, "memory.json")).toThrow("必须预先记录backupPath");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: externalDatabaseUrl, stateRoot, hostPath: externalDatabase, backupPath: join(JOURNAL_ROOT, ".deploy", "backups", "operation", "database", "app.sqlite"), checkpoint}]}, "memory.json")).not.toThrow();
    });

    it("拒绝退役nextManifest仍引用的受管资产目录", () => {
        const manifest = nativeManifestWithManagedRg("1.0.0", "a".repeat(40));
        expect(() => parseOperationJournal({
            ...operationJournal(),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
        }, "memory.json")).toThrow("仍包含nextManifest引用");
    });

    it("wrapper备份尚未原子提交时保留原目录，备份存在时恢复旧目录", async () => {
        const root = await operationRoot();
        const runtimeBin = join(root, ".runtime", "bin");
        const missingBackup = join(root, ".deploy", "backups", "wrapper-missing", "runtime-bin");
        await mkdir(runtimeBin, {recursive: true});
        await writeFile(join(runtimeBin, "neuro-book.cmd"), "old", "utf8");
        const interruptedBeforeBackup = await createOperation({
            id: "wrapper-missing",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "wrapper-missing"),
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath: missingBackup}],
        });
        await recoverInterruptedOperations(root);
        expect(await readFile(join(runtimeBin, "neuro-book.cmd"), "utf8")).toBe("old");

        const backupRoot = join(root, ".deploy", "backups", "wrapper-ready");
        const backupPath = join(backupRoot, "runtime-bin");
        await mkdir(backupPath, {recursive: true});
        await writeFile(join(backupPath, "neuro-book.cmd"), "old", "utf8");
        await writeFile(join(runtimeBin, "neuro-book.cmd"), "partial-new", "utf8");
        await createOperation({
            id: "wrapper-ready",
            action: "update",
            root,
            containerEngine: null,
            backupRoot,
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath}],
        });
        await recoverInterruptedOperations(root);
        expect(await readFile(join(runtimeBin, "neuro-book.cmd"), "utf8")).toBe("old");
        expect(interruptedBeforeBackup.effects).toContainEqual(expect.objectContaining({kind: "wrapper-switch"}));
    });

    it("成功提交后清理退役代次，已提交journal恢复时可幂等重试", async () => {
        const root = await operationRoot();
        const retired = join(root, ".runtime", "tools", "rg", "old");
        await mkdir(retired, {recursive: true});
        await writeFile(join(retired, "rg.exe"), "old", "utf8");
        const journal = await createOperation({
            id: "retired-cleanup",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: join(root, ".deploy", "backups", "retired-cleanup"),
            previousManifest: null,
            nextManifest: null,
        });

        await commitOperation(journal);
        await expect(stat(retired)).rejects.toMatchObject({code: "ENOENT"});

        await mkdir(retired, {recursive: true});
        const interrupted = await createOperation({
            id: "retired-cleanup-recovery",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: join(root, ".deploy", "backups", "retired-cleanup-recovery"),
            previousManifest: null,
            nextManifest: null,
        });
        await updateOperation(interrupted, "committed", {outcome: "success"});
        await recoverInterruptedOperations(root);
        await expect(stat(retired)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("失败回滚保留退役代次，只清理本次backup和staging", async () => {
        const root = await operationRoot();
        const retired = join(root, ".runtime", "tools", "rg", "old");
        const staging = join(root, ".deploy", "staging", "rolled-back");
        const backup = join(root, ".deploy", "backups", "rolled-back");
        await mkdir(retired, {recursive: true});
        await mkdir(staging, {recursive: true});
        await mkdir(backup, {recursive: true});
        await writeFile(join(retired, "rg.exe"), "old", "utf8");
        const journal = await createOperation({
            id: "rolled-back-retired",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathCreateEffect(".deploy/staging/rolled-back", "applied"), pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: backup,
            previousManifest: null,
            nextManifest: null,
        });

        await recoverInterruptedOperations(root);

        expect(await readFile(join(retired, "rg.exe"), "utf8")).toBe("old");
        await expect(stat(staging)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(backup)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".deploy", "operations", "rolled-back-retired.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("拒绝嵌套 Manifest 损坏的 journal", () => {
        expect(() => parseOperationJournal({...operationJournal(), nextManifest: {}}, "memory.json")).toThrow("Operation journal 不符合 schema");
    });

    it("拒绝迁移脚本根越过Installation Root", () => {
        expect(() => parseOperationJournal({...operationJournal(), migrationRoot: OUTSIDE_ROOT}, "memory.json"))
            .toThrow("migrationRoot越过允许根目录");
    });

    it("已提交旧Journal作为审计记录跳过，未完成v1/v2拒绝自动恢复", async () => {
        const root = await operationRoot();
        const operations = join(root, ".deploy", "operations");
        await writeFile(join(operations, "committed-v1.json"), JSON.stringify({...operationJournal(), schemaVersion: 1, phase: "committed"}), "utf8");
        await writeFile(join(operations, "unfinished-v2.json"), JSON.stringify({...operationJournal(), schemaVersion: 2, phase: "staged"}), "utf8");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("未完成的Operation Journal v2");
    });

    it("Git HEAD已到target时完成Manifest提交，不错误回滚", async () => {
        const root = await operationRoot();
        const nextManifest = dockerManifest(root);
        git.revision.mockResolvedValue(nextManifest.sourceRevision);
        const journal = await createOperation({
            id: "git-target",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "git-target"),
            previousManifest: {...nextManifest, sourceRevision: "b".repeat(40), components: {
                ...nextManifest.components,
                source: {...nextManifest.components.source, revision: "b".repeat(40)},
                product: {...nextManifest.components.product!, revision: "b".repeat(40)},
            }},
            nextManifest,
            effects: [{kind: "git-fast-forward", state: "applied", owner: "source", previousRevision: "b".repeat(40), targetRevision: nextManifest.sourceRevision}],
        });
        await updateOperation(journal, "healthy");

        await recoverInterruptedOperations(root);

        await expect(stat(join(root, ".deploy", "operations", "git-target.json"))).rejects.toMatchObject({code: "ENOENT"});
        expect(docker.removeDeployment).not.toHaveBeenCalled();
    });

    it("commit point 前删除本次创建路径并在恢复完成后删除 journal", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
        roots.push(root);
        const created = join(root, ".runtime", "tools", "demo", "temporary");
        await mkdir(created, {recursive: true});
        await writeFile(join(created, "partial.txt"), "partial", "utf8");
        const journal = await createOperation({
            id: "interrupted",
            action: "install",
            root,
            containerEngine: null,
            effects: [pathCreateEffect(".runtime/tools/demo/temporary", "applied")],
            backupRoot: join(root, ".deploy", "backups", "interrupted"),
            previousManifest: null,
            nextManifest: null,
        });
        await updateOperation(journal, "staged");

        await recoverInterruptedOperations(root);

        await expect(stat(created)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".deploy", "operations", "interrupted.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("validated阶段失败不会把尚未切换的旧Product当成新Product删除", async () => {
        const root = await operationRoot();
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "preserved.txt"), "old-product", "utf8");
        const previousManifest = nativeManifest("1.0.0", "a".repeat(40));
        const nextManifest = nativeManifest("1.0.1", "b".repeat(40));
        const journal = await createOperation({
            id: "validated-product",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "validated-product"),
            previousManifest,
            nextManifest,
        });
        await updateOperation(journal, "validated");

        await recoverInterruptedOperations(root);

        expect(await readFile(join(root, ".output", "preserved.txt"), "utf8")).toBe("old-product");
    });

    it("Fresh Product在planned后完成rename但未记applied时删除新Product", async () => {
        const root = await operationRoot();
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "new.txt"), "new-product", "utf8");
        const journal = await createOperation({
            id: "fresh-product-switch-intent",
            action: "install",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "fresh-product-switch-intent"),
            previousManifest: null,
            nextManifest: nativeManifest("1.0.0", "a".repeat(40)),
            effects: [{kind: "component-switch", state: "planned", owner: "product"}],
        });

        await recoverInterruptedOperations(root);

        await expect(stat(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it.each([
        {checkpoint: "第一次 rename 后", targetCreated: false},
        {checkpoint: "第二次 rename 后", targetCreated: true},
    ])("Product $checkpoint 中断时先用 immutable runner 回滚 migration，再恢复旧 Product", async ({targetCreated}) => {
        const root = await operationRoot();
        const id = `product-rename-${targetCreated ? "second" : "first"}`;
        const staging = join(root, ".deploy", "staging", id);
        const migrationRoot = join(staging, "migration-runner");
        const backup = join(root, ".deploy", "backups", id);
        await mkdir(join(migrationRoot, ".output"), {recursive: true});
        await mkdir(join(backup, "product", ".output"), {recursive: true});
        await writeFile(join(migrationRoot, ".output", "runner.mjs"), "runner", "utf8");
        await writeFile(join(backup, "product", ".output", "old.txt"), "old", "utf8");
        if (targetCreated) {
            await mkdir(join(root, ".output"), {recursive: true});
            await writeFile(join(root, ".output", "new.txt"), "new", "utf8");
        }
        const previousManifest = nativeManifest("1.0.0", "a".repeat(40));
        const nextManifest = nativeManifest("1.1.0", "b".repeat(40));
        applicationStateMigration.rollback.mockImplementationOnce(async (_root, _manifest, _runId, _allowNotStarted, runnerRoot) => {
            expect(runnerRoot).toBe(migrationRoot);
            expect(await readFile(join(runnerRoot, ".output", "runner.mjs"), "utf8")).toBe("runner");
        });
        const journal = await createOperation({
            id,
            action: "update",
            root,
            containerEngine: null,
            backupRoot: backup,
            previousManifest,
            nextManifest,
            effects: [
                pathCreateEffect(`.deploy/staging/${id}`, "applied"),
                {kind: "component-switch", state: "planned", owner: "product"},
            ],
            migrationRoot,
            applicationStateMigration: {runId: id, state: "applying"},
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(applicationStateMigration.rollback).toHaveBeenCalledWith(root, nextManifest, id, true, migrationRoot);
        expect(await readFile(join(root, ".output", "old.txt"), "utf8")).toBe("old");
        await expect(stat(staging)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Fresh Git checkout只要开始物化就在失败恢复时按ownership清理", async () => {
        const root = await operationRoot();
        const journal = await createOperation({
            id: "fresh-checkout-intent",
            action: "install",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "fresh-checkout-intent"),
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "git-checkout", state: "planned", owner: "source"}],
        });

        await recoverInterruptedOperations(root);

        expect(git.removeMaterialized).toHaveBeenCalledWith(root);
        await expect(stat(join(root, ".deploy", "operations", "fresh-checkout-intent.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Fresh Docker失败时移除容器、Compose和本地镜像", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const image = sourceDockerImageName("a".repeat(40), "fresh-docker");
        await writeFile(compose, "services: {}", "utf8");
        const journal = await createOperation({
            id: "fresh-docker",
            action: "install",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "fresh-docker"),
            previousManifest: null,
            nextManifest: dockerManifest(root, image),
            effects: [
                {kind: "compose", state: "applied", owner: "compose", previousState: "missing", stopped: false, created: true},
                {kind: "docker-image", state: "applied", owner: "product", image},
            ],
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(docker.removeImage).toHaveBeenCalledWith("docker", root, image);
        await expect(stat(compose)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Source Docker提交后只退役previousManifest证明的旧镜像且恢复不重复删除", async () => {
        const root = await operationRoot();
        const previousImage = "neuro-book-source:previous";
        const nextImage = sourceDockerImageName("a".repeat(40), "docker-image-retire");
        const journal = await createOperation({
            id: "docker-image-retire",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "docker-image-retire"),
            previousManifest: dockerManifest(root, previousImage),
            nextManifest: dockerManifest(root, nextImage),
            effects: [{kind: "docker-image", state: "applied", owner: "product", image: nextImage, previousImage}],
        });

        await commitOperation(journal);
        await recoverInterruptedOperations(root);

        expect(docker.removeImage).toHaveBeenCalledTimes(1);
        expect(docker.removeImage).toHaveBeenCalledWith("docker", root, previousImage);
        await expect(stat(join(root, ".deploy", "operations", "docker-image-retire.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Docker更新失败时恢复数据库、Compose并重启旧实例", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "docker-update");
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        const stateRoot = join(root, "data");
        const database = join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite");
        const databaseBackup = join(backup, "neuro-book.sqlite");
        await mkdir(join(stateRoot, "workspace", ".nbook"), {recursive: true});
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        await writeFile(database, "new", "utf8");
        await writeFile(`${database}-wal`, "wal", "utf8");
        await writeFile(databaseBackup, "old", "utf8");
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "docker-update",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: backup,
            previousManifest,
            nextManifest: {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-13T00:00:00.000Z"},
            effects: [
                {kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false},
                {kind: "sqlite-backup", state: "applied", owner: "app-sqlite", configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite", stateRoot, hostPath: database, backupPath: databaseBackup, checkpoint: {busy: 0, log: 0, checkpointed: 0}},
            ],
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(await readFile(database, "utf8")).toBe("old");
        await expect(stat(`${database}-wal`)).rejects.toMatchObject({code: "ENOENT"});
        expect(await readFile(compose, "utf8")).toBe("image: old");
        expect(docker.start).toHaveBeenCalledWith(
            expect.objectContaining({engine: "docker", imageId: CONTAINER_IMAGE_ID}),
            root,
            stateRoot,
            "source-docker",
            "1.0.0",
        );
    });

    it("先停止新Docker部署释放runtime lease，再回滚Application State并恢复旧Compose", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "attachment-rollback");
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        const previousManifest = dockerManifest(root);
        const nextManifest = {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-16T00:00:00.000Z"};
        const candidateContainerId = "c".repeat(64);
        const journal = await createOperation({
            id: "attachment-rollback",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: backup,
            previousManifest,
            nextManifest,
            effects: [
                {kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false},
                {kind: "candidate-container", state: "applied", owner: "application", containerId: candidateContainerId, stopped: false},
            ],
            applicationStateMigration: {
                runId: "attachment-rollback-run",
                state: "applied",
            },
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(applicationStateMigration.rollback).toHaveBeenCalledWith(root, nextManifest, "attachment-rollback-run", false, root);
        expect(docker.stopContainer).toHaveBeenCalledWith("docker", root, candidateContainerId);
        expect(docker.stopContainer.mock.invocationCallOrder[0]).toBeLessThan(docker.removeDeployment.mock.invocationCallOrder[0]!);
        expect(docker.removeDeployment.mock.invocationCallOrder[0]).toBeLessThan(applicationStateMigration.rollback.mock.invocationCallOrder[0]!);
        await expect(stat(join(root, ".deploy", "operations", "attachment-rollback.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("候选容器启动屏障缺少精确ID时拒绝回滚持久化状态", async () => {
        const root = await operationRoot();
        const manifest = dockerManifest(root);
        const journal = await createOperation({
            id: "candidate-identity-missing",
            action: "start",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "candidate-identity-missing"),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [{kind: "candidate-container", state: "planned", owner: "application", stopped: false}],
            applicationStateMigration: {runId: "candidate-identity-missing", state: "applied"},
        });
        await updateOperation(journal, "migrated");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("没有可验证的容器身份");

        expect(docker.stopContainer).not.toHaveBeenCalled();
        expect(docker.removeDeployment).not.toHaveBeenCalled();
        expect(applicationStateMigration.rollback).not.toHaveBeenCalled();
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "candidate-identity-missing.json"), "utf8")) as {outcome?: string};
        expect(saved.outcome).toBeUndefined();
    });

    it.each([
        {previousState: "stopped" as const, removed: false, restarted: false},
        {previousState: "missing" as const, removed: true, restarted: false},
        {previousState: "running" as const, removed: false, restarted: true},
    ])("start恢复$previousState容器原状态", async ({previousState, removed, restarted}) => {
        const root = await operationRoot();
        const manifest = dockerManifest(root);
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        await writeFile(compose, "image: current", "utf8");
        const journal = await createOperation({
            id: `start-restore-${previousState}`,
            action: "start",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", `start-restore-${previousState}`),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [{
                kind: "compose",
                state: "applied",
                owner: "compose",
                previousState,
                stopped: previousState === "running",
                created: false,
                previousImage: "neuro-book-source:test",
                targetImage: "neuro-book-source:test",
            }],
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledTimes(removed ? 1 : 0);
        expect(docker.start).toHaveBeenCalledTimes(restarted ? 1 : 0);
        if (restarted) {
            expect(docker.start).toHaveBeenCalledWith(
                expect.objectContaining({engine: "docker", imageId: CONTAINER_IMAGE_ID}),
                root,
                join(root, "data"),
                "source-docker",
                "1.0.0",
            );
        }
        if (!removed) expect(await readFile(compose, "utf8")).toBe("image: current");
        await expect(stat(join(root, ".deploy", "operations", `start-restore-${previousState}.json`)))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("migration-only update 的状态记录不会删除原有stopped容器", async () => {
        const root = await operationRoot();
        const manifest = dockerManifest(root);
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        await writeFile(compose, "image: current", "utf8");
        const journal = await createOperation({
            id: "migration-only-stopped",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "migration-only-stopped"),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [{
                kind: "compose",
                state: "applied",
                owner: "compose",
                previousState: "stopped",
                stopped: false,
                created: false,
                previousImage: "neuro-book-source:test",
                targetImage: "neuro-book-source:test",
            }],
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).not.toHaveBeenCalled();
        expect(docker.start).not.toHaveBeenCalled();
        expect(await readFile(compose, "utf8")).toBe("image: current");
    });

    it("planned Application State 尚未执行时直接标记回滚，不调用 Product runner", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "attachment-rollback-failure");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        const previousManifest = dockerManifest(root);
        const nextManifest = {
            ...previousManifest,
            appVersion: "1.0.1",
            updatedAt: "2026-07-28T00:00:00.000Z",
        };
        await mkdir(backup, {recursive: true});
        await writeFile(join(root, ".deploy", "docker-compose.generated.yml"), "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        const journal = await createOperation({
            id: "attachment-rollback-failure",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: backup,
            previousManifest,
            nextManifest,
            effects: [{
                kind: "compose",
                state: "applied",
                owner: "compose",
                previousState: "running",
                stopped: true,
                previousCompose,
                created: false,
            }],
            applicationStateMigration: {
                runId: "attachment-rollback-failure-run",
                state: "planned",
            },
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(applicationStateMigration.rollback).not.toHaveBeenCalled();
        await expect(stat(join(root, ".deploy", "operations", "attachment-rollback-failure.json")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("镜像清理失败时仍完成其他回滚并记录人工清理信息", async () => {
        const root = await operationRoot();
        const image = sourceDockerImageName("a".repeat(40), "image-cleanup");
        docker.removeImage.mockRejectedValueOnce(new Error("image is in use"));
        const journal = await createOperation({
            id: "image-cleanup",
            action: "install",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "image-cleanup"),
            previousManifest: null,
            nextManifest: dockerManifest(root, image),
            effects: [{kind: "docker-image", state: "applied", owner: "product", image}],
        });

        await recoverInterruptedOperations(root);

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "image-cleanup.json"), "utf8")) as {outcome: string; effects: Array<{kind: string; cleanupError?: string}>};
        expect(saved.outcome).toBe("rolled-back");
        expect(saved.effects).toContainEqual(expect.objectContaining({kind: "docker-image", cleanupError: "image is in use"}));

        await recoverInterruptedOperations(root);

        expect(docker.removeImage).toHaveBeenCalledTimes(2);
        await expect(stat(join(root, ".deploy", "operations", "image-cleanup.json")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("Portable 在 committed 删除窗口移动后按新根完成无错误 cleanup", async () => {
        const root = await operationRoot();
        const moved = `${root}-moved`;
        roots.push(moved);
        const staging = join(root, ".deploy", "staging", "portable-move");
        await mkdir(staging, {recursive: true});
        const journal = await createOperation({
            id: "portable-move",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "portable-move"),
            previousManifest: portableManifest(),
            nextManifest: portableManifest(),
            effects: [pathCreateEffect(".deploy/staging/portable-move", "applied")],
        });
        await updateOperation(journal, "committed", {outcome: "success"});
        await rename(root, moved);

        await recoverInterruptedOperations(moved);

        await expect(stat(join(moved, ".deploy", "staging", "portable-move"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(moved, ".deploy", "operations", "portable-move.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Portable 有 cleanup error 时必须移回原根，不能静默改写事务身份", async () => {
        const root = await operationRoot();
        const moved = `${root}-moved`;
        roots.push(moved);
        const journal = await createOperation({
            id: "portable-move-blocked",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "portable-move-blocked"),
            previousManifest: portableManifest(),
            nextManifest: portableManifest(),
            effects: [pathCreateEffect(".deploy/staging/portable-move-blocked", "applied")],
        });
        const effects = journal.effects.map((effect) => effect.kind === "path-create" && effect.owner === "staging"
            ? {...effect, cleanupError: "file in use"}
            : effect);
        await updateOperation(journal, "committed", {outcome: "success", effects});
        await rename(root, moved);

        await expect(recoverInterruptedOperations(moved)).rejects.toThrow("必须移回原位置");
    });

    it("旧Docker实例重启失败时保留未完成journal供下次继续恢复", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const backup = join(root, ".deploy", "backups", "restart-failure");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        docker.start.mockRejectedValueOnce(new Error("docker daemon unavailable"));
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "restart-failure",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: backup,
            previousManifest,
            nextManifest: previousManifest,
            effects: [{kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false}],
        });
        await updateOperation(journal, "switched");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("docker daemon unavailable");

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "restart-failure.json"), "utf8")) as {phase: string; outcome?: string};
        expect(saved.phase).toBe("switched");
        expect(saved.outcome).toBeUndefined();
    });
});

async function operationRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
    roots.push(root);
    await mkdir(join(root, ".deploy", "operations"), {recursive: true});
    return root;
}

function dockerManifest(root: string, image = "neuro-book-source:test"): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 5,
        profile: "source-docker",
        containerEngine: "docker",
        managerVersion: "0.1.0",
        appVersion: "1.0.0",
        channel: "canary",
        sourceRevision: revision,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {provider: "git", version: "1.0.0", revision, path: ".", repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {provider: "container", version: "1.0.0", revision, image, containerImageId: CONTAINER_IMAGE_ID},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "container", version: "1.0.0"},
            tools: {rg: {provider: "container", version: "source-docker"}, git: {provider: "container", version: "source-docker"}, python: {provider: "container", version: "source-docker"}},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function nativeManifest(version: string, revision: string): InstallationManifest {
    return {
        schemaVersion: 5,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: version,
        channel: "canary",
        sourceRevision: revision,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {provider: "release", buildId: `sha256:${"9".repeat(64)}`, version, revision, path: ".", files: ["package.json"], archiveSha256: "a".repeat(64), sourceUrl: "https://example.com/source.zip", license: "AGPL-3.0-only", redistribution: "test"},
            product: {provider: "release", buildId: `sha256:${"9".repeat(64)}`, version, revision, path: ".output", platform: currentProductPlatform(), archiveSha256: "a".repeat(64), sourceUrl: "https://example.com/product.zip", license: "AGPL-3.0-only", redistribution: "test", ...TEST_RUNTIME_IMAGE_IDENTITY},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function nativeManifestWithManagedRg(version: string, revision: string): InstallationManifest {
    const manifest = nativeManifest(version, revision);
    return {
        ...manifest,
        components: {
            ...manifest.components,
            tools: {
                rg: {
                    provider: "managed",
                    version: "old",
                    path: ".runtime/tools/rg/old/rg.exe",
                    archiveSha256: "a".repeat(64),
                    executableSha256: "b".repeat(64),
                    sourceUrl: "https://example.com/rg.zip",
                    license: "MIT",
                    redistribution: "test",
                },
            },
        },
    };
}

function operationJournal() {
    const now = "2026-07-12T00:00:00.000Z";
    return {
        schemaVersion: 5 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: JOURNAL_ROOT,
        containerEngine: null,
        effects: [],
        backupRoot: join(JOURNAL_ROOT, ".deploy", "backups", "operation"),
        previousManifest: null,
        nextManifest: null,
        createdAt: now,
        updatedAt: now,
    };
}

function portableManifest(): InstallationManifest {
    const manifest = nativeManifest("1.0.0", "a".repeat(40));
    const asset = {
        archiveSha256: "a".repeat(64),
        sourceUrl: "https://example.com/bun.zip",
        license: "MIT",
        redistribution: "test",
    };
    const runtime = {
        provider: "managed" as const,
        version: "1.3.0",
        path: ".runtime/bun/1.3.0/bun.exe",
        executableSha256: "b".repeat(64),
        ...asset,
    };
    return {
        ...manifest,
        profile: "windows-portable",
        roots: PORTABLE_ROOT_LOCATORS,
        components: {
            ...manifest.components,
            managerRuntime: runtime,
            applicationRuntime: runtime,
            tools: {
                rg: {provider: "managed", version: "14.1.1", path: ".runtime/tools/rg/14.1.1/rg.exe", executableSha256: "c".repeat(64), ...asset},
                git: {provider: "managed", version: "2.49.0", path: ".runtime/tools/git/2.49.0/cmd/git.exe", bashPath: ".runtime/tools/git/2.49.0/bin/bash.exe", distribution: "PortableGit", gitSha256: "d".repeat(64), bashSha256: "e".repeat(64), ...asset},
            },
        },
    };
}

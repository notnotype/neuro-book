import {spawn} from "node:child_process";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

const workspaceCommand = resolve("server", "workspace-files", "workspace-command.ts");
const applicationRoot = resolve(".");
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Workspace CLI hard cut", {timeout: 120_000}, () => {
    it("ensure 只创建最小 manifest，并输出 versioned envelope", async () => {
        const fixture = await createFixture();

        const first = await runWorkspace(fixture, ["project", "ensure", "alpha", "--json"]);
        expect(first, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`).toMatchObject({code: 0});
        const firstPayload = parseJson(first.stdout);
        expect(firstPayload).toMatchObject({
            schemaVersion: "nbook.workspace-cli/v1",
            ok: true,
            project: {projectRoot: "alpha"},
            actions: expect.arrayContaining(["created"]),
        });
        await expect(readFile(join(fixture.workspaceRoot, "alpha", "project.yaml"), "utf8")).resolves.toContain("kind: novel");
        await expect(readFile(join(fixture.workspaceRoot, "alpha", "project.yaml"), "utf8")).resolves.not.toContain("lorebook");

        const second = await runWorkspace(fixture, ["project", "ensure", "alpha", "--json"]);
        expect(second.code).toBe(0);
        expect(parseJson(second.stdout)).toMatchObject({ok: true, project: {projectRoot: "alpha"}, actions: []});
    });

    it("create 只物化不存在目标，重复创建返回 PROJECT_EXISTS", async () => {
        const fixture = await createFixture();

        const created = await runWorkspace(fixture, ["project", "create", "beta", "--template", "default", "--json"]);
        expect(created.code).toBe(0);
        expect(parseJson(created.stdout)).toMatchObject({ok: true, project: {projectRoot: "beta"}, actions: ["created"]});
        await expect(readFile(join(fixture.workspaceRoot, "beta", "project.yaml"), "utf8")).resolves.toContain("title: beta");

        const duplicate = await runWorkspace(fixture, ["project", "create", "beta", "--json"]);
        expect(duplicate.code).toBe(1);
        expect(parseJson(duplicate.stdout)).toMatchObject({
            schemaVersion: "nbook.workspace-cli/v1",
            ok: false,
            error: {code: "PROJECT_EXISTS"},
        });
        expect(duplicate.stderr).toContain("Project");
    });

    it("删除旧的 target、no-db、workspace/<slug> 与 init-db 合同", async () => {
        const fixture = await createFixture();

        const target = await runWorkspace(fixture, ["project", "create", "gamma", "--target", "outside", "--json"]);
        expect(target.code).not.toBe(0);
        expect(`${target.stdout}\n${target.stderr}`).toContain("unknown option");

        const noDb = await runWorkspace(fixture, ["project", "create", "gamma", "--no-db", "--json"]);
        expect(noDb.code).not.toBe(0);
        expect(`${noDb.stdout}\n${noDb.stderr}`).toContain("unknown option");

        const alias = await runWorkspace(fixture, ["project", "ensure", "workspace/gamma", "--json"]);
        expect(alias.code).toBe(1);
        expect(parseJson(alias.stdout)).toMatchObject({ok: false, error: {code: "INVALID_PROJECT_ROOT"}});

        const initDb = await runWorkspace(fixture, ["project", "init-db", "gamma"]);
        expect(initDb.code).not.toBe(0);
        expect(`${initDb.stdout}\n${initDb.stderr}`).toContain("unknown command");
    });

    it("validate 只接受一级 root，node schema 迁入 node 子命令", async () => {
        const fixture = await createFixture();
        await mkdir(join(fixture.workspaceRoot, "delta"), {recursive: true});
        await writeFile(join(fixture.workspaceRoot, "delta", "project.yaml"), "kind: novel\ntitle: Delta\nsummary: ''\n", "utf8");

        const valid = await runWorkspace(fixture, ["project", "validate", "delta", "--json"]);
        expect(valid.code).toBe(0);
        expect(parseJson(valid.stdout)).toMatchObject({ok: true, project: {projectRoot: "delta", status: "valid"}});

        const nested = await runWorkspace(fixture, ["project", "validate", "delta/manuscript", "--json"]);
        expect(nested.code).toBe(1);
        expect(parseJson(nested.stdout)).toMatchObject({ok: false, error: {code: "INVALID_PROJECT_ROOT"}});

        const schema = await runWorkspace(fixture, ["node", "schema", "character", "--json"]);
        expect(schema.code).toBe(0);
        expect(parseJson(schema.stdout)).toMatchObject({properties: {title: expect.any(Object)}});

        const oldSchema = await runWorkspace(fixture, ["schema", "character", "--json"]);
        expect(oldSchema.code).not.toBe(0);
    });

    it("从 Workspace Root 调用 node 时相对路径从 Workspace Root 解析", async () => {
        const fixture = await createFixture();
        const nodeRoot = join(fixture.workspaceRoot, "epsilon", "lorebook", "character", "hero");
        await mkdir(nodeRoot, {recursive: true});
        await writeFile(join(nodeRoot, "index.md"), [
            "---",
            "title: Hero",
            "type: character",
            "status: draft",
            "---",
            "",
            "正文",
        ].join("\n"), "utf8");

        const parsed = await runWorkspace(fixture, ["node", "parse", "epsilon/lorebook/character/hero", "--json"]);
        expect(parsed.code).toBe(0);
        expect(parseJson(parsed.stdout)).toMatchObject([{path: "epsilon/lorebook/character/hero/", title: "Hero"}]);

        const oldAlias = await runWorkspace(fixture, ["node", "parse", "workspace/epsilon/lorebook/character/hero", "--json"]);
        expect(oldAlias.code).toBe(1);
        expect(oldAlias.stderr).toContain("ENOENT");
    });

    it("node new/state 在拥有 target 的边界拒绝 Storage 路径", async () => {
        const fixture = await createFixture();

        const storageNew = await runWorkspace(fixture, ["node", "new", ".nbook/storage/evil", "--type", "character"]);
        expect(storageNew.code).toBe(1);
        expect(storageNew.stderr).toContain("Storage 数据由 Storage 服务独占");
        await expect(readFile(join(fixture.workspaceRoot, ".nbook", "storage", "evil", "index.md"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});

        const projectStorageNew = await runWorkspace(fixture, ["node", "new", "proj/.nbook/storage/evil", "--type", "character"]);
        expect(projectStorageNew.code).toBe(1);
        expect(projectStorageNew.stderr).toContain("Storage 数据由 Storage 服务独占");

        const storageState = await runWorkspace(fixture, ["node", "state", ".nbook/storage/records"]);
        expect(storageState.code).toBe(1);
        expect(storageState.stderr).toContain("Storage 数据由 Storage 服务独占");

        const plain = await runWorkspace(fixture, ["node", "new", "notes/storage/ok", "--type", "character"]);
        expect(plain.code).toBe(0);
        await expect(readFile(join(fixture.workspaceRoot, "notes", "storage", "ok", "index.md"), "utf8"))
            .resolves.toContain("type: character");
    });

    it("node parse/validate 拒绝 Storage 输入，递归校验不进入 Storage", async () => {
        const fixture = await createFixture();
        const storageRecord = join(fixture.workspaceRoot, ".nbook", "storage", "records");
        await mkdir(storageRecord, {recursive: true});
        const originalBytes = "---\ntitle: 未知原件\n---\n\n原始正文\n";
        await writeFile(join(storageRecord, "index.md"), originalBytes, "utf8");

        const explicitParse = await runWorkspace(fixture, ["node", "parse", ".nbook/storage/records", "--json", "--body"]);
        expect(explicitParse.code).toBe(1);
        expect(explicitParse.stderr).toContain("Storage 数据由 Storage 服务独占");

        const explicitValidate = await runWorkspace(fixture, ["node", "validate", ".nbook/storage/records", "--fix-missing"]);
        expect(explicitValidate.code).toBe(1);
        expect(explicitValidate.stderr).toContain("Storage 数据由 Storage 服务独占");

        const hero = join(fixture.workspaceRoot, "lorebook", "character", "hero");
        await mkdir(hero, {recursive: true});
        await writeFile(join(hero, "index.md"), [
            "---",
            "title: Hero",
            "type: character",
            "status: draft",
            "---",
            "",
            "正文",
        ].join("\n"), "utf8");

        const recursive = await runWorkspace(fixture, ["node", "validate", ".", "--recursive", "--fix-missing", "--json"]);
        expect(recursive.code, recursive.stderr).toBe(0);
        expect(parseJson(recursive.stdout)).toMatchObject({fixedPaths: ["lorebook/character/hero/index.md"]});
        await expect(readFile(join(storageRecord, "index.md"), "utf8")).resolves.toBe(originalBytes);

        const plainNode = join(fixture.workspaceRoot, "notes", "storage", "ok");
        await mkdir(plainNode, {recursive: true});
        await writeFile(join(plainNode, "index.md"), [
            "---",
            "title: Ok",
            "type: character",
            "status: draft",
            "---",
            "",
            "正文",
        ].join("\n"), "utf8");
        const plainParse = await runWorkspace(fixture, ["node", "parse", "notes/storage/ok", "--json"]);
        expect(plainParse.code, plainParse.stderr).toBe(0);

        const projectRoot = join(fixture.workspaceRoot, "proj");
        const projectStorage = join(projectRoot, ".nbook", "storage", "records");
        await mkdir(projectStorage, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Proj\nsummary: ''\n", "utf8");
        const projectBytes = "---\ntitle: 项目原件\n---\n\n原始\n";
        await writeFile(join(projectStorage, "index.md"), projectBytes, "utf8");

        const projectParse = await runWorkspace(fixture, ["node", "parse", ".nbook/storage/records", "--json"], projectRoot);
        expect(projectParse.code).toBe(1);
        expect(projectParse.stderr).toContain("Storage 数据由 Storage 服务独占");

        const projectRecursive = await runWorkspace(fixture, ["node", "validate", ".", "--recursive", "--fix-missing"], projectRoot);
        expect(projectRecursive.code, projectRecursive.stderr).toBe(0);
        await expect(readFile(join(projectStorage, "index.md"), "utf8")).resolves.toBe(projectBytes);
    });

    it("从 Project Workspace及其子目录调用 node 时相对路径从Project File Scope解析", async () => {
        const fixture = await createFixture();
        const projectRoot = join(fixture.workspaceRoot, "zeta");
        const nestedCwd = join(projectRoot, "manuscript", "drafts");
        const nodeRoot = join(projectRoot, "lorebook", "character", "hero");
        await mkdir(nestedCwd, {recursive: true});
        await mkdir(nodeRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Zeta\nsummary: ''\n", "utf8");
        await writeFile(join(nodeRoot, "index.md"), [
            "---",
            "title: Hero",
            "type: character",
            "status: draft",
            "---",
            "",
            "正文",
        ].join("\n"), "utf8");

        const fromRoot = await runWorkspace(fixture, ["node", "parse", "lorebook/character/hero", "--json"], projectRoot);
        expect(fromRoot.code).toBe(0);
        expect(parseJson(fromRoot.stdout)).toMatchObject([{path: "lorebook/character/hero/", title: "Hero"}]);

        const fromChild = await runWorkspace(fixture, ["node", "parse", "lorebook/character/hero", "--json"], nestedCwd);
        expect(fromChild.code).toBe(0);
        expect(parseJson(fromChild.stdout)).toMatchObject([{path: "lorebook/character/hero/", title: "Hero"}]);
    });

    it("从 Project Workspace调用project命令时仍操作Workspace Root下的一级Project", async () => {
        const fixture = await createFixture();
        const projectRoot = join(fixture.workspaceRoot, "eta");
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Eta\nsummary: ''\n", "utf8");

        const result = await runWorkspace(fixture, ["project", "validate", "eta", "--json"], projectRoot);
        expect(result.code).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({
            ok: true,
            project: {projectRoot: "eta", status: "valid"},
        });
    });
});

type Fixture = {
    stateRoot: string;
    workspaceRoot: string;
    env: NodeJS.ProcessEnv;
};

type CliResult = {
    code: number;
    stdout: string;
    stderr: string;
};

async function createFixture(): Promise<Fixture> {
    const root = await mkdtemp(testHostPath("nbook-workspace-command-"));
    roots.push(root);
    const stateRoot = join(root, "state");
    const workspaceRoot = join(stateRoot, "workspace");
    await mkdir(workspaceRoot, {recursive: true});
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NEURO_BOOK_APPLICATION_ROOT: applicationRoot,
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_CACHE_ROOT: join(stateRoot, "cache"),
        NODE_PATH: "",
    };
    delete env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    return {stateRoot, workspaceRoot, env};
}

async function runWorkspace(fixture: Fixture, args: string[], cwd = fixture.workspaceRoot): Promise<CliResult> {
    return await new Promise((resolveResult, rejectResult) => {
        const bunExecutable = process.versions.bun ? process.execPath : (process.env.BUN || "bun");
        const child = spawn(bunExecutable, ["run", "--no-install", workspaceCommand, ...args], {
            cwd,
            env: fixture.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.once("error", rejectResult);
        child.once("exit", (code, signal) => {
            if (signal) {
                rejectResult(new Error(`workspace CLI 被信号中断：${signal}`));
                return;
            }
            resolveResult({
                code: code ?? 1,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
    });
}

function parseJson(stdout: string): unknown {
    return JSON.parse(stdout) as unknown;
}

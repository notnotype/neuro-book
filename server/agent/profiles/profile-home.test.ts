import {access, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createLayeredProfileHomeFacade, createProfileHomePreviewFacade, defineProfileHome, ensureGlobalProfileHome, ensureProfileHome, resetProfileHome} from "nbook/server/agent/profiles/profile-home";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("profile home", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-profile-home-"));
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("初始化 home 并写入 home.json", async () => {
        const home = await ensureProfileHome({
            projectRoot,
            profileKey: "writer",
            profileVersion: 2,
            definition: defineProfileHome({
                async init(ctx) {
                    await ctx.home.writeText("styles/default.md", "# Default\n");
                },
            }),
        });

        await expect(readFile(path.join(home.root, "styles/default.md"), "utf-8")).resolves.toBe("# Default\n");
        const metadata = JSON.parse(await readFile(path.join(home.root, "home.json"), "utf-8")) as {profileKey: string; version: number};
        expect(metadata).toMatchObject({profileKey: "writer", version: 2});
    });

    it("版本升高时调用 upgrade 并传入 oldVersion 与 targetVersion", async () => {
        const calls: Array<[number, number]> = [];
        await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
        await ensureProfileHome({
            projectRoot,
            profileKey: "writer",
            profileVersion: 3,
            definition: defineProfileHome({
                async upgrade(ctx, oldVersion, targetVersion) {
                    calls.push([oldVersion, targetVersion]);
                    await ctx.home.writeText("upgraded.txt", `${oldVersion}->${targetVersion}`, {mode: "overwrite"});
                },
            }),
        });

        expect(calls).toEqual([[1, 3]]);
        await expect(readFile(path.join(projectRoot, "agents/writer/upgraded.txt"), "utf-8")).resolves.toBe("1->3");
    });

    it("writeText 默认 create，显式 overwrite 才覆盖", async () => {
        const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});

        await expect(home.writeText("note.md", "first")).resolves.toEqual({written: true});
        await expect(home.writeText("note.md", "second")).resolves.toEqual({written: false});
        await expect(home.readText("note.md")).resolves.toBe("first");
        await expect(home.writeText("note.md", "second", {mode: "overwrite"})).resolves.toEqual({written: true});
        await expect(home.readText("note.md")).resolves.toBe("second");
    });

    it("拦截越界路径并支持 reset", async () => {
        const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});

        await expect(home.writeText("../escape.md", "bad")).rejects.toThrow("profile home 路径");
        await home.writeText("note.md", "keep");
        await resetProfileHome({
            projectRoot,
            profileKey: "writer",
            profileVersion: 1,
            definition: defineProfileHome({
                async reset(ctx) {
                    await ctx.home.clear();
                    await ctx.home.writeText("reset.md", "ok");
                },
            }),
        });

        await expect(home.exists("note.md")).resolves.toBe(false);
        await expect(home.readText("reset.md")).resolves.toBe("ok");
    });

    it("读写拒绝链接逃逸，但remove可以安全删除链接目录项", async () => {
        const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
        const outsideRoot = path.join(projectRoot, "outside-home");
        const marker = path.join(outsideRoot, "marker.md");
        await mkdir(outsideRoot, {recursive: true});
        await writeFile(marker, "outside", "utf8");
        await symlink(outsideRoot, path.join(home.root, "escape"), process.platform === "win32" ? "junction" : "dir");

        await expect(home.readText("escape/marker.md")).rejects.toThrow("真实路径越过文件系统根");
        await expect(home.writeText("escape/new.md", "bad")).rejects.toThrow("真实路径越过文件系统根");
        await home.remove("escape");

        await expect(access(marker)).resolves.toBeUndefined();
        await expect(home.exists("escape")).resolves.toBe(false);
    });

    it("初始化 Global profile home 到 Workspace Root .nbook/agents", async () => {
        const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-global-profile-home-"));
        try {
            const calls: string[] = [];
            const home = await ensureGlobalProfileHome({
                workspaceRoot: absoluteFsPath(workspaceRoot),
                profileKey: "writer",
                profileVersion: 1,
                definition: defineProfileHome({
                    async init(ctx) {
                        calls.push(`${ctx.scope}:${path.relative(workspaceRoot, ctx.root).replaceAll("\\", "/")}`);
                        await ctx.home.writeText("styles/global.md", "global");
                    },
                }),
            });

            expect(path.relative(workspaceRoot, home.root).replaceAll("\\", "/")).toBe(".nbook/agents/writer");
            expect(calls).toEqual(["global:.nbook/agents/writer"]);
            await expect(readFile(path.join(workspaceRoot, ".nbook", "agents", "writer", "styles", "global.md"), "utf-8")).resolves.toBe("global");
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("层叠 home 读取 Project 优先并用 Global 兜底", async () => {
        const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-layered-profile-home-"));
        try {
            const globalHome = await ensureGlobalProfileHome({workspaceRoot: absoluteFsPath(workspaceRoot), profileKey: "writer", profileVersion: 1});
            const projectHome = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await globalHome.writeText("styles/shared.md", "global shared", {mode: "overwrite"});
            await globalHome.writeText("styles/global.md", "global only", {mode: "overwrite"});
            await projectHome.writeText("styles/shared.md", "project shared", {mode: "overwrite"});

            const layered = createLayeredProfileHomeFacade(projectHome, globalHome);

            await expect(layered.readText("styles/shared.md")).resolves.toBe("project shared");
            await expect(layered.readText("styles/global.md")).resolves.toBe("global only");
            await expect(layered.exists("styles/global.md")).resolves.toBe(true);
            expect((await layered.list("styles")).map((item) => item.path)).toEqual(["styles/global.md", "styles/shared.md"]);
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("预览覆盖层支持创建、编辑、重命名和删除且不写底层 Home", async () => {
        const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
        await home.writeText("prompts/default.md", "default", {mode: "overwrite"});
        const preview = createProfileHomePreviewFacade(home);

        await preview.writeText("prompts/draft.md", "draft", {mode: "create"});
        await preview.writeText("prompts/default.md", "edited", {mode: "overwrite"});
        await preview.move("prompts/draft.md", "prompts/renamed.md", {mode: "create"});
        await preview.remove("prompts/default.md");

        await expect(preview.readText("prompts/renamed.md")).resolves.toBe("draft");
        await expect(preview.exists("prompts/default.md")).resolves.toBe(false);
        expect((await preview.list("prompts")).map((item) => item.path)).toEqual(["prompts/renamed.md"]);
        await expect(home.readText("prompts/default.md")).resolves.toBe("default");
        await expect(home.exists("prompts/renamed.md")).resolves.toBe(false);
    });
});

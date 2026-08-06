import {access, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveBashPathForPlatform} from "nbook/server/agent/tools/file-tools";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import {closeAllProjects, openProject} from "nbook/server/workspace-files/project-session";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {createRasterTestFixtures, jpegWithDimensions} from "nbook/server/agent/test-utils/raster-fixtures";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("v3 file tools", () => {
    let root: string;
    let workspaceRoot: string;
    let harness: NeuroAgentHarness;
    let context: ToolExecutionContext;
    let attachmentAdapter: AttachmentBlobAdapter;
    let jpeg: Buffer;
    let oversizedJpeg: Buffer;

    beforeAll(async () => {
        ({jpeg} = await createRasterTestFixtures());
        oversizedJpeg = jpegWithDimensions(jpeg, 8_193, 8_192);
    });

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-agent-file-tools-test-"));
        workspaceRoot = join(root, "workspace");
        await mkdir(workspaceRoot, {recursive: true});
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(resolve(".")),
            stateRoot: absoluteFsPath(root),
        });
        attachmentAdapter = memoryAttachmentAdapter();
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(runtimePaths.workspaceRoot),
            runtimePaths,
            profiles: new AgentProfileCatalog(join(root, "profiles-system"), join(root, "profiles-user")),
            attachmentStore: new AttachmentStore(attachmentAdapter),
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.file-tools",
                name: "File Tools Test",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const session = await harness.createAgent({
            profileKey: "test.file-tools",
            initial: {},
        });
        context = {
            harness,
            sessionId: session.sessionId,
            profileKey: "test.file-tools",
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject: null,
            attachmentCodec: harness.attachmentCodec,
        };
    }, 60_000);

    afterEach(async () => {
        await closeAllProjects();
        await harness.dispose();
        await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }, 60_000);

    async function openManagedProject(projectRoot: string): Promise<ReadyProjectSessionRef> {
        const projectWorkspaceRoot = join(workspaceRoot, projectRoot);
        await mkdir(projectWorkspaceRoot, {recursive: true});
        const manifestPath = join(projectWorkspaceRoot, "project.yaml");
        await access(manifestPath).catch(() => writeFile(manifestPath, `kind: novel\ntitle: ${basename(projectWorkspaceRoot)}\nsummary: ''\n`, "utf8"));
        return openProject(projectWorkspaceRef(projectRoot), {kind: "job", source: "file-tools-test"}, absoluteFsPath(workspaceRoot));
    }

    it("read 支持 offset/limit 和 continuation 提示", async () => {
        await writeFile(join(workspaceRoot, "notes.md"), "a\nb\nc\nd", "utf-8");
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-1", {
            path: "notes.md",
            offset: 2,
            limit: 2,
        });

        expect(result?.content).toEqual([
            {type: "text", text: "2 | b\n3 | c\n\n[1 more lines in file. Use offset=4 to continue.]"},
        ]);
        expect(result?.details).toEqual(expect.objectContaining({
            startLine: 2,
            endLine: 3,
            totalLines: 4,
            nextOffset: 4,
        }));
    });

    it("read 短文件默认不显示行号，但支持显式开启", async () => {
        await writeFile(join(workspaceRoot, "short.md"), "a\nb", "utf-8");
        const tool = mustTool("read", harness);

        const plain = await tool.executeWithContext?.(context, "read-short-plain", {
            path: "short.md",
        });
        const numbered = await tool.executeWithContext?.(context, "read-short-numbered", {
            path: "short.md",
            lineNumbers: true,
        });

        expect(plain?.content).toEqual([{type: "text", text: "a\nb"}]);
        expect(numbered?.content).toEqual([{type: "text", text: "1 | a\n2 | b"}]);
    });

    it("read 参数 schema 拒绝非正整数 offset/limit", () => {
        const tool = mustTool("read", harness);

        expect(Value.Check(tool.parameters, {path: "notes.md", offset: 0})).toBe(false);
        expect(Value.Check(tool.parameters, {path: "notes.md", offset: -1})).toBe(false);
        expect(Value.Check(tool.parameters, {path: "notes.md", offset: 1.5})).toBe(false);
        expect(Value.Check(tool.parameters, {path: "notes.md", limit: 0})).toBe(false);
        expect(Value.Check(tool.parameters, {path: "notes.md", limit: 2.5})).toBe(false);
    });

    it("read 截断输出自动显示行号并返回 nextOffset", async () => {
        await writeFile(
            join(workspaceRoot, "long.md"),
            Array.from({length: 2001}, (_, index) => `line ${index + 1}`).join("\n"),
            "utf-8",
        );
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-truncated", {
            path: "long.md",
        });
        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";

        expect(text).toContain("1 | line 1");
        expect(text).toContain("2000 | line 2000");
        expect(text).toContain("[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]");
        expect(result?.details).toEqual(expect.objectContaining({
            startLine: 1,
            endLine: 2000,
            totalLines: 2001,
            nextOffset: 2001,
        }));
    });

    it("read 图片时直接返回 attachment ref，不生成 base64", async () => {
        const bytes = jpeg;
        await writeFile(join(workspaceRoot, "cover.jpg"), bytes);
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-image-1", {
            path: "cover.jpg",
        });

        expect(result?.content).toEqual([
            {type: "text", text: "Read image file [image/jpeg]"},
            {
                type: "attachment",
                attachment: {
                    id: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
                    mimeType: "image/jpeg",
                    bytes: bytes.byteLength,
                },
                name: "cover.jpg",
            },
        ]);
        expect(JSON.stringify(result)).not.toContain(bytes.toString("base64"));
    });

    it("read 图片候选使用魔数而不是扩展名作为 MIME 真相", async () => {
        await writeFile(join(workspaceRoot, "wrong.png"), jpeg);
        await writeFile(join(workspaceRoot, "fake.png"), "not an image", "utf8");
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-wrong-extension", {path: "wrong.png"});
        expect(result?.content).toEqual([
            {type: "text", text: "Read image file [image/jpeg]"},
            expect.objectContaining({
                type: "attachment",
                attachment: expect.objectContaining({mimeType: "image/jpeg", bytes: jpeg.byteLength}),
                name: "wrong.png",
            }),
        ]);
        await expect(tool.executeWithContext?.(context, "read-fake-image", {path: "fake.png"}))
            .rejects.toMatchObject({code: "invalid_input"});
    });

    it("read 在读取图片正文前拒绝超过 16 MiB 的候选文件", async () => {
        await writeFile(join(workspaceRoot, "oversized.png"), Buffer.alloc(16 * 1024 * 1024 + 1));
        const tool = mustTool("read", harness);

        await expect(tool.executeWithContext?.(context, "read-oversized-image", {path: "oversized.png"}))
            .rejects.toMatchObject({code: "limit_exceeded"});
    });

    it("read 图片通过 Codec 在 Store 写入前拒绝超过 64 MP 的源图", async () => {
        await writeFile(join(workspaceRoot, "pixel-bomb.jpg"), oversizedJpeg);
        const put = vi.spyOn(attachmentAdapter, "put");
        const tool = mustTool("read", harness);

        await expect(tool.executeWithContext?.(context, "read-pixel-bomb", {path: "pixel-bomb.jpg"}))
            .rejects.toMatchObject({code: "limit_exceeded"});
        expect(put).not.toHaveBeenCalled();
    });

    it("read 在Project-bound File Scope中直接接受Project相对路径", async () => {
        const projectWorkspaceRoot = join(root, "workspace", "silver-dragon-hime");
        await mkdir(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬"), {recursive: true});
        await writeFile(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬", "state.md"), "银龙姬状态", "utf-8");
        const currentProject = await openManagedProject("silver-dragon-hime");
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "read-project-workspace-path", {
            path: "lorebook/character/银龙姬/state.md",
        });

        expect(result?.content).toEqual([
            {type: "text", text: "银龙姬状态"},
        ]);
    });

    it("read 成功读取 lorebook 时写入当前 profile 的 context access", async () => {
        const projectWorkspaceRoot = join(root, "workspace", "silver-dragon-hime");
        await mkdir(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬"), {recursive: true});
        await writeFile(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬", "index.md"), "银龙姬设定", "utf-8");
        const currentProject = await openManagedProject("silver-dragon-hime");
        const tool = mustTool("read", harness);

        await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "read-context-access", {
            path: "lorebook/character/银龙姬/index.md",
        });

        const state = JSON.parse(await readFile(join(projectWorkspaceRoot, ".nbook", "context-access", "test.file-tools.json"), "utf-8")) as {
            profile: string;
            entries: Array<{path: string; signals: {"index-read"?: number}}>;
        };
        expect(state.profile).toBe("test.file-tools");
        expect(state.entries).toEqual([
            expect.objectContaining({
                path: "lorebook/character/银龙姬/",
                signals: {"index-read": 1},
            }),
        ]);
        await expect(readFile(join(projectWorkspaceRoot, "agents", "test.file-tools", "generated.md"), "utf-8")).resolves.toContain("lorebook/character/银龙姬/");
    });

    it("read 使用完整 Project File Address 时按目标 Project 记录 context access", async () => {
        const betaRoot = join(root, "workspace", "beta");
        await mkdir(join(root, "workspace", "silver-dragon-hime"), {recursive: true});
        await mkdir(join(betaRoot, "lorebook", "character", "beta"), {recursive: true});
        await writeFile(join(betaRoot, "lorebook", "character", "beta", "index.md"), "Beta", "utf8");
        const currentProject = await openManagedProject("silver-dragon-hime");
        await openManagedProject("beta");
        const tool = mustTool("read", harness);

        await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "read-cross-project", {path: "workspace/beta/lorebook/character/beta/index.md"});

        const state = JSON.parse(await readFile(join(betaRoot, ".nbook", "context-access", "test.file-tools.json"), "utf8")) as {
            entries: Array<{path: string}>;
        };
        expect(state.entries).toEqual([expect.objectContaining({path: "lorebook/character/beta/"})]);
    });

    it("read 使用Project内绝对地址时保留Resolver提供的context access归属", async () => {
        const projectRoot = join(root, "workspace", "silver-dragon-hime");
        const target = join(projectRoot, "lorebook", "character", "absolute", "index.md");
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, "Absolute", "utf8");
        const currentProject = await openManagedProject("silver-dragon-hime");
        const tool = mustTool("read", harness);

        await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "read-absolute-project", {path: target});

        const state = JSON.parse(await readFile(join(projectRoot, ".nbook", "context-access", "test.file-tools.json"), "utf8")) as {
            entries: Array<{path: string}>;
        };
        expect(state.entries).toEqual([expect.objectContaining({path: "lorebook/character/absolute/"})]);
    });

    it("跨 Project 读取图片时来源归目标 Project，blob 仍写入 Harness 全局 Attachment Adapter", async () => {
        const betaRoot = join(root, "workspace", "beta");
        const bytes = jpeg;
        await mkdir(join(root, "workspace", "alpha"), {recursive: true});
        await mkdir(join(betaRoot, "lorebook"), {recursive: true});
        await writeFile(join(betaRoot, "lorebook", "cover.jpg"), bytes);
        const currentProject = await openManagedProject("alpha");
        await openManagedProject("beta");
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "read-cross-project-image", {path: "workspace/beta/lorebook/cover.jpg"});
        const attachment = result?.content.find((block) => block.type === "attachment");
        if (!attachment || attachment.type !== "attachment") {
            throw new Error("read 未返回 attachment");
        }
        const hash = attachment.attachment.id.slice("sha256:".length);
        const stored = await attachmentAdapter.get(`sha256/${hash.slice(0, 2)}/${hash.slice(2)}`);

        expect(stored && Buffer.from(stored)).toEqual(bytes);
        await expect(access(join(betaRoot, ".nbook", "agent", "attachments"))).rejects.toThrow();
    });

    it("Project-bound session 将相对路径解析到当前 Project Workspace", async () => {
        const projectWorkspaceRoot = join(root, "workspace", "silver-dragon-hime");
        const currentProject = await openManagedProject("silver-dragon-hime");
        const authorized = await authorizeFileOperation({
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject,
        }, "lorebook/character/银龙姬/state.md", "read");

        expect(authorized.target.absolutePath)
            .toBe(resolve(currentProject.workspace.root, "lorebook", "character", "银龙姬", "state.md"));
    });

    it("支持跨 Project 路径和绝对文件系统路径", async () => {
        const currentProject = await openManagedProject("silver-dragon-hime");
        const targetProject = await openManagedProject("another-project");
        const operationContext = {
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject,
        };
        expect((await authorizeFileOperation(operationContext, "workspace/another-project/manuscript/chapter.md", "read")).target.absolutePath)
            .toBe(resolve(targetProject.workspace.root, "manuscript", "chapter.md"));

        const repositoryReference = resolve("reference", "workspace", "TERMS.md");
        expect((await authorizeFileOperation(operationContext, repositoryReference, "read")).target.absolutePath).toBe(repositoryReference);
    });

    it("拒绝重复添加当前 Project root 的相对路径", async () => {
        const currentProject = await openManagedProject("silver-dragon-hime");
        const operationContext = {
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject,
        };
        await expect(authorizeFileOperation(operationContext, "silver-dragon-hime/lorebook/state.md", "read"))
            .rejects.toThrow("不要重复添加 silver-dragon-hime/ 前缀");
    });

    it("write 创建父目录并写入内容", async () => {
        const tool = mustTool("write", harness);

        await tool.executeWithContext?.(context, "write-1", {
            path: "nested/file.txt",
            content: "hello",
        });

        await expect(readFile(join(workspaceRoot, "nested", "file.txt"), "utf-8")).resolves.toBe("hello");
    });

    it("Project-bound文件工具可直接读写任意绝对路径", async () => {
        const projectRoot = join(workspaceRoot, "alpha");
        const externalRoot = join(root, "external");
        const externalFile = join(externalRoot, "notes.md");
        const patchPath = externalFile.replaceAll("\\", "/");
        await mkdir(projectRoot, {recursive: true});
        await mkdir(externalRoot, {recursive: true});
        await writeFile(externalFile, "one\ntwo\n", "utf-8");
        const currentProject = await openManagedProject("alpha");
        const projectContext = {...context, currentProject};

        const read = mustTool("read", harness);
        const write = mustTool("write", harness);
        const edit = mustTool("edit", harness);
        const applyPatch = mustTool("apply_patch", harness);

        await expect(read.executeWithContext?.(projectContext, "read-absolute", {path: externalFile}))
            .resolves.toMatchObject({content: [{type: "text", text: "one\ntwo\n"}]});
        await write.executeWithContext?.(projectContext, "write-absolute", {
            path: join(externalRoot, "created.md"),
            content: "created",
        });
        await edit.executeWithContext?.(projectContext, "edit-absolute", {
            path: externalFile,
            edits: [{oldText: "two", newText: "TWO"}],
        });
        await applyPatch.executeWithContext?.(projectContext, "patch-absolute", patchInput([
            "*** Begin Patch",
            `*** Update File: ${patchPath}`,
            "@@",
            "-one",
            "+ONE",
            " TWO",
            "*** End Patch",
        ]));

        await expect(readFile(externalFile, "utf-8")).resolves.toBe("ONE\nTWO\n");
        await expect(readFile(join(externalRoot, "created.md"), "utf-8")).resolves.toBe("created");
        await expect(access(join(externalRoot, ".nbook"))).rejects.toThrow();
    });

    it("edit 执行精确替换并拒绝重复 oldText", async () => {
        await writeFile(join(workspaceRoot, "edit.txt"), "one\ntwo\nthree", "utf-8");
        const tool = mustTool("edit", harness);

        const result = await tool.executeWithContext?.(context, "edit-1", {
            path: "edit.txt",
            edits: [{oldText: "two", newText: "TWO"}],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            diff: expect.stringContaining("TWO"),
            firstChangedLine: expect.any(Number),
        }));
        await expect(readFile(join(workspaceRoot, "edit.txt"), "utf-8")).resolves.toBe("one\nTWO\nthree");

        await writeFile(join(workspaceRoot, "edit.txt"), "dup\ndup", "utf-8");
        await expect(tool.executeWithContext?.(context, "edit-2", {
            path: "edit.txt",
            edits: [{oldText: "dup", newText: "x"}],
        })).rejects.toThrow("oldText matched 2 locations at lines 1, 2");
    });

    it("edit 批量预检失败时不写文件，并报告已匹配行号", async () => {
        await writeFile(join(workspaceRoot, "edit-preflight.txt"), "one\ntwo\nthree", "utf-8");
        const tool = mustTool("edit", harness);

        await expect(tool.executeWithContext?.(context, "edit-preflight", {
            path: "edit-preflight.txt",
            edits: [
                {oldText: "one", newText: "ONE"},
                {oldText: "missing", newText: "MISSING"},
            ],
        })).rejects.toThrow(/Matched edits:\n- edits\[0\] matched lines 1-1\./);
        await expect(readFile(join(workspaceRoot, "edit-preflight.txt"), "utf-8")).resolves.toBe("one\ntwo\nthree");
    });

    it("edit 批量预检拒绝重叠 edit，并保持文件不变", async () => {
        await writeFile(join(workspaceRoot, "edit-overlap.txt"), "abcdef\n", "utf-8");
        const tool = mustTool("edit", harness);

        await expect(tool.executeWithContext?.(context, "edit-overlap", {
            path: "edit-overlap.txt",
            edits: [
                {oldText: "abc", newText: "ABC"},
                {oldText: "bcd", newText: "BCD"},
            ],
        })).rejects.toThrow("overlaps edits[0] at lines 1-1");
        await expect(readFile(join(workspaceRoot, "edit-overlap.txt"), "utf-8")).resolves.toBe("abcdef\n");
    });

    it("apply_patch 应用 Codex patch JSON 参数", async () => {
        await writeFile(join(workspaceRoot, "patch.txt"), "old\nline\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-1", patchInput([
            "*** Begin Patch",
            "*** Update File: patch.txt",
            "@@",
            "-old",
            "+new",
            " line",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "patch.txt"), "utf-8")).resolves.toBe("new\nline\n");
    });

    it("apply_patch 在Project-bound File Scope中接受Project相对路径", async () => {
        const projectWorkspaceRoot = join(root, "workspace", "silver-dragon-hime");
        await mkdir(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬"), {recursive: true});
        await writeFile(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬", "state.md"), "旧状态\n", "utf-8");
        const currentProject = await openManagedProject("silver-dragon-hime");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "patch-project-workspace-path", patchInput([
            "*** Begin Patch",
            "*** Update File: lorebook/character/银龙姬/state.md",
            "@@",
            "-旧状态",
            "+新状态",
            "*** End Patch",
        ]));

        await expect(readFile(join(projectWorkspaceRoot, "lorebook", "character", "银龙姬", "state.md"), "utf-8")).resolves.toBe("新状态\n");
    });

    it("apply_patch 支持同一文件多 hunk", async () => {
        await writeFile(join(workspaceRoot, "multi-hunk.txt"), "alpha\nmiddle\nomega\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-multi-hunk", patchInput([
            "*** Begin Patch",
            "*** Update File: multi-hunk.txt",
            "@@",
            "-alpha",
            "+ALPHA",
            " middle",
            "@@",
            "-omega",
            "+OMEGA",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "multi-hunk.txt"), "utf-8")).resolves.toBe("ALPHA\nmiddle\nOMEGA\n");
    });

    it("apply_patch 支持 End of File 标记移除尾随换行", async () => {
        await writeFile(join(workspaceRoot, "no-newline.txt"), "old\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-no-newline", patchInput([
            "*** Begin Patch",
            "*** Update File: no-newline.txt",
            "@@",
            "-old",
            "+new",
            "*** End of File",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "no-newline.txt"), "utf-8")).resolves.toBe("new");
    });

    it("apply_patch 支持新增、删除和移动文件", async () => {
        await writeFile(join(workspaceRoot, "old-name.txt"), "alpha\n", "utf-8");
        await writeFile(join(workspaceRoot, "delete-me.txt"), "bye\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        const result = await tool.executeWithContext?.(context, "patch-multi", patchInput([
            "*** Begin Patch",
            "*** Add File: added.txt",
            "+hello",
            "*** Update File: old-name.txt",
            "*** Move to: nested/new-name.txt",
            "@@",
            "-alpha",
            "+beta",
            "*** Delete File: delete-me.txt",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "added.txt"), "utf-8")).resolves.toBe("hello\n");
        await expect(readFile(join(workspaceRoot, "nested", "new-name.txt"), "utf-8")).resolves.toBe("beta\n");
        await expect(readFile(join(workspaceRoot, "delete-me.txt"), "utf-8")).rejects.toThrow();
        expect(result?.details).toEqual(expect.objectContaining({
            files: expect.arrayContaining([
                {path: "added.txt", action: "add"},
                {path: "old-name.txt", action: "delete"},
                {path: "nested/new-name.txt", action: "add"},
                {path: "delete-me.txt", action: "delete"},
            ]),
        }));
    });

    it("apply_patch 失败时不产生部分写入", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Update File: missing.txt",
            "@@",
            "-x",
            "+y",
            "*** End Patch",
        ]))).rejects.toThrow("文件不存在");

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
    });

    it("apply_patch 拒绝 Add File 覆盖已有文件", async () => {
        await writeFile(join(workspaceRoot, "existing.txt"), "original\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-existing-add", patchInput([
            "*** Begin Patch",
            "*** Add File: existing.txt",
            "+replacement",
            "*** End Patch",
        ]))).rejects.toThrow("文件已存在");

        await expect(readFile(join(workspaceRoot, "existing.txt"), "utf-8")).resolves.toBe("original\n");
    });

    it("apply_patch 先更新再删除时失败会回滚到 patch 前内容", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        await writeFile(join(workspaceRoot, "blocked"), "not a directory\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-delete-after-update-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Delete File: keep.txt",
            "*** Add File: blocked/file.txt",
            "+created",
            "*** End Patch",
        ]))).rejects.toThrow();

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
        await expect(readFile(join(workspaceRoot, "blocked"), "utf-8")).resolves.toBe("not a directory\n");
    });

    it("apply_patch 缺失上下文时失败", async () => {
        await writeFile(join(workspaceRoot, "context.txt"), "present\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-missing-context", patchInput([
            "*** Begin Patch",
            "*** Update File: context.txt",
            "@@",
            "-missing",
            "+new",
            "*** End Patch",
        ]))).rejects.toThrow("missing context");

        await expect(readFile(join(workspaceRoot, "context.txt"), "utf-8")).resolves.toBe("present\n");
    });

    it("apply_patch 拒绝无效 patch 头", async () => {
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-invalid-header", {
            patch: [
            "--- a/file.txt",
            "+++ b/file.txt",
            "@@",
            "-old",
            "+new",
            ].join("\n"),
        })).rejects.toThrow("*** Begin Patch");
    });

    it("apply_patch 写入阶段失败时会回滚已写文件", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        await writeFile(join(workspaceRoot, "blocked"), "not a directory\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-write-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Add File: blocked/file.txt",
            "+created",
            "*** End Patch",
        ]))).rejects.toThrow();

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
        await expect(readFile(join(workspaceRoot, "blocked"), "utf-8")).resolves.toBe("not a directory\n");
    });

    it("apply_patch 暴露 JSON patch 参数", () => {
        const tool = mustTool("apply_patch", harness);

        expect(tool.parameters).toEqual(expect.objectContaining({
            type: "object",
            additionalProperties: false,
            properties: expect.objectContaining({
                patch: expect.objectContaining({type: "string"}),
            }),
        }));
        expect(tool.description).toContain("patch");
    });

    it("apply_patch 拒绝越过 workspaceRoot", async () => {
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-outside", patchInput([
            "*** Begin Patch",
            "*** Add File: ../outside.txt",
            "+nope",
            "*** End Patch",
        ]))).rejects.toThrow("路径越过文件系统根");
    });

    it("apply_patch 拒绝通过symlink或junction越过Workspace Root", async () => {
        const outsideRoot = join(root, "outside");
        await mkdir(outsideRoot, {recursive: true});
        await symlink(outsideRoot, join(workspaceRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-symlink-outside", patchInput([
            "*** Begin Patch",
            "*** Add File: escape/outside.txt",
            "+nope",
            "*** End Patch",
        ]))).rejects.toThrow("真实路径越过文件系统根");
        await expect(access(join(outsideRoot, "outside.txt"))).rejects.toThrow();
    });

    it("apply_patch 拒绝删除目录", async () => {
        await mkdir(join(workspaceRoot, "folder"), {recursive: true});
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-delete-directory", patchInput([
            "*** Begin Patch",
            "*** Delete File: folder",
            "*** End Patch",
        ]))).rejects.toThrow("不能修改目录");
    });

    it("apply_patch 不接受旧 unified diff patch 内容", async () => {
        await writeFile(join(workspaceRoot, "patch.txt"), "old\nline\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-old-json", {
            patch: [
                "@@ -1,2 +1,2 @@",
                "-old",
                "+new",
                " line",
                "",
            ].join("\n"),
        })).rejects.toThrow("*** Begin Patch");
    });

    it("bash 在 workspace root 执行真实 bash 并合并输出", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-1", {
            command: "pwd && echo out && echo err 1>&2",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text).toContain("out");
        expect(text).toContain("err");
    });

    it("bash长输出只公开逻辑locator，read可分页读取且回收后明确报错", async () => {
        const bash = mustTool("bash", harness);
        const result = await bash.executeWithContext?.(context, "bash-retained-output", {
            command: "for i in $(seq 1 2100); do echo line-$i; done",
            timeout: 10,
        });
        const details = result?.details as {fullOutput?: {locator?: string; state?: string}} | undefined;
        const locator = details?.fullOutput?.locator;
        if (!locator) throw new Error("Bash长输出没有返回逻辑locator");

        expect(locator).toMatch(/^bash-output:\/\//u);
        expect(locator).not.toContain(root);
        const read = await mustTool("read", harness).executeWithContext?.(context, "read-retained-output", {
            path: locator,
            limit: 2,
        });
        const text = read?.content[0]?.type === "text" ? read.content[0].text : "";
        expect(text).toContain("1 | line-1");
        expect(text).toContain("2 | line-2");

        await rm(harness.runtimePaths!.bashOutputRoot, {recursive: true, force: true});
        await expect(mustTool("read", harness).executeWithContext?.(context, "read-reclaimed-output", {
            path: locator,
        })).rejects.toThrow(`Bash完整输出已回收：${locator}`);
    });

    it("bash 自动注入 Agent bin 并允许 workspace CLI 从 workspace cwd 运行", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-workspace-cli", {
            command: "pwd && command -v workspace && workspace --help",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.replaceAll("\\", "/")).toContain("nbook-agent-file-tools-test-");
        expect(text).toContain("/workspace");
        expect(text).toContain("agent/bin/workspace");
        expect(text).toContain("Usage: workspace [options] [command]");
    });

    it("Project-bound bash从Project Workspace运行workspace CLI", async () => {
        const projectRoot = join(workspaceRoot, "test-project");
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Test Project\nsummary: \"\"\n", "utf-8");
        await mkdir(join(projectRoot, "lorebook", "character", "hero"), {recursive: true});
        await writeFile(join(projectRoot, "lorebook", "character", "hero", "index.md"), "---\ntitle: Hero\ntype: character\nstatus: active\nsummary: 主角。\nrefs: []\n---\n\n正文。", "utf-8");
        const currentProject = await openManagedProject("test-project");
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.({
            ...context,
            currentProject,
        }, "bash-workspace-node", {
            command: "pwd && workspace node parse lorebook/character/hero --json && workspace node validate lorebook/character/hero --fix-missing",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.replaceAll("\\", "/")).toContain("/workspace/test-project");
        expect(text).toContain("\"path\": \"lorebook/character/hero/\"");
        expect(text).toContain("\"type\": \"character\"");
        expect(text).toContain("OK");
    });

    it("bash 优先从 user-assets bin 解析 workspace CLI", async () => {
        const userBinPath = join(workspaceRoot, ".nbook", "agent", "bin", "workspace");
        await mkdir(dirname(userBinPath), {recursive: true});
        await writeFile(userBinPath, "#!/usr/bin/env sh\necho user-bin-path-test\n", "utf-8");
        const tool = mustTool("bash", harness);

        try {
            const result = await tool.executeWithContext?.(context, "bash-user-workspace-cli", {
                command: "command -v workspace",
                timeout: 10,
            });

            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
            expect(text.replaceAll("\\", "/")).toContain(`${basename(root)}/workspace/.nbook/agent/bin/workspace`);
        } finally {
            await rm(userBinPath, {force: true});
        }
    });

    it("bash 会实际执行 user-assets bin 中的覆盖命令", async () => {
        const userBinPath = join(workspaceRoot, ".nbook", "agent", "bin", "workspace");
        await mkdir(dirname(userBinPath), {recursive: true});
        await writeFile(userBinPath, "#!/usr/bin/env sh\necho user-bin-test\n", "utf-8");
        const tool = mustTool("bash", harness);

        try {
            const result = await tool.executeWithContext?.(context, "bash-user-workspace-exec", {
                command: "workspace",
                timeout: 10,
            });

            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
            expect(text).toContain("user-bin-test");
        } finally {
            await rm(userBinPath, {force: true});
        }
    });

    it("bash 在 Git Bash 内也会把 Agent bin 放到 PATH 最前面", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-path-order", {
            command: "printf '%s\\n' \"$PATH\"",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        const firstPath = text.split(":")[0]?.replaceAll("\\", "/") ?? "";
        expect(firstPath).toContain(".nbook/agent/bin");
    });

    it("retrieval 的 index.md 清单命令可在真实 bash 中执行", async () => {
        await writeFile(join(workspaceRoot, "workspace.yaml"), "schemaVersion: 1\nslug: test\ndisplayName: Test\nnovelId: \"1\"\ncreatedAt: \"2026-05-24T00:00:00.000Z\"\nupdatedAt: \"2026-05-24T00:00:00.000Z\"\n", "utf-8");
        await mkdir(join(workspaceRoot, "lorebook", "character", "hero"), {recursive: true});
        await writeFile(join(workspaceRoot, "lorebook", "character", "hero", "index.md"), "---\ntitle: Hero\ntype: character\nstatus: active\nrefs: []\n---\n\n正文。", "utf-8");
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-rg-config", {
            command: "printf 'config=%s\\n' \"$RIPGREP_CONFIG_PATH\" && rg --files -g 'index.md' | workspace node parse --stdin --ndjson",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.replaceAll("\\", "/")).toContain("config=");
        expect(text.replaceAll("\\", "/")).toContain(".nbook/agent/config/ripgreprc");
        expect(text).toContain("lorebook/character/hero/index.md");
        expect(text).toContain("\"title\":\"Hero\"");
        expect(text).not.toContain("lorebook\\character\\hero\\index.md");
    });

    it("bash 优先使用 user-assets rg 配置", async () => {
        const userConfigPath = resolve(workspaceRoot, ".nbook", "agent", "config", "ripgreprc");
        let original: string | null = null;
        try {
            original = await readFile(userConfigPath, "utf-8");
        } catch {
            original = null;
        }
        await mkdir(dirname(userConfigPath), {recursive: true});
        await writeFile(userConfigPath, "--path-separator=/\n", "utf-8");
        const tool = mustTool("bash", harness);

        try {
            const result = await tool.executeWithContext?.(context, "bash-user-rg-config", {
                command: "printf '%s\\n' \"$RIPGREP_CONFIG_PATH\"",
                timeout: 10,
            });

            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
            expect(text.replaceAll("\\", "/")).toContain(".nbook/agent/config/ripgreprc");
        } finally {
            if (original === null) {
                await rm(userConfigPath, {force: true});
            } else {
                await writeFile(userConfigPath, original, "utf-8");
            }
        }
    });

    it("Windows bash 解析优先使用真实存在的 Git Bash 路径，再查 PATH 命令", () => {
        const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
        const pathBash = "C:\\Tools\\bin\\bash.exe";
        const foundGitBash = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                PATH: "C:\\Tools\\bin",
            },
            pathExists(path) {
                return path === gitBash || path === pathBash;
            },
        });

        const foundPathBash = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                PATH: "C:\\Tools\\bin",
            },
            pathExists(path) {
                return path === pathBash;
            },
        });

        expect(foundGitBash).toBe(gitBash);
        expect(foundPathBash).toBe("bash.exe");
    });

    it("Windows bash 解析支持 Scoop 用户级 Git 安装路径", () => {
        const scoopBash = "C:\\Users\\Ada\\scoop\\apps\\git\\current\\bin\\bash.exe";

        const found = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                USERPROFILE: "C:\\Users\\Ada",
                PATH: "",
            },
            pathExists(path) {
                return path === scoopBash;
            },
        });

        expect(found).toBe(scoopBash);
    });

    it("基础工具 description 对齐 Pi 风格工具选择规则", () => {
        const read = mustTool("read", harness);
        const write = mustTool("write", harness);
        const edit = mustTool("edit", harness);
        const applyPatch = mustTool("apply_patch", harness);
        const bash = mustTool("bash", harness);

        expect(read.description).toContain("Images are sent as attachments");
        expect(read.description).toContain("continue with offset until complete");
        expect(read.description).toContain("instead of cat/head/tail/sed");
        expect(write.description).toContain("new files or complete rewrites");
        expect(edit.description).toContain("one edit call with multiple entries in edits[]");
        expect(edit.description).toContain("matched against the original file");
        expect(edit.description).toContain("small as possible while still unique");
        expect(applyPatch.description).toContain("verified patch");
        expect(applyPatch.description).toContain("prefer one edit call");
        expect(bash.description).toContain("current Project Workspace");
        expect(bash.description).toContain("agent bin directories are prepended to PATH");
        expect(bash.description).toContain("workspace node");
        expect(bash.description).toContain("Prefer / path separators");
        expect(bash.description).toContain("quote Windows backslash paths");
        expect(bash.description).toContain("stdout and stderr merged");
        expect(bash.description).toContain("rg/find/ls/git/tests/build/workspace CLI");
        expect(bash.description).toContain("not for file reading or editing");
    });
});

function patchInput(lines: string[]): {patch: string} {
    return {patch: lines.join("\n")};
}

function mustTool(key: string, harness: NeuroAgentHarness) {
    const tool = harness.tools.get(key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing tool ${key}`);
    }
    return tool;
}

/** 创建只在当前用例内存活的 Attachment Adapter。 */
function memoryAttachmentAdapter(): AttachmentBlobAdapter {
    const values = new Map<string, Uint8Array>();
    return {
        async put(key, bytes) {
            values.set(key, bytes.slice());
        },
        async get(key) {
            return values.get(key)?.slice() ?? null;
        },
    };
}

import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createHash, randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import YAML from "yaml";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path"
import {compileProfileArtifacts, ProfileReleaseCommittedButRegistryFailedError, readProfileArtifactManifest, resolveProfileArtifactPathContext, validateProfileArtifact, type ProfileArtifactManifest, type ProfileArtifactManifestItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions, resolveVariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN} from "nbook/server/plot";
import {createWorkspaceContentFrontmatterDefaults, workspaceContentJsonSchema} from "nbook/server/workspace-files/content-node-schema";
import {renderWorkspaceContentTemplate, renderWorkspaceContentTemplateBundle, renderWorkspaceStateTemplate} from "nbook/server/workspace-files/content-node-templates";
import {
    copyNovelDirectoryTemplate,
    readUserAssetsSyncConflictDetail,
    resolveWorkspaceFileTarget,
    setUserAssetsProfileArtifactStagedHookForTest,
    setUserAssetsSyncStateWriteHookForTest,
    syncSystemAssetsToUserAssets,
    USER_ASSETS_WORKSPACE_ROOT,
} from "nbook/server/workspace-files/novel-workspace";
import {createRuntimePaths, runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {
    readProjectManifest as readProjectManifestAtRoot,
    writeProjectManifest as writeProjectManifestAtRoot,
} from "nbook/server/workspace-files/project-workspace";
import {closeWorkspaceTreeIndex, readPlainWorkspaceTreeSnapshot, readProjectWorkspaceTreeSnapshot, subscribeWorkspaceTreeIndex, type ProjectWorkspaceTreeIndexOptions} from "nbook/server/workspace-files/project-workspace-index";
import {PROJECT_FILE_INDEX_MODULE_TOKEN, setProjectFileIndexCommitHookForTest} from "nbook/server/workspace-files/project-file-index";
import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";
import {getSystemWorkspaceAssetContextForTest, resolveSystemNbookRoot, setSystemWorkspaceAssetContextForTest} from "nbook/server/workspace-files/system-workspace-assets";
import {getWorkspaceRuntimeRootContextForTest, resolveRuntimeWorkspaceRoot, resolveUserNbookRoot, setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, withIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/test-workspace-fixture";
import {createWorkspaceContentState, createWorkspaceDirectory, readWorkspaceTextFile, scanWorkspaceTree, validateWorkspaceContentNodes, validateWorkspaceTree, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {activateReadyProjectModule, closeAllProjects, openProject, requireReadyModuleHandle, requireReadyProject} from "nbook/server/workspace-files/project-session";

const execFileAsync = promisify(execFile);

/** 测试Adapter：把单段 Project root 投影到当前隔离 Workspace Root。 */
function readProjectManifest(projectRoot: string): ReturnType<typeof readProjectManifestAtRoot> {
    return readProjectManifestAtRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot));
}

/** 测试Adapter：把单段 Project root 投影到当前隔离 Workspace Root。 */
function writeProjectManifest(
    projectRoot: string,
    manifest: Parameters<typeof writeProjectManifestAtRoot>[2],
): ReturnType<typeof writeProjectManifestAtRoot> {
    return writeProjectManifestAtRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot), manifest);
}

describe("workspace-files", {timeout: 60_000}, () => {
    let root: AbsoluteFsPath;
    let assets: IsolatedWorkspaceAssets;

    // system assets 的编译已上移到 vitest globalSetup 的 run 级共享 snapshot，
    // 这里不再 per-file 复制并编译一份完整 `.nbook`。
    beforeEach(async () => {
        assets = await createIsolatedWorkspaceAssets({useAsCwd: true});
        root = absoluteFsPath(testHostPath("workspace-files-test", randomUUID()));
        await fs.mkdir(root, {recursive: true});
    }, 60_000);

    afterEach(async () => {
        setUserAssetsSyncStateWriteHookForTest(null);
        setUserAssetsProfileArtifactStagedHookForTest(null);
        setProjectFileIndexCommitHookForTest(null);
        try {
            await closeAllProjects();
            await closeWorkspaceTreeIndex(root);
            await fs.rm(root, {recursive: true, force: true});
        } finally {
            // dispose 内部已聚合错误并保证最终 rm(root)，这里只保证它一定被调用。
            await assets.dispose();
        }
    }, 60_000);

    it("隔离 Workspace assets context 支持嵌套恢复", async () => {
        const outerSystemRoot = assets.systemNbookRoot;
        const outerUserRoot = assets.userNbookRoot;
        const innerAssets = await createIsolatedWorkspaceAssets({useAsCwd: true});
        try {
            expect(resolveSystemNbookRoot()).toBe(innerAssets.systemNbookRoot);
            expect(resolveUserNbookRoot()).toBe(innerAssets.userNbookRoot);
        } finally {
            await innerAssets.dispose();
        }

        expect(resolveSystemNbookRoot()).toBe(outerSystemRoot);
        expect(resolveUserNbookRoot()).toBe(outerUserRoot);
    });

    it("隔离 Workspace assets 清理失败时仍先恢复 cwd 与 context", async () => {
        const outerCwd = process.cwd();
        const outerSystemRoot = assets.systemNbookRoot;
        const outerUserRoot = assets.userNbookRoot;
        const innerAssets = await createIsolatedWorkspaceAssets({useAsCwd: true});

        await innerAssets.dispose();
        await expect(innerAssets.dispose()).rejects.toThrow("Workspace fixture 销毁存在失败项");

        expect(process.cwd()).toBe(outerCwd);
        expect(resolveSystemNbookRoot()).toBe(outerSystemRoot);
        expect(resolveUserNbookRoot()).toBe(outerUserRoot);
    });

    it("允许 lorebook 使用目录 index.md 表达嵌套设定节点", async () => {
        await writeMarkdown("lorebook/location/city-a/index.md", {
            type: "location",
            status: "active",
        });
        await writeMarkdown("lorebook/location/city-a/building-a/index.md", {
            type: "item",
            status: "draft",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("允许 lorebook 使用 faction 表达势力内容节点", async () => {
        await writeMarkdown("lorebook/faction/sky-court/index.md", {
            type: "faction",
            status: "draft",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("允许 lorebook 使用 instruction 表达作品级 AI 使用说明", async () => {
        await writeMarkdown("lorebook/instruction/creation-boundaries/index.md", {
            type: "instruction",
            status: "draft",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("拒绝非法 lorebook 类型", async () => {
        await writeMarkdown("lorebook/location/foo/index.md", {
            type: "building",
            status: "active",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P2",
                code: "invalid-type",
            }),
        ]));
    });

    it("推断 manuscript 顶层目录节点为 volume，更深层目录节点为 chapter", async () => {
        await writeMarkdown("manuscript/001-volume/index.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/001-volume/001-chapter/index.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/001-volume/001-chapter/draft.md", {
            type: "research-note",
            status: "draft",
        });

        const nodes = await scanWorkspaceTree({root, targets: ["manuscript"]});
        const issues = await validateWorkspaceTree({root, targets: ["manuscript"]});

        expect(nodes.find((node) => node.path === "manuscript/001-volume/")?.entryType).toBe("volume");
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/")?.entryType).toBe("chapter");
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/draft.md")?.contentNode).toBe(false);
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/draft.md")?.entryType).toBeNull();
        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("只在内容根内拒绝同级文件 stem 与目录同名", async () => {
        await writeMarkdown("manuscript/foo.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/foo/index.md", {
            status: "draft",
        });
        await writeMarkdown("docs/foo.md", {
            type: "note",
        });
        await writeMarkdown("docs/foo/index.md", {
            type: "note",
        });

        const issues = await validateWorkspaceTree({root});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P1",
                code: "content-sibling-name-conflict",
                path: "manuscript/foo.md",
            }),
        ]));
        expect(issues.some((issue) => issue.path === "docs/foo.md" && issue.code === "content-sibling-name-conflict")).toBe(false);
    });

    it("Project Workspace tree snapshot 会返回 issues 和节点问题摘要", async () => {
        await writeMarkdown("lorebook/note/project-profile/index.md", {
            type: "note",
            status: "draft",
        });

        const snapshot = await readProjectWorkspaceTreeSnapshot(await projectIndexOptions());
        const node = snapshot.nodes.find((item) => item.path === "lorebook/note/project-profile/");

        expect(snapshot.revision).toBeGreaterThan(0);
        expect(snapshot.validatedAt).toBeTruthy();
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "missing-frontmatter-field",
                path: "lorebook/note/project-profile/",
            }),
        ]));
        expect(node?.issueSummary?.selfCount).toBeGreaterThan(0);
    });

    it("plain workspace tree snapshot 不运行 Project Workspace Issue Index", async () => {
        await writeMarkdown("lorebook/note/project-profile/index.md", {
            type: "note",
            status: "draft",
        });

        const snapshot = await readPlainWorkspaceTreeSnapshot({target: plainIndexTarget()});

        expect(snapshot.nodes.length).toBeGreaterThan(0);
        expect(snapshot.issues).toEqual([]);
    });

    it("Project Workspace mutation 后会重新读取文件与 issues", async () => {
        const options = await projectIndexOptions();
        const before = await readProjectWorkspaceTreeSnapshot(options);
        await options.fileIndex.mutate(() => writeMarkdown("lorebook/note/cache-refresh/index.md", {
            type: "note",
            status: "draft",
        }));
        const after = await readProjectWorkspaceTreeSnapshot(options);

        expect(before.nodes.some((node) => node.path === "lorebook/note/cache-refresh/")).toBe(false);
        expect(after.nodes.some((node) => node.path === "lorebook/note/cache-refresh/")).toBe(true);
        expect(after.revision).toBeGreaterThan(before.revision);
        expect(after.issues.some((issue) => issue.path === "lorebook/note/cache-refresh/")).toBe(true);
    });

    it("Project Workspace tree index 会 watch 外部新增文件并自动更新缓存", async () => {
        const before = await readProjectWorkspaceTreeSnapshot(await projectIndexOptions());
        await fs.mkdir(path.join(root, "reference", "silly-tavern"), {recursive: true});
        await fs.writeFile(path.join(root, "reference", "silly-tavern", "cache-refresh.md"), "外部导入素材\n", "utf-8");

        const refreshed = await waitForProjectWorkspaceTreePath("reference/silly-tavern/cache-refresh.md");

        expect(before.nodes.some((node) => node.path === "reference/silly-tavern/cache-refresh.md")).toBe(false);
        expect(refreshed.nodes.some((node) => node.path === "reference/silly-tavern/cache-refresh.md")).toBe(true);
        expect(refreshed.revision).toBeGreaterThan(before.revision);
    });

    it("Project Workspace mutation 会通过同一套 index 重建缓存", async () => {
        const options = await projectIndexOptions();
        const before = await readProjectWorkspaceTreeSnapshot(options);
        await options.fileIndex.mutate(() => writeMarkdown("lorebook/note/mutation-rebuild/index.md", {
            type: "note",
            status: "draft",
        }));
        const refreshed = await waitForProjectWorkspaceTreePath("lorebook/note/mutation-rebuild/");

        expect(before.nodes.some((node) => node.path === "lorebook/note/mutation-rebuild/")).toBe(false);
        expect(refreshed.nodes.some((node) => node.path === "lorebook/note/mutation-rebuild/")).toBe(true);
        expect(refreshed.revision).toBeGreaterThan(before.revision);
    });

    it("user-assets tree index 会 watch 外部新增文件且保持 issues 为空", async () => {
        const target = plainIndexTarget();
        const before = await readPlainWorkspaceTreeSnapshot({target});
        const events: string[] = [];
        const unsubscribe = await subscribeWorkspaceTreeIndex({target}, (event) => {
            events.push(event.type);
        });

        try {
            await vi.waitFor(() => {
                expect(events).toContain("workspace_watch_ready");
            }, {timeout: 4000});
            await fs.mkdir(path.join(root, "templates"), {recursive: true});
            await fs.writeFile(path.join(root, "templates", "user-template.md"), "# 用户模板\n", "utf-8");

            const refreshed = await waitForPlainWorkspaceTreePath("templates/user-template.md");

            expect(before.nodes.some((node) => node.path === "templates/user-template.md")).toBe(false);
            expect(refreshed.nodes.some((node) => node.path === "templates/user-template.md")).toBe(true);
            expect(refreshed.issues).toEqual([]);
            expect(refreshed.revision).toBeGreaterThan(before.revision);
        } finally {
            unsubscribe();
        }
    });

    it("project.yaml 格式错误时仍允许解析 Project Workspace 根目录", async () => {
        const projectRoot = `workspace-files-test-${randomUUID()}`;
        const projectDirectory = path.join(resolveRuntimeWorkspaceRoot(), projectRoot);

        try {
            await fs.mkdir(projectDirectory, {recursive: true});
            await fs.writeFile(path.join(projectDirectory, "project.yaml"), "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n", "utf-8");

            const testRuntimePaths = createRuntimePaths({
                applicationRoot: absoluteFsPath(assets.applicationRoot),
                stateRoot: absoluteFsPath(assets.root),
            });
            await expect(resolveWorkspaceFileTarget(testRuntimePaths, {projectRoot})).resolves.toEqual({
                kind: "project-workspace",
                root: path.resolve(projectDirectory),
                projectRoot,
            });
        } finally {
            await removeDirectoryWithRetry(projectDirectory);
        }
    });

    it("ProjectSession open 会备份并静默修复损坏 manifest 后再建立 File Index", async () => {
        const corruptManifest = "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n";
        await fs.writeFile(path.join(root, "project.yaml"), corruptManifest, "utf-8");

        const snapshot = await readProjectWorkspaceTreeSnapshot(await projectIndexOptions());
        const repairedManifest = YAML.parse(await fs.readFile(path.join(root, "project.yaml"), "utf-8"));
        const recoveryRoot = path.join(root, ".nbook", "recovery");
        const recoveryFiles = await fs.readdir(recoveryRoot);
        const manifestBackup = recoveryFiles.find((fileName) => /^project-manifest-.+\.yaml$/u.test(fileName));

        expect(snapshot.nodes.some((node) => node.path === "project.yaml")).toBe(true);
        expect(snapshot.issues.some((issue) => issue.code === "invalid-project-manifest")).toBe(false);
        expect(repairedManifest).toMatchObject({kind: "novel", title: expect.any(String), summary: ""});
        expect(manifestBackup).toBeDefined();
        expect(await fs.readFile(path.join(recoveryRoot, manifestBackup!), "utf-8")).toBe(corruptManifest);
    });

    it("解析结构化 refs 和 inline 引用中的相对路径", async () => {
        await writeMarkdown("lorebook/location/city/index.md", {
            type: "location",
            status: "active",
        });
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "draft",
            refs: [
                {
                    relation: "origin",
                    target: "../../location/city/",
                    note: "角色出生地",
                },
            ],
        }, "正文引用 [城市](../../location/city/)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "missing-ref" || issue.code === "legacy-ref")).toEqual([]);
    });

    it("支持 Project-relative、Markdown-relative 和当前 Project 内绝对路径引用", async () => {
        await writeMarkdown("manual/reference.md", {}, "普通文件");
        await writeMarkdown("lorebook/location/city/index.md", {
            type: "location",
            status: "active",
        });
        const absoluteCityPath = path.resolve(root, "lorebook/location/city").replace(/\\/g, "/");
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "draft",
            refs: [
                {
                    relation: "origin",
                    target: "lorebook/location/city/",
                    note: "Project-relative 内容节点引用",
                },
                {
                    relation: "manual",
                    target: "../../../manual/reference.md",
                    note: "Markdown-relative 普通文件引用",
                },
                {
                    relation: "absolute",
                    target: absoluteCityPath,
                    note: "当前 Project 内绝对路径引用",
                },
            ],
        }, `正文引用 [城市](lorebook/location/city/)、[手册](../../../manual/reference.md) 和 [绝对路径城市](${absoluteCityPath})。`);

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "missing-ref" || issue.code === "invalid-ref")).toEqual([]);
    });

    it("不会把 Markdown 图片路径当作工作区引用校验", async () => {
        await writeMarkdown("lorebook/location/city/index.md", {
            type: "location",
            status: "active",
        }, "封面图 ![城市](assets/city.png)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.some((issue) => issue.code === "missing-ref" && issue.message.includes("assets/city.png"))).toBe(false);
    });

    it("把旧引用协议报为解析错误，并报告 deprecated 状态和 ext.character", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "deprecated",
            ext: {
                character: {
                    logline: "旧角色字段",
                },
            },
        }, "旧引用 [城市](lorebook://location/city)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({level: "P1", code: "invalid-ref"}),
            expect.objectContaining({level: "P2", code: "legacy-status"}),
            expect.objectContaining({level: "P2", code: "legacy-ext-character"}),
        ]));
    });

    it("非递归校验接受根外内容节点并报告警告", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "draft",
        });
        await writeMarkdown("docs/foo/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "普通内容节点",
            type: "note",
            status: "draft",
        }));

        const fileTarget = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero/index.md"]});
        const externalNode = await validateWorkspaceContentNodes({root, targets: ["docs/foo"]});
        const recursive = await validateWorkspaceContentNodes({root, targets: ["lorebook"], recursive: true});

        expect(fileTarget.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "invalid-content-node-target"}),
        ]));
        expect(externalNode.issues).toEqual([
            expect.objectContaining({
                level: "WARN",
                code: "external-content-node",
                path: "docs/foo/",
            }),
        ]);
        expect(recursive.issues.some((issue) => issue.code === "invalid-content-node-target")).toBe(false);
    });

    it("fixMissing 会补齐 nullable 字段并保留正文", async () => {
        await writeMarkdown("lorebook/note/question/index.md", {
            title: "主角地球死亡原因",
            type: "note",
            status: "pending",
            refs: [
                {
                    relation: "mentions",
                    target: "../other/",
                },
            ],
        }, "意外？谋杀？还是灵魂牵引的副作用？");

        const before = await validateWorkspaceContentNodes({root, targets: ["lorebook/note/question"]});
        const fixed = await validateWorkspaceContentNodes({
            root,
            targets: ["lorebook/note/question"],
            fixMissing: true,
        });
        const content = await fs.readFile(path.join(root, "lorebook/note/question/index.md"), "utf-8");

        expect(before.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing-frontmatter-field"}),
        ]));
        expect(fixed.fixedPaths).toEqual(["lorebook/note/question/index.md"]);
        expect(fixed.issues.some((issue) => issue.code === "missing-frontmatter-field")).toBe(false);
        expect(content).toContain("subtype: null");
        expect(content).toContain("icon: null");
        expect(content).not.toContain("writingTip:");
        expect(content).toContain("note: null");
        expect(content).toContain("意外？谋杀？还是灵魂牵引的副作用？");
    });

    it("解析并校验内容节点 state.md 当前状态", async () => {
        await writeMarkdown("lorebook/character/A/index.md", {
            type: "character",
            status: "active",
        });
        await writeMarkdown("lorebook/character/B/index.md", {
            type: "character",
            status: "active",
        });
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            statusNote: "已经知道凶手身份，但没有公开证据。",
            updatedAt: "chapter-1",
            knowledge: [
                "所有王国公民都知道的常识。",
                "这是王国禁忌绝学，只有王室成员有资格学，[角色A](lorebook/character/A)什么时候偷学了。",
                "[皇室成员B](lorebook/character/B)在成年的时候选择学习。",
            ],
        }, "当前状态说明");

        const nodes = await scanWorkspaceTree({root, targets: ["lorebook/character/hero"]});
        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});
        const hero = nodes.find((node) => node.path === "lorebook/character/hero/");

        expect(hero?.state?.path).toBe("lorebook/character/hero/state.md");
        expect(hero?.state?.words).toBe("当前状态说明".length);
        expect(result.issues.filter((issue) => issue.path.includes("state.md"))).toEqual([]);
    });

    it("报告 state.md 信息差字符串中的引用断链", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            knowledge: [
                "主角怀疑[失踪线索](lorebook/note/missing/)与皇宫有关。",
            ],
        });

        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P1",
                code: "missing-ref",
                path: "lorebook/character/hero/state.md",
            }),
        ]));
    });

    it("拒绝旧对象式 state.md knowledge", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            knowledge: [
                {
                    info: "lorebook/note/secret/",
                    subject: "lorebook/character/hero/",
                    status: "known",
                    note: null,
                },
            ],
        });

        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P2",
                code: "invalid-state-field",
                path: "lorebook/character/hero/state.md",
            }),
        ]));
    });

    it("内容节点 schema 由 Zod 生成并保留字段描述", () => {
        const factionSchema = workspaceContentJsonSchema("faction");
        const schema = workspaceContentJsonSchema("character");
        const factionProperties = factionSchema.properties as Record<string, Record<string, unknown>>;
        const properties = schema.properties as Record<string, Record<string, unknown>>;

        expect(factionProperties.type.default).toBe("faction");
        expect(properties.title.description).toContain("内容节点显示标题");
        expect(properties.status.default).toBe("draft");
        expect((properties.retrieval.properties as Record<string, Record<string, unknown>>).trigger.description).toContain("自然语言触发条件");
        expect(properties.inject).toBeUndefined();
        expect(properties.tags.description).toContain("中文短标签");
        expect(properties.tags.description).toContain("不要为了填字段随意设置标签");
        expect(factionProperties.character).toBeUndefined();
        expect(properties.character).toBeUndefined();
    });

    it("角色内容节点模板包含 frontmatter 注释与正文结构", async () => {
        await withSystemTemplate("templates/content-node-templates/character/index.md", () => {
            const content = renderWorkspaceContentTemplate({
                title: "苏雪",
                type: "character",
                status: "draft",
            });

            expect(content).toContain("title: 苏雪");
            expect(content).toContain("status: draft # 内容节点状态");
            expect(content).toContain("retrieval:");
            expect(content).toContain("enabled: true");
            expect(content).not.toContain("inject:");
            expect(content).not.toContain("profiles: []");
            expect(content).toContain("## 概要");
            expect(content).toContain("## 角色定义");
            expect(content).toContain("## 角色画像");
            expect(content).toContain("## 动机与矛盾");
            expect(content).toContain("## 关系与角色弧");
            expect(content).not.toContain("character:");
            expect(content).not.toContain("writingTip:");
            expect(content).not.toContain("## 写作注意");
        });
    });

    it("势力内容节点模板包含 frontmatter 注释与当前状态结构", () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "天穹议会",
            type: "faction",
            status: "draft",
        }, true);

        expect(bundle.indexContent).toContain("title: 天穹议会");
        expect(bundle.indexContent).toContain("type: faction");
        expect(bundle.indexContent).toContain("tags: [] # 中文短标签");
        expect(bundle.indexContent).toContain("## 势力设定");
        expect(bundle.indexContent).toContain("## 资源与影响力");
        expect(bundle.indexContent).toContain("## 关系网络");
        expect(bundle.stateContent).toContain("knowledge: []");
        expect(bundle.stateContent).toContain("## 当前目标");
        expect(bundle.stateContent).toContain("## 冲突与压力");
    });

    it("内容节点模板支持目录格式和可选 state.md", () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "苏雪",
            type: "character",
            status: "draft",
        }, true);

        expect(bundle.indexContent).toContain("title: 苏雪");
        expect(bundle.indexContent).toContain("type: character");
        expect(bundle.stateContent).toContain("knowledge: []");
        expect(renderWorkspaceStateTemplate({
            title: "银色短剑",
            type: "item",
            status: "active",
        })).toContain("## 持有者或位置");
        expect(() => renderWorkspaceStateTemplate({
            title: "王国禁令",
            type: "rule",
            status: "draft",
        })).toThrow("暂无 state.md 模板");
    });

    it("用户 assets 可以按文件覆盖内容节点模板", async () => {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "content-node-templates", "character", "index.md");
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, [
            "---",
            "title: \"{{title}}\"",
            "type: character",
            "status: \"{{status}}\"",
            "---",
            "",
            "## 用户覆盖模板",
        ].join("\n"), "utf-8");

        try {
            const content = renderWorkspaceContentTemplate({
                title: "苏雪",
                type: "character",
                status: "draft",
            });

            expect(content).toContain("## 用户覆盖模板");
            expect(content).toContain("title: 苏雪");
            expect(content).toContain("status: draft");
            expect(content).not.toContain("## 角色定义");
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    });

    it("同步系统 assets 会补齐默认 leader profile 覆盖文件", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const staleArtifactPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "old-hash-artifact.mjs");
        const staleTypePath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "old-hash-artifact.types.d.ts");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const staleArtifactBackup = await backupOptionalFile(staleArtifactPath);
        const staleTypeBackup = await backupOptionalFile(staleTypePath);
        await fs.rm(userProfilePath, {force: true});
        await fs.mkdir(path.dirname(staleArtifactPath), {recursive: true});
        await fs.writeFile(staleArtifactPath, "export default {};\n", "utf-8");
        await fs.writeFile(staleTypePath, "export {};\n", "utf-8");

        try {
            const result = await syncSystemAssetsToUserAssets();
            const content = await fs.readFile(userProfilePath, "utf-8");
            const systemContent = await fs.readFile(systemProfilePath, "utf-8");

            expect(result.updatedProfiles).toBeGreaterThan(0);
            expect(content).toBe(systemContent);
            expect(content).toContain("profileManifest");
            expect(content).toContain("export default");
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx");
            expect(item?.sourceSha256).toBe(await sha256ForTest(userProfilePath));
            expect(item?.dependencies.find((dependency) => dependency.path === "workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx")?.sha256).toBe(item?.sourceSha256);
            expect(item?.typeFileName).toMatch(/types\.d\.ts$/);
            expect(await sha256ForTest(profileArtifactPath("workspace", item!))).toBe(item!.artifactSha256);
            await expect(fs.readFile(profileTypeArtifactPath("workspace", item!), "utf-8")).resolves.toContain("ProfileVariableValueMap");
            await expect(fs.access(staleArtifactPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(staleTypePath)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
            await restoreOptionalFile(staleArtifactPath, staleArtifactBackup);
            await restoreOptionalFile(staleTypePath, staleTypeBackup);
        }
    });

    it("测试隔离 root 写入 user-assets 不触碰真实 workspace .nbook", async () => {
        const fileName = `codex-isolation-${randomUUID()}.profile.tsx`;
        const realProfilePath = path.join(assets.applicationRoot, "workspace", ".nbook", "agent", "profiles", fileName);
        const isolatedProfilePath = path.join("workspace", ".nbook", "agent", "profiles", fileName);
        const isolatedSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");

        await expect(fs.access(realProfilePath)).rejects.toMatchObject({code: "ENOENT"});
        await fs.mkdir(path.dirname(isolatedProfilePath), {recursive: true});
        await fs.writeFile(isolatedProfilePath, "export const profileManifest = { key: \"codex.isolation\", name: \"Isolation\" } as const;\n", "utf-8");
        await fs.writeFile(isolatedSyncStatePath, JSON.stringify({profiles: [], assets: []}, null, 2), "utf-8");

        await expect(fs.access(isolatedProfilePath)).resolves.toBeUndefined();
        await expect(fs.access(isolatedSyncStatePath)).resolves.toBeUndefined();
        await expect(fs.access(realProfilePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("同步系统 assets 会修复用户 profile manifest 与 artifact 不一致", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.copyFile(systemProfilePath, userProfilePath);
            await syncSystemAssetsToUserAssets();
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;
            await fs.writeFile(profileArtifactPath("workspace", item), "export default {};\n", "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const nextManifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const nextItem = nextManifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;

            expect(result.profileWarnings?.some((warning) => warning.fileName === "builtin/leader.default.profile.tsx")).toBe(false);
            expect(await sha256ForTest(profileArtifactPath("workspace", nextItem))).toBe(nextItem.artifactSha256);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 120000);

    it("运行时同步 user profile assets 只发布一次并同步翻转 Registry", async () => {
        const fileNames = [
            "builtin/leader.default.profile.tsx",
            "builtin/leader.assets.profile.tsx",
        ];
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const profileBackups = await Promise.all(fileNames.map((fileName) => backupOptionalFile(path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/")))));
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const registryCalls: ProfileArtifactManifest[] = [];
        const registry = {
            publishProfileRelease(_profileRoot: string, manifest: ProfileArtifactManifest): void {
                registryCalls.push(manifest);
            },
        };

        try {
            for (const fileName of fileNames) {
                const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
                const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
                await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
                await fs.copyFile(systemProfilePath, userProfilePath);
            }
            await fs.writeFile(userSyncStatePath, JSON.stringify({profiles: [], assets: []}, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets({
                profileRelease: {
                    mode: "in_process",
                    registry,
                },
            });

            expect(result.profileWarnings?.filter((warning) => fileNames.includes(warning.fileName))).toEqual([]);
            expect(registryCalls).toHaveLength(1);
            expect(registryCalls[0]!.entries.map((entry) => entry.fileName)).toEqual(expect.arrayContaining(fileNames));
        } finally {
            await Promise.all(fileNames.map((fileName, index) => restoreOptionalFile(path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/")), profileBackups[index]!)));
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
        }
    }, 120000);

    it("user profile patch 发布成功后 sync state 写失败不会回滚源码", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const profileBackup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const oldSource = "export const profileManifest = { key: \"leader.default\", name: \"Old Leader\" } as const;\n";
        let profileRegistryPublished = false;
        setUserAssetsSyncStateWriteHookForTest(async () => {
            const [userSource, systemSource] = await Promise.all([
                fs.readFile(userProfilePath, "utf-8").catch(() => ""),
                fs.readFile(systemProfilePath, "utf-8"),
            ]);
            if (userSource === systemSource) {
                throw new Error("sync state denied");
            }
        });
        const registry = {
            publishProfileRelease(_profileRoot: string, manifest: ProfileArtifactManifest): void {
                if (manifest.entries.some((entry) => entry.fileName === fileName)) {
                    profileRegistryPublished = true;
                }
            },
        };

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, oldSource, "utf-8");
            const oldHash = await sha256AndBytesForTest(userProfilePath);
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.default",
                    upstreamHash: "old-upstream",
                    lastSyncedUserHash: oldHash.sha256,
                    syncedAt: "2026-01-01T00:00:00.000Z",
                }],
                assets: [],
            }, null, 2), "utf-8");

            await expect(syncSystemAssetsToUserAssets({
                profileRelease: {
                    mode: "in_process",
                    registry,
                },
            })).rejects.toThrow("sync state denied");

            const [userSource, systemSource] = await Promise.all([
                fs.readFile(userProfilePath, "utf-8"),
                fs.readFile(systemProfilePath, "utf-8"),
            ]);
            const userHash = await sha256AndBytesForTest(userProfilePath);
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === fileName)!;

            expect(profileRegistryPublished).toBe(true);
            expect(userSource).toBe(systemSource);
            expect(item.sourceSha256).toBe(userHash.sha256);
            expect(item.sourceBytes).toBe(userHash.bytes);
        } finally {
            setUserAssetsSyncStateWriteHookForTest(null);
            await restoreOptionalFile(userProfilePath, profileBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 120000);

    it("user profile patch 磁盘发布后 Registry 失败不会回滚源码", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const profileBackup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const oldSource = "export const profileManifest = { key: \"leader.default\", name: \"Old Leader\" } as const;\n";
        let registryAttempts = 0;
        const registry = {
            publishProfileRelease(): void {
                registryAttempts += 1;
                throw new Error("registry denied");
            },
        };

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, oldSource, "utf-8");
            const oldHash = await sha256AndBytesForTest(userProfilePath);
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.default",
                    upstreamHash: "old-upstream",
                    lastSyncedUserHash: oldHash.sha256,
                    syncedAt: "2026-01-01T00:00:00.000Z",
                }],
                assets: [],
            }, null, 2), "utf-8");

            await expect(syncSystemAssetsToUserAssets({
                profileRelease: {
                    mode: "in_process",
                    registry,
                },
            })).rejects.toBeInstanceOf(ProfileReleaseCommittedButRegistryFailedError);

            const [userSource, systemSource] = await Promise.all([
                fs.readFile(userProfilePath, "utf-8"),
                fs.readFile(systemProfilePath, "utf-8"),
            ]);
            const userHash = await sha256AndBytesForTest(userProfilePath);
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === fileName)!;

            expect(registryAttempts).toBe(2);
            expect(userSource).toBe(systemSource);
            expect(item.sourceSha256).toBe(userHash.sha256);
            expect(item.sourceBytes).toBe(userHash.bytes);
        } finally {
            await restoreOptionalFile(userProfilePath, profileBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 120000);

    it("user profile patch 发布前源码变化会放弃发布并回滚本轮源码替换", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const profileBackup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const oldSource = "export const profileManifest = { key: \"leader.default\", name: \"Old Leader\" } as const;\n";
        const externalSource = "export const profileManifest = { key: \"leader.default\", name: \"External Edit\" } as const;\n";
        let sourceMutated = false;
        let profileRegistryPublished = false;
        setUserAssetsProfileArtifactStagedHookForTest(async (stagedFileName) => {
            if (!sourceMutated && stagedFileName === fileName) {
                sourceMutated = true;
                await fs.writeFile(userProfilePath, externalSource, "utf-8");
            }
        });
        const registry = {
            publishProfileRelease(): void {
                profileRegistryPublished = true;
            },
        };

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, oldSource, "utf-8");
            const oldHash = await sha256AndBytesForTest(userProfilePath);
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.default",
                    upstreamHash: "old-upstream",
                    lastSyncedUserHash: oldHash.sha256,
                    syncedAt: "2026-01-01T00:00:00.000Z",
                }],
                assets: [],
            }, null, 2), "utf-8");

            await expect(syncSystemAssetsToUserAssets({
                profileRelease: {
                    mode: "in_process",
                    registry,
                },
            })).rejects.toThrow("同步发布前源码又发生变化");

            const userSource = await fs.readFile(userProfilePath, "utf-8");
            const syncState = JSON.parse(await fs.readFile(userSyncStatePath, "utf-8")) as {
                profiles?: Array<{fileName: string; lastSyncedUserHash: string}>;
            };
            const stateItem = syncState.profiles?.find((profile) => profile.fileName === fileName);

            expect(sourceMutated).toBe(true);
            expect(profileRegistryPublished).toBe(false);
            expect(userSource).toBe(oldSource);
            expect(stateItem?.lastSyncedUserHash).toBe(oldHash.sha256);
        } finally {
            setUserAssetsProfileArtifactStagedHookForTest(null);
            await restoreOptionalFile(userProfilePath, profileBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 120000);

    it("同步系统 assets 会修复用户 profile manifest 指向 building artifact", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const buildingArtifactPath = path.join(userCompiledRoot, "builtin__leader.default.fake.building.mjs");

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.copyFile(systemProfilePath, userProfilePath);
            await syncSystemAssetsToUserAssets();
            await fs.writeFile(buildingArtifactPath, "export default {};\n", "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const nextManifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const nextItem = nextManifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;

            expect(result.profileWarnings?.some((warning) => warning.fileName === "builtin/leader.default.profile.tsx")).toBe(false);
            expect(nextItem.artifactFileName).toMatch(/^artifacts\/[a-f0-9]{64}\.mjs$/);
            expect(await sha256ForTest(profileArtifactPath("workspace", nextItem))).toBe(nextItem.artifactSha256);
            await expect(fs.access(buildingArtifactPath)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
            await fs.rm(buildingArtifactPath, {force: true});
        }
    }, 180_000);

    it("同步系统 assets 不覆盖已手改用户 profile artifact", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.copyFile(systemProfilePath, userProfilePath);
            await syncSystemAssetsToUserAssets();
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;
            const artifactPath = profileArtifactPath("workspace", item);
            await fs.appendFile(userProfilePath, "\n// user custom change\n", "utf-8");
            await fs.writeFile(artifactPath, "export default { custom: true };\n", "utf-8");
            const beforeArtifact = await fs.readFile(artifactPath, "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.profileWarnings?.some((warning) => warning.fileName === "builtin/leader.default.profile.tsx")).toBe(false);
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toContain("user custom change");
            await expect(fs.readFile(artifactPath, "utf-8")).resolves.toBe(beforeArtifact);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 180_000);

    it("系统 profile 更新且用户覆盖已手改时会返回可查看 diff 的 warning", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const syncedContent = await fs.readFile(systemProfilePath, "utf-8");
        const syncedHash = createHash("sha256").update(syncedContent).digest("hex");

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, `${syncedContent}\n// user custom change\n`, "utf-8");
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.default",
                    upstreamHash: "old-upstream-hash",
                    lastSyncedUserHash: syncedHash,
                    syncedAt: new Date(0).toISOString(),
                }],
                assets: [],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.profileWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({fileName, profileKey: "leader.default"}),
            ]));
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toContain("user custom change");
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 30000);

    it("强制同步系统 assets 会覆盖已手改用户 profile 并刷新 compiled artifact", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const profileBackup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.copyFile(systemProfilePath, userProfilePath);
            await syncSystemAssetsToUserAssets();
            const manifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const item = manifest.profiles.find((profile) => profile.fileName === fileName)!;
            const artifactPath = profileArtifactPath("workspace", item);
            await fs.appendFile(userProfilePath, "\n// user custom change before force sync\n", "utf-8");
            await fs.writeFile(artifactPath, "export default { custom: true };\n", "utf-8");

            const result = await syncSystemAssetsToUserAssets({force: true});
            const nextManifest = await readProfileArtifactManifest(path.join("workspace", ".nbook", "agent", "profiles"));
            const nextItem = nextManifest.profiles.find((profile) => profile.fileName === fileName)!;

            expect(result.updatedProfiles).toBeGreaterThanOrEqual(1);
            expect(result.profileWarnings?.some((warning) => warning.fileName === fileName)).toBe(false);
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toBe(await fs.readFile(systemProfilePath, "utf-8"));
            expect(await sha256ForTest(profileArtifactPath("workspace", nextItem))).toBe(nextItem.artifactSha256);
        } finally {
            await restoreOptionalFile(userProfilePath, profileBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    }, 180_000);

    // 该用例会改写 system profile 并触发 system `.compiled` 发布，必须独占一份可写 system assets 副本。
    it("前端同步 preflight 会先刷新过期 system profile manifest", async () => {
        await withIsolatedWorkspaceAssets({useAsCwd: true, systemAssets: "isolated"}, async () => {
            const fileName = "builtin/leader.assets.profile.tsx";
            const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
            const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
            const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
            const originalContent = await fs.readFile(systemProfilePath, "utf-8");
            const originalHash = createHash("sha256").update(originalContent).digest("hex");
            const nextContent = `${originalContent}\n// test system profile preflight marker\n`;

            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, originalContent, "utf-8");
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.assets",
                    upstreamHash: originalHash,
                    lastSyncedUserHash: originalHash,
                    syncedAt: new Date(0).toISOString(),
                }],
                assets: [],
            }, null, 2), "utf-8");
            await fs.writeFile(systemProfilePath, nextContent, "utf-8");

            const result = await prepareSystemAssets({syncUserAssets: true});

            expect(result.profileResult.compiled.map((item) => item.fileName)).toContain(fileName);
            expect(result.userAssetsSync?.updatedProfiles).toBeGreaterThanOrEqual(1);
            expect(result.userAssetsSync?.profileWarnings?.some((warning) => warning.fileName === fileName)).toBe(false);
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toBe(nextContent);
        });
        // 备份/恢复与重新编译已不再需要：可写副本随 fixture dispose 一起消失。
    }, 120000);

    it("可以读取用户 profile 覆盖的系统版本 diff 内容", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await syncSystemAssetsToUserAssets();
            await fs.appendFile(userProfilePath, "\n// user diff detail marker\n", "utf-8");

            const detail = await readUserAssetsSyncConflictDetail({kind: "profile", fileName});

            expect(detail.kind).toBe("profile");
            expect(detail.fileName).toBe(fileName);
            expect(detail.userContent).toContain("user diff detail marker");
            expect(detail.systemContent).toBe(await fs.readFile(systemProfilePath, "utf-8"));
            expect(detail.language).toBe("typescript");
            expect(detail.userSha256).toBe(await sha256ForTest(userProfilePath));
            expect(detail.systemSha256).toBe(await sha256ForTest(systemProfilePath));
            expect(detail.userBytes).toBeGreaterThan(0);
            expect(detail.systemBytes).toBeGreaterThan(0);
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("拒绝读取越界的用户资产同步 diff 路径", async () => {
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "../config.json",
        })).rejects.toThrow("assetPath 不能为空或包含非法片段");
    }, 30000);

    it("拒绝读取黑名单内的用户资产同步 diff 路径", async () => {
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "config.json",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "agent/sessions/1.jsonl",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "agent/profiles/.compiled/manifest.json",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
    }, 30000);

    it("同步系统 assets 会清理用户变量定义旧 compiled artifact", async () => {
        const userVariablePath = path.join("workspace", ".nbook", "agent", "variables", "definitions.ts");
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "manifest.json");
        const staleArtifactPath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "old-hash-definition.mjs");
        const staleTypePath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "old-hash-definition.types.d.ts");
        const variableBackup = await backupOptionalFile(userVariablePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const staleArtifactBackup = await backupOptionalFile(staleArtifactPath);
        const staleTypeBackup = await backupOptionalFile(staleTypePath);
        await fs.rm(userVariablePath, {force: true});
        await fs.mkdir(path.dirname(staleArtifactPath), {recursive: true});
        await fs.writeFile(staleArtifactPath, "export default [];\n", "utf-8");
        await fs.writeFile(staleTypePath, "export {};\n", "utf-8");

        try {
            const result = await syncSystemAssetsToUserAssets();
            expect(result.assetWarnings).toEqual([]);
            const manifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {definitions: Array<{fileName: string; artifactFileName: string; typeFileName?: string}>};
            const item = manifest.definitions.find((definition) => definition.fileName === "definitions.ts");

            expect(result.updatedAssets).toBeGreaterThan(0);
            expect(item?.artifactFileName).toMatch(/^artifacts\/[0-9a-f]{64}\.mjs$/u);
            expect(item?.typeFileName).toMatch(/^artifacts\/[0-9a-f]{64}\.types\.d\.ts$/u);
            await expect(fs.readFile(path.join("workspace", ".nbook", "agent", "variables", ".compiled", ...item!.artifactFileName.split("/")), "utf-8")).resolves.toContain("definitions_default");
            await expect(fs.readFile(path.join("workspace", ".nbook", "agent", "variables", ".compiled", ...item.typeFileName!.split("/")), "utf-8")).resolves.toContain("ProfileVariableValueMap");
            await expect(fs.access(staleArtifactPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(staleTypePath)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userVariablePath, variableBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(staleArtifactPath, staleArtifactBackup);
            await restoreOptionalFile(staleTypePath, staleTypeBackup);
        }
    }, 30000);

    it("可以读取用户变量定义覆盖的系统版本 diff 内容", async () => {
        const assetPath = "agent/variables/definitions.ts";
        const userVariablePath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemVariablePath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const variableBackup = await backupOptionalFile(userVariablePath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);

        try {
            await syncSystemAssetsToUserAssets();
            await fs.appendFile(userVariablePath, "\n// user variable diff marker\n", "utf-8");

            const detail = await readUserAssetsSyncConflictDetail({kind: "asset", assetPath});

            expect(detail.kind).toBe("asset");
            expect(detail.assetPath).toBe(assetPath);
            expect(detail.userContent).toContain("user variable diff marker");
            expect(detail.systemContent).toBe(await fs.readFile(systemVariablePath, "utf-8"));
            expect(detail.language).toBe("typescript");
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userVariablePath, variableBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会补齐 Agent runtime bin 和 config", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "bin", "workspace"),
            path.join("workspace", ".nbook", "agent", "bin", "workspace.cmd"),
            path.join("workspace", ".nbook", "agent", "config", "ripgreprc"),
        ];
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            const result = await syncSystemAssetsToUserAssets();

            expect(result.copied).toBeGreaterThanOrEqual(paths.length);
            await expect(fs.readFile(paths[0]!, "utf-8")).resolves.toContain("server/workspace-files/workspace-command.ts");
            await expect(fs.readFile(paths[1]!, "utf-8")).resolves.toContain("server\\workspace-files\\workspace-command.ts");
            await expect(fs.readFile(paths[2]!, "utf-8")).resolves.toContain("--path-separator=/");
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
        }
    });

    it("同步系统 assets 会补齐 writer 默认 home 资源并记录同步状态", async () => {
        const userPresetPath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "writer.home", "styles", "reborn-villain-loli-magic-girl.first-three-chapters.style.md");
        const userSyncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backup = await backupOptionalFile(userPresetPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        await fs.rm(userPresetPath, {force: true});

        try {
            const result = await syncSystemAssetsToUserAssets();
            const content = await fs.readFile(userPresetPath, "utf-8");
            const syncState = JSON.parse(await fs.readFile(userSyncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};

            expect(result.copied + (result.updatedAssets ?? 0)).toBeGreaterThanOrEqual(1);
            expect(content).toContain("key: reborn-villain-loli-magic-girl.first-three-chapters.style");
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/profiles/builtin/writer.home/styles/reborn-villain-loli-magic-girl.first-three-chapters.style.md"}),
            ]));
        } finally {
            await restoreOptionalFile(userPresetPath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });
    it("Runtime legacy projection 不复制 Agent package，也不覆盖 Install Root ledger 内容", async () => {
        const sourceRoot = path.join(assets.systemNbookRoot);
        const targetRoot = path.join(assets.userNbookRoot);
        const skillPath = path.join(targetRoot, "agent", "skills", "runtime-skill", "SKILL.md");
        const workflowPath = path.join(targetRoot, "agent", "workflows", "runtime-workflow", "workflow.ts");
        const profilePath = path.join(targetRoot, "agent", "profiles", "builtin", "leader.default.profile.tsx");
        await fs.mkdir(path.dirname(skillPath), {recursive: true});
        await fs.mkdir(path.dirname(workflowPath), {recursive: true});
        await fs.mkdir(path.dirname(profilePath), {recursive: true});
        await fs.writeFile(skillPath, "local skill\n", "utf-8");
        await fs.writeFile(workflowPath, "export const local = true;\n", "utf-8");
        await fs.writeFile(profilePath, "local profile\n", "utf-8");
        const result = await syncSystemAssetsToUserAssets({
            sourceNbookRoot: sourceRoot,
            targetNbookRoot: targetRoot,
            syncManagedAssets: true,
            excludeAgentPackages: true,
            syncProfiles: false,
            syncVariableDefinitions: true,
            syncVariableCompiledArtifacts: false,
        });
        expect(result.profileWarnings).toEqual([]);
        await expect(fs.readFile(skillPath, "utf-8")).resolves.toBe("local skill\n");
        await expect(fs.readFile(workflowPath, "utf-8")).resolves.toBe("export const local = true;\n");
        await expect(fs.readFile(profilePath, "utf-8")).resolves.toBe("local profile\n");
    });

    it("同步系统 assets 会保留手改 wrapper，并硬切缺少 sync state 的旧 scripts", async () => {
        const wrapperPaths = [
            path.join("workspace", ".nbook", "agent", "bin", "workspace"),
            path.join("workspace", ".nbook", "agent", "bin", "workspace.cmd"),
        ];
        const legacyScriptPaths = [
            path.join("workspace", ".nbook", "agent", "scripts", "profile.ts"),
            path.join("workspace", ".nbook", "agent", "scripts", "variable.ts"),
            path.join("workspace", ".nbook", "agent", "scripts", "workspace.ts"),
        ];
        const wrapperSentinels = [
            "#!/usr/bin/env sh\necho user-bin-preserved\n",
            "@echo off\necho user-cmd-preserved\n",
        ];
        const legacySentinel = "console.log('old managed script');\n";
        const paths = [...wrapperPaths, ...legacyScriptPaths];
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const syncStateBackup = await backupOptionalFile(syncStatePath);

        try {
            await fs.mkdir(path.dirname(syncStatePath), {recursive: true});
            await fs.writeFile(syncStatePath, JSON.stringify({profiles: [], assets: []}, null, 2), "utf-8");
            for (const [index, filePath] of wrapperPaths.entries()) {
                await fs.mkdir(path.dirname(filePath), {recursive: true});
                await fs.writeFile(filePath, wrapperSentinels[index] ?? "", "utf-8");
            }
            for (const filePath of legacyScriptPaths) {
                await fs.mkdir(path.dirname(filePath), {recursive: true});
                await fs.writeFile(filePath, legacySentinel, "utf-8");
            }

            const result = await syncSystemAssetsToUserAssets();

            for (const [index, filePath] of wrapperPaths.entries()) {
                await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(wrapperSentinels[index]);
            }
            for (const filePath of legacyScriptPaths) {
                await expect(fs.access(filePath)).rejects.toMatchObject({code: "ENOENT"});
            }
            expect(result.assetWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/bin/workspace"}),
                expect.objectContaining({assetPath: "agent/bin/workspace.cmd"}),
            ]));
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会删除仍跟随上游的旧 Agent runtime scripts 与 sync state", async () => {
        const assetPaths = [
            "agent/scripts/profile.ts",
            "agent/scripts/variable.ts",
            "agent/scripts/workspace.ts",
        ];
        const userScriptPaths = assetPaths.map((assetPath) => path.join("workspace", ".nbook", ...assetPath.split("/")));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const scriptBackups = await Promise.all(userScriptPaths.map((filePath) => backupOptionalFile(filePath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const previousScript = "console.log('old runtime script');\n";
        const previousHash = createHash("sha256").update(previousScript).digest("hex");

        try {
            for (const userScriptPath of userScriptPaths) {
                await fs.mkdir(path.dirname(userScriptPath), {recursive: true});
                await fs.writeFile(userScriptPath, previousScript, "utf-8");
            }
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: assetPaths.map((assetPath) => ({
                    assetPath,
                    upstreamHash: previousHash,
                    lastSyncedUserHash: previousHash,
                    syncedAt: new Date(0).toISOString(),
                })),
            }, null, 2), "utf-8");

            await syncSystemAssetsToUserAssets();

            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            for (const userScriptPath of userScriptPaths) {
                await expect(fs.access(userScriptPath)).rejects.toMatchObject({code: "ENOENT"});
            }
            expect(syncState.assets?.filter((item) => assetPaths.includes(item.assetPath))).toEqual([]);
        } finally {
            for (const [index, userScriptPath] of userScriptPaths.entries()) {
                await restoreOptionalFile(userScriptPath, scriptBackups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "skills", "profile-system-guide", "SKILL.md"),
            path.join("workspace", ".nbook", "agent", "skills", "llmlint", "package.json"),
            path.join("workspace", ".nbook", "agent", "skills", "llmlint", "rulesets", "builtin", "default", "ruleset.json"),
            path.join("workspace", ".nbook", "agent", "skills", "llmlint", "rulesets", "builtin", "default", "rules", "vocabulary", "r18.json"),
            path.join("workspace", ".nbook", "agent", "skills", "llmlint", "src", "curated-slugs.ts"),
            path.join("workspace", ".nbook", "templates", "content-node-templates", "chapter", "index.md"),
            path.join("workspace", ".nbook", "templates", "project-directory-templates", "agents", "leader.default", "context.md"),
            path.join("workspace", ".nbook", "agent", "bin", "profile"),
            path.join("workspace", ".nbook", "agent", "config", "ripgreprc"),
        ];
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            const result = await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};

            expect(result.copied + (result.updatedAssets ?? 0)).toBeGreaterThan(0);
            await expect(fs.readFile(paths[0]!, "utf-8")).resolves.toContain("profile");
            const llmlintPackage = JSON.parse(await fs.readFile(paths[1]!, "utf-8")) as {
                name: string;
                version: string;
                license: string;
            };
            expect(llmlintPackage).toMatchObject({
                name: "llmlint",
                version: "3.0.0",
                license: "AGPL-3.0-only",
            });
            await expect(fs.readFile(paths[2]!, "utf-8")).resolves.toContain("builtin/default");
            await expect(fs.readFile(paths[3]!, "utf-8")).resolves.toContain("vocabulary.r18");
            await expect(fs.readFile(paths[4]!, "utf-8")).resolves.toContain("CURATED_RULE_SLUGS");
            await expect(fs.readFile(paths[5]!, "utf-8")).resolves.toContain("chapter");
            await expect(fs.readFile(paths[6]!, "utf-8")).resolves.toContain("Leader Default Context Notes");
            await expect(fs.readFile(paths[7]!, "utf-8")).resolves.toContain("server/agent/profiles/profile-command.ts");
            await expect(fs.readFile(paths[8]!, "utf-8")).resolves.toContain("--path-separator=/");
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/skills/profile-system-guide/SKILL.md"}),
                expect.objectContaining({assetPath: "agent/skills/llmlint/package.json"}),
                expect.objectContaining({assetPath: "agent/skills/llmlint/rulesets/builtin/default/ruleset.json"}),
                expect.objectContaining({assetPath: "agent/skills/llmlint/rulesets/builtin/default/rules/vocabulary/r18.json"}),
                expect.objectContaining({assetPath: "agent/skills/llmlint/src/curated-slugs.ts"}),
                expect.objectContaining({assetPath: "templates/content-node-templates/chapter/index.md"}),
                expect.objectContaining({assetPath: "templates/project-directory-templates/agents/leader.default/context.md"}),
                expect.objectContaining({assetPath: "agent/bin/profile"}),
                expect.objectContaining({assetPath: "agent/config/ripgreprc"}),
            ]));
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会清理未手改的已删除上游模板并保留手改副本", async () => {
        const deletedAssetPath = "templates/project-directory-templates/simulation/subjects/player/subject.md";
        const editedDeletedAssetPath = "templates/project-directory-templates/simulation/subjects/sample-npc/subject.md";
        const deletedUserPath = path.join("workspace", ".nbook", ...deletedAssetPath.split("/"));
        const editedUserPath = path.join("workspace", ".nbook", ...editedDeletedAssetPath.split("/"));
        const deletedSystemPath = path.join("assets", "workspace", ".nbook", ...deletedAssetPath.split("/"));
        const editedSystemPath = path.join("assets", "workspace", ".nbook", ...editedDeletedAssetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const deletedBackup = await backupOptionalFile(deletedUserPath);
        const editedBackup = await backupOptionalFile(editedUserPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const syncedContent = "old system template\n";
        const editedContent = "old system template\nuser edit\n";
        const syncedHash = createHash("sha256").update(syncedContent).digest("hex");
        const editedHash = createHash("sha256").update(editedContent).digest("hex");

        try {
            await expect(fs.access(deletedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(editedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            await fs.mkdir(path.dirname(deletedUserPath), {recursive: true});
            await fs.mkdir(path.dirname(editedUserPath), {recursive: true});
            await fs.writeFile(deletedUserPath, syncedContent, "utf-8");
            await fs.writeFile(editedUserPath, editedContent, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [
                    {
                        assetPath: deletedAssetPath,
                        upstreamHash: syncedHash,
                        lastSyncedUserHash: syncedHash,
                        syncedAt: new Date(0).toISOString(),
                    },
                    {
                        assetPath: editedDeletedAssetPath,
                        upstreamHash: syncedHash,
                        lastSyncedUserHash: syncedHash,
                        syncedAt: new Date(0).toISOString(),
                    },
                ],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string; lastSyncedUserHash?: string}>};
            const assetPaths = syncState.assets?.map((asset) => asset.assetPath) ?? [];

            await expect(fs.access(deletedUserPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.readFile(editedUserPath, "utf-8")).resolves.toBe(editedContent);
            expect(assetPaths).not.toContain(deletedAssetPath);
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: editedDeletedAssetPath, lastSyncedUserHash: syncedHash}),
            ]));
            expect(result.assetWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: editedDeletedAssetPath}),
            ]));
            expect(await sha256ForTest(editedUserPath)).toBe(editedHash);
        } finally {
            await restoreOptionalFile(deletedUserPath, deletedBackup);
            await restoreOptionalFile(editedUserPath, editedBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会清理未手改的旧 anti-ai-slop skill 副本", async () => {
        const deletedAssetPath = "agent/skills/anti-ai-slop/SKILL.md";
        const deletedUserPath = path.join("workspace", ".nbook", ...deletedAssetPath.split("/"));
        const deletedSystemPath = path.join("assets", "workspace", ".nbook", ...deletedAssetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const deletedBackup = await backupOptionalFile(deletedUserPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const syncedContent = "old anti-ai-slop skill\n";
        const syncedHash = createHash("sha256").update(syncedContent).digest("hex");

        try {
            await expect(fs.access(deletedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            await fs.mkdir(path.dirname(deletedUserPath), {recursive: true});
            await fs.writeFile(deletedUserPath, syncedContent, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath: deletedAssetPath,
                    upstreamHash: syncedHash,
                    lastSyncedUserHash: syncedHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            const assetPaths = syncState.assets?.map((asset) => asset.assetPath) ?? [];

            await expect(fs.access(deletedUserPath)).rejects.toMatchObject({code: "ENOENT"});
            expect(assetPaths).not.toContain(deletedAssetPath);
        } finally {
            await restoreOptionalFile(deletedUserPath, deletedBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会清理未手改的旧 llmlint 受管文件", async () => {
        const deletedAssetPaths = [
            "agent/skills/llmlint/src/legacy-import.ts",
            "agent/skills/llmlint/presets/anti-ai-slop/static-rules.json",
            "agent/skills/llmlint/presets/anti-ai-slop/llm-rules.json",
            "agent/skills/llmlint/presets/anti-ai-slop/category-suggestions.json",
            "agent/skills/llmlint/rulesets/builtin/anti-ai-slop/ruleset.json",
            "agent/skills/llmlint/rulesets/builtin/cn/ruleset.json",
            "agent/skills/llmlint/rulesets/builtin/default/rules.json",
            "agent/skills/llmlint/rulesets/builtin/cn-light/ruleset.json",
            "agent/skills/llmlint/rulesets/builtin/cn-standard/ruleset.json",
            "agent/skills/llmlint/rulesets/builtin/cn-strong/ruleset.json",
            "agent/skills/llmlint/rulesets/builtin/cn-extreme/ruleset.json",
        ];
        const orphanDeletedAssetPaths = [
            "agent/skills/llmlint/.gitignore",
            "agent/skills/llmlint/.git/config",
            "agent/skills/llmlint/evals/README.md",
            "agent/skills/llmlint/rulesets/builtin/cn-light/rules.json",
            "agent/skills/llmlint/rulesets/builtin/cn-standard/rules.json",
        ];
        const staleManagedAssetPath = "agent/skills/llmlint/rulesets/builtin/default/rules/vocabulary.r18.json";
        const editedStaleManagedAssetPath = "agent/skills/llmlint/rulesets/builtin/default/rules/vocabulary.body.json";
        const editedDeletedAssetPath = "agent/skills/llmlint/presets/anti-ai-slop/user-edited-static-rules.json";
        const updatedAssetPaths = [
            "agent/skills/llmlint/src/cli.ts",
            "agent/skills/llmlint/src/rules.ts",
        ];
        const deletedUserPaths = deletedAssetPaths.map((assetPath) => path.join("workspace", ".nbook", ...assetPath.split("/")));
        const deletedSystemPaths = deletedAssetPaths.map((assetPath) => path.join("assets", "workspace", ".nbook", ...assetPath.split("/")));
        const orphanDeletedUserPaths = orphanDeletedAssetPaths.map((assetPath) => path.join("workspace", ".nbook", ...assetPath.split("/")));
        const orphanDeletedSystemPaths = orphanDeletedAssetPaths.map((assetPath) => path.join("assets", "workspace", ".nbook", ...assetPath.split("/")));
        const staleManagedUserPath = path.join("workspace", ".nbook", ...staleManagedAssetPath.split("/"));
        const staleManagedSystemPath = path.join("assets", "workspace", ".nbook", ...staleManagedAssetPath.split("/"));
        const editedStaleManagedUserPath = path.join("workspace", ".nbook", ...editedStaleManagedAssetPath.split("/"));
        const editedStaleManagedSystemPath = path.join("assets", "workspace", ".nbook", ...editedStaleManagedAssetPath.split("/"));
        const editedDeletedUserPath = path.join("workspace", ".nbook", ...editedDeletedAssetPath.split("/"));
        const editedDeletedSystemPath = path.join("assets", "workspace", ".nbook", ...editedDeletedAssetPath.split("/"));
        const updatedUserPaths = updatedAssetPaths.map((assetPath) => path.join("workspace", ".nbook", ...assetPath.split("/")));
        const updatedSystemPaths = updatedAssetPaths.map((assetPath) => path.join("assets", "workspace", ".nbook", ...assetPath.split("/")));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const deletedBackups = await Promise.all(deletedUserPaths.map((userPath) => backupOptionalFile(userPath)));
        const orphanDeletedBackups = await Promise.all(orphanDeletedUserPaths.map((userPath) => backupOptionalFile(userPath)));
        const staleManagedBackup = await backupOptionalFile(staleManagedUserPath);
        const editedStaleManagedBackup = await backupOptionalFile(editedStaleManagedUserPath);
        const editedDeletedBackup = await backupOptionalFile(editedDeletedUserPath);
        const updatedBackups = await Promise.all(updatedUserPaths.map((userPath) => backupOptionalFile(userPath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const syncedContents = [
            "old legacy import\n",
            "{\"id\":\"static-rules\"}\n",
            "{\"id\":\"llm-rules\"}\n",
            "{\"id\":\"category-suggestions\"}\n",
            "{\"id\":\"builtin/anti-ai-slop\"}\n",
            "{\"id\":\"builtin/cn\"}\n",
            "[{\"id\":\"old builtin/default rules\"}]\n",
            "{\"id\":\"builtin/cn-light\"}\n",
            "{\"id\":\"builtin/cn-standard\"}\n",
            "{\"id\":\"builtin/cn-strong\"}\n",
            "{\"id\":\"builtin/cn-extreme\"}\n",
        ];
        const syncedHashes = syncedContents.map((content) => createHash("sha256").update(content).digest("hex"));
        const staleManagedSyncedContent = "[{\"id\":\"old flat vocabulary r18\"}]\n";
        const editedStaleManagedSyncedContent = "[{\"id\":\"old flat vocabulary body\"}]\n";
        const editedStaleManagedContent = "[{\"id\":\"user edited old flat vocabulary body\"}]\n";
        const staleManagedSyncedHash = createHash("sha256").update(staleManagedSyncedContent).digest("hex");
        const editedStaleManagedSyncedHash = createHash("sha256").update(editedStaleManagedSyncedContent).digest("hex");
        const editedDeletedSyncedContent = "{\"id\":\"old managed llmlint rule\"}\n";
        const editedDeletedContent = "{\"id\":\"user edited old managed llmlint rule\"}\n";
        const editedDeletedSyncedHash = createHash("sha256").update(editedDeletedSyncedContent).digest("hex");
        const oldUpdatedContents = [
            "import {formatLegacyImportReport} from \"./legacy-import\";\nprogram.command(\"import-legacy\");\nprogram.command(\"import-curated\");\nprogram.argument(\"[file]\");\n",
            "function readLegacySources() {}\nconst key = \"source.legacy\";\n",
        ];
        const oldUpdatedHashes = oldUpdatedContents.map((content) => createHash("sha256").update(content).digest("hex"));
        const llmlintSkillRoot = path.join("workspace", ".nbook", "agent", "skills", "llmlint");
        const llmlintBinPath = path.join(llmlintSkillRoot, "bin", "llmlint.ts");

        try {
            for (const deletedSystemPath of deletedSystemPaths) {
                await expect(fs.access(deletedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            }
            for (const orphanDeletedSystemPath of orphanDeletedSystemPaths) {
                await expect(fs.access(orphanDeletedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            }
            await expect(fs.access(staleManagedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(editedStaleManagedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(editedDeletedSystemPath)).rejects.toMatchObject({code: "ENOENT"});
            for (let index = 0; index < deletedUserPaths.length; index++) {
                const deletedUserPath = deletedUserPaths[index]!;
                await fs.mkdir(path.dirname(deletedUserPath), {recursive: true});
                await fs.writeFile(deletedUserPath, syncedContents[index]!, "utf-8");
            }
            for (const orphanDeletedUserPath of orphanDeletedUserPaths) {
                await fs.mkdir(path.dirname(orphanDeletedUserPath), {recursive: true});
                await fs.writeFile(orphanDeletedUserPath, "{\"id\":\"orphan old builtin\"}\n", "utf-8");
            }
            await fs.mkdir(path.dirname(staleManagedUserPath), {recursive: true});
            await fs.writeFile(staleManagedUserPath, staleManagedSyncedContent, "utf-8");
            await fs.mkdir(path.dirname(editedStaleManagedUserPath), {recursive: true});
            await fs.writeFile(editedStaleManagedUserPath, editedStaleManagedContent, "utf-8");
            await fs.mkdir(path.dirname(editedDeletedUserPath), {recursive: true});
            await fs.writeFile(editedDeletedUserPath, editedDeletedContent, "utf-8");
            for (let index = 0; index < updatedUserPaths.length; index++) {
                const updatedUserPath = updatedUserPaths[index]!;
                await fs.mkdir(path.dirname(updatedUserPath), {recursive: true});
                await fs.writeFile(updatedUserPath, oldUpdatedContents[index]!, "utf-8");
            }
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [
                    ...deletedAssetPaths.map((assetPath, index) => ({
                        assetPath,
                        upstreamHash: syncedHashes[index],
                        lastSyncedUserHash: syncedHashes[index],
                        syncedAt: new Date(0).toISOString(),
                    })),
                    {
                        assetPath: staleManagedAssetPath,
                        upstreamHash: staleManagedSyncedHash,
                        lastSyncedUserHash: staleManagedSyncedHash,
                        syncedAt: new Date(0).toISOString(),
                    },
                    {
                        assetPath: editedStaleManagedAssetPath,
                        upstreamHash: editedStaleManagedSyncedHash,
                        lastSyncedUserHash: editedStaleManagedSyncedHash,
                        syncedAt: new Date(0).toISOString(),
                    },
                    {
                        assetPath: editedDeletedAssetPath,
                        upstreamHash: editedDeletedSyncedHash,
                        lastSyncedUserHash: editedDeletedSyncedHash,
                        syncedAt: new Date(0).toISOString(),
                    },
                    ...updatedAssetPaths.map((assetPath, index) => ({
                        assetPath,
                        upstreamHash: oldUpdatedHashes[index],
                        lastSyncedUserHash: oldUpdatedHashes[index],
                        syncedAt: new Date(0).toISOString(),
                    })),
                ],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            const assetPaths = syncState.assets?.map((asset) => asset.assetPath) ?? [];
            const cliSource = await fs.readFile(updatedUserPaths[0]!, "utf-8");
            const rulesSource = await fs.readFile(updatedUserPaths[1]!, "utf-8");
            await expect(fs.access(path.join(llmlintSkillRoot, "node_modules"))).rejects.toMatchObject({code: "ENOENT"});
            await execFileAsync("bun", ["install", "--cwd", llmlintSkillRoot, "--frozen-lockfile"], {
                encoding: "utf-8",
                timeout: 30000,
            });
            const {stdout: helpStdout} = await execFileAsync("bun", [llmlintBinPath, "--help"], {
                encoding: "utf-8",
                timeout: 10000,
            });

            for (const deletedUserPath of deletedUserPaths) {
                await expect(fs.access(deletedUserPath)).rejects.toMatchObject({code: "ENOENT"});
            }
            for (const orphanDeletedUserPath of orphanDeletedUserPaths) {
                await expect(fs.access(orphanDeletedUserPath)).rejects.toMatchObject({code: "ENOENT"});
            }
            await expect(fs.access(staleManagedUserPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.readFile(editedStaleManagedUserPath, "utf-8")).resolves.toBe(editedStaleManagedContent);
            await expect(fs.readFile(editedDeletedUserPath, "utf-8")).resolves.toBe(editedDeletedContent);
            for (const deletedAssetPath of deletedAssetPaths) {
                expect(assetPaths).not.toContain(deletedAssetPath);
            }
            expect(assetPaths).not.toContain(staleManagedAssetPath);
            expect(assetPaths).toContain(editedStaleManagedAssetPath);
            expect(assetPaths).toContain(editedDeletedAssetPath);
            expect(result.assetWarnings?.filter((warning) => warning.assetPath === editedStaleManagedAssetPath)).toHaveLength(1);
            expect(result.assetWarnings?.filter((warning) => warning.assetPath === editedDeletedAssetPath)).toHaveLength(1);
            for (let index = 0; index < updatedUserPaths.length; index++) {
                await expect(fs.readFile(updatedUserPaths[index]!, "utf-8")).resolves.toBe(await fs.readFile(updatedSystemPaths[index]!, "utf-8"));
            }
            expect(cliSource).not.toContain("legacy-import");
            expect(cliSource).not.toContain("import-legacy");
            expect(cliSource).not.toContain("import-curated");
            expect(cliSource).not.toContain("[file]");
            expect(rulesSource).not.toContain("source.legacy");
            expect(rulesSource).not.toContain("readLegacySources");
            expect(helpStdout).toContain("check [options] <files...>");
            expect(helpStdout).toContain("fix [options] <files...>");
            expect(helpStdout).toContain("guide [options]");
            expect(helpStdout).toContain("rules [options]");
            expect(helpStdout).not.toContain("show-llm-rules");
            expect(helpStdout).not.toContain("import-legacy");
            expect(helpStdout).not.toContain("import-curated");
        } finally {
            await Promise.all(deletedUserPaths.map((userPath, index) => restoreOptionalFile(userPath, deletedBackups[index]!)));
            await Promise.all(orphanDeletedUserPaths.map((userPath, index) => restoreOptionalFile(userPath, orphanDeletedBackups[index]!)));
            await restoreOptionalFile(staleManagedUserPath, staleManagedBackup);
            await restoreOptionalFile(editedStaleManagedUserPath, editedStaleManagedBackup);
            await restoreOptionalFile(editedDeletedUserPath, editedDeletedBackup);
            await Promise.all(updatedUserPaths.map((userPath, index) => restoreOptionalFile(userPath, updatedBackups[index]!)));
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    // 该用例全程改写 system skill 的 SKILL.md / package.json / bun.lock 且不做恢复，
    // 必须独占一份可写 system assets 副本，不能污染 run 级共享只读 snapshot。
    it("Skill 同步只在依赖合同更新时失效 node_modules", async () => {
        await withIsolatedWorkspaceAssets({useAsCwd: true, systemAssets: "isolated"}, async () => {
            const systemSkillRoot = path.join("assets", "workspace", ".nbook", "agent", "skills", "llmlint");
            const userSkillRoot = path.join("workspace", ".nbook", "agent", "skills", "llmlint");
            const sentinelPath = path.join(userSkillRoot, "node_modules", "sentinel.txt");
            const systemSkillPath = path.join(systemSkillRoot, "SKILL.md");
            const userSkillPath = path.join(userSkillRoot, "SKILL.md");
            const systemPackagePath = path.join(systemSkillRoot, "package.json");
            const userPackagePath = path.join(userSkillRoot, "package.json");
            const systemLockPath = path.join(systemSkillRoot, "bun.lock");

            await syncSystemAssetsToUserAssets();
            await fs.mkdir(path.dirname(sentinelPath), {recursive: true});
            await fs.writeFile(sentinelPath, "installed\n", "utf-8");

            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("installed\n");

            await fs.appendFile(systemSkillPath, "\n<!-- prompt-only update -->\n", "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(userSkillPath, "utf-8")).resolves.toContain("prompt-only update");
            await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("installed\n");

            await syncSystemAssetsToUserAssets({force: true});
            await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("installed\n");

            const packageJson = JSON.parse(await fs.readFile(systemPackagePath, "utf-8")) as {
                version: string;
                dependencies: {[name: string]: string};
            };
            const reorderedDependencies: {[name: string]: string} = {};
            for (const [name, version] of Object.entries(packageJson.dependencies).reverse()) {
                reorderedDependencies[name] = version;
            }
            packageJson.dependencies = reorderedDependencies;
            await fs.writeFile(systemPackagePath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("installed\n");

            packageJson.version = "99.0.0";
            await fs.writeFile(systemPackagePath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("installed\n");
            await expect(fs.readFile(userPackagePath, "utf-8")).resolves.toContain('"version": "99.0.0"');

            packageJson.dependencies = {"test-runtime-dependency": "1.0.0"};
            await fs.writeFile(systemPackagePath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.access(sentinelPath)).rejects.toMatchObject({code: "ENOENT"});

            await fs.mkdir(path.dirname(sentinelPath), {recursive: true});
            await fs.writeFile(sentinelPath, "reinstalled\n", "utf-8");
            await fs.appendFile(systemLockPath, "\n", "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.access(sentinelPath)).rejects.toMatchObject({code: "ENOENT"});

            const genericSystemRoot = path.join("assets", "workspace", ".nbook", "agent", "skills", "runtime-fixture");
            const genericUserRoot = path.join("workspace", ".nbook", "agent", "skills", "runtime-fixture");
            const genericSentinelPath = path.join(genericUserRoot, "node_modules", "sentinel.txt");
            await fs.mkdir(path.join(genericSystemRoot, "node_modules"), {recursive: true});
            await fs.writeFile(path.join(genericSystemRoot, "SKILL.md"), "---\nname: runtime-fixture\ndescription: Runtime fixture.\n---\n", "utf-8");
            await fs.writeFile(path.join(genericSystemRoot, "package.json"), `${JSON.stringify({
                name: "runtime-fixture",
                version: "1.0.0",
                dependencies: {commander: "1.0.0"},
            }, null, 4)}\n`, "utf-8");
            await fs.writeFile(path.join(genericSystemRoot, "bun.lock"), "{}\n", "utf-8");
            await fs.writeFile(path.join(genericSystemRoot, "node_modules", "must-not-sync.txt"), "derived\n", "utf-8");

            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(path.join(genericUserRoot, "SKILL.md"), "utf-8")).resolves.toContain("runtime-fixture");
            await expect(fs.access(path.join(genericUserRoot, "node_modules", "must-not-sync.txt"))).rejects.toMatchObject({code: "ENOENT"});

            await fs.mkdir(path.dirname(genericSentinelPath), {recursive: true});
            await fs.writeFile(genericSentinelPath, "installed\n", "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.readFile(genericSentinelPath, "utf-8")).resolves.toBe("installed\n");

            await fs.writeFile(path.join(genericSystemRoot, "package.json"), `${JSON.stringify({
                name: "runtime-fixture",
                version: "1.0.1",
                dependencies: {commander: "2.0.0"},
            }, null, 4)}\n`, "utf-8");
            await syncSystemAssetsToUserAssets();
            await expect(fs.access(genericSentinelPath)).rejects.toMatchObject({code: "ENOENT"});

            await fs.mkdir(path.dirname(genericSentinelPath), {recursive: true});
            await fs.writeFile(genericSentinelPath, "installed-after-update\n", "utf-8");
            await fs.writeFile(path.join(genericUserRoot, "package.json"), "{ broken user manifest\n", "utf-8");
            await fs.writeFile(path.join(genericSystemRoot, "package.json"), `${JSON.stringify({
                name: "runtime-fixture",
                version: "1.0.2",
                dependencies: {commander: "3.0.0"},
            }, null, 4)}\n`, "utf-8");
            await syncSystemAssetsToUserAssets({force: true});
            await expect(fs.readFile(path.join(genericUserRoot, "package.json"), "utf-8")).resolves.toContain('"version": "1.0.2"');
            await expect(fs.access(genericSentinelPath)).rejects.toMatchObject({code: "ENOENT"});
        });
    }, 180_000);

    it("同步系统 assets 会更新仍跟随上游的 Agent skill", async () => {
        const assetPath = "agent/skills/profile-system-guide/SKILL.md";
        const userSkillPath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemSkillPath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const skillBackup = await backupOptionalFile(userSkillPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const previousSkill = "# Old skill\n";
        const previousHash = createHash("sha256").update(previousSkill).digest("hex");

        try {
            await fs.mkdir(path.dirname(userSkillPath), {recursive: true});
            await fs.writeFile(userSkillPath, previousSkill, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath,
                    upstreamHash: previousHash,
                    lastSyncedUserHash: previousHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.updatedAssets).toBeGreaterThanOrEqual(1);
            await expect(fs.readFile(userSkillPath, "utf-8")).resolves.toBe(await fs.readFile(systemSkillPath, "utf-8"));
        } finally {
            await restoreOptionalFile(userSkillPath, skillBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    }, 180_000);

    it("系统 skill 更新且用户覆盖已手改时会返回可查看 diff 的 warning", async () => {
        const assetPath = "agent/skills/profile-system-guide/SKILL.md";
        const userSkillPath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemSkillPath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const skillBackup = await backupOptionalFile(userSkillPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const systemContent = await fs.readFile(systemSkillPath, "utf-8");
        const syncedHash = createHash("sha256").update(systemContent).digest("hex");

        try {
            await fs.mkdir(path.dirname(userSkillPath), {recursive: true});
            await fs.writeFile(userSkillPath, `${systemContent}\n<!-- user skill change -->\n`, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath,
                    upstreamHash: "old-upstream-hash",
                    lastSyncedUserHash: syncedHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const detail = await readUserAssetsSyncConflictDetail({kind: "asset", assetPath});

            expect(result.assetWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath}),
            ]));
            expect(detail.kind).toBe("asset");
            expect(detail.assetPath).toBe(assetPath);
            expect(detail.systemContent).toBe(systemContent);
            expect(detail.userContent).toContain("user skill change");
            expect(detail.language).toBe("markdown");
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userSkillPath, skillBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    }, 180_000);

    it("强制同步系统 assets 会覆盖受管 asset 但不覆盖黑名单本地状态", async () => {
        const assetPath = "agent/skills/profile-system-guide/SKILL.md";
        const userSkillPath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemSkillPath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const sessionPath = path.join("workspace", ".nbook", "agent", "sessions", "force-sync-test.jsonl");
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const skillBackup = await backupOptionalFile(userSkillPath);
        const sessionBackup = await backupOptionalFile(sessionPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);

        try {
            await fs.mkdir(path.dirname(userSkillPath), {recursive: true});
            await fs.mkdir(path.dirname(sessionPath), {recursive: true});
            await fs.writeFile(userSkillPath, "# User custom skill\n", "utf-8");
            await fs.writeFile(sessionPath, "{\"type\":\"local-session\"}\n", "utf-8");

            const result = await syncSystemAssetsToUserAssets({force: true});

            expect(result.updatedAssets).toBeGreaterThanOrEqual(1);
            await expect(fs.readFile(userSkillPath, "utf-8")).resolves.toBe(await fs.readFile(systemSkillPath, "utf-8"));
            await expect(fs.readFile(sessionPath, "utf-8")).resolves.toBe("{\"type\":\"local-session\"}\n");
        } finally {
            await restoreOptionalFile(userSkillPath, skillBackup);
            await restoreOptionalFile(sessionPath, sessionBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    }, 180_000);

    it("同步系统 assets 不会把本地状态和 compiled 产物纳入 managed sync", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json"),
            path.join("workspace", ".nbook", "agent", "variables", ".compiled", "manifest.json"),
            path.join("workspace", ".nbook", "agent", "profiles", ".system-profile-metadata.json"),
        ];
        const syncStatePath = path.join("workspace", ".nbook", ".system-assets-sync-state.json");
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            const assetPaths = syncState.assets?.map((asset) => asset.assetPath) ?? [];

            expect(assetPaths.some((assetPath) => assetPath.includes("/.compiled/"))).toBe(false);
            expect(assetPaths).not.toContain("agent/profiles/.system-profile-metadata.json");
            await expect(fs.access(paths[2]!)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("系统 profile metadata 只来自 compiled manifest", async () => {
        const legacySystemMetadataPath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ".system-profile-metadata.json");

        await expect(fs.access(legacySystemMetadataPath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("小说目录模板会创建最小 lorebook 骨架且通过内容节点校验", async () => {
        await withSystemTemplate([
            "templates/project-directory-templates/lorebook/index.md",
            "templates/project-directory-templates/lorebook/instruction/creation-boundaries/index.md",
            "templates/project-directory-templates/lorebook/note/project-profile/index.md",
            "templates/project-directory-templates/lorebook/note/story-concept/index.md",
            "templates/project-directory-templates/lorebook/note/opening-seed/index.md",
        ], async () => {
            await copyNovelDirectoryTemplate(root);
        });

        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.toContain("Project Agent Instructions");
        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.toContain("项目的全局 Agent 指令");
        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.not.toContain("初始化待办");
        await expect(fs.access(path.join(root, "PROJECT-STATUS.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readWorkspaceTextFile(root, ".nbook/icons.json")).resolves.toContain("\"lorebook\"");
        await expect(fs.access(path.join(root, ".agent/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, ".agent/plan/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(readWorkspaceTextFile(root, "lorebook/index.md")).resolves.toContain("## 目录用途");
        await expect(fs.access(path.join(root, "lorebook/world/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/character/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/location/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/faction/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/item/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/event/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, "lorebook/system/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toContain("## 类型与基调");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toContain("## 对外简介");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toContain("enabled: false");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("## 故事概述");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("长简介式作品介绍");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("enabled: false");
        await expect(fs.access(path.join(root, "lorebook/note/opening-seed/index.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readWorkspaceTextFile(root, "lorebook/instruction/creation-boundaries/index.md")).resolves.toContain("## 使用方式");
        await expect(readWorkspaceTextFile(root, "lorebook/instruction/creation-boundaries/index.md")).resolves.toContain("enabled: false");
        await expect(readWorkspaceTextFile(root, "lorebook/instruction/creation-boundaries/index.md")).resolves.not.toContain("inject:");
        await expect(fs.access(path.join(root, "lorebook/rule/writing-style/index.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readWorkspaceTextFile(root, "agents/writer/context.md")).resolves.toContain("Writer Context Notes");
        await expect(readWorkspaceTextFile(root, "agents/writer/memory.md")).resolves.toContain("Writer Memory");
        await expect(readWorkspaceTextFile(root, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("## 正文草稿");
        await expect(readWorkspaceTextFile(root, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("- 开局示例");
        await expect(readWorkspaceTextFile(root, "world-engine/schema/index.ts")).resolves.toContain("WorldSchema");
        await expect(readWorkspaceTextFile(root, "world-engine/schema/index.ts")).resolves.toContain("character");
        await expect(readWorkspaceTextFile(root, "world-engine/schema/index.ts")).resolves.toContain("location");
        await expect(readWorkspaceTextFile(root, "world-engine/calendar.ts")).resolves.toContain("type: 'gregorian'");
        await expect(fs.access(path.join(root, "world-engine", "schema.yaml"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join(root, "world-engine", "calendar.yaml"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join(root, "simulation"))).rejects.toMatchObject({code: "ENOENT"});

        const lorebookResult = await validateWorkspaceContentNodes({
            root,
            targets: ["lorebook"],
            recursive: true,
        });
        const manuscriptResult = await validateWorkspaceContentNodes({
            root,
            targets: ["manuscript"],
            recursive: true,
        });

        expect(lorebookResult.issues.filter((issue) => (issue.level === "P1" || issue.level === "P2") && issue.code !== "invalid-ref")).toEqual([]);
        expect(manuscriptResult.issues.filter((issue) => (issue.level === "P1" || issue.level === "P2") && issue.code !== "invalid-ref")).toEqual([]);
    });

    it("小说目录模板不会覆盖已有用户文件", async () => {
        const targetPath = path.join(root, "lorebook/instruction/creation-boundaries/index.md");
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.writeFile(targetPath, "用户已经写好的创作边界", "utf-8");

        await copyNovelDirectoryTemplate(root);

        await expect(readWorkspaceTextFile(root, "lorebook/instruction/creation-boundaries/index.md")).resolves.toBe("用户已经写好的创作边界");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toContain("## 对外简介");
    });

    it("用户 assets 可以覆盖小说目录模板但不覆盖目标 workspace 既有文件", async () => {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "project-directory-templates", "lorebook", "note", "project-profile", "index.md");
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, "# 用户覆盖作品定位模板\n", "utf-8");

        try {
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toBe("# 用户覆盖作品定位模板\n");
            await expect(fs.access(path.join(root, "workspace.yaml"))).rejects.toMatchObject({code: "ENOENT"});

            await writeWorkspaceTextFile(root, "lorebook/note/project-profile/index.md", "# 小说自己的作品定位\n");
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "lorebook/note/project-profile/index.md")).resolves.toBe("# 小说自己的作品定位\n");
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    });

    it("小说目录模板会忽略用户 assets 中已废弃的默认模板文件", async () => {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "project-directory-templates", "lorebook", "rule", "writing-style", "index.md");
        const userSimulationTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "project-directory-templates", "simulation", "subjects", "player", "subject.md");
        const backup = await backupOptionalFile(userTemplatePath);
        const simulationBackup = await backupOptionalFile(userSimulationTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.mkdir(path.dirname(userSimulationTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, "# 旧文风模板\n", "utf-8");
        await fs.writeFile(userSimulationTemplatePath, "# 旧 simulation 模板\n", "utf-8");

        try {
            await copyNovelDirectoryTemplate(root);
            await expect(fs.access(path.join(root, "lorebook/rule/writing-style/index.md"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(path.join(root, "simulation"))).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
            await restoreOptionalFile(userSimulationTemplatePath, simulationBackup);
        }
    });

    it("Project Workspace 会加载模板，并由 Project Module 初始化 SQLite", async () => {
        const workspaceSlug = `workspace-files-test-${randomUUID()}`;
        const projectPath = `workspace/${workspaceSlug}`;
        const createdRoot = path.join("workspace", workspaceSlug);

        await writeProjectManifest(workspaceSlug, {
            kind: "novel",
            title: "测试小说",
            summary: "测试简介",
        });
        await copyNovelDirectoryTemplate(projectPath);

        let projectOpened = false;
        try {
            await expect(readProjectManifest(workspaceSlug)).resolves.toEqual({
                kind: "novel",
                title: "测试小说",
                summary: "测试简介",
            });
            await expect(fs.access(path.join(createdRoot, "workspace.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(readWorkspaceTextFile(createdRoot, "AGENTS.md")).resolves.toContain("Project Agent Instructions");
            await expect(readWorkspaceTextFile(createdRoot, "AGENTS.md")).resolves.toContain("agents/{profile}/context.md");
            await expect(fs.access(path.join(createdRoot, "PROJECT-STATUS.md"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(readWorkspaceTextFile(createdRoot, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("示范章节");
            await expect(readWorkspaceTextFile(createdRoot, "world-engine/schema/index.ts")).resolves.toContain("WorldSchema");
            await expect(readWorkspaceTextFile(createdRoot, "world-engine/schema/index.ts")).resolves.toContain("Character");
            await expect(fs.access(path.join(createdRoot, "world-engine", "schema.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(readWorkspaceTextFile(createdRoot, "world-engine/calendar.ts")).resolves.toContain("type: 'gregorian'");
            await expect(fs.access(path.join(createdRoot, "world-engine", "calendar.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(path.join(createdRoot, "simulation"))).rejects.toMatchObject({code: "ENOENT"});
            await openProjectForTest(workspaceSlug);
            projectOpened = true;
            await expect(fs.access(path.join(createdRoot, ".nbook", "project.sqlite"))).resolves.toBeUndefined();
            const ready = requireReadyProject(projectWorkspaceRef(workspaceSlug));
            const {world: worldEngineFacade} = await activateReadyProjectModule(
                ready,
                PROJECT_PLOT_WORLD_MODULE_TOKEN,
            );
            await expect(worldEngineFacade.formatTime(0n)).resolves.toBe("公元1年1月1日 00:00");
            await expect(worldEngineFacade.getWorldSchema()).resolves.toEqual(expect.objectContaining({
                subjectTypes: expect.arrayContaining([
                    expect.objectContaining({type: "world"}),
                    expect.objectContaining({type: "character"}),
                ]),
            }));
            await expect(worldEngineFacade.createSubject({
                id: "world",
                type: "world",
                name: "世界",
                at: 0n,
            })).resolves.toEqual({subjectId: "world", issues: []});
            await expect(worldEngineFacade.queryState({subjectIds: ["world"], attrs: ["era"]})).resolves.toMatchObject({
                instant: 0n,
                subjects: [{subjectId: "world", type: "world", attrs: {era: "新纪元"}}],
                issues: [],
            });
            await expect(worldEngineFacade.createSubject({
                id: "capital",
                type: "location",
                name: "王都",
                at: 0n,
            })).resolves.toEqual({subjectId: "capital", issues: []});
            await expect(worldEngineFacade.createSubject({
                id: "erina",
                type: "character",
                name: "艾莉娜",
                at: 0n,
            })).resolves.toEqual({subjectId: "erina", issues: []});
            await expect(worldEngineFacade.createSubject({
                id: "old-sword",
                type: "item",
                name: "旧剑",
                at: 0n,
            })).resolves.toEqual({subjectId: "old-sword", issues: []});
            await expect(worldEngineFacade.writeSlice({
                instant: 1n,
                title: "示例：艾莉娜抵达王都",
                patches: [
                    {subjectId: "world", path: "/events", op: "append", value: {text: "世界引擎示例启动"}},
                    {subjectId: "capital", path: "/name", op: "replace", value: "王都"},
                    {subjectId: "capital", path: "/events", op: "append", value: {text: "艾莉娜抵达王都"}},
                    {subjectId: "erina", path: "/location", op: "replace", value: "subject://capital"},
                    {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
                    {subjectId: "erina", path: "/events", op: "append", value: {text: "抵达王都并拾起旧剑"}},
                    {subjectId: "old-sword", path: "/name", op: "replace", value: "旧剑"},
                    {subjectId: "old-sword", path: "/durability", op: "increment", value: -5},
                    {subjectId: "old-sword", path: "/events", op: "append", value: {text: "被艾莉娜拾起，剑身多了一道裂纹"}},
                ],
            })).resolves.toEqual(expect.objectContaining({issues: []}));
            await expect(worldEngineFacade.queryState({
                subjectIds: ["erina", "old-sword", "world"],
                attrs: ["hp", "location", "inventory", "events", "durability", "era"],
            })).resolves.toMatchObject({
                subjects: [
                    {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://capital", inventory: ["subject://old-sword"], events: [{text: "抵达王都并拾起旧剑"}]}},
                    {subjectId: "old-sword", type: "item", attrs: {durability: 95, events: [{text: "被艾莉娜拾起，剑身多了一道裂纹"}]}},
                    {subjectId: "world", type: "world", attrs: {era: "新纪元", events: [{text: "世界引擎示例启动"}]}},
                ],
                issues: [],
            });
        } finally {
            if (projectOpened) {
                await closeProjectForTest(workspaceSlug);
            }
            await removeDirectoryWithRetry(createdRoot);
        }
    }, 40_000);

    it("创建内容节点时可以同时写入 state.md", async () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "苏雪",
            type: "character",
            status: "draft",
        }, true);

        const node = await createWorkspaceDirectory({
            root,
            dirPath: "lorebook/character/su-xue",
            indexContent: bundle.indexContent,
            stateContent: bundle.stateContent,
        });

        expect(node.state?.path).toBe("lorebook/character/su-xue/state.md");
        await expect(readWorkspaceTextFile(root, "lorebook/character/su-xue/state.md")).resolves.toContain("## 当前状态");
    });

    it("可以给已有内容节点补充 state.md 且不覆盖已有文件", async () => {
        await createWorkspaceDirectory({
            root,
            dirPath: "lorebook/item/silver-dagger",
            indexContent: renderWorkspaceContentTemplate({
                title: "银色短剑",
                type: "item",
                status: "draft",
            }),
        });

        const node = await createWorkspaceContentState({
            root,
            dirPath: "lorebook/item/silver-dagger",
            stateContent: renderWorkspaceStateTemplate({
                title: "银色短剑",
                type: "item",
                status: "draft",
            }),
        });

        expect(node.state?.path).toBe("lorebook/item/silver-dagger/state.md");
        await expect(createWorkspaceContentState({
            root,
            dirPath: "lorebook/item/silver-dagger",
            stateContent: "重复状态",
        })).rejects.toThrow("state.md 已存在");
    });

    it("允许读写 YAML 这类普通文本文件", async () => {
        await writeWorkspaceTextFile(root, "workspace.yaml", "slug: silver-dragon-hime\n");

        await expect(readWorkspaceTextFile(root, "workspace.yaml")).resolves.toBe("slug: silver-dragon-hime\n");
    });

    it("拒绝把明确二进制扩展按文本读取", async () => {
        await fs.writeFile(path.join(root, "cover.png"), "not really png", "utf-8");

        await expect(readWorkspaceTextFile(root, "cover.png")).rejects.toThrow("This file type cannot be read as text");
    });

    it("拒绝把含 NUL 的文件按文本读取", async () => {
        await fs.writeFile(path.join(root, "bad.txt"), Buffer.from([0x61, 0x00, 0x62]));

        await expect(readWorkspaceTextFile(root, "bad.txt")).rejects.toThrow("The file appears to be binary");
    });

    it("拒绝非法 UTF-8 文件", async () => {
        await fs.writeFile(path.join(root, "bad.log"), Buffer.from([0xff]));

        await expect(readWorkspaceTextFile(root, "bad.log")).rejects.toThrow("The file is not valid UTF-8 text");
    });

    /**
     * 写入一个带最小 frontmatter 的 Markdown 测试文件。
     */
    async function writeMarkdown(filePath: string, frontmatter: Record<string, unknown>, body = "正文"): Promise<void> {
        const absolutePath = path.join(root, filePath);
        const yaml = YAML.stringify(frontmatter).trimEnd();
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, `---\n${yaml}\n---\n\n${body}`, "utf-8");
    }

    /**
     * 等待 Project Workspace index watcher 完成 debounce 重建。
     */
    async function waitForProjectWorkspaceTreePath(filePath: string): Promise<Awaited<ReturnType<typeof readProjectWorkspaceTreeSnapshot>>> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
            const snapshot = await readProjectWorkspaceTreeSnapshot(await projectIndexOptions());
            if (snapshot.nodes.some((node) => node.path === filePath)) {
                return snapshot;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`等待 Project Workspace tree index 更新超时: ${filePath}`);
    }

    /**
     * 等待 plain workspace index watcher 完成 debounce 重建。
     */
    async function waitForPlainWorkspaceTreePath(filePath: string): Promise<Awaited<ReturnType<typeof readPlainWorkspaceTreeSnapshot>>> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
            const snapshot = await readPlainWorkspaceTreeSnapshot({target: plainIndexTarget()});
            if (snapshot.nodes.some((node) => node.path === filePath)) {
                return snapshot;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`等待 user-assets tree index 更新超时: ${filePath}`);
    }

    /**
     * 为索引测试建立真实ProjectSession，并返回显式Project Workspace目标。
     */
    async function projectIndexOptions(): Promise<ProjectWorkspaceTreeIndexOptions> {
        const ref = projectWorkspaceRef(path.basename(root));
        const ready = await openProject(
            ref,
            {kind: "job", source: "workspace-files-test"},
            absoluteFsPath(path.dirname(root)),
        );
        return {
            target: {kind: "project-workspace", root: ready.workspace.root, projectRoot: ref.projectRoot},
            fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        };
    }

    /** 返回当前隔离目录的显式plain Workspace目标。 */
    function plainIndexTarget(): Extract<WorkspaceFileTarget, {kind: "workspace-root"}> {
        return {kind: "workspace-root", root};
    }

    /**
     * 备份当前测试隔离 user-assets 中可能已经存在的同路径测试文件。
     */
    async function backupOptionalFile(filePath: string): Promise<string | null> {
        try {
            return await fs.readFile(filePath, "utf-8");
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    /**
     * 还原被测试临时覆盖的隔离 user-assets 文件。
     */
    async function restoreOptionalFile(filePath: string, content: string | null): Promise<void> {
        if (content === null) {
            await fs.rm(filePath, {force: true});
            return;
        }
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, content, "utf-8");
    }

    /**
     * Windows 下 libsql 关闭 SQLite 后文件句柄可能短暂释放延迟，测试清理需要重试。
     */
    async function removeDirectoryWithRetry(dirPath: string): Promise<void> {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                await fs.rm(dirPath, {recursive: true, force: true});
                return;
            } catch (error) {
                if (typeof error !== "object" || error === null || !("code" in error) || !["EBUSY", "EPERM"].includes(String(error.code)) || attempt === 19) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
            }
        }
    }

    /**
     * 计算文件 sha256，用于验证同步 manifest 是否绑定当前用户侧源码。
     */
    async function sha256ForTest(filePath: string): Promise<string> {
        return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    }

    /**
     * 计算文件 sha256 和 byte length，用于验证 manifest entry 与源码一致。
     */
    async function sha256AndBytesForTest(filePath: string): Promise<{sha256: string; bytes: number}> {
        const buffer = await fs.readFile(filePath);
        return {
            sha256: createHash("sha256").update(buffer).digest("hex"),
            bytes: buffer.byteLength,
        };
    }

    function profileArtifactPath(root: "workspace" | "assets", item: ProfileArtifactManifestItem): string {
        const profileRoot = root === "assets"
            ? path.join("assets", "workspace", ".nbook", "agent", "profiles")
            : path.join("workspace", ".nbook", "agent", "profiles");
        return path.join(profileRoot, ".compiled", ...item.artifactFileName.split("/"));
    }

    function profileTypeArtifactPath(root: "workspace" | "assets", item: ProfileArtifactManifestItem): string {
        if (!item.typeFileName) {
            throw new Error(`profile ${item.profileKey} 缺少 type artifact。`);
        }
        const profileRoot = root === "assets"
            ? path.join("assets", "workspace", ".nbook", "agent", "profiles")
            : path.join("workspace", ".nbook", "agent", "profiles");
        return path.join(profileRoot, ".compiled", ...item.typeFileName.split("/"));
    }

    /**
     * 临时移开用户覆盖模板，让断言只验证 bundled system template。
     */
    async function withSystemTemplate<T>(templateRelativePath: string | string[], callback: () => T | Promise<T>): Promise<T> {
        const templateRelativePaths = Array.isArray(templateRelativePath) ? templateRelativePath : [templateRelativePath];
        const userTemplatePaths = templateRelativePaths.map((item) => path.join(USER_ASSETS_WORKSPACE_ROOT, item));
        const backups = await Promise.all(userTemplatePaths.map((item) => backupOptionalFile(item)));
        await Promise.all(userTemplatePaths.map((item) => fs.rm(item, {force: true})));
        try {
            return await callback();
        } finally {
            for (const [index, userTemplatePath] of userTemplatePaths.entries()) {
                await restoreOptionalFile(userTemplatePath, backups[index] ?? null);
            }
        }
    }

    it("受管资产同步与旧 sync state 清理都不安装、覆盖或删除 Storage 记录", async () => {
        const sourceRoot = path.join(root, "source-nbook");
        const targetRoot = path.join(assets.userNbookRoot);
        const storageRecordPath = path.join(targetRoot, "storage", "records", "shelf.json");
        await fs.mkdir(path.join(sourceRoot, "storage", "records"), {recursive: true});
        await fs.writeFile(path.join(sourceRoot, "storage", "records", "installed.json"), "{\"revision\":\"upstream\"}\n", "utf-8");
        await fs.mkdir(path.join(sourceRoot, "reference"), {recursive: true});
        await fs.writeFile(path.join(sourceRoot, "reference", "kept.md"), "受管资产\n", "utf-8");
        await fs.mkdir(path.dirname(storageRecordPath), {recursive: true});
        await fs.writeFile(storageRecordPath, "{\"revision\":\"original\"}\n", "utf-8");
        // 旧 manifest/state 声称同一条 Storage 记录受管：同步既不能把它当受管资产覆盖，也不能在清理时删除。
        await fs.writeFile(path.join(targetRoot, ".system-assets-sync-state.json"), JSON.stringify({
            profiles: [],
            assets: [{
                assetPath: "storage/records/shelf.json",
                upstreamHash: "stale-upstream",
                lastSyncedUserHash: "stale-user",
                syncedAt: "2020-01-01T00:00:00.000Z",
            }],
        }, null, 2), "utf-8");

        const result = await syncSystemAssetsToUserAssets({
            sourceNbookRoot: sourceRoot,
            targetNbookRoot: targetRoot,
            syncProfiles: false,
            syncVariableDefinitions: false,
            syncVariableCompiledArtifacts: false,
        });

        await expect(fs.readFile(storageRecordPath, "utf-8")).resolves.toBe("{\"revision\":\"original\"}\n");
        await expect(fs.access(path.join(targetRoot, "storage", "records", "installed.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.readFile(path.join(targetRoot, "reference", "kept.md"), "utf-8")).resolves.toBe("受管资产\n");
        expect(result.assetWarnings ?? []).toEqual([]);
    });
});

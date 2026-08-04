import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, stat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {buildSystemPromptRoot} from "nbook/server/agent/profiles/profile-http-service";
import {
    createProfileSource,
    createProfileSourceDraft,
    deleteProfileSource,
    listProfileFiles,
    listProfileTemplates,
    readProfileSource,
    readProfileSourceDraft,
    saveProfileSource,
} from "nbook/server/agent/profiles/workbench-service";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

function workbenchRoots(userProfileRoot: string) {
    return {...profileWorkbenchRootsFromRuntime(), userProfileRoot};
}

describe("profile workbench service", () => {
    it("列出系统 profile 模板", async () => {
        await expect(listProfileTemplates(profileWorkbenchRootsFromRuntime())).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({name: "basic-agent"}),
            expect.objectContaining({name: "report-agent"}),
        ]));
    });

    it("拒绝越界 fileName", async () => {
        const catalog = new AgentProfileCatalog(
            resolve(".agent", "tmp", "profile-workbench-invalid-system"),
            resolve(".agent", "tmp", "profile-workbench-invalid-user"),
        );

        await expect(saveProfileSource(catalog, {
            fileName: "../bad.profile.tsx",
            source: "",
        }, workbenchRoots(resolve(".agent", "tmp", "profile-workbench-invalid")))).rejects.toThrow("相对路径");
    });

    it("从模板创建的 profile 编译后可被 catalog 加载", async () => {
        const root = resolve(".agent", "tmp", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
        const catalog = new AgentProfileCatalog(join(root, "assets", ".nbook", "agent", "profiles"), userRoot);
        try {
            const created = await createProfileSourceDraft({
                profileKey: "agent.created",
                templateName: "report-agent",
                name: "Created",
                description: "",
                systemPrompt: "你是测试 Agent。",
            }, workbenchRoots(userRoot));

            expect(created.name).toBe("agent.created");
            await compileProfileArtifacts({
                profileRoot: userRoot,
                fileName: "agent.created.profile.tsx",
            });
            catalog.invalidate();
            await expect(catalog.get("agent.created")).resolves.toEqual(expect.objectContaining({
                manifest: expect.objectContaining({key: "agent.created"}),
                rootToolKeys: expect.arrayContaining(["report_result"]),
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 30_000);

    it("轻量 draft 读取不触发 runtime catalog", async () => {
        const root = resolve(".agent", "tmp", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        const roots = {
            ...workbenchRoots(userRoot),
            systemProfileRoot: join(root, "system-profiles"),
        };
        await mkdir(userRoot, {recursive: true});
        try {
            const created = await createProfileSourceDraft({
                profileKey: "agent.draft",
                templateName: "basic-agent",
                name: "Draft",
                description: "",
                systemPrompt: "轻量草稿",
            }, roots);
            expect(created.name).toBe("agent.draft");

            const listed = await listProfileFiles(roots);
            expect(listed).toEqual([expect.objectContaining({
                fileName: "agent.draft.profile.tsx",
                profileKey: "agent.draft",
                loadStatus: "not_compiled",
            })]);

            const detail = await readProfileSourceDraft({
                fileName: "agent.draft.profile.tsx",
                source: created.source.replace("轻量草稿", "未保存草稿"),
            }, roots);
            expect(detail.source).toContain("未保存草稿");
            expect(detail.root?.type).toBe("ProfilePrompt");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 30_000);

    it("删除用户 profile 后触发全量 build 以移除 manifest entry", async () => {
        const root = resolve(".agent", "tmp", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        const fileName = "agent.deleted.profile.tsx";
        const enqueued: Array<{fileName?: string; reason: string}> = [];
        await mkdir(userRoot, {recursive: true});
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        catalog.attachBuildCoordinator({
            stateFor() {
                return {
                    running: false,
                    queued: false,
                    reason: null,
                    updatedAt: null,
                };
            },
            enqueue(input) {
                enqueued.push(input);
            },
        });
        try {
            await createProfileSourceDraft({
                profileKey: "agent.deleted",
                templateName: "basic-agent",
                name: "Deleted",
                description: "",
                systemPrompt: "待删除",
                fileName,
            }, workbenchRoots(userRoot));

            const result = await deleteProfileSource(catalog, {fileName}, workbenchRoots(userRoot));

            expect(result).toEqual({fileName, deleted: true});
            await expect(pathExists(join(userRoot, fileName))).resolves.toBe(false);
            expect(enqueued).toEqual([{
                reason: "profile_source_deleted",
            }]);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 30_000);

    it("解析新 TSX DSL 为 ProfilePrompt tree", () => {
        const root = buildSystemPromptRoot(`
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

export default defineAgentProfile({
    manifest: {key: "agent.parser", name: "Parser"},
    initialSchema: {},
    outputSchema: {},
    tools: {},
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <HistorySet>
                    <Message>
                        <Import path="reference/agent/project-workspace-guide.md" />
                    </Message>
                    <AIMessage>
                        <ToolCall id="call_read" name="read" args={{ path: "workspace/" }} />
                    </AIMessage>
                    <ToolResult toolCallId="call_read" toolName="read">ok</ToolResult>
                    <Message>历史初始化</Message>
                </HistorySet>
                <ModelContext>
                    <Message>{ctx.runtime?.now}</Message>
                </ModelContext>
                <AppendingSet>
                    <FileChangeNotice mode={ctx.settings.fileChangeAwareness} />
                    <Reminder id="plan">
                        <Message>提醒</Message>
                    </Reminder>
                    <Watch path="ctx.initial.prompt" />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
        `);

        expect(root).toEqual(expect.objectContaining({
            type: "ProfilePrompt",
            sourceRange: expect.objectContaining({
                start: expect.any(Number),
                end: expect.any(Number),
            }),
        }));
        expect(root?.children.map((node) => node.type)).toEqual([
            "System",
            "HistorySet",
            "ModelContext",
            "AppendingSet",
        ]);
        expect(root?.children[0]?.children[0]).toEqual(expect.objectContaining({
            type: "Text",
            textKind: "source",
            text: "renderSystemPrompt()",
        }));
        const importNode = root?.children[1]?.children[0]?.children[0];
        expect(importNode).toEqual(expect.objectContaining({
            type: "Import",
            props: expect.objectContaining({
                path: "reference/agent/project-workspace-guide.md",
            }),
        }));
        const toolCall = root?.children[1]?.children[1]?.children[0];
        expect(toolCall).toEqual(expect.objectContaining({
            type: "ToolCall",
            textKind: "source",
            text: "{ path: \"workspace/\" }",
        }));
        expect(root?.children[2]?.children.map((node) => node.type)).toEqual(["Message"]);
        const appendingChildren = root?.children[3]?.children ?? [];
        expect(appendingChildren.map((node) => node.type)).toEqual(["FileChangeNotice", "Reminder", "Watch"]);
        expect(appendingChildren[0]?.props.mode).toEqual({
            kind: "expression",
            code: "ctx.settings.fileChangeAwareness",
        });
    }, 30000);

    it("FileChangeNotice literal 属性可由 Inspector 源码往返解析", () => {
        const root = buildSystemPromptRoot(`
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

export default defineAgentProfile({
    manifest: {key: "agent.literal-notice", name: "Literal Notice"},
    initialSchema: {},
    outputSchema: {},
    tools: {},
    context() {
        return (
            <ProfilePrompt>
                <AppendingSet>
                    <FileChangeNotice mode="minimal" />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
        `);
        const notice = root?.children[0]?.children[0];

        expect(notice).toEqual(expect.objectContaining({
            type: "FileChangeNotice",
            props: {mode: "minimal"},
        }));
    }, 30_000);

    it("source-draft 是未保存源码预览入口，不写入真实用户 profile 文件", async () => {
        const root = resolve(".agent", "tmp", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
        try {
            await createProfileSourceDraft({
                profileKey: "agent.override",
                templateName: "basic-agent",
                name: "Override",
                description: "",
                systemPrompt: "原始提示词",
            }, workbenchRoots(userRoot));
            const fileName = "agent.override.profile.tsx";
            const filePath = join(userRoot, fileName);
            const originalSource = await readFile(filePath, "utf8");
            const checked = await readProfileSourceDraft({
                fileName,
                source: originalSource.replace("原始提示词", "未保存提示词"),
            }, workbenchRoots(userRoot));

            expect(checked.source).toContain("未保存提示词");
            expect(checked.root?.children.map((node: ProfileTemplateNodeDto) => node.type)).toContain("System");
            await expect(readFile(filePath, "utf8")).resolves.toBe(originalSource);
            await expect(pathExists(join(userRoot, ".compiled", "manifest.json"))).resolves.toBe(false);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

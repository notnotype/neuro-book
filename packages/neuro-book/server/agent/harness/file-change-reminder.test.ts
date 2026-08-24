import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {fauxAssistantMessage} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {AppendingSet, FileChangeNotice, ProfilePrompt} from "nbook/server/agent/profiles/profile-dsl";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {buildFileChangeReminder, mergeProfileTurnContextMessages} from "nbook/server/agent/profiles/profile-turn-context";
import type {AgentChangeDiffDetail} from "nbook/server/workspace-history/agent-change-diff";
import type {UnseenGroup} from "@notnotype/nb-history";
import {closeAllProjects,
    requireReadyModuleHandle,
    requireActiveReadyProject,
    resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {MAX_AGENT_CHANGE_NOTICE_CHARS} from "nbook/shared/agent/file-change-policy";
import {
    LOCAL_USER_ID,
    PROJECT_HISTORY_MODULE_TOKEN,
    recordProjectWrite,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

describe("file-change-reminder 纯函数", () => {
    it("buildFileChangeReminder：minimal 只含路径条数，full 含归因与操作类型", () => {
        const groups: UnseenGroup[] = [{
            path: "manuscript/ch1.md",
            baseHash: null,
            endHash: "abc",
            maxEntryId: 9,
            entries: [
                {id: 8, occurredAt: "2026-07-09T00:00:00Z", actor: {kind: "user", userId: "local"}, operation: {type: "file.create", path: "manuscript/ch1.md", afterHash: "aaa"}},
                {id: 9, occurredAt: "2026-07-09T00:01:00Z", actor: {kind: "agent", sessionId: "12"}, operation: {type: "file.edit", path: "manuscript/ch1.md", beforeHash: "aaa", afterHash: "abc"}},
            ],
        }];
        const minimal = buildFileChangeReminder(groups, "minimal");
        expect(minimal).toContain("<file-change-notice>");
        expect(minimal).toContain("added: [manuscript/ch1.md](manuscript/ch1.md) — 2 changes");
        expect(minimal).not.toContain("agent#12");

        const full = buildFileChangeReminder(groups, "full");
        expect(full).toContain("the user");
        expect(full).toContain("agent#12");
        expect(full).toContain("added");
        expect(full).toContain("modified");
        expect(full).toContain("read");
    });

    it("组合操作按净状态保留 Git 风格主状态", () => {
        const actor = {kind: "user", userId: "local"} as const;
        const entry = (id: number, operation: UnseenGroup["entries"][number]["operation"]): UnseenGroup["entries"][number] => ({
            id,
            occurredAt: new Date(id * 1000).toISOString(),
            actor,
            operation,
        });
        const groups: UnseenGroup[] = [
            {
                path: "notes/added.md",
                baseHash: null,
                endHash: "added-2",
                maxEntryId: 2,
                entries: [
                    entry(1, {type: "file.create", path: "notes/added.md", afterHash: "added-1"}),
                    entry(2, {type: "file.edit", path: "notes/added.md", beforeHash: "added-1", afterHash: "added-2"}),
                ],
            },
            {
                path: "notes/renamed.md",
                baseHash: "rename-1",
                endHash: "rename-2",
                maxEntryId: 4,
                entries: [
                    entry(3, {type: "file.rename", fromPath: "notes/old.md", toPath: "notes/renamed.md", contentHash: "rename-1"}),
                    entry(4, {type: "file.edit", path: "notes/renamed.md", beforeHash: "rename-1", afterHash: "rename-2"}),
                ],
            },
            {
                path: "notes/restored.md",
                baseHash: null,
                endHash: "restore-2",
                maxEntryId: 6,
                entries: [
                    entry(5, {type: "file.restore", path: "notes/restored.md", beforeHash: null, afterHash: "restore-1", sourceEntryId: 1}),
                    entry(6, {type: "file.edit", path: "notes/restored.md", beforeHash: "restore-1", afterHash: "restore-2"}),
                ],
            },
            {
                path: "notes/reverted.md",
                baseHash: "revert-before",
                endHash: "revert-2",
                maxEntryId: 8,
                entries: [
                    entry(7, {type: "file.revert", path: "notes/reverted.md", beforeHash: "revert-before", afterHash: "revert-1", revertedEntryIds: [1]}),
                    entry(8, {type: "file.edit", path: "notes/reverted.md", beforeHash: "revert-1", afterHash: "revert-2"}),
                ],
            },
            {
                path: "notes/deleted.md",
                baseHash: "delete-before",
                endHash: null,
                maxEntryId: 9,
                entries: [entry(9, {type: "file.revert", path: "notes/deleted.md", beforeHash: "delete-before", afterHash: null, revertedEntryIds: [2]})],
            },
        ];

        const notice = buildFileChangeReminder(groups, "minimal");

        expect(notice).toContain("added: [notes/added.md]");
        expect(notice).toContain("renamed: [notes/renamed.md]");
        expect(notice).toContain("restored: [notes/restored.md]");
        expect(notice).toContain("reverted: [notes/reverted.md]");
        expect(notice).toContain("deleted: notes/deleted.md");
    });

    it("安全小 diff 内联，超限 diff 只给引用与变更位置", () => {
        const groups: UnseenGroup[] = [{
            path: "manuscript/ch1.md",
            baseHash: "before",
            endHash: "after",
            maxEntryId: 1,
            entries: [{id: 1, occurredAt: "2026-07-09T00:00:00Z", actor: {kind: "user", userId: "local"}, operation: {type: "file.edit", path: "manuscript/ch1.md", beforeHash: "before", afterHash: "after"}}],
        }];
        const inlineDetails = new Map<string, AgentChangeDiffDetail>([["manuscript/ch1.md", {
            kind: "inline",
            diff: "@@ -1,1 +1,1 @@\n-old\n+new",
            locations: ["新 L1 / 旧 L1"],
            charCount: 31,
            changedLineCount: 2,
            lineLimit: 16,
        }]]);
        const inline = buildFileChangeReminder(groups, "minimal", inlineDetails, 512);
        expect(inline).toContain("Diff: 31 characters, 2 changed lines");
        expect(inline).toContain("+new");

        const referenceDetails = new Map<string, AgentChangeDiffDetail>([["manuscript/ch1.md", {
            kind: "reference",
            locations: ["新 L20-L40 / 旧 L18-L35"],
            charCount: 900,
            changedLineCount: 30,
            lineLimit: 16,
        }]]);
        const reference = buildFileChangeReminder(groups, "minimal", referenceDetails, 512);
        expect(reference).toContain("Location: new L20-L40 / old L18-L35");
        expect(reference).toContain("read complete current content only from non-sensitive paths when relevant");
        expect(reference).not.toContain("Use read for the complete current file");
    });

    it("2/4 个超限文件在 minimal/full 下都只输出一次完整读取指导", () => {
        for (const count of [2, 4]) {
            const groups = Array.from({length: count}, (_, index) => unseenGroup(`notes/reference-${index}.md`, index + 1));
            const details = new Map<string, AgentChangeDiffDetail>(groups.map((group, index) => [group.path, {
                kind: "reference" as const,
                locations: [`新 L${index + 1} / 旧 L${index + 1}`],
                charCount: 900 + index,
                changedLineCount: 30 + index,
                lineLimit: 16,
            }]));

            for (const mode of ["minimal", "full"] as const) {
                const notice = buildFileChangeReminder(groups, mode, details, 512);
                expect(notice.match(/Diff size:/g)).toHaveLength(count);
                expect(notice.match(/read complete current content only from non-sensitive paths when relevant/g)).toHaveLength(1);
                expect(notice).not.toContain("Use read for the complete current file");
            }
        }
    });

    it("单个敏感文件只给普通路径和检查限制，不生成链接、Inbox 或 read 建议", () => {
        const group = unseenGroup(".env.local", 1);
        const details = new Map<string, AgentChangeDiffDetail>([[group.path, {kind: "blocked"}]]);

        const notice = buildFileChangeReminder([group], "full", details, 512);

        expect(notice).toContain("modified: .env.local");
        expect(notice).not.toContain("[.env.local](.env.local)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("ask the user before inspecting them when the current task requires it");
        expect(notice).not.toContain("file change inbox");
        expect(notice).not.toContain("use read");
        expect(notice).not.toContain("Use read");
    });

    it("敏感文件不在前四个 diff detail 中时仍保持阻断表现", () => {
        const groups = [
            unseenGroup("notes/one.md", 1),
            unseenGroup("notes/two.md", 2),
            unseenGroup("notes/three.md", 3),
            unseenGroup("notes/four.md", 4),
            unseenGroup(".env.production", 5),
        ];

        const notice = buildFileChangeReminder(groups, "minimal", new Map(), 512);

        expect(notice).toContain("modified: .env.production");
        expect(notice).not.toContain("[.env.production](.env.production)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("ask the user before inspecting them when the current task requires it");
        expect(notice).not.toContain("file change inbox");
    });

    it("敏感与普通文件混合时 read 指引只适用于非敏感路径", () => {
        const groups = [unseenGroup("manuscript/ch1.md", 1), unseenGroup(".env.local", 2)];

        for (const mode of ["minimal", "full"] as const) {
            const notice = buildFileChangeReminder(groups, mode, new Map(), 512);

            expect(notice).toContain("[manuscript/ch1.md](manuscript/ch1.md)");
            expect(notice).not.toContain("[.env.local](.env.local)");
            expect(notice).toContain("read complete current content only from non-sensitive paths when relevant");
            expect(notice).toContain("Do not read or reproduce them solely because they changed");
            expect(notice).not.toContain("file change inbox");
        }
    });

    it("inline/reference/敏感/删除混合时逐文件事实完整且 footer 每类指导只出现一次", () => {
        const inlineGroup = unseenGroup("notes/inline.md", 1);
        const referenceGroup = unseenGroup("notes/reference.md", 2);
        const sensitiveGroup = unseenGroup(".env.local", 3);
        const deletedGroup = unseenGroup("manuscript/deleted.md", 4, null);
        const details = new Map<string, AgentChangeDiffDetail>([
            [inlineGroup.path, {
                kind: "inline",
                diff: "@@ -1,1 +1,1 @@\n-old\n+new",
                locations: ["新 L1 / 旧 L1"],
                charCount: 31,
                changedLineCount: 2,
                lineLimit: 16,
            }],
            [referenceGroup.path, {
                kind: "reference",
                locations: ["新 L20-L40 / 旧 L18-L35"],
                charCount: 900,
                changedLineCount: 30,
                lineLimit: 16,
            }],
            [sensitiveGroup.path, {kind: "blocked"}],
            [deletedGroup.path, {
                kind: "reference",
                locations: ["新 ∅ / 旧 L1-L40"],
                charCount: 901,
                changedLineCount: 40,
                lineLimit: 16,
            }],
        ]);

        const notice = buildFileChangeReminder(
            [inlineGroup, referenceGroup, sensitiveGroup, deletedGroup],
            "full",
            details,
            512,
        );

        expect(notice).toContain("Location: new L1 / old L1");
        expect(notice).toContain("Diff: 31 characters, 2 changed lines");
        expect(notice).toContain("Location: new L20-L40 / old L18-L35");
        expect(notice).toContain("Diff size: 900 characters, 30 changed lines");
        expect(notice).not.toContain("[.env.local](.env.local)");
        expect(notice).toContain("Sensitive path");
        expect(notice).not.toContain("[manuscript/deleted.md](manuscript/deleted.md)");
        expect(notice).toContain("The current file is deleted");
        expect(notice.match(/read complete current content only from non-sensitive paths when relevant/g)).toHaveLength(1);
        expect(notice.match(/Do not read or reproduce them solely because they changed/g)).toHaveLength(1);
        expect(notice.match(/Deleted paths have no current file/g)).toHaveLength(1);
        expect(notice).not.toContain("file change inbox");
    });

    it("敏感删除文件无链接且明确当前路径不可读取", () => {
        const group = unseenGroup("credentials/private.key", 1, null);

        const notice = buildFileChangeReminder([group], "full", new Map(), 512);

        expect(notice).toContain("deleted: credentials/private.key");
        expect(notice).not.toContain("[credentials/private.key](credentials/private.key)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("current file is deleted");
        expect(notice).toContain("Deleted paths have no current file");
        expect(notice).not.toContain("use read");
        expect(notice).not.toContain("Use read");
    });

    it("批量变更最多逐项列出 50 个文件，并保留准确遗漏数量", () => {
        const groups = Array.from({length: 55}, (_, index) => unseenGroup(`notes/change-${index}.md`, index + 1));

        const notice = buildFileChangeReminder(groups, "minimal");

        expect(notice).toContain("notes/change-49.md");
        expect(notice).not.toContain("notes/change-50.md");
        expect(notice).toContain("5 additional changed files were not expanded");
        expect(Array.from(notice).length).toBeLessThanOrEqual(12_288);
    });

    it("长路径批次逼近总预算时减少展开项并保持 notice 硬上限", () => {
        const groups = Array.from({length: 50}, (_, index) => unseenGroup(
            `notes/${String(index).padStart(2, "0")}-${"x".repeat(900)}.md`,
            index + 1,
        ));

        const notice = buildFileChangeReminder(groups, "full");
        const listedCount = notice.match(/^- modified:/gmu)?.length ?? 0;

        expect(listedCount).toBeGreaterThan(0);
        expect(listedCount).toBeLessThan(50);
        expect(notice).toContain(`${50 - listedCount} additional changed files were not expanded`);
        expect(Array.from(notice).length).toBeLessThanOrEqual(MAX_AGENT_CHANGE_NOTICE_CHARS);
    });

    it("删除文件不生成当前文件链接，超限时只提示当前路径不可读取", () => {
        const group = unseenGroup("manuscript/deleted.md", 1, null);
        const details = new Map<string, AgentChangeDiffDetail>([[group.path, {
            kind: "reference",
            locations: ["新 ∅ / 旧 L1-L40"],
            charCount: 900,
            changedLineCount: 40,
            lineLimit: 16,
        }]]);

        const notice = buildFileChangeReminder([group], "full", details, 512);

        expect(notice).toContain("deleted: manuscript/deleted.md");
        expect(notice).not.toContain("[manuscript/deleted.md](manuscript/deleted.md)");
        expect(notice).toContain("current file is deleted");
        expect(notice).not.toContain("Use read for the complete current file");
    });

    it("动态 notice 按 Profile 声明的位置插回 AppendingSet", () => {
        const merged = mergeProfileTurnContextMessages(
            [createUserMessage({text: "BEFORE"}), createUserMessage({text: "AFTER"})],
            [{appendingIndex: 1, message: createUserMessage({text: "NOTICE"})}],
        );

        expect(merged.map((message) => storedMessageText(message))).toEqual(["BEFORE", "NOTICE", "AFTER"]);
    });
});

/** 构造 notice 纯函数测试使用的单条 unseen 分组。 */
function unseenGroup(path: string, id: number, endHash: string | null = `after-${id}`): UnseenGroup {
    return {
        path,
        baseHash: `before-${id}`,
        endHash,
        maxEntryId: id,
        entries: [{
            id,
            occurredAt: new Date(id * 1000).toISOString(),
            actor: {kind: "user", userId: "local"},
            operation: endHash === null
                ? {type: "file.delete", path, beforeHash: `before-${id}`}
                : {type: "file.edit", path, beforeHash: `before-${id}`, afterHash: endHash},
        }],
    };
}

describe("file-change notice 端到端（FauxProvider 黑盒）", () => {
    let agentRoot: string;
    let workspaceRoot: AbsoluteFsPath;
    let tempRoot: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        setHistoryEnabledOverrideForTest(true);
        tempRoot = testHostPath(`nb-file-change-notice-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        agentRoot = workspaceRoot;
        faux = createFauxModels({
            models: [{id: `faux-${randomUUID()}`, contextWindow: 128_000, maxTokens: 8_000}],
        });
        await writeFauxProviderConfig(workspaceRoot, faux);
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(agentRoot),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(workspaceRoot),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await closeAllProjects().catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(agentRoot, {recursive: true, force: true}).catch(() => undefined);
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    /** session 内 <file-change-notice> 消息计数。 */
    async function countNotices(sessionId: number): Promise<number> {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        return context.messages
            .filter((message) => storedMessageText(message).includes("<file-change-notice>"))
            .length;
    }

    /** 取得当前 ready ProjectSession generation 的精确 History handle。 */
    function historyHandle(projectRoot: string): ProjectHistoryHandle {
        const ready = requireActiveReadyProject(projectWorkspaceRef(projectRoot));
        return requireReadyModuleHandle(
            ready,
            PROJECT_HISTORY_MODULE_TOKEN,
        );
    }

    it("他人变更注入 notice，成功轮推进游标，下轮不重复；首轮懒基线不淹没", async () => {
        const projectRoot = "notice-e2e";
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef(projectRoot), {kind: "novel", title: "notice", summary: ""});
        await openProjectForTest(projectRoot);

        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice", name: "Notice"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "minimal"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice",
            initial: {},
            currentProjectRoot: "notice-e2e",
        });

        // 首轮：Profile 显式声明 notice；懒 initCursor 以当下为基线。
        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        const first = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        expect(first.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);

        // 他人（用户）改文件
        await recordProjectWrite(historyHandle(projectRoot), {
            relativePath: "manuscript/ch1.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("用户改动"),
        });

        // 第二轮：pre-model 注入 notice
        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        const second = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});
        expect(second.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(1);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const notice = context.messages
            .map((message) => storedMessageText(message))
            .find((text) => text.includes("<file-change-notice>"));
        expect(notice).toContain("manuscript/ch1.md");
        expect(notice).toContain("Diff:");
        expect(notice).toContain("+用户改动");

        // 第三轮：游标已推进且无新变更，不再注入
        faux.setResponses([fauxAssistantMessage("第三轮完成")]);
        const third = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第三轮"}});
        expect(third.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(1);
    }, 30_000);

    it("模型失败不推进游标，notice 位于 CurrentUserInput 前并在成功重试后结算", async () => {
        const projectRoot = "notice-at-least-once";
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef(projectRoot), {kind: "novel", title: "notice-at-least-once", summary: ""});
        await openProjectForTest(projectRoot);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.retry", name: "NoticeRetry"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "minimal"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.retry",
            initial: {},
            currentProjectRoot: "notice-at-least-once",
        });

        faux.setResponses([fauxAssistantMessage("建立基线")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "基线轮"}});
        await recordProjectWrite(historyHandle(projectRoot), {
            relativePath: "manuscript/retry.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("需要重复交付"),
        });

        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            const noticeIndex = texts.findIndex((text) => text.includes("<file-change-notice>"));
            expect(noticeIndex).toBeGreaterThanOrEqual(0);
            expect(noticeIndex).toBeLessThan(texts.length - 1);
            expect(texts.at(-1)).toContain("失败轮");
            return fauxAssistantMessage("provider failed", {stopReason: "error", errorMessage: "provider failed"});
        }]);
        const failed = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "失败轮"}});
        expect(failed.status).toBe("error");

        let retryNoticeCount = 0;
        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            expect(texts.some((text) => text.includes("manuscript/retry.md"))).toBe(true);
            expect(texts.at(-1)).toContain("重试轮");
            retryNoticeCount = texts.filter((text) => text.includes("<file-change-notice>")).length;
            return fauxAssistantMessage("重试成功");
        }]);
        const retried = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "重试轮"}});
        expect(retried.status).toBe("completed");

        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            expect(texts.filter((text) => text.includes("<file-change-notice>")).length).toBe(retryNoticeCount);
            return fauxAssistantMessage("结算完成");
        }]);
        const settled = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "结算检查"}});
        expect(settled.status).toBe("completed");
    }, 30_000);

    it("无 Current Project 的 session 不注入 notice", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.global", name: "NoticeGlobal"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.global",
            initial: {},
        });
        faux.setResponses([fauxAssistantMessage("完成")]);
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "跑一轮"}});
        expect(result.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);
    }, 30_000);

    it("敏感文件只注入引用和阻断说明，绝不把正文或 diff 送给 Agent", async () => {
        const projectRoot = "notice-sensitive";
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef(projectRoot), {kind: "novel", title: "notice-sensitive", summary: ""});
        await openProjectForTest(projectRoot);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.sensitive", name: "NoticeSensitive"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "full"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.sensitive",
            initial: {},
            currentProjectRoot: "notice-sensitive",
        });

        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        await recordProjectWrite(historyHandle(projectRoot), {
            relativePath: ".env.local",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("SUPER_SECRET_VALUE=never-echo"),
        });

        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const notice = context.messages
            .map((message) => storedMessageText(message))
            .find((text) => text.includes("<file-change-notice>"));

        expect(notice).toContain(".env.local");
        expect(notice).toContain("Sensitive path");
        expect(notice).not.toContain("SUPER_SECRET_VALUE");
        expect(notice).not.toContain("never-echo");
    }, 30_000);

    it("有 Project 和未见变更，但 Profile 未声明节点时绝不注入 notice", async () => {
        const projectRoot = "notice-disabled";
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef(projectRoot), {kind: "novel", title: "notice-disabled", summary: ""});
        await openProjectForTest(projectRoot);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.disabled", name: "NoticeDisabled"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.disabled",
            initial: {},
            currentProjectRoot: "notice-disabled",
        });

        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        await recordProjectWrite(historyHandle(projectRoot), {
            relativePath: "manuscript/ch1.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("用户改动"),
        });

        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});

        expect(result.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);
    }, 30_000);
});

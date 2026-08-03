import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {consola} from "consola";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentSessionNotFoundError, isAgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {Usage} from "nbook/server/agent/messages/types";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        cost: {
            input,
            output,
            cacheRead,
            cacheWrite,
            total: input + output + cacheRead + cacheWrite,
        },
    };
}

describe("JsonlSessionRepository", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = absoluteFsPath(resolve(".agent", "agent-session-test", randomUUID()));
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("缺失的 Session 文件统一抛出稳定领域错误", async () => {
        const missingSessionId = 17;

        await expect(repo.readSession(missingSessionId)).rejects.toEqual(expect.objectContaining({
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: missingSessionId,
        }));
        await expect(repo.readEntryContext(missingSessionId, randomUUID())).rejects.toBeInstanceOf(AgentSessionNotFoundError);
        await expect(repo.scanEntries(missingSessionId, () => {})).rejects.toBeInstanceOf(AgentSessionNotFoundError);
        await expect(repo.sessionFileSignature(missingSessionId)).rejects.toBeInstanceOf(AgentSessionNotFoundError);
    });

    it("Not Found 类型守卫跨 HMR 按稳定字段识别", () => {
        const reloadedError = Object.assign(new Error("missing"), {
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: 17,
        });

        expect(isAgentSessionNotFoundError(reloadedError)).toBe(true);
        expect(isAgentSessionNotFoundError(Object.assign(new Error("missing"), {
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: 0,
        }))).toBe(false);
    });

    it("列表与读取之间删除 Session 时返回 Not Found 且不读取备份目录", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const backupPath = join(root, ".nbook", "agent", "session-backups", "cross-instance", `${String(session.metadata.sessionId)}.jsonl`);
        await mkdir(join(root, ".nbook", "agent", "session-backups", "cross-instance"), {recursive: true});
        await writeFile(backupPath, await readFile(sessionPath, "utf8"), "utf8");
        const listed = await repo.listSessions();
        await rm(sessionPath);

        expect(listed.map((item) => item.sessionId)).toContain(session.metadata.sessionId);
        await expect(repo.readSession(session.metadata.sessionId)).rejects.toBeInstanceOf(AgentSessionNotFoundError);
        expect(await repo.listSessions()).toEqual([]);
    });

    it("现存损坏文件和 visitor 的其它 ENOENT 不会被误判为 Session Not Found", async () => {
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        await writeFile(sessionPath, "{broken-json}\n", "utf8");

        await expect(repo.readSession(session.metadata.sessionId)).rejects.not.toBeInstanceOf(AgentSessionNotFoundError);

        const healthy = await repo.createSession({profileKey: "leader.default", initial: {}});
        await expect(repo.scanEntries(healthy.metadata.sessionId, async () => {
            await readFile(join(root, "missing-visitor-file"), "utf8");
        })).rejects.toMatchObject({code: "ENOENT"});
    });

    it("创建 session 使用全局递增 ID 并 reduce active path", async () => {
        const first = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "first",
        });
        const second = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "novel-a",
            title: "second",
        });

        expect(first.metadata.sessionId).toBe(1);
        expect(second.metadata.sessionId).toBe(2);

        await repo.appendUserMessage(first.metadata.sessionId, "hello");
        await repo.appendMessage(first.metadata.sessionId, createAssistantTextMessage({text: "hi"}));
        await repo.appendEntry(first.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "renamed",
                summary: "short summary",
            },
        });

        const context = repo.reduce(await repo.readSession(first.metadata.sessionId));

        expect(context.title).toBe("renamed");
        expect(context.summary).toBe("short summary");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    });

    it("workspace-root scope 只返回未绑定 Current Project 的 Session", async () => {
        const workspaceSession = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "workspace session",
        });
        const projectSession = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "novel-7",
            title: "project session",
        });
        const userAssetsSession = await repo.createSession({
            profileKey: "leader.assets",
            initial: {},
            title: "assets session",
        });

        const sessions = await repo.listSessions({scope: "workspace-root"});

        expect(sessions.map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            workspaceSession.metadata.sessionId,
            userAssetsSession.metadata.sessionId,
        ]);
        expect(sessions.some((session) => session.sessionId === projectSession.metadata.sessionId)).toBe(false);
    });

    it("recovery=required 只返回需要确认 Current Project 的 Session", async () => {
        const review = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "ambiguous-project",
            title: "needs recovery",
        });
        const reviewPath = join(root, ".nbook", "agent", "sessions", `${String(review.metadata.sessionId)}.jsonl`);
        const reviewSource = await readFile(reviewPath, "utf8");
        await writeFile(
            reviewPath,
            reviewSource.replace(
                '"currentProjectRoot":"ambiguous-project"',
                '"migrationReview":{"status":"required","reason":"current_project_unresolved"}',
            ),
            "utf8",
        );
        await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "known-project",
            title: "known project",
        });
        await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "workspace root",
        });

        const sessions = await repo.listSessions({scope: "all", recovery: "required"});

        expect(sessions).toEqual([expect.objectContaining({
            sessionId: review.metadata.sessionId,
            migrationReview: {status: "required", reason: "current_project_unresolved"},
        })]);
    });

    it("列表隔离单个损坏metadata并返回结构化issue", async () => {
        const healthy = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const corrupt = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const corruptPath = join(root, ".nbook", "agent", "sessions", `${String(corrupt.metadata.sessionId)}.jsonl`);
        const source = await readFile(corruptPath, "utf8");
        await writeFile(corruptPath, source.replace('"schemaVersion":2', '"schemaVersion":2,"workspaceRoot":"workspace"'), "utf8");

        const result = await repo.listSessionsWithIssues();

        expect(result.sessions).toEqual([
            expect.objectContaining({sessionId: healthy.metadata.sessionId}),
        ]);
        expect(result.issues).toEqual([{
            sessionId: corrupt.metadata.sessionId,
            fileName: `${String(corrupt.metadata.sessionId)}.jsonl`,
            message: expect.stringContaining("已删除或未知字段：workspaceRoot"),
        }]);
    });

    it("相同Session问题集合只告警一次，修复后复发会重新告警", async () => {
        const corrupt = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const corruptPath = join(root, ".nbook", "agent", "sessions", `${String(corrupt.metadata.sessionId)}.jsonl`);
        const source = await readFile(corruptPath, "utf8");
        const invalid = source.replace('"schemaVersion":2', '"schemaVersion":2,"workspaceRoot":"workspace"');
        await writeFile(corruptPath, invalid, "utf8");
        const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

        await repo.listSessions();
        await repo.listSessions();
        expect(warn).toHaveBeenCalledTimes(1);

        await writeFile(corruptPath, source, "utf8");
        await repo.listSessions();
        await writeFile(corruptPath, invalid, "utf8");
        await repo.listSessions();
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it("session 列表支持摘要搜索和 offset 分页", async () => {
        const alpha = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "Alpha Session",
        });
        const beta = await repo.createSession({
            profileKey: "writer",
            initial: {},
            title: "Beta Session",
        });
        await repo.appendEntry(alpha.metadata.sessionId, {
            type: "session_update",
            updates: {summary: "dragon outline"},
        });
        await repo.appendUserMessage(beta.metadata.sessionId, "needle in preview");

        await expect(repo.listSessions({scope: "workspace-root", search: "dragon"})).resolves.toEqual([
            expect.objectContaining({sessionId: alpha.metadata.sessionId}),
        ]);
        await expect(repo.listSessions({scope: "workspace-root", search: "writer"})).resolves.toEqual([
            expect.objectContaining({sessionId: beta.metadata.sessionId}),
        ]);
        await expect(repo.listSessions({scope: "workspace-root", search: "needle"})).resolves.toEqual([
            expect.objectContaining({sessionId: beta.metadata.sessionId}),
        ]);
        await expect(repo.listSessions({scope: "workspace-root", offset: 1, limit: 1})).resolves.toHaveLength(1);
    });

    it("session 列表支持按 profileKey 精确筛选", async () => {
        const inline = await repo.createSession({
            profileKey: "inline.editor",
            initial: {},
            currentProjectRoot: "novel-a",
            title: "inline",
        });
        await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "novel-a",
            title: "leader",
        });
        await repo.createSession({
            profileKey: "inline.editor",
            initial: {},
            currentProjectRoot: "novel-b",
            title: "other inline",
        });

        const sessions = await repo.listSessions({
            scope: "project",
            projectRoot: "novel-a",
            profileKey: "inline.editor",
        });

        expect(sessions).toEqual([
            expect.objectContaining({
                sessionId: inline.metadata.sessionId,
                profileKey: "inline.editor",
                currentProjectRoot: "novel-a",
            }),
        ]);
    });

    it("session summary 累加 active path 中所有 assistant usage", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });

        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({
            text: "first",
            usage: usage(10, 3, 2, 1),
        }));
        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({
            text: "second",
            usage: usage(20, 7, 4, 0),
        }));

        const summary = repo.summary(await repo.readSession(session.metadata.sessionId));

        expect(summary.usage).toMatchObject({
            input: 30,
            output: 10,
            cacheRead: 6,
            cacheWrite: 1,
            totalTokens: 47,
            cost: {
                input: 30,
                output: 10,
                cacheRead: 6,
                cacheWrite: 1,
                total: 47,
            },
        });
    });

    it("session summary usage 不受 compaction 删除上下文影响", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({
            text: "before compact",
            usage: usage(100, 20),
        }));
        const kept = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({
            text: "after compact",
            usage: usage(10, 2),
        }));
        await repo.appendEntry(session.metadata.sessionId, {
            type: "compaction",
            summary: "compressed previous context",
            firstKeptEntryId: kept.id,
            tokensBefore: 120,
        });

        const snapshot = await repo.readSession(session.metadata.sessionId);

        expect(repo.reduce(snapshot).messages.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(repo.summary(snapshot).usage).toMatchObject({
            input: 110,
            output: 22,
            totalTokens: 132,
        });
    });

    it("session 列表支持 profile、状态、关系和数量筛选", async () => {
        const leader = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "leader",
        });
        await repo.createSession({
            profileKey: "writer",
            initial: {},
            parentSessionId: leader.metadata.sessionId,
            title: "writer",
        });
        const assetsLeader = await repo.createSession({
            profileKey: "leader.assets",
            initial: {},
            title: "assets leader",
        });
        await repo.createSession({
            profileKey: "rp.leader",
            initial: {},
            title: "rp leader",
        });
        await repo.createSession({
            profileKey: "simulator.leader",
            initial: {},
            title: "simulator leader",
        });
        await repo.appendEntry(assetsLeader.metadata.sessionId, {
            type: "session_archived",
            reason: "test",
        });

        const leaders = await repo.listSessions({
            scope: "workspace-root",
            includeArchived: true,
            profileGroup: "leader",
        });
        expect(leaders.map((session) => session.profileKey)).toEqual(["leader.assets", "simulator.leader", "rp.leader", "leader.default"]);

        const topActiveLeaders = await repo.listSessions({
            scope: "workspace-root",
            profileGroup: "leader",
            status: "active",
            relation: "top",
            limit: 1,
        });
        expect(topActiveLeaders).toHaveLength(1);
        expect(topActiveLeaders[0]).toMatchObject({
            profileKey: "simulator.leader",
        });

        const childSessions = await repo.listSessions({
            scope: "workspace-root",
            includeArchived: true,
            relation: "child",
        });
        expect(childSessions.map((session) => session.profileKey)).toEqual(["writer"]);

        const runtimeOnlySessions = await repo.listSessions({
            scope: "workspace-root",
            includeArchived: true,
            status: "running",
        });
        expect(runtimeOnlySessions).toEqual([]);
    });

    it("session 列表默认隐藏 system session，includeSystem 时显示", async () => {
        const leader = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "leader",
        });
        const summarizer = await repo.createSession({
            profileKey: "summarizer",
            initial: {sourceSessionId: leader.metadata.sessionId},
            systemRole: "summarizer",
            title: "summarizer",
        });

        const defaultList = await repo.listSessions({scope: "workspace-root"});
        const systemList = await repo.listSessions({scope: "workspace-root", includeSystem: true});

        expect(defaultList.map((session) => session.sessionId)).toEqual([leader.metadata.sessionId]);
        expect(systemList.map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            leader.metadata.sessionId,
            summarizer.metadata.sessionId,
        ]);
        expect(systemList.find((session) => session.sessionId === summarizer.metadata.sessionId)?.systemRole).toBe("summarizer");
    });

    it("active leaf scoped projection 只影响绑定的分支", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "base",
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "root");
        const firstBranch = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "branch a"}));
        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        const secondBranch = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "branch b"}));

        const firstProjection = await repo.appendProjectionEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "Branch A Title",
                summary: "Branch A summary",
            },
        }, {
            scope: "activeLeaf",
            leafId: firstBranch.id,
        });
        const secondProjection = await repo.appendProjectionEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "Branch B Title",
                summary: "Branch B summary",
            },
        }, {
            scope: "activeLeaf",
            leafId: secondBranch.id,
        });

        let snapshot = await repo.readSession(session.metadata.sessionId);
        expect(snapshot.leafId).toBe(secondBranch.id);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Branch B Title",
            summary: "Branch B summary",
        });

        await repo.moveLeaf(session.metadata.sessionId, firstBranch.id);
        snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Branch A Title",
            summary: "Branch A summary",
        });

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "base",
            summary: undefined,
        });
        const treeNodeIds = repo.tree(snapshot).map((node) => node.id);
        expect(treeNodeIds).not.toContain(firstProjection.id);
        expect(treeNodeIds).not.toContain(secondProjection.id);
    });

    it("active leaf scoped projection 在绑定 leaf 之后的同一路径继续生效", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "base",
        });
        await repo.appendUserMessage(session.metadata.sessionId, "你好");
        const summarizedLeaf = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "你好！"}));

        await repo.appendProjectionEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "Greeting",
                summary: "用户向助手打招呼。",
            },
        }, {
            scope: "activeLeaf",
            leafId: summarizedLeaf.id,
        });

        let snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Greeting",
            summary: "用户向助手打招呼。",
        });

        await repo.appendUserMessage(session.metadata.sessionId, "你好");
        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "你好！有什么想聊的？"}));

        snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Greeting",
            summary: "用户向助手打招呼。",
        });
    });

    it("Session Tree 的工具名、标题预览和 label 都使用有界公开文本", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const user = await repo.appendUserMessage(session.metadata.sessionId, "root");
        const toolName = "tool-" + "x".repeat(10_000);
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "call-1",
            toolName,
            text: "ok",
        }));
        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "标题" + "长".repeat(10_000),
            },
        });
        await repo.appendEntry(session.metadata.sessionId, {
            type: "label",
            targetEntryId: user.id,
            label: "标签" + "长".repeat(10_000),
        });

        const tree = repo.tree(await repo.readSession(session.metadata.sessionId));
        const toolNode = tree.find((node) => node.role === "toolResult");
        const titleNode = tree.find((node) => node.type === "session_update");
        const userNode = tree.find((node) => node.id === user.id);

        expect(toolNode?.toolName).toBeDefined();
        expect(Buffer.byteLength(toolNode?.toolName ?? "", "utf8")).toBeLessThanOrEqual(512);
        expect(titleNode?.preview).toBeDefined();
        expect(Buffer.byteLength(titleNode?.preview ?? "", "utf8")).toBeLessThanOrEqual(512);
        expect(userNode?.label).toBeDefined();
        expect(Buffer.byteLength(userNode?.label ?? "", "utf8")).toBeLessThanOrEqual(512);
    });

    it("支持 leaf 移动和 fork，历史不删除", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "first");
        expect(repo.activePathRevision(await repo.readSession(session.metadata.sessionId))).toBeNull();

        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "answer"}));
        expect(repo.activePathRevision(await repo.readSession(session.metadata.sessionId))).toBeNull();

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        const moved = await repo.readSession(session.metadata.sessionId);
        const moveLeafEntry = moved.entries.findLast((entry) => entry.type === "leaf" && entry.origin === "move");

        expect(repo.reduce(moved).messages.map((message) => message.role)).toEqual(["user"]);
        expect(repo.tree(moved).some((node) => node.type === "message" && !node.active)).toBe(true);
        expect(repo.activePathRevision(moved)).toBe(moveLeafEntry?.id);

        const fork = await repo.forkSession(session.metadata.sessionId, userEntry.id);
        const forkContext = repo.reduce(fork);

        expect(fork.metadata.sessionId).toBe(2);
        // fork 不是子 Agent，不能占用 parentSessionId，否则会从顶层 session 列表消失。
        expect(fork.metadata.parentSessionId).toBeUndefined();
        expect(forkContext.customState["fork.from"]).toEqual({
            sessionId: session.metadata.sessionId,
            entryId: userEntry.id,
        });
    });

    it("tree 返回消息展示元数据和终端节点信息", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "first message");
        const firstAssistantEntry = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "first answer"}));

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        const secondAssistantEntry = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "second answer"}));
        await repo.appendEntry(session.metadata.sessionId, {
            type: "label",
            targetEntryId: secondAssistantEntry.id,
            label: "selected",
        });

        const tree = repo.tree(await repo.readSession(session.metadata.sessionId));
        const userNode = tree.find((node) => node.id === userEntry.id);
        const firstAssistantNode = tree.find((node) => node.id === firstAssistantEntry.id);
        const secondAssistantNode = tree.find((node) => node.id === secondAssistantEntry.id);

        expect(userNode).toMatchObject({
            role: "user",
            preview: "first message",
            childCount: 2,
            terminal: false,
            active: true,
        });
        // appendUserMessage 写的是 origin: "manual"，只进模型上下文不进 Chat Flow。
        expect(userNode?.chatEntry).toBeUndefined();
        expect(firstAssistantNode).toMatchObject({
            role: "assistant",
            preview: "first answer",
            childCount: 0,
            terminal: true,
            active: false,
        });
        expect(firstAssistantNode?.chatEntry).toBe("assistant");
        expect(secondAssistantNode).toMatchObject({
            role: "assistant",
            preview: "second answer",
            label: "selected",
            terminal: false,
            active: true,
        });
    });

    it("appendEntries 以单条 batch record 写入多条 entry 并只移动一次 leaf", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        await repo.appendUserMessage(session.metadata.sessionId, "run");

        const entries = await repo.appendEntries(session.metadata.sessionId, [
            {
                type: "message",
                message: createAssistantTextMessage({text: "I will call a tool"}),
                origin: "harness",
            },
            {
                type: "message",
                message: createTextToolResult({
                    toolCallId: "call-1",
                    toolName: "read",
                    text: "ok",
                }),
                origin: "harness",
            },
        ]);

        expect(entries.map((entry) => entry.type)).toEqual(["message", "message"]);
        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot).messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: unknown[]});
        const batch = records.find((record) => record.kind === "batch");
        expect(batch?.entries?.map((entry) => (entry as {type: string}).type)).toEqual(["message", "message", "leaf"]);
    });

    it("linked agent 关系按 session 全量 entry reduce，不受 active path 分支影响", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const branchPoint = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "branch point"}));
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom",
            key: "agent.link.177",
            value: {
                sessionId: 177,
                profileKey: "simulator.leader",
            },
        });
        await repo.moveLeaf(session.metadata.sessionId, branchPoint.id);

        const context = repo.reduce(await repo.readSession(session.metadata.sessionId));

        expect(context.messages.map((message) => message.role)).toEqual(["assistant"]);
        expect(context.linkedAgents).toEqual([
            {
                sessionId: 177,
                profileKey: "simulator.leader",
                detached: false,
            },
        ]);
    });

    it("读写两侧都拒绝尚未迁移的 raw image", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const rawMessage = {
            role: "toolResult" as const,
            toolCallId: "call-image",
            toolName: "read",
            content: [{type: "image" as const, mimeType: "image/png", data: "AAAA"}],
            isError: false,
            timestamp: Date.now(),
        };

        await expect(repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            message: rawMessage as never,
        })).rejects.toMatchObject({code: "migration_required"});

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        await appendFile(sessionPath, `${JSON.stringify({
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: Date.now(),
                type: "message",
                message: rawMessage,
            },
        })}\n`, "utf8");

        await expect(repo.readSession(session.metadata.sessionId)).rejects.toMatchObject({code: "migration_required"});
        await expect(repo.listSessionsWithIssues()).rejects.toMatchObject({code: "migration_required"});
    });

    it("readEntry 为投影 Current Project 扫描完整 JSONL 并拒绝损坏尾部", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const target = await repo.appendUserMessage(session.metadata.sessionId, "target");
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        await appendFile(sessionPath, "{not-json-after-target}\n", "utf8");

        await expect(repo.readEntry(session.metadata.sessionId, target.id)).rejects.toThrow();
        await expect(repo.readSession(session.metadata.sessionId)).rejects.toThrow();
    });

    it("Runtime 拒绝旧完整 Model 且不改写源文件", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        await appendFile(sessionPath, `${JSON.stringify({
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: Date.now(),
                type: "model_change",
                model: {
                    providerConfigId: "provider-a",
                    provider: "upstream-provider",
                    id: "model-a",
                    baseUrl: "https://private.example",
                    headers: {Authorization: "Bearer secret"},
                },
            },
        })}\n`, "utf8");

        const original = await readFile(sessionPath, "utf8");
        const strictRepo = new JsonlSessionRepository(root);

        await expect(strictRepo.readSession(session.metadata.sessionId))
            .rejects.toThrow("只包含providerConfigId和modelId");
        expect(await readFile(sessionPath, "utf8")).toBe(original);
    });

    it("旧 Model 身份无法证明时稳定阻断且不改写源文件", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        await appendFile(sessionPath, `${JSON.stringify({
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: Date.now(),
                type: "model_change",
                model: {id: "model-without-provider", headers: {Authorization: "Bearer secret"}},
            },
        })}\n`, "utf8");
        const original = await readFile(sessionPath, "utf8");
        const blockedRepo = new JsonlSessionRepository(root);

        await expect(blockedRepo.readSession(session.metadata.sessionId)).rejects.toThrow("只包含providerConfigId和modelId");
        await expect(blockedRepo.readEntry(session.metadata.sessionId, randomUUID())).rejects.toThrow("只包含providerConfigId和modelId");
        expect(await readFile(sessionPath, "utf8")).toBe(original);
    });

    it("新 model_change 只允许写入 Provider Config ID 与 Model ID", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        await repo.appendEntry(session.metadata.sessionId, {
            type: "model_change",
            model: {providerConfigId: "provider-a", modelId: "model-a"},
        });
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {entry?: {type?: string; model?: object}});
        const modelChange = records.find((record) => record.entry?.type === "model_change");

        expect(modelChange?.entry?.model).toEqual({providerConfigId: "provider-a", modelId: "model-a"});
        await expect(repo.appendEntry(session.metadata.sessionId, {
            type: "model_change",
            model: {providerConfigId: "provider-a", modelId: "model-a", headers: {Authorization: "secret"}},
        } as never)).rejects.toThrow("只包含providerConfigId和modelId");
    });

    it("一个旧 Session 无法脱敏时不会阻断其他 Session", async () => {
        const blocked = await repo.createSession({profileKey: "leader.default", initial: {}});
        const healthy = await repo.createSession({profileKey: "leader.default", initial: {}});
        const blockedPath = join(root, ".nbook", "agent", "sessions", `${String(blocked.metadata.sessionId)}.jsonl`);
        await appendFile(blockedPath, `${JSON.stringify({
            kind: "entry",
            entry: {id: randomUUID(), parentId: null, timestamp: Date.now(), type: "model_change", model: {provider: "registry", id: "model"}},
        })}\n`, "utf8");
        const isolatedRepo = new JsonlSessionRepository(root);

        await expect(isolatedRepo.readSession(healthy.metadata.sessionId)).resolves.toMatchObject({metadata: {sessionId: healthy.metadata.sessionId}});
        const result = await isolatedRepo.listSessionsWithIssues();
        expect(result.sessions.some((session) => session.sessionId === healthy.metadata.sessionId)).toBe(true);
        expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({sessionId: blocked.metadata.sessionId, message: expect.stringContaining("只包含providerConfigId和modelId")})]));
    });
});

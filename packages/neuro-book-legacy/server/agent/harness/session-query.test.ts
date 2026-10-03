import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("NeuroAgentHarness session query", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("recovery 在读取 JSONL 前捕获 event cursor，期间 append/publish 不会被跳过", async () => {
        const root = absoluteFsPath(testHostPath("session-query-test", randomUUID()));
        roots.push(root);
        const repo = new JsonlSessionRepository(root);
        const harness = new NeuroAgentHarness({
            repo,
            profiles: new AgentProfileCatalog(
                join(root, "system-profiles"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            enableSessionSummarizer: false,
        });
        const created = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        harness.eventHub.pinReplayFrom(created.metadata.sessionId, 1);

        const originalReadSession = repo.readSession.bind(repo);
        let publishedSeq = 0;
        let injectedEntryId = "";
        let injected = false;
        repo.readSession = async (...args) => {
            if (!injected) {
                injected = true;
                const entry = await repo.appendEntry(created.metadata.sessionId, {
                    type: "message",
                    origin: "prompt",
                    clientMessageId: randomUUID(),
                    intent: "normal",
                    message: {
                        role: "user",
                        content: [{type: "text", text: "cursor 之后写入"}],
                        timestamp: 100,
                    },
                });
                const projected = projectAgentChatEntry(entry);
                if (!projected) {
                    throw new Error("测试 entry 应可公开投影");
                }
                injectedEntryId = entry.id;
                publishedSeq = harness.eventHub.publish({
                    sessionId: created.metadata.sessionId,
                    kind: "session",
                    event: {type: "session_entry", entry: projected},
                }).payload.seq;
            }
            return originalReadSession(...args);
        };

        const recovery = await harness.getSessionQuery(created.metadata.sessionId, {}) as AgentSessionRecoveryDto;
        expect(recovery.eventCursor.after).toBeLessThan(publishedSeq);
        expect(recovery.history.entries.map((entry) => entry.id)).toContain(injectedEntryId);

        const subscription = harness.eventHub.subscribe(created.metadata.sessionId, recovery.eventCursor);
        await expect(subscription.next()).resolves.toMatchObject({
            done: false,
            value: {
                payload: {
                    seq: publishedSeq,
                    event: {type: "session_entry"},
                },
            },
        });
        await subscription.return();
        await harness.drainBackgroundTasks();
    });

    it("active-path mutation 只返回 live state，不内嵌 recovery", async () => {
        const root = absoluteFsPath(testHostPath("session-query-test", randomUUID()));
        roots.push(root);
        const repo = new JsonlSessionRepository(root);
        const harness = new NeuroAgentHarness({
            repo,
            profiles: new AgentProfileCatalog(
                join(root, "system-profiles"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            enableSessionSummarizer: false,
        });
        const created = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const entry = await repo.appendEntry(created.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            message: {
                role: "user",
                content: [{type: "text", text: "需要重试"}],
                timestamp: 100,
            },
        });

        await expect(harness.runCommand(created.metadata.sessionId, {
            command: "retry",
            entryId: entry.id,
        })).resolves.toMatchObject({
            kind: "live_state",
            status: "completed",
            sessionId: created.metadata.sessionId,
            state: {activePathRevision: expect.any(String)},
        });
        await expect(harness.moveTree(created.metadata.sessionId, {position: "empty"})).resolves.toMatchObject({
            status: "completed",
            state: {
                activeLeafId: null,
                activePathRevision: expect.any(String),
            },
        });
        await harness.drainBackgroundTasks();
    });
});

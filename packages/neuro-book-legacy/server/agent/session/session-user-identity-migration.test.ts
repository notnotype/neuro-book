import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {migrateSessionUserIdentities} from "nbook/server/agent/session/session-user-identity-migration";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Session user identity migration", () => {
    it("为 entry、batch 与 queue 生成确定 ID，并硬切有序 content 和显式 intent", async () => {
        const filePath = await writeSession([
            {kind: "header", metadata: {sessionId: 42}},
            {kind: "entry", entry: userEntry("user-normal", "普通消息")},
            {kind: "batch", entries: [userEntry("user-steer", "<user_steer>\n调整\n</user_steer>")]},
            {
                kind: "entry",
                entry: {
                    id: "queue-state",
                    type: "custom",
                    key: AGENT_FOLLOW_UP_QUEUE_STATE_KEY,
                    value: {
                        status: "ready",
                        items: [{
                            id: "queue-1",
                            kind: "followup",
                            message: {
                                text: "继续",
                                attachments: [{type: "attachment", attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 8}}],
                            },
                            createdAt: 1,
                        }],
                    },
                },
            },
        ]);

        await expect(migrateSessionUserIdentities(filePath)).resolves.toEqual({
            changed: true,
            userEntries: 2,
            queueItems: 1,
        });
        const first = await readRecords(filePath);
        const normal = entry(first, "user-normal");
        const steer = entry(first, "user-steer");
        const queue = entry(first, "queue-state");
        expect(normal).toMatchObject({
            clientMessageId: expect.stringMatching(UUID_PATTERN),
            intent: "normal",
            message: {content: [{type: "text", text: "普通消息"}]},
        });
        expect(steer).toMatchObject({
            clientMessageId: expect.stringMatching(UUID_PATTERN),
            intent: "steer",
            message: {content: [{type: "text", text: "<user_steer>\n调整\n</user_steer>"}]},
        });
        expect(queue.value?.items[0]).toMatchObject({
            clientMessageId: expect.stringMatching(UUID_PATTERN),
            message: {
                content: [
                    {type: "text", text: "继续"},
                    {type: "attachment"},
                ],
            },
        });

        await expect(migrateSessionUserIdentities(filePath)).resolves.toEqual({
            changed: false,
            userEntries: 2,
            queueItems: 1,
        });
        expect(await readRecords(filePath)).toEqual(first);
    });

    it("迁移验证失败时不覆盖原 JSONL", async () => {
        const filePath = await writeSession([
            {kind: "header", metadata: {sessionId: 7}},
            {
                kind: "entry",
                entry: {
                    ...userEntry("bad-user", "正文"),
                    clientMessageId: "not-a-uuid",
                },
            },
        ]);
        const before = await readFile(filePath, "utf8");

        await expect(migrateSessionUserIdentities(filePath)).rejects.toThrow("用户 entry clientMessageId 非法");
        expect(await readFile(filePath, "utf8")).toBe(before);
    });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** 构造迁移前的旧用户消息。 */
function userEntry(id: string, content: string) {
    return {
        id,
        parentId: null,
        timestamp: 1,
        type: "message",
        origin: "prompt",
        message: {role: "user", content, timestamp: 1},
    };
}

/** 写入隔离 JSONL fixture。 */
async function writeSession(records: object[]): Promise<string> {
    const root = testHostPath("session-user-identity-migration-test", randomUUID());
    roots.push(root);
    await mkdir(root, {recursive: true});
    const filePath = resolve(root, "42.jsonl");
    await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    return filePath;
}

/** 读取 entry/batch 扁平视图。 */
async function readRecords(filePath: string): Promise<MigratedRecord[]> {
    return (await readFile(filePath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as MigratedRecord);
}

/** 按 ID 查找 entry；测试 fixture 已保证存在。 */
function entry(records: MigratedRecord[], id: string): MigratedEntry {
    const entries = records.flatMap((record): MigratedEntry[] => record.kind === "entry" && record.entry
        ? [record.entry]
        : record.kind === "batch" && record.entries
            ? record.entries
            : []);
    const found = entries.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`缺少测试 entry：${id}`);
    return found;
}

type MigratedEntry = {
    id: string;
    clientMessageId?: string;
    intent?: "normal" | "steer";
    message?: {
        content?: Array<{type: string; text?: string}>;
    };
    value?: {
        items: Array<{
            clientMessageId?: string;
            message?: {content?: Array<{type: string; text?: string}>};
        }>;
    };
};

type MigratedRecord = {
    kind: "header" | "entry" | "batch";
    entry?: MigratedEntry;
    entries?: MigratedEntry[];
};

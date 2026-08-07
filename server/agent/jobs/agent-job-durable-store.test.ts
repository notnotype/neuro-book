import {randomUUID} from "node:crypto";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {
    AgentJobDurableStore,
    type DurableAgentJobRecord,
} from "nbook/server/agent/jobs/agent-job-durable-store";

describe("AgentJobDurableStore", () => {
    it("以同目录临时文件、fsync 和原子替换保存最新记录", async () => {
        const root = resolve(".agent", "agent-job-store-test", randomUUID());
        const store = new AgentJobDurableStore(root);
        const initial = record("job_store", "running");
        await store.write(initial);
        await store.write({
            ...initial,
            snapshot: {
                ...initial.snapshot,
                status: "completed",
                endedAt: 2,
                preview: "done",
            },
            result: {ok: true},
            detail: {kind: "bash"},
        });

        await expect(store.read("job_store")).resolves.toMatchObject({
            schemaVersion: 1,
            snapshot: {jobId: "job_store", status: "completed", preview: "done"},
            result: {ok: true},
            detail: {kind: "bash"},
        });
        expect(await readdir(root)).toEqual(["job_store.json"]);

        await store.delete("job_store");
        await expect(store.read("job_store")).resolves.toBeNull();
        await rm(root, {recursive: true, force: true});
    });

    it("拒绝损坏记录和不安全的 Job ID", async () => {
        const root = resolve(".agent", "agent-job-store-test", randomUUID());
        const store = new AgentJobDurableStore(root);
        await expect(store.write(record("../escape", "running"))).rejects.toThrow("不能用于 durable 文件名");

        await mkdir(root, {recursive: true});
        await writeFile(resolve(root, "job_corrupt.json"), "{\"schemaVersion\":1}\n", "utf8");
        await expect(store.read("job_corrupt")).rejects.toThrow();
        const quarantined = await store.quarantine("job_corrupt");
        expect(quarantined).toEqual(expect.stringContaining(".job_corrupt.json.corrupt."));
        await expect(store.read("job_corrupt")).resolves.toBeNull();
        expect(await readdir(root)).toEqual([expect.stringContaining(".job_corrupt.json.corrupt.")]);
        await rm(root, {recursive: true, force: true});
    });
});

function record(jobId: string, status: "running" | "completed"): DurableAgentJobRecord {
    return {
        schemaVersion: 1,
        snapshot: {
            jobId,
            kind: "bash",
            title: "test",
            ownerSessionId: null,
            status,
            deliveryStatus: "not_required",
            createdAt: 1,
            ref: null,
        },
    };
}

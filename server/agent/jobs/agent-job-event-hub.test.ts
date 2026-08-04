import {describe, expect, it} from "vitest";
import {AgentJobEventHub} from "nbook/server/agent/jobs/agent-job-event-hub";
import type {AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

describe("AgentJobEventHub", () => {
    it("发布 immutable 快照并按全局 seq 严格排序", () => {
        const hub = new AgentJobEventHub();
        const job = snapshot("job-1", "running");

        const first = hub.publish({type: "job_upserted", job});
        job.title = "mutated after publish";
        const second = hub.publish({type: "jobs_removed", jobIds: [job.jobId]});

        expect(first.payload.seq).toBe(1);
        expect(second.payload.seq).toBe(2);
        expect(first.payload.event).toMatchObject({type: "job_upserted", job: {title: "job-1"}});
        expect(first.frame.toString("utf8")).toContain('"title":"job-1"');
        expect(first.frame.toString("utf8")).not.toContain("mutated after publish");
        expect(Object.isFrozen(first.payload)).toBe(true);
        expect(Object.isFrozen(first.payload.event)).toBe(true);
    });

    it("从快照游标 replay 后续 Job 变化", async () => {
        const hub = new AgentJobEventHub();
        const cursor = hub.cursor();
        const job = snapshot("job-1", "running");

        hub.publish({type: "job_upserted", job});
        const subscription = hub.subscribe(cursor);
        const iterator = subscription[Symbol.asyncIterator]();

        expect(subscription.connected.payload.event).toEqual({
            type: "connected",
            eventEpoch: hub.eventEpoch,
            latestSeq: 1,
        });
        await expect(iterator.next()).resolves.toMatchObject({
            done: false,
            value: {
                payload: {
                    eventEpoch: hub.eventEpoch,
                    seq: 1,
                    event: {type: "job_upserted", job},
                },
            },
        });

        subscription.close();
    });

    it.each([
        ["缺少 epoch", {eventEpoch: undefined, after: 1}, "event cursor is missing epoch"],
        ["跨 epoch", {eventEpoch: "old-epoch", after: 0}, "event epoch changed"],
        ["游标超前", {eventEpoch: "CURRENT", after: 99}, "event cursor is ahead of server"],
        ["replay 过期", {eventEpoch: "CURRENT", after: 0}, "event replay buffer expired"],
    ])("%s 时要求对应订阅者恢复快照", async (_label, input, reason) => {
        const hub = new AgentJobEventHub({replayLimit: 1});
        hub.publish({type: "job_upserted", job: snapshot("job-1", "running")});
        if (reason === "event replay buffer expired") {
            hub.publish({type: "job_upserted", job: snapshot("job-2", "running")});
        }
        const cursor = {
            ...(input.eventEpoch === "CURRENT" ? {eventEpoch: hub.eventEpoch} : input.eventEpoch ? {eventEpoch: input.eventEpoch} : {}),
            after: input.after,
        };
        const subscription = hub.subscribe(cursor);

        await expect(subscription.next()).resolves.toMatchObject({
            done: false,
            value: {payload: {event: {type: "snapshot_required", reason}}},
        });
        subscription.close();
    });

    it("单帧超限时以同一 seq 降级为 snapshot_required", async () => {
        const hub = new AgentJobEventHub({maxEventBytes: 300});
        const cursor = hub.cursor();
        const published = hub.publish({
            type: "job_upserted",
            job: {...snapshot("job-large", "running"), preview: "x".repeat(2_000)},
        });

        expect(published.frameBytes).toBeLessThanOrEqual(300);
        expect(published.payload).toMatchObject({
            seq: 1,
            event: {type: "snapshot_required", reason: "public event exceeded maximum frame size"},
        });
        await expect(hub.subscribe(cursor).next()).resolves.toMatchObject({
            done: false,
            value: {payload: {seq: 1, event: {type: "snapshot_required"}}},
        });
    });

    it("恢复请求本身也无法满足帧预算时拒绝提交 seq", () => {
        const hub = new AgentJobEventHub({maxEventBytes: 1});

        expect(() => hub.publish({
            type: "job_upserted",
            job: snapshot("job-large", "running"),
        })).toThrow("snapshot_required frame 超过公开事件预算");
        expect(hub.cursor().after).toBe(0);
    });

    it("慢消费者超过 live 队列预算时立即中止", async () => {
        const hub = new AgentJobEventHub({
            subscriberQueueLimit: 1,
            subscriberQueueByteLimit: 1024,
        });
        const subscription = hub.subscribe(hub.cursor());

        hub.publish({type: "job_upserted", job: snapshot("job-1", "running")});
        hub.publish({type: "job_upserted", job: snapshot("job-2", "running")});

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("queue_overflow");
        await expect(subscription.next()).resolves.toEqual({done: true, value: undefined});
    });

    it("close 中止全部订阅并拒绝后续 publish 与 subscribe", async () => {
        const hub = new AgentJobEventHub();
        hub.publish({type: "job_upserted", job: snapshot("job-1", "running")});
        const subscription = hub.subscribe(hub.cursor());
        const waiting = subscription.next();

        hub.close();

        await expect(waiting).resolves.toEqual({done: true, value: undefined});
        expect(subscription.closeReason).toBe("hub_closed");
        expect(() => hub.publish({type: "jobs_removed", jobIds: ["job-1"]})).toThrow("job_event_hub_closed");
        expect(() => hub.subscribe()).toThrow("job_event_hub_closed");
    });
});

function snapshot(jobId: string, status: AgentJobSnapshot["status"]): AgentJobSnapshot {
    return {
        jobId,
        kind: "bash",
        title: jobId,
        ownerSessionId: null,
        status,
        deliveryStatus: "not_required",
        createdAt: 1,
        ref: {command: "echo ok"},
    };
}

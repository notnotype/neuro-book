import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import {
    AgentJobDurableStore,
    type DurableAgentJobRecord,
} from "nbook/server/agent/jobs/agent-job-durable-store";

describe("AgentJobManager", () => {
    it("启动回执精确指向首次 running 发布，不受同步执行器后续事件污染", async () => {
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        const before = jobs.recovery().eventCursor;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const spawned = jobs.spawn({
            kind: "workflow",
            title: "causal cursor",
            deliver: "none",
            run: async (context) => {
                context.setWaiting("同步进入等待");
                await gate;
                return {resultPreview: "done"};
            },
        });

        expect(spawned.job).toMatchObject({status: "waiting"});
        expect(spawned.jobEventCursor).toEqual({eventEpoch: before.eventEpoch, after: before.after + 1});
        expect(jobs.recovery().eventCursor.after).toBe(before.after + 2);
        const subscription = jobs.subscribeEvents(before);
        await expect(subscription.next()).resolves.toMatchObject({
            value: {payload: {
                eventEpoch: spawned.jobEventCursor.eventEpoch,
                seq: spawned.jobEventCursor.after,
                event: {type: "job_upserted", job: {status: "running"}},
            }},
        });

        subscription.close();
        release();
        await jobs.waitIdle();
    });

    it("shutdown 开始后拒绝启动新 Job", async () => {
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        await jobs.shutdown();

        expect(() => jobs.spawn({
            kind: "bash",
            title: "too late",
            deliver: "none",
            run: async () => ({resultPreview: "done"}),
        })).toThrow("已关闭");
    });

    it("列表快照与 SSE 游标之间创建的 Job 可以 replay", async () => {
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        const recovery = jobs.recovery();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const spawned = jobs.spawn({
            kind: "bash",
            title: "created after snapshot",
            deliver: "none",
            run: async () => {
                await gate;
                return {resultPreview: "done"};
            },
        });
        const subscription = jobs.subscribeEvents(recovery.eventCursor);
        const event = await subscription.next();

        expect(recovery.jobs).toEqual([]);
        expect(event).toMatchObject({
            done: false,
            value: {payload: {event: {type: "job_upserted", job: {jobId: spawned.job.jobId, status: "running"}}}},
        });

        subscription.close();
        release();
        await jobs.waitIdle();
    });

    it("250ms 内的 preview 更新合并为最后一帧", async () => {
        vi.useFakeTimers();
        try {
            const jobs = new AgentJobManager(() => {
                throw new Error("ownerless 测试不应投递");
            }, "");
            const recovery = jobs.recovery();
            let setPreview!: (text: string) => void;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            jobs.spawn({
                kind: "bash",
                title: "preview coalescing",
                deliver: "none",
                run: async (context) => {
                    setPreview = context.setPreview;
                    await gate;
                    return {resultPreview: "done"};
                },
            });
            const subscription = jobs.subscribeEvents(recovery.eventCursor);
            await subscription.next();

            setPreview("first");
            setPreview("latest");
            await vi.advanceTimersByTimeAsync(249);
            expect(jobs.recovery().eventCursor.after).toBe(1);

            await vi.advanceTimersByTimeAsync(1);
            const event = await subscription.next();
            expect(event).toMatchObject({
                done: false,
                value: {payload: {event: {type: "job_upserted", job: {preview: "latest"}}}},
            });

            subscription.close();
            release();
            await jobs.waitIdle();
        } finally {
            vi.useRealTimers();
        }
    });

    it("waiting、running 与 terminal 立即发布且 terminal 清除迟到 preview", async () => {
        vi.useFakeTimers();
        try {
            const jobs = new AgentJobManager(() => {
                throw new Error("ownerless 测试不应投递");
            }, "");
            const recovery = jobs.recovery();
            let setPreview!: (text: string) => void;
            let setWaiting!: (text: string) => void;
            let setRunning!: () => void;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            jobs.spawn({
                kind: "workflow",
                title: "state transitions",
                deliver: "none",
                run: async (context) => {
                    setPreview = context.setPreview;
                    setWaiting = context.setWaiting;
                    setRunning = context.setRunning;
                    await gate;
                    return {resultPreview: "final result"};
                },
            });
            const subscription = jobs.subscribeEvents(recovery.eventCursor);
            await subscription.next();

            setPreview("stale preview");
            setWaiting("need answer");
            setRunning();
            setPreview("latest output");
            release();
            await jobs.waitIdle();

            const waiting = await subscription.next();
            const running = await subscription.next();
            const terminal = await subscription.next();
            expect([waiting.value?.payload, running.value?.payload, terminal.value?.payload]).toMatchObject([
                {event: {type: "job_upserted", job: {status: "waiting", preview: "need answer"}}},
                {event: {type: "job_upserted", job: {status: "running", preview: "need answer"}}},
                {event: {type: "job_upserted", job: {status: "completed", preview: "final result"}}},
            ]);

            await vi.advanceTimersByTimeAsync(250);
            expect(jobs.recovery().eventCursor.after).toBe(4);
            subscription.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it("结果回流进入 durable system follow-up queue，且 waitIdle 等到入队完成", async () => {
        let releaseDelivery: (() => void) | undefined;
        const delivery = new Promise<void>((resolve) => {
            releaseDelivery = resolve;
        });
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            deliveryId: string;
            clientMessageId: string;
        }) => {
            await delivery;
            return {
                state: "queued" as const,
                deliveryId: input.deliveryId,
                clientMessageId: input.clientMessageId,
            };
        });
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, "");
        jobs.spawn({
            kind: "bash",
            title: "background task",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });

        let idleResolved = false;
        const idle = jobs.waitIdle().then(() => {
            idleResolved = true;
        });
        await vi.waitFor(() => expect(enqueueDurableSystemFollowUp).toHaveBeenCalledOnce());

        expect(idleResolved).toBe(false);
        expect(enqueueDurableSystemFollowUp).toHaveBeenCalledWith({
            sessionId: 7,
            text: "<system-reminder>\n[后台任务完成] background task（" + jobs.list()[0]!.jobId + "）\ndone\n</system-reminder>",
            deliveryId: expect.any(String),
            clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        });

        releaseDelivery!();
        await idle;
        expect(idleResolved).toBe(true);
        await expect(jobs.get(jobs.list()[0]!.jobId)).resolves.toMatchObject({deliveryStatus: "accepted"});
    });

    it.each([
        ["Session queue 拒绝", async () => { throw new Error("owner queue unavailable"); }],
        ["Session 不存在", async () => { throw new Error("owner session missing"); }],
    ])("结果回流%s时只标记 delivery failed 且不重试", async (_label, enqueue) => {
        const enqueueDurableSystemFollowUp = vi.fn(enqueue);
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, "");
        const spawned = jobs.spawn({
            kind: "workflow",
            title: "delivery failure",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done", result: {ok: true}}),
        });

        await jobs.waitIdle();

        await expect(jobs.get(spawned.job.jobId)).resolves.toMatchObject({
            status: "completed",
            deliveryStatus: "failed",
            deliveryError: expect.stringContaining("owner"),
            result: {ok: true},
        });
        expect(enqueueDurableSystemFollowUp).toHaveBeenCalledOnce();
    });

    it("shutdown 期间完成的 Job 保留 pending，交给下次启动幂等回流", async () => {
        const root = resolve(".agent", "agent-job-shutdown-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const enqueueDurableSystemFollowUp = vi.fn();
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, registryPath);
        jobs.spawn({
            kind: "workflow",
            title: "shutdown delivery",
            ownerSessionId: 7,
            run: async (context) => {
                await new Promise<void>((resolveGate) => {
                    context.signal.addEventListener("abort", () => resolveGate(), {once: true});
                });
                return {resultPreview: "cancelled"};
            },
        });

        await expect(Promise.race([
            jobs.shutdown().then(() => "settled"),
            new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 300)),
        ])).resolves.toBe("settled");
        expect(enqueueDurableSystemFollowUp).not.toHaveBeenCalled();
        const durable = await new AgentJobDurableStore(resolve(root, "jobs")).read(jobs.list()[0]!.jobId);
        expect(durable?.snapshot).toMatchObject({
            status: "cancelled",
            deliveryStatus: "pending",
        });
        await rm(root, {recursive: true, force: true});
    });

    it("shutdown 先关闭事件订阅并清理 preview，取消终态不再发布", async () => {
        vi.useFakeTimers();
        try {
            const jobs = new AgentJobManager(() => {
                throw new Error("ownerless 测试不应投递");
            }, "");
            const cursor = jobs.recovery().eventCursor;
            let lateSetPreview!: (text: string) => void;
            jobs.spawn({
                kind: "bash",
                title: "shutdown events",
                deliver: "none",
                run: async (context) => {
                    lateSetPreview = context.setPreview;
                    context.setPreview("pending");
                    await new Promise<void>((resolve) => {
                        context.signal.addEventListener("abort", () => resolve(), {once: true});
                    });
                    return {resultPreview: "cancelled"};
                },
            });
            const subscription = jobs.subscribeEvents(cursor);
            const seqBeforeShutdown = jobs.recovery().eventCursor.after;

            await jobs.shutdown();

            expect(subscription.signal.aborted).toBe(true);
            expect(subscription.closeReason).toBe("hub_closed");
            expect(vi.getTimerCount()).toBe(0);
            lateSetPreview("after shutdown");
            expect(vi.getTimerCount()).toBe(0);
            expect(jobs.recovery().eventCursor.after).toBe(seqBeforeShutdown);
            expect(() => jobs.subscribeEvents()).toThrow("job_event_hub_closed");
        } finally {
            vi.useRealTimers();
        }
    });

    it("list 保持轻量，get 保存完整大型结构化结果且通知不截断", async () => {
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            deliveryId: string;
            clientMessageId: string;
            text: string;
        }) => ({
            state: "queued" as const,
            deliveryId: input.deliveryId,
            clientMessageId: input.clientMessageId,
        }));
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, "");
        const largeText = "完整结果".repeat(3_000);
        const spawned = jobs.spawn({
            kind: "workflow",
            title: "large workflow",
            ownerSessionId: 7,
            run: async () => ({
                resultPreview: largeText,
                result: {payload: largeText},
                message: `[后台 Workflow 完成]\n${JSON.stringify({payload: largeText}, null, 2)}`,
            }),
        });

        await jobs.waitIdle();
        const summary = jobs.list()[0]!;
        const detail = (await jobs.get(spawned.job.jobId))!;
        const notification = enqueueDurableSystemFollowUp.mock.calls[0]![0].text;

        expect(summary).not.toHaveProperty("result");
        expect(summary.preview?.length).toBeLessThanOrEqual(401);
        expect(detail.result).toEqual({payload: largeText});
        expect(notification).toContain("<system-reminder>\n[后台 Workflow 完成]");
        expect(notification).not.toContain("[后台任务完成]");
        expect(notification).toContain(largeText);
        expect(notification).not.toContain("截断");
        expect(notification).not.toContain("```json");
    });

    it("每个 Job 只保留最新 durable 文件，旧 jobs.jsonl 不再追加", async () => {
        const root = resolve(".agent", "agent-job-manager-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        await mkdir(root, {recursive: true});
        await writeFile(registryPath, "legacy-audit\n", "utf8");
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, registryPath);
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolveGate) => {
            release = resolveGate;
        });
        jobs.spawn({
            kind: "workflow",
            title: "ordered",
            deliver: "none",
            run: async (context) => {
                context.setWaiting("wait");
                context.setRunning();
                await gate;
                return {resultPreview: "done"};
            },
        });
        release!();
        await jobs.waitIdle();

        expect(await readFile(registryPath, "utf8")).toBe("legacy-audit\n");
        const durableFiles = await readdir(resolve(root, "jobs"));
        expect(durableFiles).toHaveLength(1);
        const durable = JSON.parse(await readFile(resolve(root, "jobs", durableFiles[0]!), "utf8")) as DurableAgentJobRecord;
        expect(durable.snapshot).toMatchObject({
            status: "completed",
            preview: "done",
            deliveryStatus: "not_required",
        });
        await rm(root, {recursive: true, force: true});
    });

    it("旧 jobs.jsonl 只迁移 active Job，并独立处理每条中断通知", async () => {
        const root = resolve(".agent", "agent-job-recovery-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        await mkdir(root, {recursive: true});
        await writeFile(registryPath, [
            {at: 1, jobId: "job-fail", kind: "workflow", title: "失败通知", ownerSessionId: 1, status: "running", deliveryStatus: "pending"},
            {at: 2, jobId: "job-ok", kind: "workflow", title: "成功通知", ownerSessionId: 2, status: "waiting", deliveryStatus: "pending"},
            {at: 3, jobId: "job-terminal", kind: "bash", title: "旧终态", ownerSessionId: null, status: "completed", deliveryStatus: "not_required"},
        ].map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
        const originalRegistry = await readFile(registryPath, "utf8");
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            sessionId: number;
            deliveryId: string;
            clientMessageId: string;
        }) => {
            if (input.sessionId === 1) throw new Error("owner-1 offline");
            return {
                state: "queued" as const,
                deliveryId: input.deliveryId,
                clientMessageId: input.clientMessageId,
            };
        });
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, registryPath);

        await jobs.recoverInterrupted();

        expect(enqueueDurableSystemFollowUp).toHaveBeenCalledTimes(2);
        expect(jobs.list().map((job) => job.jobId).sort()).toEqual(["job-fail", "job-ok"]);
        await expect(jobs.get("job-fail")).resolves.toMatchObject({
            status: "interrupted",
            deliveryStatus: "failed",
            deliveryError: "owner-1 offline",
        });
        await expect(jobs.get("job-ok")).resolves.toMatchObject({
            status: "interrupted",
            deliveryStatus: "accepted",
        });
        expect(await readFile(registryPath, "utf8")).toBe(originalRegistry);
        expect((await readdir(resolve(root, "jobs"))).sort()).toEqual(["job-fail.json", "job-ok.json"]);
        await rm(root, {recursive: true, force: true});
    });

    it("进程重启后恢复终态列表、完整 result 和 kind detail", async () => {
        const root = resolve(".agent", "agent-job-history-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const first = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, registryPath);
        const spawned = first.spawn({
            kind: "workflow",
            title: "durable history",
            deliver: "none",
            detail: async () => ({runId: "run-history", status: "completed"}),
            run: async () => ({
                resultPreview: "done",
                result: {payload: "complete"},
            }),
        });
        await first.waitIdle();

        const restored = new AgentJobManager(() => {
            throw new Error("终态 ownerless 历史不应投递");
        }, registryPath);
        await restored.recoverInterrupted();

        expect(restored.list()).toEqual([
            expect.objectContaining({
                jobId: spawned.job.jobId,
                status: "completed",
                preview: "done",
            }),
        ]);
        await expect(restored.get(spawned.job.jobId)).resolves.toMatchObject({
            result: {payload: "complete"},
            detail: {runId: "run-history", status: "completed"},
        });
        await rm(root, {recursive: true, force: true});
    });

    it("恢复时隔离损坏的单 Job 文件并继续加载其它历史", async () => {
        const root = resolve(".agent", "agent-job-corrupt-history-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const store = new AgentJobDurableStore(resolve(root, "jobs"));
        await mkdir(resolve(root, "jobs"), {recursive: true});
        await writeFile(resolve(root, "jobs", "job_corrupt.json"), "{\"schemaVersion\":1}\n", "utf8");
        await store.write(durableCompletedRecord("job_valid", undefined));

        const jobs = new AgentJobManager(() => {
            throw new Error("corrupt history test should not deliver");
        }, registryPath);
        await jobs.recoverInterrupted();

        expect(jobs.list().map((job) => job.jobId)).toEqual(["job_valid"]);
        const files = await readdir(resolve(root, "jobs"));
        expect(files).toHaveLength(2);
        expect(files).toEqual(expect.arrayContaining([
            "job_valid.json",
            expect.stringContaining(".job_corrupt.json.corrupt."),
        ]));
        await rm(root, {recursive: true, force: true});
    });

    it("terminal pending 在重启后使用原稳定 ID 重投并更新为 accepted", async () => {
        const root = resolve(".agent", "agent-job-pending-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const store = new AgentJobDurableStore(resolve(root, "jobs"));
        const durable = durableCompletedRecord("job_pending", {
            deliveryId: "delivery-stable",
            clientMessageId: "9ec1c584-22d6-4dcc-9748-b54258892a23",
            message: "<system-reminder>\nreliable result\n</system-reminder>",
        });
        await store.write(durable);
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            deliveryId: string;
            clientMessageId: string;
        }) => ({
            state: "persisted" as const,
            deliveryId: input.deliveryId,
            clientMessageId: input.clientMessageId,
        }));
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, registryPath);

        await jobs.recoverInterrupted();

        expect(enqueueDurableSystemFollowUp).toHaveBeenCalledWith({
            sessionId: 7,
            text: durable.delivery!.message,
            deliveryId: "delivery-stable",
            clientMessageId: "9ec1c584-22d6-4dcc-9748-b54258892a23",
        });
        await expect(jobs.get("job_pending")).resolves.toMatchObject({
            status: "completed",
            deliveryStatus: "accepted",
            result: {ok: true},
        });
        await rm(root, {recursive: true, force: true});
    });

    it("accepted=queued 的历史在重启后重新触发 drain，已提交时升级私有证据", async () => {
        const root = resolve(".agent", "agent-job-accepted-queue-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const store = new AgentJobDurableStore(resolve(root, "jobs"));
        const durable = durableCompletedRecord("job_accepted_queue", {
            deliveryId: "delivery-accepted",
            clientMessageId: "b6c72bf4-25f4-4c34-8c52-a6ccfe38c492",
            message: "<system-reminder>\nalready queued\n</system-reminder>",
            acceptedState: "queued",
        });
        durable.snapshot.deliveryStatus = "accepted";
        await store.write(durable);
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            deliveryId: string;
            clientMessageId: string;
        }) => ({
            state: "persisted" as const,
            deliveryId: input.deliveryId,
            clientMessageId: input.clientMessageId,
        }));
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, registryPath);

        await jobs.recoverInterrupted();

        expect(enqueueDurableSystemFollowUp).toHaveBeenCalledOnce();
        expect((await store.read("job_accepted_queue"))?.delivery).toMatchObject({
            deliveryId: "delivery-accepted",
            acceptedState: "persisted",
        });
        await rm(root, {recursive: true, force: true});
    });

    it("terminal durable commit 失败时不发布 completed，而是收口为持久化失败", async () => {
        const root = resolve(".agent", "agent-job-persist-failure-test", randomUUID());
        class TerminalFailingStore extends AgentJobDurableStore {
            private failed = false;

            override async write(record: DurableAgentJobRecord): Promise<void> {
                if (!this.failed && record.snapshot.status === "completed") {
                    this.failed = true;
                    throw new Error("disk full");
                }
                await super.write(record);
            }
        }
        const store = new TerminalFailingStore(resolve(root, "jobs"));
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, resolve(root, "jobs.jsonl"), store);
        const cursor = jobs.recovery().eventCursor;
        const spawned = jobs.spawn({
            kind: "bash",
            title: "persist failure",
            deliver: "none",
            run: async () => ({resultPreview: "done", result: {ok: true}}),
        });
        const subscription = jobs.subscribeEvents(cursor);
        await subscription.next();

        await jobs.waitIdle();
        const terminal = await subscription.next();

        expect(terminal).toMatchObject({
            value: {payload: {event: {type: "job_upserted", job: {
                jobId: spawned.job.jobId,
                status: "failed",
                error: expect.stringContaining("disk full"),
            }}}},
        });
        await expect(jobs.get(spawned.job.jobId)).resolves.toMatchObject({
            status: "failed",
            error: expect.stringContaining("持久化失败"),
        });
        subscription.close();
        await rm(root, {recursive: true, force: true});
    });

    it("terminal durable commit 完成前，列表和 SSE 都不公开 completed", async () => {
        const root = resolve(".agent", "agent-job-terminal-gate-test", randomUUID());
        let releaseTerminal!: () => void;
        const terminalGate = new Promise<void>((resolveGate) => {
            releaseTerminal = resolveGate;
        });
        let terminalWriteStarted!: () => void;
        const terminalStarted = new Promise<void>((resolveStarted) => {
            terminalWriteStarted = resolveStarted;
        });
        class BlockingTerminalStore extends AgentJobDurableStore {
            override async write(record: DurableAgentJobRecord): Promise<void> {
                if (record.snapshot.status === "completed") {
                    terminalWriteStarted();
                    await terminalGate;
                }
                await super.write(record);
            }
        }
        const store = new BlockingTerminalStore(resolve(root, "jobs"));
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, resolve(root, "jobs.jsonl"), store);
        const cursor = jobs.recovery().eventCursor;
        jobs.spawn({
            kind: "bash",
            title: "terminal gate",
            deliver: "none",
            run: async () => ({resultPreview: "done"}),
        });
        const subscription = jobs.subscribeEvents(cursor);
        await subscription.next();
        await terminalStarted;

        expect(jobs.list()[0]).toMatchObject({status: "running"});
        expect(jobs.recovery().eventCursor.after).toBe(cursor.after + 1);

        releaseTerminal();
        await jobs.waitIdle();
        await expect(subscription.next()).resolves.toMatchObject({
            value: {payload: {event: {type: "job_upserted", job: {status: "completed"}}}},
        });
        subscription.close();
        await rm(root, {recursive: true, force: true});
    });

    it("clearFinished 只清终态条目，running 保留", async () => {
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        jobs.spawn({
            kind: "bash",
            title: "finished",
            deliver: "none",
            run: async () => ({resultPreview: "done"}),
        });
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolveGate) => {
            release = resolveGate;
        });
        const running = jobs.spawn({
            kind: "bash",
            title: "still running",
            deliver: "none",
            run: async () => {
                await gate;
                return {resultPreview: "done"};
            },
        });
        await vi.waitFor(() => expect(jobs.list().find((job) => job.title === "finished")?.status).toBe("completed"));
        const cursor = jobs.recovery().eventCursor;

        await expect(jobs.clearFinished()).resolves.toBe(1);
        expect(jobs.list().map((job) => job.jobId)).toEqual([running.job.jobId]);
        expect(jobs.recovery().eventCursor.after).toBe(cursor.after + 1);
        await expect(jobs.subscribeEvents(cursor).next()).resolves.toMatchObject({
            done: false,
            value: {payload: {event: {type: "jobs_removed", jobIds: [expect.stringMatching(/^job_/)]}}},
        });

        release!();
        await jobs.waitIdle();
    });

    it("delivery pending 不能清除，accepted 后删除 durable 记录且重启不再出现", async () => {
        const root = resolve(".agent", "agent-job-clear-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        let releaseDelivery!: () => void;
        const delivery = new Promise<void>((resolve) => {
            releaseDelivery = resolve;
        });
        const enqueueDurableSystemFollowUp = vi.fn(async (input: {
            deliveryId: string;
            clientMessageId: string;
        }) => {
            await delivery;
            return {
                state: "queued" as const,
                deliveryId: input.deliveryId,
                clientMessageId: input.clientMessageId,
            };
        });
        const jobs = new AgentJobManager(() => ({enqueueDurableSystemFollowUp}) as never, registryPath);
        const before = jobs.recovery().eventCursor;
        const spawned = jobs.spawn({
            kind: "workflow",
            title: "clear during delivery",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });

        await vi.waitFor(() => expect(jobs.list().find((job) => job.jobId === spawned.job.jobId)?.status).toBe("completed"));
        await vi.waitFor(() => expect(enqueueDurableSystemFollowUp).toHaveBeenCalledOnce());
        const terminal = jobs.recovery().eventCursor;
        await expect(jobs.clearFinished()).resolves.toBe(0);
        expect(jobs.list()).toHaveLength(1);
        expect(jobs.recovery().eventCursor).toEqual(terminal);

        let idleResolved = false;
        const idle = jobs.waitIdle().then(() => {
            idleResolved = true;
        });
        await Promise.resolve();
        expect(idleResolved).toBe(false);

        releaseDelivery();
        await idle;
        expect(idleResolved).toBe(true);
        await expect(jobs.clearFinished()).resolves.toBe(1);
        expect(jobs.list()).toEqual([]);
        expect(jobs.recovery().eventCursor.after).toBe(terminal.after + 2);

        const restored = new AgentJobManager(() => {
            throw new Error("已清除记录不应投递");
        }, registryPath);
        await restored.recoverInterrupted();
        expect(restored.list()).toEqual([]);
        expect(await readdir(resolve(root, "jobs"))).toEqual([]);
        expect(before.eventEpoch).toEqual(expect.any(String));
        await rm(root, {recursive: true, force: true});
    });
});

function durableCompletedRecord(
    jobId: string,
    delivery: DurableAgentJobRecord["delivery"],
): DurableAgentJobRecord {
    return {
        schemaVersion: 1,
        snapshot: {
            jobId,
            kind: "workflow",
            title: "pending delivery",
            ownerSessionId: 7,
            status: "completed",
            deliveryStatus: "pending",
            createdAt: 1,
            endedAt: 2,
            ref: {runId: "run-pending"},
            preview: "done",
        },
        result: {ok: true},
        detail: {runId: "run-pending", status: "completed"},
        delivery,
    };
}

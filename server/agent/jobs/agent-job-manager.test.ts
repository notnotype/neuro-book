import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";

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

    it("结果回流使用普通 prompt invocation，且 waitIdle 等到投递完成", async () => {
        let releaseDelivery: (() => void) | undefined;
        const delivery = new Promise<void>((resolve) => {
            releaseDelivery = resolve;
        });
        const invokeAgent = vi.fn(async () => {
            await delivery;
            return {
                sessionId: 7,
                invocationId: "job-followup",
                status: "completed" as const,
                finalMessage: "received",
            };
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
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
        await vi.waitFor(() => expect(invokeAgent).toHaveBeenCalledOnce());

        expect(idleResolved).toBe(false);
        expect(invokeAgent).toHaveBeenCalledWith({
            sessionId: 7,
            mode: "prompt",
            message: {text: "<system-reminder>\n[后台任务完成] background task（" + jobs.list()[0]!.jobId + "）\ndone\n</system-reminder>"},
            caller: {kind: "system"},
            messageIdentity: "system",
            signal: expect.any(AbortSignal),
        });

        releaseDelivery!();
        await idle;
        expect(idleResolved).toBe(true);
        await expect(jobs.get(jobs.list()[0]!.jobId)).resolves.toMatchObject({deliveryStatus: "accepted"});
    });

    it.each([
        ["返回 error", async () => ({sessionId: 7, invocationId: "delivery-error", status: "error" as const, acceptance: {state: "none" as const}, error: "owner 忙"})],
        ["抛出异常", async () => { throw new Error("owner invocation 崩溃"); }],
    ])("结果回流%s时只标记 delivery failed 且不重试", async (_label, invoke) => {
        const invokeAgent = vi.fn(invoke);
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
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
        expect(invokeAgent).toHaveBeenCalledOnce();
    });

    it("shutdown 会取消在途结果回流，不被不合作的 owner invocation 永久阻塞", async () => {
        const invokeAgent = vi.fn(async (input: {signal?: AbortSignal}) => {
            await new Promise<void>((resolve) => {
                if (input.signal?.aborted) {
                    resolve();
                    return;
                }
                input.signal?.addEventListener("abort", () => resolve(), {once: true});
            });
            return {
                sessionId: 7,
                invocationId: "shutdown-followup",
                status: "error" as const,
            };
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
        jobs.spawn({
            kind: "workflow",
            title: "shutdown delivery",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });
        await vi.waitFor(() => expect(invokeAgent).toHaveBeenCalledOnce());

        await expect(Promise.race([
            jobs.shutdown().then(() => "settled"),
            new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 300)),
        ])).resolves.toBe("settled");
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
        const invokeAgent = vi.fn(async (_input: {message: {text: string}}) => ({
            sessionId: 7,
            invocationId: "job-followup",
            status: "completed" as const,
        }));
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
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
        const notification = invokeAgent.mock.calls[0]![0].message.text;

        expect(summary).not.toHaveProperty("result");
        expect(summary.preview?.length).toBeLessThanOrEqual(401);
        expect(detail.result).toEqual({payload: largeText});
        expect(notification).toContain("<system-reminder>\n[后台 Workflow 完成]");
        expect(notification).not.toContain("[后台任务完成]");
        expect(notification).toContain(largeText);
        expect(notification).not.toContain("截断");
        expect(notification).not.toContain("```json");
    });

    it("jobs.jsonl 串行记录 running、waiting、running、terminal", async () => {
        const root = resolve(".agent", "agent-job-manager-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
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

        const lines = (await readFile(registryPath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as {status: string}).status);
        expect(lines).toEqual(["running", "waiting", "running", "completed"]);
        await rm(root, {recursive: true, force: true});
    });

    it("recoverInterrupted 独立处理每条中断通知，单条失败不阻塞后续", async () => {
        const root = resolve(".agent", "agent-job-recovery-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        await mkdir(root, {recursive: true});
        await writeFile(registryPath, [
            {at: 1, jobId: "job-fail", kind: "workflow", title: "失败通知", ownerSessionId: 1, status: "running", deliveryStatus: "pending"},
            {at: 2, jobId: "job-ok", kind: "workflow", title: "成功通知", ownerSessionId: 2, status: "waiting", deliveryStatus: "pending"},
        ].map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
        const invokeAgent = vi.fn(async (input: {sessionId: number; messageIdentity?: string; caller?: {kind: string}}) => {
            if (input.sessionId === 1) throw new Error("owner-1 offline");
            return {sessionId: input.sessionId, invocationId: "recovery", status: "completed" as const, acceptance: {state: "none" as const}};
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, registryPath);

        await jobs.recoverInterrupted();

        expect(invokeAgent).toHaveBeenCalledTimes(2);
        expect(invokeAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({messageIdentity: "system", caller: {kind: "system"}}));
        expect(invokeAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({messageIdentity: "system", caller: {kind: "system"}}));
        const lines = (await readFile(registryPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {jobId: string; status: string; deliveryStatus?: string; deliveryError?: string});
        expect(lines.filter((line) => line.jobId === "job-fail").at(-1)).toMatchObject({status: "interrupted", deliveryStatus: "failed", deliveryError: "owner-1 offline"});
        expect(lines.filter((line) => line.jobId === "job-ok").at(-1)).toMatchObject({status: "interrupted", deliveryStatus: "accepted"});
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

        expect(jobs.clearFinished()).toBe(1);
        expect(jobs.list().map((job) => job.jobId)).toEqual([running.job.jobId]);
        expect(jobs.recovery().eventCursor.after).toBe(cursor.after + 1);
        await expect(jobs.subscribeEvents(cursor).next()).resolves.toMatchObject({
            done: false,
            value: {payload: {event: {type: "jobs_removed", jobIds: [expect.stringMatching(/^job_/)]}}},
        });

        release!();
        await jobs.waitIdle();
    });

    it("clearFinished 后迟到的 delivery 状态不重新发布已清除 Job", async () => {
        let releaseDelivery!: () => void;
        const delivery = new Promise<void>((resolve) => {
            releaseDelivery = resolve;
        });
        const invokeAgent = vi.fn(async () => {
            await delivery;
            return {
                sessionId: 7,
                invocationId: "late-delivery",
                status: "completed" as const,
            };
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
        const before = jobs.recovery().eventCursor;
        const spawned = jobs.spawn({
            kind: "workflow",
            title: "clear during delivery",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });

        await vi.waitFor(() => expect(jobs.list().find((job) => job.jobId === spawned.job.jobId)?.status).toBe("completed"));
        await vi.waitFor(() => expect(invokeAgent).toHaveBeenCalledOnce());
        const terminal = jobs.recovery().eventCursor;
        expect(jobs.clearFinished()).toBe(1);
        expect(jobs.list()).toEqual([]);
        expect(jobs.recovery().eventCursor.after).toBe(terminal.after + 1);

        let idleResolved = false;
        const idle = jobs.waitIdle().then(() => {
            idleResolved = true;
        });
        await Promise.resolve();
        expect(idleResolved).toBe(false);

        releaseDelivery();
        await idle;
        expect(idleResolved).toBe(true);
        expect(jobs.list()).toEqual([]);
        expect(jobs.recovery().eventCursor).toEqual({
            eventEpoch: before.eventEpoch,
            after: terminal.after + 1,
        });
    });
});

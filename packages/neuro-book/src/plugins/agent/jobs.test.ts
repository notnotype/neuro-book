/**
 * 任务中心（docs/specs/agent/jobs.md）。测试名里的编号是那份 Spec 的输出条目与验收场景。任务的驱动在这里是测试自己写的：任务中心
 * 不认识子会话与进程，驱动只是“怎样停、交回什么文字”的回调；子代理与后台命令的驱动在各自的测试里经真实运行时测。
 */
import {describe, expect, test} from "bun:test";

import {createTestClock} from "@notnotype/nb-harness/kernel/testing";

import {JobCenter, KEPT_PER_OWNER, type Job} from "./backend/jobs/center";

let ids = 0;

function center(limits = {perSession: 8, global: 16}) {
    const clock = createTestClock();
    const jobs = new JobCenter({clock, limits: () => limits, newId: () => `${String((ids += 1)).padStart(12, "0")}`});
    /** 起一个在跑的任务；`kill` 照实把它记成已停止。 */
    const run = (owner: string, kind: "agent" | "shell" = "agent", summary = "活"): Job => {
        const reserved = jobs.reserve(owner, kind, `inv-${String(ids)}`, summary);
        if (!reserved.ok) throw new Error(reserved.scope);
        const job = reserved.job;
        jobs.start(job, {kill: async () => jobs.end(job, "aborted", {reason: "aborted"}), result: async () => `${summary}的结果`});
        return job;
    };
    return {clock, jobs, run};
}

const never = new AbortController().signal;

describe("上限", () => {
    test("输出 2：每个会话只数子代理，全局都数；检查中的也占名额，退回后能再派", () => {
        const {jobs, run} = center({perSession: 2, global: 3});
        run("p");
        const second = jobs.reserve("p", "agent", "i", "第二个");
        expect(second.ok).toBe(true);
        expect(jobs.reserve("p", "agent", "i", "第三个")).toEqual({ok: false, code: "concurrency-limit", scope: "session"});
        expect(jobs.reserve("p", "shell", "i", "命令").ok).toBe(true);
        expect(jobs.reserve("q", "shell", "i", "别人的命令")).toEqual({ok: false, code: "concurrency-limit", scope: "global"});
        if (second.ok) jobs.release(second.job);
        expect(jobs.reserve("q", "agent", "i", "退回之后").ok).toBe(true);
    });

    test("检查中的任务不出现在 jobs 里", () => {
        const {jobs} = center();
        jobs.reserve("p", "agent", "i", "还在检查");
        expect(jobs.list("p")).toEqual([]);
    });
});

describe("wait", () => {
    test("场景 2：交回先结束的那个，再等交回另一个，第三次 no-jobs", async () => {
        const {jobs, run} = center();
        const a = run("p", "agent", "甲");
        const b = run("p", "agent", "乙");
        jobs.end(b, "completed", {reason: "completed", line: "乙完成了"});
        const first = await jobs.wait("p", {timeoutMs: 1_000, signal: never});
        expect(first).toMatchObject({kind: "ready", job: {id: b.id}});
        const waiting = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        jobs.end(a, "failed", {reason: "error"});
        expect(await waiting).toMatchObject({kind: "ready", job: {id: a.id}});
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "no-jobs"});
    });

    test("输出 3：只认自己启动的后台任务；正被前台等着的得 job-foreground", async () => {
        const {jobs, run} = center();
        const mine = run("p");
        const theirs = run("q");
        expect(await jobs.wait("p", {ids: [theirs.id], timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "job-unknown", job: theirs.id});
        jobs.attach(mine);
        expect(await jobs.wait("p", {ids: [mine.id], timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "job-foreground", job: mine.id});
        // 不点名时不等前台的：自己只有这一个，于是没有可等的。
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "no-jobs"});
    });

    test("输出 3：同一个提问只让 wait 立即返回一次，之后照常等别的", async () => {
        const {clock, jobs, run} = center();
        const asking = run("p", "agent", "问的");
        const other = run("p", "agent", "另一个");
        jobs.question(asking, {id: "q1", text: "要几章？"});
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toMatchObject({kind: "ready", job: {id: asking.id}});
        const again = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        jobs.end(other, "completed", {reason: "completed"});
        expect(await again).toMatchObject({kind: "ready", job: {id: other.id}});
        const timeout = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        await clock.advance(1_000);
        expect(await timeout).toMatchObject({kind: "timeout"});
    });

    test("输出 3：插话与中止都提前结束等待，任务不变", async () => {
        const {jobs, run} = center();
        const job = run("p");
        let arrive!: () => void;
        const interrupted = new Promise<void>((resolve) => {
            arrive = resolve;
        });
        const waiting = jobs.wait("p", {timeoutMs: 60_000, signal: never, interrupted});
        arrive();
        expect(await waiting).toMatchObject({kind: "interrupted", jobs: [{id: job.id, state: "running"}]});
        const stop = new AbortController();
        const aborted = jobs.wait("p", {timeoutMs: 60_000, signal: stop.signal});
        stop.abort();
        expect(await aborted).toMatchObject({kind: "aborted"});
        expect(job.state).toBe("running");
    });
});

describe("kill 与寿命", () => {
    test("输出 4、11：只停自己的；已结束的说已经结束；用户经远程能停这个会话的任何任务", async () => {
        const {jobs, run} = center();
        const job = run("p");
        expect(await jobs.kill("q", job.id)).toBe("job-unknown");
        expect(await jobs.kill("p", job.id)).toBe("killed");
        expect(job.state).toBe("aborted");
        expect(await jobs.kill("p", job.id)).toBe("already-ended");
        const another = run("p");
        expect(await jobs.kill(null, another.id)).toBe("killed");
    });

    test("输出 6：前台以终态交回就移出；没取过的后台任务每个会话至多留 32 个，先丢最早结束的", async () => {
        const {jobs, run} = center({perSession: 100, global: 100});
        const foreground = run("p");
        jobs.attach(foreground);
        jobs.end(foreground, "completed", {reason: "completed"});
        jobs.detach(foreground, true);
        expect(jobs.get(foreground.id)).toBeUndefined();
        const ended: Job[] = [];
        for (let index = 0; index < KEPT_PER_OWNER + 1; index += 1) {
            const job = run("p");
            jobs.end(job, "completed", {reason: "completed"});
            ended.push(job);
        }
        expect(jobs.get(ended[0]!.id)).toBeUndefined();
        expect(jobs.list("p")).toHaveLength(KEPT_PER_OWNER);
    });
});

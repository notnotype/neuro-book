/**
 * 测试控制入口（`site.operations` 输出 11、边界一节的最后一条）：合同测试从进程外把模块看到的时间往前拨、立即跑一次定时任务。
 *
 * 三道限制分在三处：没设 `NB_SITE_TEST_CONTROL` 时 `serve` 根本不建它、根应用也不挂这两个地址（`site.ts`），没设口令的进程里
 * 没有这段代码路径；设了口令而监听地址不是本机回环时配置校验就拒绝（`config.ts` 的 `not_loopback`）；每个请求都要带口令，
 * 没带或不对时与别的不存在的地址一样回 404，请求方分不出这个入口在不在。
 *
 * 状态（拨过的偏移量）属于 `serve` 的这一次运行：`createTestControl` 每次调用各有一份，不放在模块级的变量里。
 * 口令只在比较时用到，不进日志、失败行与响应体。
 */

import {createHash, timingSafeEqual} from "node:crypto";

import {Hono, type Context} from "hono";

import type {JobScheduler} from "./jobs";
import type {Logger} from "./log";
import type {Clock} from "./module";

export interface TestControl {
    /** 给模块的 `ModuleContext.clock`：墙钟加上拨过的偏移量。 */
    readonly clock: Clock;
    /** 挂在根应用的 `/test-control` 下。 */
    readonly app: Hono;
}

export interface TestControlOptions {
    readonly token: string;
    readonly scheduler: JobScheduler;
    readonly log: Logger;
}

const NOT_FOUND = {code: "not_found"} as const;
const BAD_REQUEST = {code: "bad_request"} as const;

function digest(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
}

/** 只有这几个键的普通对象；多出来的键也算不合格（拼错的字段名不该被悄悄忽略）。 */
function exactObject(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** 请求体按 JSON 读；读不出来时为 undefined，调用方回 400。 */
async function jsonBody(c: Context): Promise<unknown> {
    try {
        return (await c.req.json()) as unknown;
    } catch {
        // 不是合法的 JSON 是请求方的错，按 `bad_request` 回给它；错误对象里是请求体的片段，不往外传。
        return undefined;
    }
}

export function createTestControl(options: TestControlOptions): TestControl {
    const {scheduler, log} = options;
    const expected = digest(`Bearer ${options.token}`);
    let offsetMs = 0;
    const clock: Clock = {now: () => Date.now() + offsetMs};

    // 两边先各取 SHA-256 再比：长度相同，`timingSafeEqual` 才能用，比较的耗时也与口令猜对了几位无关。
    const authorized = (c: Context): boolean => {
        const header = c.req.header("Authorization");
        return header !== undefined && timingSafeEqual(digest(header), expected);
    };

    const app = new Hono();
    app.post("/clock", async (c) => {
        if (!authorized(c)) return c.json(NOT_FOUND, 404);
        const body = await jsonBody(c);
        if (!exactObject(body, ["advanceMs"])) return c.json(BAD_REQUEST, 400);
        const {advanceMs} = body;
        // 只能往前拨；累加之后仍要是安全整数，`Date.now() + offsetMs` 才不丢精度。
        if (typeof advanceMs !== "number" || !Number.isSafeInteger(advanceMs) || advanceMs <= 0 || !Number.isSafeInteger(offsetMs + advanceMs)) {
            return c.json(BAD_REQUEST, 400);
        }
        offsetMs += advanceMs;
        log.info("test_control.clock_advanced", "test control moved the module clock forward", {offsetMs});
        return c.json({now: clock.now()});
    });
    app.post("/jobs/run", async (c) => {
        if (!authorized(c)) return c.json(NOT_FOUND, 404);
        const body = await jsonBody(c);
        if (!exactObject(body, ["module", "job"]) || typeof body.module !== "string" || typeof body.job !== "string") return c.json(BAD_REQUEST, 400);
        const {module, job} = body;
        const handle = scheduler.find(module, job);
        if (handle === undefined) return c.json(NOT_FOUND, 404);
        // 到这里两个名字都是登记过的模块与任务名，不是任意的请求内容，可以进日志。
        log.info("test_control.job_run", "test control runs a scheduled job now", {module, job});
        const outcome = await handle.runNow();
        if (outcome === "done") return c.json({status: "done"});
        if (outcome === "failed") return c.json({code: "job_failed", module, job}, 500);
        // 调度还没开始或已经停了：监听之后、模块 start() 之前，或停止之后还连着的请求。Spec 没给这种情形定码，
        // 借用就绪检查的 `not_ready`。
        return c.json({code: "not_ready"}, 503);
    });
    return {clock, app};
}

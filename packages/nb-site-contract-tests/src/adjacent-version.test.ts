/**
 * 相邻版本可互换（`site.operations` 输出 7、验收 2）：本版本执行过迁移、写过数据的数据目录交给上一个版本的程序，它仍能启动、
 * 通过就绪检查并正常读写。上一个版本的程序由 `NB_SITE_PREVIOUS_SERVER_COMMAND` 给出（JSON 数组形式的 argv）；没设时整组跳过，
 * 组名里写明跳过的原因，运行结果里看得到，不算通过。CI 与本机都用 `nb-site-server` 的 `build:previous` 打出基准提交的程序。
 *
 * 上一个版本还没有的接口不测（验收 2 的最后一句）。有没有由给出程序的一方按上一个版本的源码说，经
 * `NB_SITE_PREVIOUS_WITHOUT_INGEST`、`NB_SITE_PREVIOUS_WITHOUT_TELEMETRY_JOBS` 传进来；用例不看上一个版本回不回 404 自己判断，
 * 否则上一个版本把写入口弄丢了也会被当成“还没有”放过去。跳过的用例在名字里写明原因。
 *
 * 上报按收集清单第 1 版造：上一个版本只认识它发布时的清单，第 1 版是哪个版本都认识的。
 * 登录（验收 2 的“登录可用”）等账号模块有了接口（t07）再加进来。
 *
 * 时间预算：起停进程、跨进程的一串读写放在 `beforeAll` 里；用例只发请求、断言记下的结果。
 */

import {beforeAll, describe, expect, it} from "bun:test";

import {ANONYMOUS_MANIFESTS} from "@notnotype/nb-site-telemetry-contract";

import {
    commandFromEnv,
    flagFromEnv,
    PREVIOUS_SERVER_COMMAND_ENV,
    PREVIOUS_WITHOUT_INGEST_ENV,
    PREVIOUS_WITHOUT_TELEMETRY_JOBS_ENV,
    useSiteSandbox,
    type CommandResult,
    type ProcessOptions,
    type SiteProcess,
} from "./testing/site";
import {dailyReport, sendReport, type IngestResponse, type Report} from "./testing/telemetry";

const sandbox = useSiteSandbox("nb-site-contract-tests adjacent-version.test.ts");

const previous = commandFromEnv(PREVIOUS_SERVER_COMMAND_ENV);
const withoutIngest = flagFromEnv(PREVIOUS_WITHOUT_INGEST_ENV);
const withoutJobs = flagFromEnv(PREVIOUS_WITHOUT_TELEMETRY_JOBS_ENV);
const title = previous === undefined ? `相邻版本可互换（输出 7、验收 2）：跳过，没设 ${PREVIOUS_SERVER_COMMAND_ENV}` : "相邻版本可互换（输出 7、验收 2）";
const noIngest = withoutIngest ? `：跳过，${PREVIOUS_WITHOUT_INGEST_ENV}=1（上一个版本还没有统计的写入口）` : "";
const noJobs = withoutIngest || withoutJobs ? `：跳过，${withoutIngest ? PREVIOUS_WITHOUT_INGEST_ENV : PREVIOUS_WITHOUT_TELEMETRY_JOBS_ENV}=1` : "";

/** 起停三四个进程的一串步骤；每个进程起来只要几百毫秒，留够负载高时的余量。 */
const SETUP_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;

const FIRST_MANIFEST = ANONYMOUS_MANIFESTS.get(1);
if (FIRST_MANIFEST === undefined) throw new Error("the telemetry contract has no anonymous manifest version 1");

/** 收集清单第 1 版的一份每日上报，每次编号不同。 */
function firstManifestReport(): Report {
    return dailyReport({anonymous: FIRST_MANIFEST});
}

/** 断言里只比状态码与响应体；响应头里有每次不同的请求编号。 */
function outcome(response: {readonly status: number; readonly body: unknown}): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

/** 起 `serve` 并等到就绪；就绪之前退出或超时都抛错，错误里带进程的输出。 */
async function startReady(options: ProcessOptions): Promise<SiteProcess> {
    const site = await sandbox.start(options);
    await site.ready();
    return site;
}

/** 停一个中途的进程：一串步骤里下一个进程要接管同一个数据目录，这一个必须先干净地退出、放掉库锁。 */
async function stopCleanly(site: SiteProcess, what: string): Promise<void> {
    const code = await site.stop();
    if (code !== 0) throw new Error(`${what} exited with ${String(code)} on SIGTERM\nstderr:\n${site.stderr()}`);
}

describe.skipIf(previous === undefined)(title, () => {
    describe("本版本迁移并写过的数据目录交给上一个版本", () => {
        let migrated: CommandResult;
        let recorded: IngestResponse;
        let report: Report;
        let site: SiteProcess;
        let ready: unknown;

        beforeAll(async () => {
            const dataDir = await sandbox.dataDir();
            migrated = await sandbox.run("migrate", {dataDir});
            if (migrated.exitCode !== 0) throw new Error(`migrate with this version failed:\n${migrated.stderr}`);
            const current = await startReady({dataDir});
            report = firstManifestReport();
            recorded = await sendReport(current.url, "daily", report);
            await stopCleanly(current, "this version");
            site = await sandbox.start({dataDir, command: previous!});
            ready = await site.ready();
        }, SETUP_TIMEOUT_MS);

        it("上一个版本的程序能启动并通过就绪检查", () => {
            expect(migrated.exitCode).toBe(0);
            expect(recorded.status).toBe(200);
            expect(ready).toMatchObject({status: "ready"});
            expect(site.exitCode).toBeNull();
        });

        it.skipIf(withoutIngest)(`每日上报可用：重发本版本记入的那一份是重发，新的一份照常记入${noIngest}`, async () => {
            const {serverDay} = recorded.body as {readonly serverDay: string};
            expect(outcome(await sendReport(site.url, "daily", report))).toEqual({status: 200, body: {serverDay, duplicate: true, dropped: []}});
            expect(outcome(await sendReport(site.url, "daily", firstManifestReport()))).toMatchObject({status: 200, body: {duplicate: false, dropped: []}});
        });

        it.skipIf(withoutIngest || withoutJobs)(`统计的两个定时任务能跑：拨到第 8 天后 aggregate 与 purge 都回 200，本版本记入的那一份被删${noJobs}`, async () => {
            const {serverDay} = recorded.body as {readonly serverDay: string};
            const day = Date.parse(`${serverDay}T00:00:00Z`) / DAY_MS;
            const now = await site.advanceClock(1);
            // 拨到记入那天往后第 8 天的开头之后一分钟：超过最长的保留期 7 天（`site.telemetry-ingest` 的配置），用例跑多久都不会跨天。
            await site.advanceClock((day + 8) * DAY_MS + 60_000 - now);
            expect(outcome(await site.runJob("telemetry", "aggregate"))).toEqual({status: 200, body: {status: "done"}});
            expect(outcome(await site.runJob("telemetry", "purge"))).toEqual({status: 200, body: {status: "done"}});
            expect(outcome(await sendReport(site.url, "daily", report))).toMatchObject({status: 200, body: {duplicate: false}});
        });
    });

    describe.skipIf(withoutIngest)(`上一个版本先写、本版本迁移并写、再换回上一个版本${noIngest}`, () => {
        let byPrevious: Report;
        let byCurrent: Report;
        let first: IngestResponse;
        let migrated: CommandResult;
        let second: IngestResponse;
        let firstSeenByCurrent: IngestResponse;
        let site: SiteProcess;

        beforeAll(async () => {
            const dataDir = await sandbox.dataDir();
            // 上一个版本从空目录起：库由它自己的迁移建出来，里面是它写下的数据。
            const before = await startReady({dataDir, command: previous!});
            byPrevious = firstManifestReport();
            first = await sendReport(before.url, "daily", byPrevious);
            await stopCleanly(before, "the previous version");

            migrated = await sandbox.run("migrate", {dataDir});
            if (migrated.exitCode !== 0) throw new Error(`migrate with this version failed:\n${migrated.stderr}`);
            const current = await startReady({dataDir});
            byCurrent = firstManifestReport();
            second = await sendReport(current.url, "daily", byCurrent);
            firstSeenByCurrent = await sendReport(current.url, "daily", byPrevious);
            await stopCleanly(current, "this version");

            site = await startReady({dataDir, command: previous!});
        }, SETUP_TIMEOUT_MS);

        it("上一个版本记入的一份，本版本迁移之后认得出是重发；本版本记入的一份照常记入", () => {
            expect(outcome(first)).toMatchObject({status: 200, body: {duplicate: false}});
            expect(migrated.exitCode).toBe(0);
            expect(outcome(firstSeenByCurrent)).toMatchObject({status: 200, body: {duplicate: true}});
            expect(outcome(second)).toMatchObject({status: 200, body: {duplicate: false}});
        });

        it("换回上一个版本：两个版本各自记入的那一份重发都是 duplicate", async () => {
            expect(outcome(await sendReport(site.url, "daily", byPrevious))).toMatchObject({status: 200, body: {duplicate: true}});
            expect(outcome(await sendReport(site.url, "daily", byCurrent))).toMatchObject({status: 200, body: {duplicate: true}});
        });
    });
});

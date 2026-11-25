/**
 * 相邻版本可互换（`site.operations` 输出 7、验收 2）：本版本执行过迁移的数据目录交给上一个版本的程序，它仍能启动并通过
 * 就绪检查。上一个版本的程序由 `NB_SITE_PREVIOUS_SERVER_COMMAND` 给出（JSON 数组形式的 argv）；没设时整组跳过，
 * 组名里写明跳过的原因，运行结果里看得到，不算通过。
 *
 * 验收 2 的“登录与每日上报可用”要等 t06、t07 有了接口再加进这一组。CI 拿基准提交的程序当上一个版本，由 t06 接入。
 */

import {beforeAll, describe, expect, it} from "bun:test";

import {commandFromEnv, PREVIOUS_SERVER_COMMAND_ENV, useSiteSandbox, type CommandResult, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests adjacent-version.test.ts");

const previous = commandFromEnv(PREVIOUS_SERVER_COMMAND_ENV);
const title = previous === undefined ? `相邻版本可互换（输出 7、验收 2）：跳过，没设 ${PREVIOUS_SERVER_COMMAND_ENV}` : "相邻版本可互换（输出 7、验收 2）";

describe.skipIf(previous === undefined)(title, () => {
    let migrated: CommandResult;
    let site: SiteProcess;
    let ready: unknown;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        migrated = await sandbox.run("migrate", {dataDir});
        if (migrated.exitCode !== 0) throw new Error(`migrate with this version failed:\n${migrated.stderr}`);
        // 上一个版本可能还不认识测试控制口令，不给它。
        site = await sandbox.start({dataDir, command: previous!, env: {NB_SITE_TEST_CONTROL: undefined}});
        ready = await site.ready();
    }, 30_000);

    it("本版本迁移过的数据目录，上一个版本的程序能启动并通过就绪检查", () => {
        expect(migrated.exitCode).toBe(0);
        expect(ready).toMatchObject({status: "ready"});
        expect(site.exitCode).toBeNull();
    });
});

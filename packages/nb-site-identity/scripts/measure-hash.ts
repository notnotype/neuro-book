/**
 * 密码哈希的耗时与内存（w00037 t07 计划第 5 节切片表第 4 行；做法照计划探针 p5）。不是测试，不进 `bun test`；改了哈希参数、换了
 * Bun 版本或部署的机器时手动跑一次，数字写进 Task 记录，并核对 `src/hash-limiter.ts` 的 `FAILURE_FLOOR_MS` 仍高于两种算法单次
 * 校验的 p99。
 *
 *     bun packages/nb-site-identity/scripts/measure-hash.ts [每种算法每个并发循环的校验次数，缺省 100]
 *
 * 用 `taskset -c 0,1` 把自己钉在两个核上重新起一次（部署的机器按 2 核估），量四样：
 * 1. 一次哈希（新格式）：顺序算 20 次的 p50 与 p99；
 * 2. 8 个同时算：从发起到 8 个都完成的时长，做 5 轮；
 * 3. 两种算法单次校验的耗时：2 个并发循环（缺省的哈希限额就是 2），各校验 N 次，合起来取 p50 与 p99；
 * 4. 32 个并发登录：真实的模块（真的 SQLite 文件与迁移、真的 Better Auth、缺省的哈希限额 2 与队长 64），同一个账号、32 个来源
 *    同时登录，量从发起到全部回应的时长、每个请求的 p50 与 p99、各状态码的个数（队长 64 装得下，应当全是 200），做 3 轮；
 * 5. 常驻内存：开始时与整个过程里的峰值（每 10 毫秒采一次；哈希在线程池里算，事件循环空着，采样不受影响）。
 * 跑前跑后各记一次 `/proc/loadavg`：负载高时数字偏大，汇报时一起写。需要 Linux 的 `taskset`。
 */

import {readFileSync} from "node:fs";
import {scrypt} from "node:crypto";

import {hashPassword, verifyPassword} from "../src/password";
import {TEST_SITE_URL} from "../src/testing/library";
import {createTestIdentity, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION} from "../src/testing/module";

const PINNED_ENV = "NB_MEASURE_HASH_PINNED";
const CORES = "0,1";

if (process.env[PINNED_ENV] !== "1") {
    const child = Bun.spawn(["taskset", "-c", CORES, process.execPath, import.meta.path, ...process.argv.slice(2)], {
        env: {...process.env, [PINNED_ENV]: "1"},
        stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(await child.exited);
}

const loopIterations = Number(process.argv[2] ?? "100");
if (!Number.isInteger(loopIterations) || loopIterations < 1) throw new Error("iterations must be a positive integer");

const PASSWORD = "measure-hash correct horse battery staple";
const LOG = {warn: () => undefined};

function loadavg(): string {
    return readFileSync("/proc/loadavg", "utf8").trim().split(" ").slice(0, 3).join(" ");
}

function percentile(samples: readonly number[], p: number): number {
    const sorted = [...samples].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;
const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

async function timed(work: () => Promise<unknown>): Promise<number> {
    const start = performance.now();
    await work();
    return performance.now() - start;
}

function legacyHash(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(`scrypt:${salt}:${key.toString("hex")}`)));
    });
}

/** `concurrency` 个循环同时跑，每个顺序做 `iterations` 次，返回每一次的耗时。 */
async function concurrentSamples(concurrency: number, iterations: number, work: () => Promise<unknown>): Promise<number[]> {
    const samples: number[] = [];
    await Promise.all(
        Array.from({length: concurrency}, async () => {
            for (let index = 0; index < iterations; index += 1) samples.push(await timed(work));
        }),
    );
    return samples;
}

const loadBefore = loadavg();
const rssStart = process.memoryUsage().rss;
let rssPeak = rssStart;
const sampler = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
}, 10);

// 先各算一次，让线程池与库的初始化不落进样本。
const argon2 = await hashPassword(PASSWORD);
const legacy = await legacyHash(PASSWORD, "measure-salt");
await verifyPassword(PASSWORD, argon2, {accountId: 0, log: LOG});
await verifyPassword(PASSWORD, legacy, {accountId: 0, log: LOG});

const single: number[] = [];
for (let index = 0; index < 20; index += 1) single.push(await timed(() => hashPassword(PASSWORD)));

const eightAtOnce: number[] = [];
for (let index = 0; index < 5; index += 1) eightAtOnce.push(await timed(() => Promise.all(Array.from({length: 8}, () => hashPassword(PASSWORD)))));

const verifyArgon2 = await concurrentSamples(2, loopIterations, async () => {
    if (!(await verifyPassword(PASSWORD, argon2, {accountId: 0, log: LOG}))) throw new Error("argon2id verify failed");
});
const verifyLegacy = await concurrentSamples(2, loopIterations, async () => {
    if (!(await verifyPassword(PASSWORD, legacy, {accountId: 0, log: LOG}))) throw new Error("legacy verify failed");
});

// 测试用的模块把失败下限与“先等 2 秒”的睡眠换成立即 resolve；这里全是成功的登录，两样都碰不到。
const identity = await createTestIdentity("identity-measure-hash");
const concurrentLogins: {wallMs: number[]; requestMs: number[]; statuses: Record<string, number>} = {wallMs: [], requestMs: [], statuses: {}};
try {
    await identity.addUser("measure", {password: PASSWORD, consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}});
    const loginOnce = async (address: string): Promise<void> => {
        const started = performance.now();
        const response = await identity.fetch("/login", {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: address},
            body: JSON.stringify({identifier: "measure", password: PASSWORD}),
        });
        await response.arrayBuffer();
        concurrentLogins.requestMs.push(performance.now() - started);
        concurrentLogins.statuses[String(response.status)] = (concurrentLogins.statuses[String(response.status)] ?? 0) + 1;
    };
    // 先登录一次，让库与模块的初始化不落进样本；它不计入。
    await loginOnce("198.51.100.1");
    concurrentLogins.requestMs.length = 0;
    concurrentLogins.statuses = {};
    // 每轮换一批来源：来源加用户名 5 分钟只有 10 次。
    for (let batch = 0; batch < 3; batch += 1) {
        concurrentLogins.wallMs.push(await timed(() => Promise.all(Array.from({length: 32}, (_, index) => loginOnce(`10.${String(batch)}.0.${String(index + 1)}`)))));
    }
} finally {
    await identity.root.cleanup();
}

clearInterval(sampler);

const result = {
    bun: Bun.version,
    cores: CORES,
    loadavgBefore: loadBefore,
    loadavgAfter: loadavg(),
    hashOnce: {samples: single.length, p50Ms: round(percentile(single, 50)), p99Ms: round(percentile(single, 99))},
    hashEightAtOnce: {rounds: eightAtOnce.length, medianMs: round(percentile(eightAtOnce, 50)), maxMs: round(Math.max(...eightAtOnce))},
    verifyConcurrency2: {
        argon2id: {samples: verifyArgon2.length, p50Ms: round(percentile(verifyArgon2, 50)), p99Ms: round(percentile(verifyArgon2, 99)), maxMs: round(Math.max(...verifyArgon2))},
        legacyScrypt: {samples: verifyLegacy.length, p50Ms: round(percentile(verifyLegacy, 50)), p99Ms: round(percentile(verifyLegacy, 99)), maxMs: round(Math.max(...verifyLegacy))},
    },
    concurrentLogins32: {
        rounds: concurrentLogins.wallMs.length,
        wallMs: concurrentLogins.wallMs.map(round),
        requestP50Ms: round(percentile(concurrentLogins.requestMs, 50)),
        requestP99Ms: round(percentile(concurrentLogins.requestMs, 99)),
        statuses: concurrentLogins.statuses,
    },
    rssMb: {start: mb(rssStart), peak: mb(rssPeak)},
};
console.log(JSON.stringify(result, null, 2));

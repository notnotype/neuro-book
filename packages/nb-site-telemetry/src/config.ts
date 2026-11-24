/**
 * 统计模块的配置（docs/specs/site/telemetry-ingest.md 的输入一节）。读法与入口的 `nb-site-server/src/config.ts` 一致：
 * 没设与设成空串都算没给、用缺省值；整数只认十进制的整数写法；问题只带变量名与问题词，不带取值（`site.operations` 输出 1，
 * 问题词见它的失败与恢复一节）。
 */

/** 统计模块自己的配置。 */
export interface TelemetryConfig {
    /** `NB_SITE_TELEMETRY_RETENTION_DAYS`：原始上报留几个服务端日。下限 2 撑住协议的 48 小时去重，上限 7 是条款（Spec 边界一节）。 */
    readonly retentionDays: number;
    /** `NB_SITE_TELEMETRY_RATE_LIMIT`：每个来源每个 10 分钟窗口的请求数，三个写入口合计。 */
    readonly rateLimit: number;
    /** `NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS` 换成毫秒：聚合任务的间隔。 */
    readonly aggregateIntervalMs: number;
}

/** 配置问题只带变量名与固定的问题词，不带取值（`site.operations` 输出 1）。 */
export interface TelemetryConfigProblem {
    readonly name: string;
    readonly problem: "not_integer" | "out_of_range";
}

export type TelemetryConfigResult = {readonly ok: true; readonly config: TelemetryConfig} | {readonly ok: false; readonly problems: readonly TelemetryConfigProblem[]};

interface IntegerVariable {
    readonly name: string;
    readonly min: number;
    readonly max: number;
    readonly fallback: number;
}

const RETENTION_DAYS: IntegerVariable = {name: "NB_SITE_TELEMETRY_RETENTION_DAYS", min: 2, max: 7, fallback: 7};
const RATE_LIMIT: IntegerVariable = {name: "NB_SITE_TELEMETRY_RATE_LIMIT", min: 1, max: 1_000_000, fallback: 600};
const AGGREGATE_INTERVAL_SECONDS: IntegerVariable = {name: "NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS", min: 60, max: 86_400, fallback: 600};

export function parseTelemetryConfig(env: Readonly<Record<string, string | undefined>>): TelemetryConfigResult {
    const problems: TelemetryConfigProblem[] = [];
    const read = (variable: IntegerVariable): number => {
        const value = env[variable.name];
        if (value === undefined || value === "") return variable.fallback;
        // `-1` 是整数、只是越界；`1e3`、`7.0` 不是整数写法。
        if (!/^-?\d+$/u.test(value)) {
            problems.push({name: variable.name, problem: "not_integer"});
            return variable.fallback;
        }
        const number = Number(value);
        if (number < variable.min || number > variable.max) {
            problems.push({name: variable.name, problem: "out_of_range"});
            return variable.fallback;
        }
        return number;
    };
    const retentionDays = read(RETENTION_DAYS);
    const rateLimit = read(RATE_LIMIT);
    const aggregateIntervalSeconds = read(AGGREGATE_INTERVAL_SECONDS);
    if (problems.length > 0) return {ok: false, problems};
    return {ok: true, config: {retentionDays, rateLimit, aggregateIntervalMs: aggregateIntervalSeconds * 1000}};
}

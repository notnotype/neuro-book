// 多轮修订谱系与台账 v3（Task 24 Phase 1）。
//
// 一次审稿 = 一轮，一轮 = 一个自包含目录 + 台账里的一个条目：
//
//     .agent/llmlint/
//         session.json              台账（跨轮累积的唯一沉淀）
//         rounds/0001/
//             source/<basename>     修前快照（步骤 2 跑 check 之前拷下来的）
//             check-source.json     步骤 2 的 check --format json
//             detect-source.json    步骤 2 的 detect --format json
//             plan.md               修复计划
//             output/<basename>     修后稿
//             check-output.json     复测 check
//             detect-output.json    复测 detect
//
// 为什么目录由代码建而不是让 Agent 拼：contribute 要读这些文件产出上传条目，
// 轮号算错或快照漏拷会产出「错但看不出来」的数据。轮号、目录、台账骨架全部在这里定，
// Agent 只负责往条目里填判断类字段（decisions / judgment / retest）。
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {loadUserSettings, type SharingTier} from "./user-state";

/** 台账 schema 版本。v2 不迁移不兼容——它从来没有代码读过，没有兼容负担。 */
export const LEDGER_VERSION = 3;

const LLMLINT_DIR = join(".agent", "llmlint");
const LEDGER_FILE = "session.json";
const ROUNDS_DIR = "rounds";
const LEDGER_KEYS = new Set(["version", "projectId", "rounds"]);
const ROUND_KEYS = new Set([
    "round", "parentRound", "startedAt", "completedAt", "status", "sourceFiles", "settings",
    "summary", "retest", "decisions", "localConfigSuggestions", "judgment", "contributedAt",
]);
const METRIC_KEYS = new Set(["staticIssues", "densityIssues", "docPAi", "spread"]);
const RETEST_KEYS = new Set([...METRIC_KEYS, "verdict"]);
const DECISION_KEYS = new Set(["file", "line", "ruleId", "fragment", "verdict", "reason"]);
const JUDGMENT_KEYS = new Set(["wantReadOnBefore", "wantReadOnAfter", "comment", "blind"]);
const SETTINGS_KEYS = new Set(["sharingTier", "login"]);
const ROUND_STATUSES = new Set<RoundStatus>(["running", "completed", "aborted"]);
const SHARING_TIERS = new Set<SharingTier>(["off", "stats", "fragments", "full"]);
const DECISION_VERDICTS = new Set<RoundDecision["verdict"]>(["fix", "keep", "ask"]);
const RETEST_VERDICTS = new Set<RoundRetest["verdict"]>(["pass", "fail"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/iu;

/** 一轮的检测指标。docPAi / spread 由 Agent 从 detect 报告抄一个数；命中分布不在这里，在轮目录的 check JSON 里。 */
export type RoundMetrics = {
    staticIssues: number;
    densityIssues: number;
    docPAi: number;
    spread: number;
};

/** 复测指标：比 summary 多一个判据结论。verdict 判据见 SKILL.md 步骤 4（命中减少 + 无新命中 + 篇幅 ±20%）。 */
export type RoundRetest = RoundMetrics & {
    verdict: "pass" | "fail";
};

/** 一处疑难判定。这是学习出口的原料，也是 fragments 档上传的主体。 */
export type RoundDecision = {
    file: string;
    line: number;
    /** null = 语义规则或无规则依托的观察（四象限「规则静默 × 文内高位」那一格）。 */
    ruleId: string | null;
    fragment: string;
    verdict: "fix" | "keep" | "ask";
    reason: string;
};

/**
 * 作者自评。全部字段可 null（拒答不阻塞流程）。
 *
 * `blind` 恒 false 且必须如实写：这是作者对自己刚改完的稿子打分，不是独立盲评，
 * 不能用来满足 D5 的第二条件（那条要求独立盲评，出口在 web 采集站）。
 */
export type RoundJudgment = {
    /** 修前分，问在步骤 1 跑 check 之前——读完「你这稿多少处 AI 味」再打分会被带偏。 */
    wantReadOnBefore: number | null;
    /** 修后分，问在复测通过之后。 */
    wantReadOnAfter: number | null;
    comment: string | null;
    blind: false;
};

export type RoundStatus = "running" | "completed" | "aborted";

export type RoundEntry = {
    round: number;
    /**
     * 父轮号：本轮续修的是哪一轮的 output。null = 另起一篇。
     *
     * 必须显式声明，不能靠「上轮 output 哈希 ≠ 本轮 source 哈希」推——作者第 1 轮审第 1 章、
     * 第 2 轮审第 2 章时两个哈希天然不等，那样推会凭空捏造一条不存在的用户修订边。
     */
    parentRound: number | null;
    startedAt: string;
    /** null = 本轮还没收尾。 */
    completedAt: string | null;
    status: RoundStatus;
    /** 原始输入路径（相对 cwd），与 source/ 里的 basename 对应。 */
    sourceFiles: string[];
    settings: {sharingTier: SharingTier; login: "none"};
    /** null = 步骤 2 还没写回。 */
    summary: RoundMetrics | null;
    /** null = 还没复测。 */
    retest: RoundRetest | null;
    decisions: RoundDecision[];
    localConfigSuggestions: string[];
    judgment: RoundJudgment;
    /** 非 null = 已导出到发件箱，不再重复导出。 */
    contributedAt: string | null;
};

export type Ledger = {
    version: typeof LEDGER_VERSION;
    /** 随机 UUID，无任何语义。服务端将来按它把同项目多轮分组，而不需要看到任何内容。 */
    projectId: string;
    rounds: RoundEntry[];
};

/** 台账与轮目录的根，按 cwd 解析（与 check 的相对路径行为一致，Agent 在项目根运行）。 */
export function llmlintDir(cwd: string): string {
    return join(resolve(cwd), LLMLINT_DIR);
}

export function ledgerPath(cwd: string): string {
    return join(llmlintDir(cwd), LEDGER_FILE);
}

export function roundsRoot(cwd: string): string {
    return join(llmlintDir(cwd), ROUNDS_DIR);
}

/** 轮目录路径。轮号四位零填充，1 → rounds/0001。 */
export function roundDir(cwd: string, round: number): string {
    return join(roundsRoot(cwd), formatRoundNumber(round));
}

export function formatRoundNumber(round: number): string {
    return String(round).padStart(4, "0");
}

/**
 * 读台账。文件不存在返回 null；版本不是 v3 直接抛——不写兼容分支，
 * 旧档由用户自行删除或另存（`decisions` 想留就手工搬过去）。
 */
export function loadLedger(cwd: string): Ledger | null {
    const filePath = ledgerPath(cwd);
    if (!existsSync(filePath)) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    } catch (error) {
        throw new Error(`${filePath} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    const ledger = readObject(parsed, "台账", LEDGER_KEYS);
    if (ledger.version !== LEDGER_VERSION) {
        throw new Error(
            `${filePath} 是 v${String(ledger.version)} 台账，当前版本 v${LEDGER_VERSION}，不做迁移。`
                + `需要保留旧记录请自行另存后删除该文件。`,
        );
    }
    if (typeof ledger.projectId !== "string" || !UUID_PATTERN.test(ledger.projectId)) {
        throw new Error(`${filePath} 的 projectId 必须是 UUID。`);
    }
    if (!Array.isArray(ledger.rounds)) {
        throw new Error(`${filePath} 的 rounds 必须是数组。`);
    }
    const rounds = ledger.rounds.map((entry, index) => parseRoundEntry(entry, `rounds[${index}]`));
    const roundNumbers = new Set<number>();
    for (const entry of rounds) {
        if (roundNumbers.has(entry.round)) {
            throw new Error(`${filePath} 的 round=${entry.round} 重复。`);
        }
        roundNumbers.add(entry.round);
    }
    for (const entry of rounds) {
        if (entry.parentRound !== null && (!roundNumbers.has(entry.parentRound) || entry.parentRound >= entry.round)) {
            throw new Error(`${filePath} 的 round=${entry.round} 指向非法 parentRound=${entry.parentRound}。`);
        }
    }
    return {version: LEDGER_VERSION, projectId: ledger.projectId, rounds};
}

/** 规则 ID 会进入 stats/fragments；只允许规则 registry 能表达的无路径安全标识。 */
export function isSafeRuleId(value: string): boolean {
    return RULE_ID_PATTERN.test(value);
}

/** 逐层解析一轮台账，未知键和非法形态全部 fail closed。 */
function parseRoundEntry(value: unknown, label: string): RoundEntry {
    const entry = readObject(value, label, ROUND_KEYS);
    const round = readPositiveInteger(entry.round, `${label}.round`);
    const parentRound = entry.parentRound === null ? null : readPositiveInteger(entry.parentRound, `${label}.parentRound`);
    const sourceFiles = readStringArray(entry.sourceFiles, `${label}.sourceFiles`, true);
    const settings = readObject(entry.settings, `${label}.settings`, SETTINGS_KEYS);
    const judgment = parseJudgment(entry.judgment, `${label}.judgment`);
    return {
        round,
        parentRound,
        startedAt: readTimestamp(entry.startedAt, `${label}.startedAt`, false),
        completedAt: readTimestamp(entry.completedAt, `${label}.completedAt`, true),
        status: readEnum(entry.status, ROUND_STATUSES, `${label}.status`),
        sourceFiles,
        settings: {
            sharingTier: readEnum(settings.sharingTier, SHARING_TIERS, `${label}.settings.sharingTier`),
            login: readLiteral(settings.login, "none", `${label}.settings.login`),
        },
        summary: entry.summary === null ? null : parseMetrics(entry.summary, `${label}.summary`),
        retest: entry.retest === null ? null : parseRetest(entry.retest, `${label}.retest`),
        decisions: readArray(entry.decisions, `${label}.decisions`).map((decision, index) => parseDecision(decision, `${label}.decisions[${index}]`)),
        localConfigSuggestions: readStringArray(entry.localConfigSuggestions, `${label}.localConfigSuggestions`, false),
        judgment,
        contributedAt: readTimestamp(entry.contributedAt, `${label}.contributedAt`, true),
    };
}

/** 解析静态/检测指标；计数必须为非负整数，概率类只要求有限数。 */
function parseMetrics(value: unknown, label: string): RoundMetrics {
    const metrics = readObject(value, label, METRIC_KEYS);
    return {
        staticIssues: readNonNegativeInteger(metrics.staticIssues, `${label}.staticIssues`),
        densityIssues: readNonNegativeInteger(metrics.densityIssues, `${label}.densityIssues`),
        docPAi: readFiniteNumber(metrics.docPAi, `${label}.docPAi`),
        spread: readFiniteNumber(metrics.spread, `${label}.spread`),
    };
}

/** 解析复测指标，禁止通过额外字段夹带自由文本。 */
function parseRetest(value: unknown, label: string): RoundRetest {
    const retest = readObject(value, label, RETEST_KEYS);
    const metrics = parseMetrics({
        staticIssues: retest.staticIssues,
        densityIssues: retest.densityIssues,
        docPAi: retest.docPAi,
        spread: retest.spread,
    }, label);
    return {...metrics, verdict: readEnum(retest.verdict, RETEST_VERDICTS, `${label}.verdict`)};
}

/** 解析一处人工决策；文件归属在贡献阶段结合本轮 sourceFiles 做交叉校验。 */
function parseDecision(value: unknown, label: string): RoundDecision {
    const decision = readObject(value, label, DECISION_KEYS);
    const ruleId = decision.ruleId === null ? null : readString(decision.ruleId, `${label}.ruleId`);
    if (ruleId !== null && !isSafeRuleId(ruleId)) {
        throw new Error(`${label}.ruleId 不是安全规则 ID。`);
    }
    return {
        file: readString(decision.file, `${label}.file`),
        line: readPositiveInteger(decision.line, `${label}.line`),
        ruleId,
        fragment: readString(decision.fragment, `${label}.fragment`, true),
        verdict: readEnum(decision.verdict, DECISION_VERDICTS, `${label}.verdict`),
        reason: readString(decision.reason, `${label}.reason`, true),
    };
}

/** 解析作者自评；0–5 是 Task 24 的量表合同，null 表示拒答。 */
function parseJudgment(value: unknown, label: string): RoundJudgment {
    const judgment = readObject(value, label, JUDGMENT_KEYS);
    return {
        wantReadOnBefore: readRating(judgment.wantReadOnBefore, `${label}.wantReadOnBefore`),
        wantReadOnAfter: readRating(judgment.wantReadOnAfter, `${label}.wantReadOnAfter`),
        comment: judgment.comment === null ? null : readString(judgment.comment, `${label}.comment`, true),
        blind: readLiteral(judgment.blind, false, `${label}.blind`),
    };
}

function readObject(value: unknown, label: string, allowed: Set<string>): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象。`);
    }
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
        if (!allowed.has(key)) {
            throw new Error(`${label}.${key} 不是允许的字段。`);
        }
    }
    return object;
}

function readArray(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} 必须是数组。`);
    }
    return value;
}

function readStringArray(value: unknown, label: string, requireNonEmpty: boolean): string[] {
    const values = readArray(value, label).map((item, index) => readString(item, `${label}[${index}]`));
    if (requireNonEmpty && values.length === 0) {
        throw new Error(`${label} 至少需要一项。`);
    }
    return values;
}

function readString(value: unknown, label: string, allowEmpty = false): string {
    if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
        throw new Error(`${label} 必须是${allowEmpty ? "字符串" : "非空字符串"}。`);
    }
    return value;
}

function readFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${label} 必须是有限数字。`);
    }
    return value;
}

function readPositiveInteger(value: unknown, label: string): number {
    const number = readFiniteNumber(value, label);
    if (!Number.isInteger(number) || number < 1) {
        throw new Error(`${label} 必须是正整数。`);
    }
    return number;
}

function readNonNegativeInteger(value: unknown, label: string): number {
    const number = readFiniteNumber(value, label);
    if (!Number.isInteger(number) || number < 0) {
        throw new Error(`${label} 必须是非负整数。`);
    }
    return number;
}

function readRating(value: unknown, label: string): number | null {
    if (value === null) {
        return null;
    }
    const number = readFiniteNumber(value, label);
    if (number < 0 || number > 5) {
        throw new Error(`${label} 必须在 0–5 之间或为 null。`);
    }
    return number;
}

function readTimestamp(value: unknown, label: string, nullable: true): string | null;
function readTimestamp(value: unknown, label: string, nullable: false): string;
function readTimestamp(value: unknown, label: string, nullable: boolean): string | null {
    if (value === null && nullable) {
        return null;
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
        throw new Error(`${label} 必须是规范 UTC ISO 时间戳${nullable ? "或 null" : ""}。`);
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
        throw new Error(`${label} 必须是规范 UTC ISO 时间戳${nullable ? "或 null" : ""}。`);
    }
    return value;
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>, label: string): T {
    if (typeof value !== "string" || !allowed.has(value as T)) {
        throw new Error(`${label} 必须是 ${[...allowed].join("、")} 之一。`);
    }
    return value as T;
}

function readLiteral<T extends string | boolean>(value: unknown, expected: T, label: string): T {
    if (value !== expected) {
        throw new Error(`${label} 必须是 ${String(expected)}。`);
    }
    return expected;
}

/** 全量写台账，四空格 JSON + 尾换行（与 settings.json 同风格，diff 友好）。 */
export function saveLedger(cwd: string, ledger: Ledger): void {
    mkdirSync(llmlintDir(cwd), {recursive: true});
    writeFileSync(ledgerPath(cwd), `${JSON.stringify(ledger, null, 4)}\n`, "utf-8");
}

/**
 * 下一个轮号 = max(台账各 round, rounds/ 现有目录号) + 1。
 *
 * 目录也参与是为了让中断轮（建了目录没写完台账）占住号不被复用——
 * 复用会让两轮的产物混在同一个目录里，谱系直接失真。
 */
export function nextRoundNumber(cwd: string, ledger: Ledger | null): number {
    let max = 0;
    for (const entry of ledger?.rounds ?? []) {
        if (typeof entry.round === "number" && entry.round > max) {
            max = entry.round;
        }
    }
    const root = roundsRoot(cwd);
    if (existsSync(root)) {
        for (const name of readdirSync(root, {withFileTypes: true})) {
            if (!name.isDirectory()) {
                continue;
            }
            const parsed = Number.parseInt(name.name, 10);
            if (Number.isInteger(parsed) && parsed > max) {
                max = parsed;
            }
        }
    }
    return max + 1;
}

export type BeginRoundInput = {
    cwd: string;
    /** 本轮输入文件（相对或绝对路径均可）。 */
    files: string[];
    /** 续修哪一轮的 output；另起一篇传 null。 */
    parentRound: number | null;
    /** 注入时间戳，测试用；缺省取当前时间。 */
    now?: string;
};

export type BeginRoundResult = {
    round: number;
    dir: string;
    /** source/ 下的实际文件名，按 files 顺序对应（重名已消歧）。 */
    snapshots: string[];
};

/**
 * 起一轮：建目录 → 快照修前正文 → 追加台账骨架。
 *
 * 快照时机是步骤 2 跑 check 之前，此刻磁盘上的内容才是真正的「修前」。
 */
export function beginRound(input: BeginRoundInput): BeginRoundResult {
    if (input.files.length === 0) {
        throw new Error("round begin 至少需要一个输入文件。");
    }
    const cwd = resolve(input.cwd);
    const missing = input.files.filter((file) => !existsSync(resolve(cwd, file)));
    if (missing.length > 0) {
        throw new Error(`输入文件不存在：${missing.join("、")}`);
    }

    const ledger = loadLedger(cwd) ?? {version: LEDGER_VERSION, projectId: randomUUID(), rounds: []};
    if (input.parentRound !== null) {
        const parent = ledger.rounds.find((entry) => entry.round === input.parentRound);
        if (!parent) {
            throw new Error(`台账里没有第 ${input.parentRound} 轮，--parent 只能指向已有的轮。`);
        }
    }

    const round = nextRoundNumber(cwd, ledger);
    const dir = roundDir(cwd, round);
    const sourceDir = join(dir, "source");
    mkdirSync(sourceDir, {recursive: true});

    // basename 镜像；重名加数字前缀消歧（台账 sourceFiles 保留原始路径，不丢信息）。
    const snapshots = snapshotNamesForFiles(input.files);
    for (const [index, file] of input.files.entries()) {
        const name = snapshots[index]!;
        copyFileSync(resolve(cwd, file), join(sourceDir, name));
    }

    const startedAt = input.now ?? new Date().toISOString();
    ledger.rounds.push({
        round,
        parentRound: input.parentRound,
        startedAt,
        completedAt: null,
        status: "running",
        sourceFiles: [...input.files],
        settings: {sharingTier: loadUserSettings().sharing.tier, login: "none"},
        summary: null,
        retest: null,
        decisions: [],
        localConfigSuggestions: [],
        judgment: {wantReadOnBefore: null, wantReadOnAfter: null, comment: null, blind: false},
        contributedAt: null,
    });
    saveLedger(cwd, ledger);

    return {round, dir, snapshots};
}

/** 与 round begin 完全同口径地生成安全快照名；只含 basename，重名从 2- 开始消歧。 */
export function snapshotNamesForFiles(files: string[]): string[] {
    const used = new Set<string>();
    return files.map((file) => {
        const base = portableBasename(file) || "source.txt";
        let name = base;
        if (used.has(snapshotNameKey(name))) {
            let seq = 2;
            while (used.has(snapshotNameKey(`${seq}-${base}`))) {
                seq += 1;
            }
            name = `${seq}-${base}`;
        }
        used.add(snapshotNameKey(name));
        return name;
    });
}

/** Windows 文件系统按大小写不敏感处理；所有平台都按这一更严格口径生成快照名。 */
function snapshotNameKey(name: string): string {
    return name.normalize("NFC").toLocaleLowerCase("en-US");
}

/** 同时识别 POSIX 与 Windows 分隔符，保证回退值不会夹带目录。 */
export function portableBasename(file: string): string {
    return file.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
}

/** round metrics 的结果：台账 summary/retest 需要的四项指标 + 复测 verdict 建议。 */
export type RoundMetricsResult = {
    round: number;
    dir: string;
    /** check-source.json 的静态命中总数；缺文件或字段为 null。 */
    staticIssues: number | null;
    /** density 命中数；缺文件为 null。 */
    densityIssues: number | null;
    /** detect 的 docPAi；缺文件为 null。 */
    docPAi: number | null;
    /** detect 的 spread；缺文件为 null。 */
    spread: number | null;
    /** 复测判据（有 check-output.json 时）：pass / fail；未复测为 null。 */
    verdict: "pass" | "fail" | null;
    /** 缺文件等说明；空数组 = 全部齐备。 */
    message: string[];
};

/**
 * 读轮目录的 check/detect JSON，算出台账 summary/retest 需要的四项指标。
 *
 * 有 `check-output.json`（复测产物）时再给 verdict 建议：静态命中减少、
 * 没有引入新规则命中、篇幅在原文 ±20% 内三条同时成立为 pass。
 * 检测分数不参与 verdict（SKILL 步骤 4：检测分数只作参考，不作目标）。
 */
export function computeRoundMetrics(cwd: string, round: number): RoundMetricsResult {
    const dir = roundDir(cwd, round);
    const checkSourcePath = join(dir, "check-source.json");
    const detectSourcePath = join(dir, "detect-source.json");
    const checkOutputPath = join(dir, "check-output.json");
    const message: string[] = [];

    let staticIssues: number | null = null;
    let densityIssues: number | null = null;
    let docPAi: number | null = null;
    let spread: number | null = null;
    let sourceVisible: number | null = null;
    const sourceRuleIds = new Set<string>();

    if (existsSync(checkSourcePath)) {
        const check = JSON.parse(readFileSync(checkSourcePath, "utf-8"));
        staticIssues = check.summary?.total ?? null;
        densityIssues = Array.isArray(check.densityIssues) ? check.densityIssues.length : null;
        sourceVisible = check.summary?.visibleChars ?? null;
        for (const ruleId of Object.keys(check.rules ?? {})) {
            sourceRuleIds.add(ruleId);
        }
    } else {
        message.push(`缺 ${checkSourcePath}`);
    }

    if (existsSync(detectSourcePath)) {
        const detect = JSON.parse(readFileSync(detectSourcePath, "utf-8"));
        const file = detect.files?.[0];
        docPAi = typeof file?.docPAi === "number" ? file.docPAi : null;
        spread = typeof file?.spread === "number" ? file.spread : null;
    } else {
        message.push(`缺 ${detectSourcePath}`);
    }

    let verdict: "pass" | "fail" | null = null;
    if (existsSync(checkOutputPath)) {
        const output = JSON.parse(readFileSync(checkOutputPath, "utf-8"));
        const outputTotal = output.summary?.total ?? null;
        const outputVisible = output.summary?.visibleChars ?? null;
        const outputRuleIds = new Set<string>();
        for (const issue of output.issues ?? []) {
            outputRuleIds.add(issue.ruleId);
        }
        const reduced = outputTotal !== null && staticIssues !== null && outputTotal < staticIssues;
        const noNewRules = [...outputRuleIds].every((ruleId) => sourceRuleIds.has(ruleId));
        const withinBudget = outputVisible !== null && sourceVisible !== null
            && outputVisible >= sourceVisible * 0.8 && outputVisible <= sourceVisible * 1.2;
        const checks = [
            reduced ? "命中减少" : "命中未减少",
            noNewRules ? "无新规则命中" : "引入新规则命中",
            withinBudget ? "篇幅 ±20% 内" : "篇幅超出 ±20%",
        ];
        verdict = reduced && noNewRules && withinBudget ? "pass" : "fail";
        message.push(`复测：${checks.join("、")}`);
    }

    return {round, dir, staticIssues, densityIssues, docPAi, spread, verdict, message};
}

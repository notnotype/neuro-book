import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
    ackAnswers,
    askQuestions,
    assertCursor,
    closeArtifact,
    publishArtifact,
    readAnswers,
    resolveAnswersScope,
    submitAnswer,
    supersedeQuestion,
    waitForAnswers,
    withdrawQuestion,
    type AnswersFilter,
    type AnswersQuery,
    type AnswersResult,
    type ArtifactAnswersView,
    type QuestionSpec,
} from "../core/artifact-ops.js";
import type {VersionQuestion} from "../core/artifacts.js";
import {NbdevError, type Warning} from "../core/errors.js";
import {isRecord} from "../core/json.js";
import {touchCallerLease} from "../core/lease-ops.js";
import {parseOptionsShorthand, QUESTION_ID_PATTERN, REVIEW_OPTIONS, type QuestionOption} from "../core/questions.js";
import {locateRepository} from "../core/repo.js";
import {AS_OPTION, leaseLines, listValue, requireValue, stringValue, writeCaller, writeOutcome, type CommandSpec, type Values} from "./common.js";
import type {CliIo, CommandOutcome} from "./output.js";

/** 产物、提问与答复的命令（t08）。合同见 docs/cli.md。 */

export const ARTIFACT_USAGE = `  artifact publish <workRef> <taskRef> <artifactId> [--kind <design|report|review>] [--title <标题>] [--entry <入口>] [--include <路径>]… [--keep <题号>]… [--force-version] [--as <标签>]
  artifact close <workRef> <taskRef> <artifactId> [--as <标签>]
  ask <workRef> <taskRef> --id <题号> --type <single|multi|text|confirm> --label <题目> [--option <值>[=<名称>]|@review]… [--required] [--recommend <值>]… [--artifact <artifactId>] [--about <路径>] [--as <标签>]
  ask <workRef> <taskRef> --from <JSON 文件> [--artifact <artifactId>] [--as <标签>]
  ask withdraw <workRef> <taskRef> <[artifactId#]题号> [--as <标签>]
  ask supersede <workRef> <taskRef> <[artifactId#]题号> --by <[workRef/taskRef/][artifactId#]题号> [--as <标签>]
  answers [<workRef> [<taskRef> [<artifactId>]]] [--pending|--unacked] [--wait [--timeout <秒>] [--since <答复 id>]] [--as <标签>]
  answers ack <workRef> <taskRef> <artifactId> [--through <cursor>] [--include <路径>]… [--as <标签>]
  answers record <workRef> <taskRef> <artifactId> --set <题号>=<值>… [--comment <题号>=<文字>]… [--note <说明>] [--as <标签>]`;

const DEFAULT_WAIT_SECONDS = 1_800;
/** 提交失败时怎么补救（文件已经写在主工作区）：下一次写同一个产物会顺带提交 `versions/`、`answers/` 里的残留。 */
const PUBLISH_FAILURE_HINT = "重跑同一条发布会补交它们（内容没变，不出新版本）";
const ACK_FAILURE_HINT = "重跑同一条确认会补交它们";
const ASK_FAILURE_HINT = "不要重跑（会报题号重复），下一次写这个产物时会顺带补交";
const CLOSE_FAILURE_HINT = "重跑同一条关闭会补交它们";
const DERIVE_FAILURE_HINT = "不要重跑（会报已撤回或已取代），下一次写这个产物时会顺带补交";
const RECORD_FAILURE_HINT = "不要重跑（会再写一份），下一次写这个产物时会顺带补交";

function questionLine(question: VersionQuestion): string {
    const options = question.options.length > 0 ? `（${question.options.map((option) => option.value).join("/")}）` : "";
    const outcome = question.outcome ? `  [${question.outcome.kind === "withdrawn" ? "已撤回" : "已取代"}]` : "";
    return `  ${question.id}  ${question.type}${options}  ${question.label}${question.required ? "（必答）" : ""}${outcome}`;
}

/** `题号=值` 的列表（`--set`、`--comment`）。键是用户输入：没有原型的对象存，`__proto__` 这类键不会被吞掉或改到原型上。 */
function pairs(values: Values, name: string): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    for (const entry of listValue(values, name)) {
        const separator = entry.indexOf("=");
        if (separator <= 0) throw new NbdevError("usage", `--${name} 要写成 <题号>=<值>：${entry}`);
        const key = entry.slice(0, separator);
        if (!QUESTION_ID_PATTERN.test(key)) throw new NbdevError("usage", `--${name} 的题号不合格式：${key}`, {details: {option: name, questionId: key}});
        if (Object.hasOwn(result, key)) throw new NbdevError("usage", `--${name} 给了两次题 ${key}`, {details: {option: name, questionId: key}});
        result[key] = entry.slice(separator + 1);
    }
    return result;
}

function optionsFromFlags(flags: readonly string[]): QuestionOption[] {
    if (flags.length === 1 && flags[0]!.trim() === "@review") return REVIEW_OPTIONS.map((option) => ({...option}));
    return flags.map((flag) => {
        const separator = flag.indexOf("=");
        return separator < 0 ? {value: flag, label: flag} : {value: flag.slice(0, separator), label: flag.slice(separator + 1)};
    });
}

/** `--from` 的 JSON：题的数组，或 `{questions: [...]}`；选项可以写成对象数组，也可以写一行写法的字符串。 */
async function questionsFromFile(io: CliIo, path: string): Promise<QuestionSpec[]> {
    let value: unknown;
    try {
        value = JSON.parse(await readFile(resolve(io.cwd, path), "utf8"));
    } catch (error) {
        throw new NbdevError("usage", `--from 读不了或不是合法 JSON：${path}（${error instanceof Error ? error.message : String(error)}）`, {cause: error});
    }
    const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.questions) ? value.questions : null;
    if (!list) throw new NbdevError("usage", "--from 的内容要是题的数组，或 {questions: [...]}");
    return list.map((entry: unknown, index: number): QuestionSpec => {
        if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.type !== "string" || typeof entry.label !== "string") {
            throw new NbdevError("usage", `--from 第 ${index + 1} 道题缺 id、type 或 label`);
        }
        const options = typeof entry.options === "string" ? parseOptionsShorthand(entry.options)
            : Array.isArray(entry.options) ? entry.options.map((option: unknown) => {
                if (!isRecord(option) || typeof option.value !== "string" || typeof option.label !== "string") throw new NbdevError("usage", `--from 第 ${index + 1} 道题的选项要写成 {value, label}`);
                return {value: option.value, label: option.label};
            }) : [];
        const recommend = typeof entry.recommend === "string" ? [entry.recommend] : Array.isArray(entry.recommend) ? entry.recommend.filter((item: unknown): item is string => typeof item === "string") : [];
        return {
            id: entry.id,
            type: entry.type,
            label: entry.label,
            options,
            required: entry.required === true,
            recommend,
            about: typeof entry.about === "string" ? entry.about : null,
        };
    });
}

function answersLines(result: AnswersResult): string[] {
    if (result.artifacts.length === 0) return ["没有符合条件的答复或提问"];
    const lines: string[] = [];
    for (const view of result.artifacts) lines.push(...artifactLines(view));
    if (result.cursor) lines.push(`游标：${result.cursor}（只等之后的新答复时用 --since ${result.cursor}）`);
    return lines;
}

const ADOPTION_LABEL = {none: "还没有答复", waiting: "等会话采纳", adopted: "已采纳"} as const;

function artifactLines(view: ArtifactAnswersView): string[] {
    const lines = [`${view.workId.slice(0, 6)}/${view.taskId.slice(0, view.taskId.indexOf("-"))} ${view.artifactId} v${view.version}（${view.state === "closed" ? "已关闭，" : ""}${ADOPTION_LABEL[view.adoption]}，${view.waiting} 道题待答）  ${view.title}`];
    for (const state of view.questions) {
        const value = state.answer ? `：${JSON.stringify(state.answer.value)}（针对 v${state.answer.artifactVersion}）` : "";
        const stale = state.stale ? `；旧答复${state.stale.code === "stale_value" ? "按最新一版" : "本身就"}不合法（${state.stale.reason}）` : "";
        lines.push(`  ${state.question.id}  [${state.state}]  ${state.question.label}${value}${stale}`);
    }
    if (view.unacked.length > 0) lines.push(`  未确认的答复：${view.unacked.join("、")}；把决定写进 Task README 后运行 nbdev answers ack ${view.workId.slice(0, 6)} ${view.taskId.slice(0, view.taskId.indexOf("-"))} ${view.artifactId} --through ${view.cursor} --include <README>`);
    return lines;
}

/**
 * 发布或登记了题之后怎样等答复（t19：很多会话发完不挂等待，开发者答完只能自己去通知）。命令也放进 `data.waitCommand`，
 * 用 `--json` 的调用方同样拿得到。
 */
function waitHint(data: {workId: string; taskId: string; artifactId: string}): {command: string; line: string} {
    const command = `nbdev answers ${data.workId.slice(0, 6)} ${data.taskId.slice(0, data.taskId.indexOf("-"))} ${data.artifactId} --wait`;
    return {command, line: `等答复：用会话的后台机制挂着 ${command}（Claude Code 用 run_in_background），退出码 0 是有了答复或开发者关掉了它（看 state），4（超时或被打断）时按原参数重挂；会话空闲时面板也会把 [nbdev] 通知发进输入框`};
}

/** 没写新记录的结果（内容没变、已经关闭、都已确认）：顺带补交了上次的残留时，照写命令报提交结果，提交失败同样是退出码 1。 */
function noNewRecord(schema: string, outcome: Parameters<typeof writeOutcome>[1], summary: string, extra: string[], failureHint: string): CommandOutcome {
    if (!outcome.commit.committed && outcome.commit.reason === "nothing_to_commit") {
        return {schema, data: {...outcome.data, commit: outcome.commit}, warnings: outcome.warnings, error: null, human: [summary, ...extra]};
    }
    return writeOutcome(schema, outcome, `${summary}；补交了上次没提交的记录`, extra, failureHint);
}

/** 写命令的公共部分：认调用者、调用核心函数、把调用者的警告放在最前。 */
async function withCaller<T>(io: CliIo, values: Values, run: (context: Awaited<ReturnType<typeof locateRepository>>, options: {caller: Awaited<ReturnType<typeof writeCaller>>["caller"]; herdr: Awaited<ReturnType<typeof writeCaller>>["herdr"]}) => Promise<T & {warnings: Warning[]}>): Promise<T & {warnings: Warning[]}> {
    const context = await locateRepository(io.cwd);
    const {herdr, caller, warnings} = await writeCaller(io, values);
    const outcome = await run(context, {caller, herdr});
    outcome.warnings.unshift(...warnings);
    return outcome;
}

export const ARTIFACT_COMMANDS: Record<string, CommandSpec> = {
    "artifact publish": {
        schema: "nbdev.artifact-publish/v1",
        positionals: ["workRef", "taskRef", "artifactId"],
        options: {kind: {type: "string"}, title: {type: "string"}, entry: {type: "string"}, include: {type: "string", multiple: true}, keep: {type: "string", multiple: true}, "force-version": {type: "boolean"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const outcome = await withCaller(io, values, (context, options) => publishArtifact(context, {
                workRef: positionals[0]!,
                taskRef: positionals[1]!,
                artifactId: positionals[2]!,
                kind: stringValue(values, "kind"),
                title: stringValue(values, "title"),
                entry: stringValue(values, "entry"),
                include: listValue(values, "include"),
                keep: listValue(values, "keep"),
                forceVersion: values["force-version"] === true,
            }, options));
            const {data} = outcome;
            if (data.unchanged) {
                return noNewRecord("nbdev.artifact-publish/v1", outcome, `${data.artifactId} 的内容与题都没变，没有出新版本（要强制出新版本加 --force-version）`, leaseLines({lease: data.lease, released: []}), PUBLISH_FAILURE_HINT);
            }
            const live = data.questions.filter((question) => !question.outcome).length;
            const wait = live > 0 ? waitHint(data) : null;
            const previous = data.previous ? [`上一版 v${data.previous.version}（${data.previous.publishedAt}${data.previous.publishedBy ? `，${data.previous.publishedBy} 发布` : ""}）`] : [];
            return writeOutcome("nbdev.artifact-publish/v1", {...outcome, data: {...data, waitCommand: wait?.command ?? null}}, `已发布 ${data.workId}/${data.taskId} ${data.artifactId} v${data.version}：${live} 道活的题`, [
                ...data.questions.map(questionLine),
                ...(data.dropped.length > 0 ? [`被这一版取代（页面里没有了、还没答）：${data.dropped.join("、")}`] : []),
                ...previous,
                `提交的文件：${data.committedFiles.join("、")}`,
                ...leaseLines({lease: data.lease, released: []}),
                ...(wait ? [wait.line] : []),
            ], PUBLISH_FAILURE_HINT);
        },
    },
    "artifact close": {
        schema: "nbdev.artifact-close/v1",
        positionals: ["workRef", "taskRef", "artifactId"],
        options: {...AS_OPTION},
        async run({io, positionals, values}) {
            const outcome = await withCaller(io, values, (context, options) => closeArtifact(context, {workRef: positionals[0]!, taskRef: positionals[1]!, artifactId: positionals[2]!}, options));
            const {data} = outcome;
            if (data.unchanged) return noNewRecord("nbdev.artifact-close/v1", outcome, `${data.artifactId} 已经关闭`, [], CLOSE_FAILURE_HINT);
            return writeOutcome("nbdev.artifact-close/v1", outcome, `已关闭 ${data.artifactId}（v${data.version}），撤回了 ${data.affected.length} 道未答的题${data.affected.length > 0 ? `：${data.affected.join("、")}` : ""}`, leaseLines({lease: data.lease, released: []}), CLOSE_FAILURE_HINT);
        },
    },
    ask: {
        schema: "nbdev.ask/v1",
        positionals: ["workRef", "taskRef"],
        options: {
            id: {type: "string"}, type: {type: "string"}, label: {type: "string"}, option: {type: "string", multiple: true}, required: {type: "boolean"}, optional: {type: "boolean"},
            recommend: {type: "string", multiple: true}, artifact: {type: "string"}, about: {type: "string"}, from: {type: "string"}, ...AS_OPTION,
        },
        async run({io, positionals, values}) {
            const from = stringValue(values, "from");
            let questions: QuestionSpec[];
            if (from !== undefined) {
                if (["id", "type", "label", "option", "required", "optional", "recommend", "about"].some((name) => values[name] !== undefined)) throw new NbdevError("usage", "--from 不与单题参数（--id、--type、--label、--option、--required、--optional、--recommend、--about）混用");
                questions = await questionsFromFile(io, from);
            } else {
                questions = [{
                    id: requireValue(values, "id"),
                    type: requireValue(values, "type"),
                    label: requireValue(values, "label"),
                    options: optionsFromFlags(listValue(values, "option")),
                    required: values.required === true,
                    recommend: listValue(values, "recommend"),
                    about: stringValue(values, "about") ?? null,
                }];
            }
            const outcome = await withCaller(io, values, (context, options) => askQuestions(context, {workRef: positionals[0]!, taskRef: positionals[1]!, artifactId: stringValue(values, "artifact"), questions}, options));
            const {data} = outcome;
            const wait = waitHint(data);
            return writeOutcome("nbdev.ask/v1", {...outcome, data: {...data, waitCommand: wait.command}}, `已登记 ${data.affected.length} 道题到 ${data.artifactId} v${data.version}：${data.affected.join("、")}`, [...leaseLines({lease: data.lease, released: []}), wait.line], ASK_FAILURE_HINT);
        },
    },
    "ask withdraw": {
        schema: "nbdev.ask-withdraw/v1",
        positionals: ["workRef", "taskRef", "question"],
        options: {...AS_OPTION},
        async run({io, positionals, values}) {
            const outcome = await withCaller(io, values, (context, options) => withdrawQuestion(context, {workRef: positionals[0]!, taskRef: positionals[1]!, question: positionals[2]!}, options));
            return writeOutcome("nbdev.ask-withdraw/v1", outcome, `已撤回 ${outcome.data.artifactId}#${outcome.data.affected.join("、")}（v${outcome.data.version}）`, leaseLines({lease: outcome.data.lease, released: []}), DERIVE_FAILURE_HINT);
        },
    },
    "ask supersede": {
        schema: "nbdev.ask-supersede/v1",
        positionals: ["workRef", "taskRef", "question"],
        options: {by: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const by = requireValue(values, "by");
            const outcome = await withCaller(io, values, (context, options) => supersedeQuestion(context, {workRef: positionals[0]!, taskRef: positionals[1]!, question: positionals[2]!, by}, options));
            return writeOutcome("nbdev.ask-supersede/v1", outcome, `已记下 ${outcome.data.artifactId}#${outcome.data.affected.join("、")} 被 ${by} 取代（v${outcome.data.version}）`, leaseLines({lease: outcome.data.lease, released: []}), DERIVE_FAILURE_HINT);
        },
    },
    answers: {
        schema: "nbdev.answers/v1",
        positionals: ["workRef", "taskRef", "artifactId"],
        positionalsRange: [0, 3],
        options: {pending: {type: "boolean"}, unacked: {type: "boolean"}, wait: {type: "boolean"}, timeout: {type: "string"}, since: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            if (values.pending === true && values.unacked === true) throw new NbdevError("usage", "--pending 与 --unacked 只能选一个");
            const wait = values.wait === true;
            if (wait && values.pending === true) throw new NbdevError("usage", "--wait 不与 --pending 同用：--wait 等的是答复");
            if (!wait && (values.timeout !== undefined)) throw new NbdevError("usage", "--timeout 只与 --wait 同用");
            const timeoutText = stringValue(values, "timeout");
            const timeoutSeconds = timeoutText === undefined ? DEFAULT_WAIT_SECONDS : Number(timeoutText);
            if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new NbdevError("usage", `--timeout 要写正数秒：${timeoutText}`);
            const filter: AnswersFilter = values.pending === true ? "pending" : values.unacked === true ? "unacked" : "all";
            const since = stringValue(values, "since");
            if (since !== undefined) assertCursor(since, "--since");
            const query: AnswersQuery = {workRef: positionals[0], taskRef: positionals[1], artifactId: positionals[2], filter, since};
            const context = await locateRepository(io.cwd);
            const warnings: Warning[] = [];
            // 范围只算一次：读答复、等待与续期租约共用（每算一次都要读过渡期状态、列全部 Work 与 Task）。
            const scope = await resolveAnswersScope(context, query);
            // 指定了 Task 时续期调用者的租约（开始与结束各一次）；这时范围里恰好一个 Task。不指定 Task 的读取不认调用者。
            const target = query.workRef !== undefined && query.taskRef !== undefined ? scope.tasks[0] : undefined;
            const touch = target
                ? await (async () => {
                    const {herdr, caller, warnings: callerWarnings} = await writeCaller(io, values);
                    warnings.push(...callerWarnings);
                    return {caller, run: () => touchCallerLease(context, {workId: target.workId, taskId: target.taskId, action: "answers"}, {caller, herdr}, warnings)};
                })()
                : null;
            await touch?.run();
            let result: AnswersResult;
            if (wait) {
                const controller = new AbortController();
                const abort = () => controller.abort();
                process.once("SIGINT", abort);
                process.once("SIGTERM", abort);
                // 挂着它的终端或面板会话关掉时发的是 SIGHUP；不接的话进程直接退出，stdout 什么也没有（docs/cli.md 的“answers --wait”）。
                process.once("SIGHUP", abort);
                try {
                    result = await waitForAnswers(context, query, {
                        timeoutMs: timeoutSeconds * 1_000,
                        signal: controller.signal,
                        scope,
                        onWaiting: (watched) => io.stderr.write(watched.length === 0
                            ? `等待中：范围里还没有产物，等待期间新建的产物会加入范围，最多等 ${timeoutSeconds} 秒\n`
                            : `等待中：${watched.length} 个产物还没有${query.since === undefined ? "未确认的" : "更新的"}答复，最多等 ${timeoutSeconds} 秒\n`),
                    });
                } finally {
                    process.off("SIGINT", abort);
                    process.off("SIGTERM", abort);
                    process.off("SIGHUP", abort);
                }
                // 等完再续期一次；认不出的调用者开头已经给过 caller_unknown，不再重复。
                if (touch?.caller?.kind === "session") await touch.run();
            } else {
                result = await readAnswers(context, query, scope);
            }
            warnings.push(...result.warnings);
            const outcome: CommandOutcome = {schema: "nbdev.answers/v1", data: {artifacts: result.artifacts, cursor: result.cursor}, warnings, error: null, human: answersLines(result)};
            return outcome;
        },
    },
    "answers ack": {
        schema: "nbdev.answers-ack/v1",
        positionals: ["workRef", "taskRef", "artifactId"],
        options: {through: {type: "string"}, include: {type: "string", multiple: true}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const outcome = await withCaller(io, values, (context, options) => ackAnswers(context, {workRef: positionals[0]!, taskRef: positionals[1]!, artifactId: positionals[2]!, through: stringValue(values, "through"), include: listValue(values, "include")}, options));
            const {data} = outcome;
            const newer = data.newer.length > 0 ? [`比 --through 新、没有确认的答复：${data.newer.join("、")}；先用 nbdev answers 读它们`] : [];
            if (!data.acked) return noNewRecord("nbdev.answers-ack/v1", outcome, `${data.artifactId} 的答复都已确认，没有写新的确认`, newer, ACK_FAILURE_HINT);
            return writeOutcome("nbdev.answers-ack/v1", outcome, `已确认 ${data.artifactId} 的 ${data.ack!.answers.length} 份答复：${data.ack!.answers.join("、")}`, [...newer, ...leaseLines({lease: data.lease, released: []})], ACK_FAILURE_HINT);
        },
    },
    "answers record": {
        schema: "nbdev.answers-record/v1",
        positionals: ["workRef", "taskRef", "artifactId"],
        options: {set: {type: "string", multiple: true}, comment: {type: "string", multiple: true}, note: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const rawValues = pairs(values, "set");
            if (Object.keys(rawValues).length === 0) throw new NbdevError("usage", "至少给一个 --set <题号>=<值>");
            const outcome = await withCaller(io, values, (context, options) => submitAnswer(context, {
                workRef: positionals[0]!,
                taskRef: positionals[1]!,
                artifactId: positionals[2]!,
                values: {},
                rawValues,
                comments: pairs(values, "comment"),
                note: stringValue(values, "note") ?? null,
                submittedBy: {kind: "agent-transcribed"},
            }, options));
            return writeOutcome("nbdev.answers-record/v1", outcome, `已代录 ${outcome.data.artifactId} 的答复 ${outcome.data.answer.answerId}：${Object.keys(outcome.data.answer.values).join("、")}`, leaseLines({lease: outcome.data.lease, released: []}), RECORD_FAILURE_HINT);
        },
    },
};

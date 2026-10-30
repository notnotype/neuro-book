/**
 * `nbstory` 命令行（docs/specs/story/cli-skill.md）。查询命令直接调核心库，不经 HTTP；只有 `serve` 才加载服务端代码。
 *
 * 退出码：0 成功；1 查询失败；2 用法错误；3 `serve` 启动失败；`ask` 另有 4（问答失败）与 130（取消），见
 * docs/specs/story/qa.md 输出 14。`--json` 时标准输出只有一个 JSON。
 *
 * `serve` 与 `ask` 用到的代码（服务端、OMP）只在这两条命令里动态导入，其余命令不加载它们。
 */

// 必须是第一条导入：启动环境的快照要先于任何 OMP 模块取（platform/startup-env.ts）。
import "../platform/startup-env";
import type {StoryMethod} from "../contract/contract";
import {createStoryApi} from "../core/api";
import {coordinatedLibrary} from "../ingest/coordinator";
import type {StoryApi} from "../core/api";
import type {StoryErrorCode} from "../core/errors";
import {decodeArguments, usage, UsageError} from "./commands";
import type {CommandSpec} from "./commands";
import {formatResult} from "./format";
import {parseCommandLine} from "./program";
import {liveRegistration} from "./registration";

export interface CliIo {
    stdout(text: string): void;
    stderr(text: string): void;
}

const processIo: CliIo = {
    stdout: text => process.stdout.write(`${text}\n`),
    stderr: text => process.stderr.write(`${text}\n`),
};

/** 失败时给人读的下一步。 */
export const NEXT_STEP: Partial<Record<StoryErrorCode, string>> = {
    book_not_found: "用 nbstory books 查看书库里的书",
    book_ambiguous: "用 --book 指定书",
    book_exists: "换书名或用 --id 指定新 id",
    entity_not_found: "用 nbstory find 或 nbstory search 查",
    entity_ambiguous: "从上面的候选里改用 id",
    beyond_position: "把 --at 往后拨",
    cursor_invalid: "去掉 --cursor 从第一页重新取",
    position_out_of_range: "改正 --at",
    revision_target_not_found: "用 nbstory revisions list 或 nbstory find 查正确的说法或对象",
    revision_not_candidate: "确认只收候选身份说法（nbstory revisions list --state pending），驳回收连两个对象的身份说法（人物卡的“同一身份”里有说法编号）",
    revision_not_found: "用 nbstory revisions list 查修订编号",
    evidence_invalid: "依据位置要写成已抽取的“章.段”，例如 5.75",
    record_not_found: "用 nbstory statements <对象> --tiers 或 nbstory episodes --tiers 列出这个位置的记录，从里面取 id；位置之后的记录要把 --at 往后拨",
};

/** 命令 → 查看器的页面与页签（docs/specs/story/viewer.md 的“边界与兼容”）。 */
const VIEWER_PAGE: Record<string, {page: string; tab?: string}> = {
    info: {page: "overview"},
    chapter: {page: "overview"},
    stats: {page: "stats"},
    find: {page: "roster"},
    card: {page: "roster", tab: "summary"},
    knowledge: {page: "roster", tab: "records"},
    statements: {page: "roster", tab: "records"},
    appearances: {page: "roster", tab: "episodes"},
    knows: {page: "secrets"},
    relations: {page: "relations"},
    ledger: {page: "ledger"},
    track: {page: "ledger"},
    questions: {page: "questions"},
    timeline: {page: "timeline"},
    episodes: {page: "episodes"},
    arcs: {page: "episodes"},
    search: {page: "overview"},
    read: {page: "source"},
    para: {page: "source"},
};

function formatAt(at: unknown): string | null {
    if (typeof at !== "object" || at === null || !("chapter" in at)) return null;
    const {chapter, paragraph} = at as {chapter: number; paragraph?: number};
    return paragraph === undefined ? String(chapter) : `${chapter}.${paragraph}`;
}

/** 有有效的服务登记时，给出查看器里对应画面的地址；地址里不含登录口令。 */
async function viewerUrl(api: StoryApi, spec: CommandSpec, params: Record<string, unknown>, result: unknown): Promise<string | null> {
    const target = VIEWER_PAGE[spec.name];
    if (!target) return null;
    const registration = await liveRegistration(api.library.root);
    if (!registration) return null;
    const bookId = await api.library.resolveBookId(params.book as string | undefined);
    const query = new URLSearchParams();
    // 地址总带上这次查询实际用的阅读位置：不带 --at 时是全书已抽取到的位置。地址省略的部分查看器会用存下的阅读
    // 状态补齐（viewer 输出 4），省略就打开不了与命令同一个位置的画面。
    let at = formatAt(params.at);
    if (!at) {
        const info = await api.call("book.info", {book: bookId});
        if (info.ok) at = `${info.value.at.chapter}.${info.value.at.paragraph}`;
    }
    if (at) query.set("at", at);
    if (typeof params.perspective === "string") query.set("perspective", params.perspective);
    let entity: string | null = null;
    if (spec.name === "card") entity = (result as {id: string}).id;
    else if (typeof params.entity === "string") {
        const card = await api.call("entity.card", {entity: params.entity, ...(params.at ? {at: params.at} : {}), ...(params.book ? {book: params.book} : {})});
        if (card.ok) entity = card.value.id;
    }
    if (entity) query.set("entity", entity);
    if (target.tab && entity) query.set("tab", target.tab);
    const search = query.toString();
    return `${registration.url}/book/${encodeURIComponent(bookId)}/${target.page}${search ? `?${search}` : ""}`;
}

export async function main(argv: readonly string[], io: CliIo = processIo): Promise<number> {
    const parsed = parseCommandLine(argv, io);
    if ("exit" in parsed) return parsed.exit;
    const {spec, library} = parsed;
    let params: Record<string, unknown>;
    try {
        params = decodeArguments(spec, parsed.positionals, parsed.options);
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        io.stderr(`${error.message}\n\n${usage()}`);
        return 2;
    }

    if (spec.name === "serve") {
        const {serveCommand} = await import("../server/serve");
        return serveCommand({library, port: params.port as number | undefined, open: params.open === true, json: parsed.json}, io);
    }
    if (spec.name === "ask") {
        const {askCommand} = await import("./ask");
        return askCommand({library, params, json: parsed.json}, io);
    }
    if (spec.name === "config") {
        const {configCommand} = await import("./config");
        return configCommand({params, json: parsed.json}, io);
    }
    if (spec.name === "skill") {
        const {skillCommand} = await import("./skill");
        return skillCommand({params, json: parsed.json}, io);
    }
    if (spec.name === "ingest") {
        const {ingestCommand} = await import("./ingest");
        return ingestCommand({library, params, json: parsed.json}, io);
    }
    if (spec.name === "revisions") {
        const {revisionsCommand} = await import("./revisions");
        return revisionsCommand({library, params, json: parsed.json}, io);
    }
    if (spec.name === "qa") {
        const {qaCommand} = await import("./qa");
        return qaCommand({library, params, json: parsed.json}, io);
    }
    if (spec.method === null) throw new Error(`命令 ${spec.name} 没有对应的方法，也没有单独分派`);

    const json = parsed.json;
    // 导入与删除要与抽取任务协调同一个书 id（抽取在别的进程里运行时删除得到 ingest_running）。
    const api = createStoryApi({library: coordinatedLibrary(library)});
    const method: StoryMethod = spec.method;
    const outcome = await api.call(method, params);
    if (json) {
        io.stdout(JSON.stringify(outcome.ok ? {ok: true, data: outcome.value} : {ok: false, error: outcome.error}));
        return outcome.ok ? 0 : 1;
    }
    if (!outcome.ok) {
        const next = NEXT_STEP[outcome.error.code];
        io.stderr(`错误（${outcome.error.code}）：${outcome.error.message}${next ? `\n下一步：${next}` : ""}`);
        return 1;
    }
    const lines = [formatResult(method, outcome.value, "option", {tiers: parsed.options.has("tiers")})];
    const url = await viewerUrl(api, spec, params, outcome.value);
    if (url) lines.push("", `查看器：${url}`);
    io.stdout(lines.join("\n"));
    return 0;
}

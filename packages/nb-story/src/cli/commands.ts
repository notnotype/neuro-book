/**
 * `nbstory` 的命令表：一条查询命令对应一个查询方法（docs/specs/story/cli-skill.md 的“输入与前置条件”）。
 *
 * 每个位置参数与选项声明自己的解码器，把命令行的文字解码成合同的参数形状；解码后的参数再由 api.call 按同一份
 * schema 校验，所以这里只管“文字 → 值”，不重复合同里的规则。
 */

import {resolve} from "node:path";

import type {StoryMethod} from "../contract/contract";
import {parsePositionText} from "../core/position";
import type {PositionInput} from "../core/position";

/** 解码失败：命令行用法错误，退出码 2。 */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

type Decoder = (text: string, name: string) => unknown;

const text: Decoder = value => value;
const integer: Decoder = (value, name) => {
    if (!/^-?\d+$/u.test(value)) throw new UsageError(`${name} 要写整数：${value}`);
    return Number(value);
};
const position: Decoder = (value, name) => {
    const parsed = parsePositionText(value);
    if (!parsed) throw new UsageError(`${name} 要写“章”或“章.段”，例如 38 或 38.57：${value}`);
    return parsed;
};
const mode: Decoder = (value, name) => {
    if (value !== "graph" && value !== "full") throw new UsageError(`${name} 只能是 graph（图当目录）或 full（全读）：${value}`);
    return value;
};
const agent: Decoder = (value, name) => {
    if (value !== "claude" && value !== "codex") throw new UsageError(`${name} 只能是 claude 或 codex：${value}`);
    return value;
};
const list: Decoder = value =>
    value
        .split(",")
        .map(item => item.trim())
        .filter(item => item !== "");

/** `read` 的范围：`38`、`38.48`、`38.48-81`（同一章到第 81 段）或 `38.48-39.3`。 */
export function decodeRange(value: string): {from: PositionInput; to?: PositionInput} {
    const parts = value.split("-");
    if (parts.length > 2) throw new UsageError(`范围只能有一个终点，例如 38.48-81：${value}`);
    const [start, end] = parts;
    const from = start === undefined ? null : parsePositionText(start);
    if (!from) throw new UsageError(`范围要写“章.段[-段]”，例如 38.48-81：${value}`);
    if (end === undefined) return {from};
    if (from.paragraph === undefined) throw new UsageError(`带终点的范围起点要写到段：${value}`);
    const to = end.includes(".") ? parsePositionText(end) : /^\d+$/u.test(end) ? {chapter: from.chapter, paragraph: Number(end)} : null;
    if (!to) throw new UsageError(`范围的终点要写“段”或“章.段”：${value}`);
    return {from, to};
}

/** 一个位置参数：解码成方法参数里的一个或几个字段。 */
interface Positional {
    name: string;
    decode: (value: string) => Record<string, unknown>;
    /** 可以不给；可选的位置参数只能排在必需的后面。 */
    optional?: boolean;
}

interface OptionSpec {
    /** 方法参数名；不给时用选项名的驼峰写法。 */
    param?: string;
    decode: Decoder;
}

export interface CommandSpec {
    name: string;
    method: StoryMethod | null;
    summary: string;
    positionals: Positional[];
    options: Record<string, OptionSpec>;
    /** 是书级命令（接受 --book、--at）。 */
    book: boolean;
    /** 分页的命令接受 --limit、--cursor。 */
    paged: boolean;
}

const BOOK_OPTIONS: Record<string, OptionSpec> = {
    book: {decode: text},
    at: {decode: position},
};
const PAGE_OPTIONS: Record<string, OptionSpec> = {
    limit: {decode: integer},
    cursor: {decode: text},
};

function command(spec: Omit<CommandSpec, "options" | "positionals"> & {positionals?: Positional[]; options?: Record<string, OptionSpec>}): CommandSpec {
    return {
        ...spec,
        positionals: spec.positionals ?? [],
        options: {...(spec.book ? BOOK_OPTIONS : {}), ...(spec.paged ? PAGE_OPTIONS : {}), ...(spec.options ?? {})},
    };
}

const entityArg: Positional = {name: "对象", decode: value => ({entity: value})};
const query = {query: {decode: text}};

export const COMMANDS: readonly CommandSpec[] = [
    command({name: "books", method: "books.list", summary: "列出书库里的书", book: false, paged: false}),
    command({
        name: "import",
        method: "book.import",
        summary: "把 V9 记忆图收进书库",
        book: false,
        paged: false,
        positionals: [{name: "文件", decode: value => ({file: resolve(value)})}],
        options: {title: {decode: text}, id: {decode: text}},
    }),
    command({name: "remove", method: "book.remove", summary: "从书库删除一本书", book: false, paged: false, positionals: [{name: "书", decode: value => ({book: value})}]}),
    command({name: "info", method: "book.info", summary: "书的信息与目录", book: true, paged: false}),
    command({name: "stats", method: "book.stats", summary: "可见记录数与全书抽取统计", book: true, paged: false}),
    command({name: "chapter", method: "chapter.digest", summary: "这一章的变化", book: true, paged: false, positionals: [{name: "章", decode: value => ({chapter: integer(value, "章")})}]}),
    command({
        name: "find",
        method: "entities.list",
        summary: "找对象：全部称呼、身份、出场次数",
        book: true,
        paged: true,
        positionals: [{name: "名字或称呼", decode: value => ({query: value})}],
        options: {kind: {decode: text}, perspective: {decode: text}},
    }),
    command({name: "card", method: "entity.card", summary: "人物卡", book: true, paged: false, positionals: [entityArg], options: {perspective: {decode: text}}}),
    command({name: "knowledge", method: "entity.knowledge", summary: "他知道的事", book: true, paged: true, positionals: [entityArg], options: {state: {decode: text}, ...query}}),
    command({name: "statements", method: "entity.statements", summary: "关于他的说法", book: true, paged: true, positionals: [entityArg], options: query}),
    command({name: "appearances", method: "entity.episodes", summary: "他参与的情节", book: true, paged: true, positionals: [entityArg], options: query}),
    command({name: "ties", method: "entity.relations", summary: "他和每个对象的关系：关系词、身份连接、一句说明", book: true, paged: false, positionals: [entityArg], options: {perspective: {decode: text}}}),
    command({
        name: "between",
        method: "entity.relation",
        summary: "两个对象之间的全部说法、一起出场的情节、互相知道的事",
        book: true,
        paged: false,
        positionals: [entityArg, {name: "另一个", decode: value => ({other: value})}],
        options: {perspective: {decode: text}},
    }),
    command({name: "knows", method: "secrets.matrix", summary: "谁知道什么（秘密矩阵）", book: true, paged: false}),
    command({
        name: "relations",
        method: "graph.relations",
        summary: "人物之间的关系、同场、认知与身份连接",
        book: true,
        paged: false,
        options: {perspective: {decode: text}, kinds: {decode: list}, "min-together": {decode: integer}},
    }),
    command({name: "ledger", method: "ledger.tracks", summary: "各项数值与任务的当前值", book: true, paged: false}),
    command({name: "track", method: "ledger.track", summary: "某一项的流水与对账差额", book: true, paged: false, positionals: [{name: "数值", decode: value => ({track: value})}], options: {owner: {decode: text}}}),
    command({name: "questions", method: "questions.list", summary: "悬念与进展", book: true, paged: true, options: {state: {decode: text}, sort: {decode: text}, ...query}}),
    command({name: "timeline", method: "timeline", summary: "时间线", book: true, paged: false, options: {order: {decode: text}}}),
    command({name: "episodes", method: "episodes.list", summary: "情节", book: true, paged: true, options: {arc: {decode: text}, ...query}}),
    command({name: "arcs", method: "arcs.list", summary: "当前这一批主线", book: true, paged: false}),
    command({name: "search", method: "search", summary: "搜名字、说法、原文", book: true, paged: true, positionals: [{name: "文字", decode: value => ({query: value})}], options: {kinds: {decode: list}}}),
    command({name: "read", method: "source.read", summary: "读原文", book: true, paged: false, positionals: [{name: "章.段[-段]", decode: decodeRange}]}),
    command({
        name: "para",
        method: "source.records",
        summary: "引用某一段的记录",
        book: true,
        paged: false,
        positionals: [
            {
                name: "章.段",
                decode: value => {
                    const parsed = parsePositionText(value);
                    if (!parsed || parsed.paragraph === undefined) throw new UsageError(`要写“章.段”，例如 38.57：${value}`);
                    return {chapter: parsed.chapter, paragraph: parsed.paragraph};
                },
            },
        ],
    }),
    command({name: "serve", method: null, summary: "启动查看器的独立服务", book: false, paged: false, options: {port: {decode: integer}, open: {decode: () => true}}}),
    command({
        name: "ask",
        method: null,
        summary: "内置问答：调用模型回答一个问题；--continue 在对话里追问",
        book: true,
        paged: false,
        positionals: [{name: "问题", decode: value => ({question: value})}],
        options: {mode: {decode: mode}, config: {decode: value => resolve(value)}, continue: {decode: text}, model: {decode: text}, thinking: {decode: text}, structured: {decode: () => true}},
    }),
    command({
        name: "qa",
        method: null,
        summary: "问答记录（一个对话一条）：列出、显示（qa <id>）、删除（qa rm <id>）",
        book: true,
        paged: false,
        positionals: [
            {name: "记录 id 或 rm", decode: value => ({first: value}), optional: true},
            {name: "记录 id", decode: value => ({second: value}), optional: true},
        ],
    }),
    command({
        name: "ingest",
        method: null,
        summary: "导入 TXT 原文并逐章抽取；接着抽（--book）、看进度（--status）",
        book: false,
        paged: false,
        positionals: [{name: "原文文件", decode: value => ({file: resolve(value)}), optional: true}],
        options: {
            title: {decode: text},
            id: {decode: text},
            book: {decode: text},
            preview: {decode: () => true},
            status: {decode: () => true},
            config: {decode: value => resolve(value)},
            "no-ledger": {decode: () => true},
            "no-secrets": {decode: () => true},
        },
    }),
    command({
        name: "config",
        method: null,
        summary: "问答与抽取的配置：init、show、set <字段> <值>、unset <字段>、test",
        book: false,
        paged: false,
        positionals: [
            {name: "动作", decode: value => ({action: value}), optional: true},
            {name: "字段", decode: value => ({field: value}), optional: true},
            {name: "值", decode: value => ({value}), optional: true},
        ],
        options: {
            config: {decode: value => resolve(value)},
            "base-url": {decode: text},
            model: {decode: text},
            "api-key-env": {decode: text},
            "max-tokens": {decode: integer},
            thinking: {decode: text},
            force: {decode: () => true},
            ingest: {decode: () => true},
        },
    }),
    command({
        name: "skill",
        method: null,
        summary: "把随包的 Skill 装进外部 Agent 的 Skill 目录：install",
        book: false,
        paged: false,
        positionals: [{name: "动作", decode: value => ({action: value}), optional: true}],
        options: {
            agent: {decode: agent},
            dir: {decode: value => resolve(value)},
            force: {decode: () => true},
        },
    }),
];

/** 所有命令都接受的选项（不进方法参数）。 */
export const GLOBAL_OPTIONS = new Set(["library", "json", "help"]);
/** 不带值的开关。 */
export const FLAGS = new Set(["json", "help", "open", "force", "preview", "status", "ingest", "no-ledger", "no-secrets", "structured"]);

/** 选项在 `--help` 里的说明；同名选项在各命令里含义相同，所以按名字写一份。 */
export const OPTION_HELP: Record<string, string> = {
    library: "书库目录（默认用户级书库）",
    json: "标准输出只给一个 JSON",
    help: "显示用法",
    book: "书的 id 或书名；书库只有一本书时可省略",
    at: "阅读位置：章或章.段；不给就读到全书已抽取的最后位置",
    limit: "每页条数",
    cursor: "上一页给出的续页标记；去掉就从第一页取",
    title: "书名",
    id: "新书的 id",
    kind: "对象类别",
    kinds: "类别，逗号分隔",
    perspective: "用这个对象的视角看",
    state: "只看这个状态",
    query: "只看含这些字的",
    sort: "排序方式",
    order: "story（故事时间）或 source（出现顺序）",
    arc: "只看这条主线",
    owner: "这一项数值的持有者",
    "min-together": "至少同场几次才算",
    port: "监听端口",
    open: "启动后在浏览器里打开",
    mode: "graph（图当目录，默认）或 full（全读）",
    continue: "在这个对话里追问（对话 id 见 nbstory qa）；不能同时写 --at、--mode",
    config: "配置文件（默认 ~/.config/nbstory/config.json）",
    "base-url": "OpenAI 兼容服务的地址",
    model: "模型：服务商/模型名（OMP 目录里的，或配置里的候选）；config init 用自定义地址时写模型名",
    "api-key-env": "存密钥的环境变量名（密钥本身不进配置）",
    "max-tokens": "一次请求的输出上限（token）；config set ingest.model 时用",
    thinking: "推理档：minimal、low、medium、high、xhigh、max；模型不支持时往下夹；不写则请求不带推理档",
    structured: "新对话用 answer 工具交结构化的卷（默认按配置的 qa.answer，再缺省是 Markdown）",
    force: "覆盖已有的配置文件；skill install 时换掉内容不同的 Skill 目录（目录里多出的文件会被删掉）",
    agent: "装给哪个 Agent：claude（~/.claude/skills，默认）或 codex（~/.agents/skills）",
    dir: "装到这个目录下的 nbstory/；不能与 --agent 同时给",
    preview: "只切章并列出结果，不调用模型、不写书库",
    status: "看抽取进度；不给 --book 时列出全部",
    "no-ledger": "新建时不记数值（钱、道具、任务进度）；之后不能改",
    "no-secrets": "新建时不记秘密（身份秘密与谁知道）；之后不能改",
    ingest: "检查抽取用的模型（按 minimal、medium 两档各试一次）",
};

export function camelCase(name: string): string {
    return name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}

/** 按命令表把命令行参数解码成方法参数。 */
export function decodeArguments(spec: CommandSpec, positionals: readonly string[], options: ReadonlyMap<string, string>): Record<string, unknown> {
    const required = spec.positionals.filter(item => !item.optional).length;
    if (positionals.length < required || positionals.length > spec.positionals.length) {
        const wanted = required === spec.positionals.length ? `${required}` : `${required} 到 ${spec.positionals.length}`;
        throw new UsageError(`${spec.name} 要 ${wanted} 个参数（${spec.positionals.map(item => (item.optional ? `[${item.name}]` : `<${item.name}>`)).join(" ") || "无"}），给了 ${positionals.length} 个`);
    }
    const params: Record<string, unknown> = {};
    positionals.forEach((value, index) => Object.assign(params, spec.positionals[index]!.decode(value)));
    for (const [name, value] of options) {
        if (GLOBAL_OPTIONS.has(name)) continue;
        const option = spec.options[name];
        if (!option) throw new UsageError(`${spec.name} 没有选项 --${name}`);
        params[option.param ?? camelCase(name)] = option.decode(value, `--${name}`);
    }
    return params;
}

export function usage(): string {
    const width = Math.max(...COMMANDS.map(spec => spec.name.length));
    const lines = COMMANDS.map(spec => {
        const args = spec.positionals.map(item => (item.optional ? `[${item.name}]` : `<${item.name}>`)).join(" ");
        return `  ${spec.name.padEnd(width)}  ${spec.summary}${args ? `  ${args}` : ""}`;
    });
    return [
        "用法：nbstory <命令> [参数] [选项]",
        "",
        "命令：",
        ...lines,
        "",
        "通用选项：--library <目录>、--json、--version（打印版本）；书级命令另有 --book <书>、--at <章或章.段>；列表命令另有 --limit、--cursor。",
        "ask 另有 --mode graph|full（图当目录或全读，默认 graph）、--config <配置文件>、--continue <对话 id>（追问）、--model <服务商/模型名>、--thinking <档>（只对这一问）、--structured（新对话结构化作答）。",
        "config 的动作：init（交互；或 --model <服务商/模型名> 用目录里的模型，--base-url --model --api-key-env 用自定义地址）、show、set <字段> <值>、unset <字段>、test（加 --ingest 检查抽取模型）。",
        "ingest 另有 --title、--id、--preview、--book <书 id>（用保存的原文接着抽）、--status、--config；新建时可加 --no-ledger（不记数值）、--no-secrets（不记秘密）。",
        "skill install 另有 --agent claude|codex（装进 ~/.claude/skills 或 ~/.agents/skills，默认 claude）、--dir <目录>、--force（换掉内容不同的已装目录）。",
    ].join("\n");
}

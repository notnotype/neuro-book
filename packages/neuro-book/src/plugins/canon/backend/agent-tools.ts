/**
 * canon 给 Agent 的四个工具（docs/specs/canon/agent-tools.md）：查名字、看条目树、读条目、改设定。
 *
 * 工具在服务端入口里，世界在项目实例里：每次调用先按会话所在的作品取项目租约（调用期间项目不会停止或换代，作者关了窗口也照样
 * 能写；不取租约时项目在宽限期里会拒绝无租约的访问），再经 `{project}` 目标调世界服务，调完释放。
 *
 * 给模型看的是中文文字（`agent-text.ts`），有字数上限；机器可读的部分（码、修订、版本、id 对照）放 `details`。写入者由这里填
 * `{kind: "agent", session}`，模型改不了；请求 id 由会话 id 与这次调用的 `invocation` 合成（`callId` 只在一条回复里不重复）。
 * 名字与地址在这里解析成 id，内核只认 id。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {agentTool, TOOLS_POINT} from "@notnotype/nb-plugin-sdk/agent";
import type {AgentToolImplementation} from "@notnotype/nb-plugin-sdk/agent";
import type {JsonValue, ToolResult} from "@notnotype/nb-harness/kernel/contracts";
import {generateFieldId, staleRead} from "@notnotype/nb-canon";
import type {ComponentType, EntryEdits, EntryOp, EntryView, FieldDeclaration, FieldDraft, FieldKind, ReadPosition} from "@notnotype/nb-canon/schema";

import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {canonWorldContract, fromRemote} from "../shared/contracts";
import type {CanonFailure, CanonInput, CanonMethod, CanonOutputs, CanonResult, FoundEntry, RemoteRaw} from "../shared/contracts";
import {CANON_ENTRY_KINDS_POINT, defaultComponents, entryKindsPoint, mergeEntryKinds} from "../shared/entry-kinds";
import type {EntryKind, EntryKindDeclaration} from "../shared/entry-kinds";
import {fieldsText} from "../shared/agent-fields";
import {agentBlockText, replaceInBlock} from "./agent-entry-text";
import {componentNamed, resolveField, uniqueNamed} from "./agent-names";
import {clip, failureText, impactText, parseStamp, positionText, stampText} from "./agent-text";

export const AGENT_TOOL_IDS = {lookup: "nbook.canon.lookup", tree: "nbook.canon.tree", read: "nbook.canon.read", write: "nbook.canon.write"} as const;

/** 读取位置的参数：初值，或某一章（章 id 或从 1 数的序号）的开头、末尾；不给时是最后一章末尾。 */
const AT = {
    description: "读取位置。\"initial\" 是最初：什么都没套，连前史也没套；{chapter, edge} 是某一章的开头（start）或末尾（end，缺省），chapter 写章 id 或从 1 数的序号。不给时是最后一章末尾。",
    anyOf: [
        {type: "string", enum: ["initial"]},
        {type: "object", properties: {chapter: {type: ["string", "integer"]}, edge: {type: "string", enum: ["start", "end"]}}, required: ["chapter"], additionalProperties: false},
    ],
} as const;

const lookup = agentTool(AGENT_TOOL_IDS.lookup, {
    providerName: "canon_lookup",
    description: "按名字或别名查设定条目，给出 id、种类、启用的设定组与简介。写入前先用它把名字换成 id；没找到时列出名字相近的条目。",
    parameters: {type: "object", properties: {names: {type: "array", items: {type: "string"}, minItems: 1, maxItems: 20}, at: AT}, required: ["names"], additionalProperties: false},
    version: "1",
    effect: "read",
    concurrency: "shared",
    group: "设定",
    defaultForAll: true,
});

const tree = agentTool(AGENT_TOOL_IDS.tree, {
    providerName: "canon_tree",
    description: "看设定条目树的一层：id、名字、种类、有没有子条目。parent 写条目的 id 或名字，不给是最上层；cursor 续读下一页。",
    parameters: {type: "object", properties: {parent: {type: "string"}, limit: {type: "integer", minimum: 1, maximum: 50}, cursor: {type: "string"}, at: AT}, additionalProperties: false},
    version: "1",
    effect: "read",
    concurrency: "shared",
    group: "设定",
    defaultForAll: true,
});

const read = agentTool(AGENT_TOOL_IDS.read, {
    providerName: "canon_read",
    description: [
        "读一个设定条目。第一行给出位置与版本（写入时把版本原样带给 canon_write 的 version）。",
        "show 缺省 [\"fields\"]：每个设定组的字段、值、种类与可取的值；\"text\"：主文字（每块前面方括号里是块 id，标签带着这个位置上的值，见 canon_write）；\"origins\"：field 这个字段的值是怎么来的；\"history\"：最近的修订。",
        "field 写“设定组.字段”，只读这一个字段（列表读全）；写 \"text[块 id]\" 只读主文字的这一块，长的分页，cursor 续读。",
    ].join("\n"),
    parameters: {
        type: "object",
        properties: {entry: {type: "string"}, at: AT, mode: {type: "string", enum: ["actual", "planned"]}, show: {type: "array", items: {type: "string", enum: ["fields", "text", "origins", "history"]}}, field: {type: "string"}, cursor: {type: "string"}},
        required: ["entry"],
        additionalProperties: false,
    },
    // 2：主文字换成标签写法，读到的是带值写法（w00055 t02）。
    version: "2",
    effect: "read",
    concurrency: "shared",
    group: "设定",
    defaultForAll: true,
});

const write = agentTool(AGENT_TOOL_IDS.write, {
    providerName: "canon_write",
    description: [
        "改设定：一次写入（一条修订）里改几处，全部生效或整批不生效。作者能在改动记录里看到、还原。",
        "version：canon_read 或 canon_lookup 第一行的版本，原样带回；读过之后世界变了会被拒（stale-read），重读再写。只建新条目时可以不给。",
        "intent：\"setting\"（缺省）是改设定，写回给出这个值的那条记录；\"story\" 是在 at 那一章记一条剧情变化（某章发生了什么）。",
        "entry 写条目 id、名字，或同一批里 create 的 \"$代号\"。field 写“设定组.字段”，列表元素写“设定组.字段[元素].子字段”；设定组、字段、元素写 id 或名字都行。名字、简介、别名用 op 本身或 field \"名字\"/\"简介\"。",
        "op：create（name、kind、可选 key 代号、parent、folder、summary、aliases、components 设定组列表（不写时用这个种类默认的设定组，例如人物带人物与形象；写 [] 是不要默认）、fields 初值 {\"设定组.字段\": 值}、text 主文字）；",
        "set（entry、field、value）；replace（entry、field、find、with，把恰好出现一次的 find 换成 with）；",
        "add（entry、field、delta，只在 story）；note（entry、field、text，语义档记一句，只在 story）；",
        "listAdd（entry、field 列表、value 元素 {子字段: 值}，以条目为键的列表另写 target 条目）；listRemove（entry、field 写到元素）；",
        "aliases（entry、add、remove）；addBlock（entry、text、after 块 id：放在它后面，null 放在最前，不写放在最后）；removeBlock（entry、block）；",
        "addComponent、removeComponent（entry、component 设定组）；move（entry、parent 上级或 null、after 兄弟或 null、folder、kind）；delete、restore（entry）。",
        "有的设定组（canon_read 里标着“可以加字段”）能在某个条目上加它自己的字段：addField（entry、component 设定组、label 显示名、kind 缺省 text（还有 number、enum、boolean、list、image、ref），可带 unit、min、max、options、suggestions、precision、value 初值）；renameField（entry、field、label）；removeField（entry、field，数据保留）；restoreField（entry、field，恢复去掉过的）。create 与 addComponent 可以带 declare：create 写 {\"设定组\": [声明…]}，addComponent 写 [声明…]。",
        "这一批新建的东西初值写在建它的那一项里，后面不能再改它。引用字段的值写条目名字或 id。",
        "主文字按块存，一块里可以有几段，分块由你定：create 的 text 是一块，addBlock 加一块。会随剧情变的、带秘密的内容各自单独成块，因为剧情里的文字变化是整块替换，给写手的简报按块决定给不给。",
        "主文字是 Markdown 加标签：<V of=\"设定组.字段\" /> 写本条目字段的值，<V entry=\"条目 id\" of=\"设定组.字段\" /> 写别的条目的；<V expr=\"panel.魔力 >= 1000\" /> 写算出来的值（式子里的字符串用单引号，可用 round、floor、ceil、min、max、abs、percent）；<If test=\"式子\">…<ElseIf test=\"…\" />…<Else />…</If> 按条件写一段之内的文字；<Ref id=\"条目 id\" /> 写条目的名字（同一批 create 的条目在 entry、id、ref('…') 里写 \"$代号\"）；<Image of=\"设定组.图片字段\" alt=\"说明\" /> 或 <Image src=\"路径\" alt=\"说明\" />。要在正文里写 < 加大写字母，写成 \\<。",
        "canon_read 读到的标签带着值：<V of=\"panel.魔力\">3110</V>，以及 label、incomplete、unavailable、value、name、path 这些属性。它们只给你看，存下时程序会去掉：set text[块] 整块换掉时照抄带值的写法就行；replace 的 find 是在读到的带值写法里找的，要与读到的一字不差（标签连同属性与中间的值），或者只找标签以外的文字。文字里改了值不会写进字段，改值用 set 写那个字段。canon_read 一页读不全的长块只能用 replace 改局部。",
        "还原一次修订：不写 edits，写 revert: {revision, withDependents}。",
    ].join("\n"),
    parameters: {
        type: "object",
        properties: {
            version: {type: "string"},
            title: {type: "string", maxLength: 60},
            why: {type: "string"},
            intent: {type: "string", enum: ["setting", "story"]},
            at: AT,
            edits: {type: "array", minItems: 1, maxItems: 30, items: {type: "object", properties: {op: {type: "string"}}, required: ["op"], additionalProperties: true}},
            revert: {type: "object", properties: {revision: {type: "string"}, withDependents: {type: "boolean"}}, required: ["revision"], additionalProperties: false},
        },
        required: ["title"],
        additionalProperties: false,
    },
    // 2：主文字换成标签写法，交回的文字去值后写入（w00055 t02）。
    version: "2",
    effect: "write",
    concurrency: "exclusive",
    strict: false,
    group: "设定",
    defaultForAll: true,
});

/** 失败的工具结果：`text` 给模型，`details` 给程序（码与详情）。 */
const failed = (code: string, text: string, details: Record<string, JsonValue> = {}): ToolResult => ({text, status: "error", code, details: {code, ...details}});

type Call = <M extends CanonMethod>(method: M, input: CanonInput<M>) => Promise<CanonResult<CanonOutputs[M]>>;

/** 取项目租约、调世界、释放（输出 1）。 */
async function withWorld(projects: ProjectsService | null, remote: ActivationContext["remote"], project: string | undefined, signal: AbortSignal, run: (call: Call) => Promise<ToolResult>): Promise<ToolResult> {
    if (project === undefined) return failed("no-project", "这个会话不属于任何作品，设定工具用不了。");
    if (projects === null) return failed("project-unavailable", "这个实例没有项目登记，设定工具用不了。");
    const acquired = await projects.acquire(project);
    if (acquired.status === "rejected") return failed("project-unavailable", `作品打不开：${acquired.reason}（${acquired.detail}）`);
    const {lease} = acquired;
    try {
        if (signal.aborted) return failed("cancelled", "调用已取消。");
        const client = remote.use(canonWorldContract).at({project: lease.id}) as unknown as Record<string, (input: unknown, options: {signal: AbortSignal}) => Promise<RemoteRaw>>;
        const call: Call = async (method, input) => fromRemote(await client[method]!(input, {signal}));
        return await run(call);
    } finally {
        lease.release();
    }
}

/** 一次调用里用到的世界信息：章表、登记的类型、读取位置，以及登记的条目种类（新建时套默认的设定组）。 */
interface Context {
    readonly call: Call;
    readonly chapters: CanonOutputs["chapters"];
    readonly components: readonly ComponentType[];
    readonly position: ReadPosition;
    readonly kinds: readonly EntryKind[];
}

async function contextOf(call: Call, at: unknown, kinds: readonly EntryKind[]): Promise<Context | ToolResult> {
    const [chapters, components] = await Promise.all([call("chapters", {}), call("components", {})]);
    if (!chapters.ok) return worldFailed(chapters.failure);
    if (!components.ok) return worldFailed(components.failure);
    const position = positionOf(at, chapters.value.items);
    if (typeof position === "string") return failed("bad-position", position);
    return {call, chapters: chapters.value, components: components.value.items, position, kinds};
}

function positionOf(at: unknown, chapters: readonly {readonly id: string; readonly index: number}[]): ReadPosition | string {
    if (at === undefined || at === null) {
        const last = chapters.at(-1);
        return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last.id, edge: "end"};
    }
    if (at === "initial") return {kind: "initial"};
    if (typeof at === "object") {
        const {chapter, edge} = at as {chapter?: unknown; edge?: unknown};
        const found = typeof chapter === "number" ? chapters[chapter - 1] : chapters.find((item) => item.id === chapter) ?? (typeof chapter === "string" && /^\d+$/u.test(chapter) ? chapters[Number(chapter) - 1] : undefined);
        if (found === undefined) return `没有这一章：${String(chapter)}。章写 id 或从 1 数的序号，共 ${String(chapters.length)} 章。`;
        return {kind: "chapter", chapter: found.id, edge: edge === "start" ? "start" : "end"};
    }
    return "at 写 \"initial\" 或 {chapter, edge}。";
}

function worldFailed(failure: CanonFailure): ToolResult {
    return failed(failure.code, failureText(failure as {code: string} & Record<string, unknown>), {failure: JSON.parse(JSON.stringify(failure)) as JsonValue});
}

function head(context: Context, version: number, inputDigest: string): string {
    const chapter = context.position.kind === "chapter" ? context.chapters.items.find((item) => item.id === (context.position as {chapter: string}).chapter) : undefined;
    return `位置：${positionText(context.position, chapter)}｜版本：${stampText(version, inputDigest)}`;
}

/* ---------- 名字 ---------- */

const ENTRY_ID = /^e\d+$/u;

/** 名字、id 或 `$代号` 换成条目 id；没有或不唯一时给一句能照着改的话。 */
async function resolveEntry(context: Context, given: string, keys: ReadonlyMap<string, string>): Promise<{readonly id: string} | {readonly problem: string}> {
    if (given.startsWith("$")) {
        const tmp = keys.get(given.slice(1));
        return tmp === undefined ? {problem: `没有代号 ${given}：代号由同一批前面的 create 用 key 起`} : {id: tmp};
    }
    if (ENTRY_ID.test(given)) {
        const entry = await context.call("entry", {id: given, position: context.position, mode: "actual"});
        if (entry.ok && entry.value.view !== null) return {id: given};
    }
    const found = await context.call("findEntries", {query: given, position: context.position, limit: 10});
    if (!found.ok) return {problem: failureText(found.failure as {code: string} & Record<string, unknown>)};
    const exact = found.value.items.filter((item) => item.name === given || item.matchedAlias === given);
    if (exact.length === 1) return {id: exact[0]!.id};
    if (exact.length > 1) return {problem: `“${given}”对应几个条目：${exact.map(candidateText).join("；")}。写 id。`};
    return {problem: `没有叫“${given}”的条目${found.value.items.length === 0 ? "" : `；名字相近的：${found.value.items.slice(0, 3).map(candidateText).join("；")}`}。`};
}

function candidateText(item: FoundEntry): string {
    return `${item.id} ${item.name}（${item.kind}${item.matchedAlias === undefined ? "" : `，别名 ${item.matchedAlias}`}${item.appeared ? "" : "，还没出场"}）`;
}

/** 条目的读取：视图与字段声明。 */
async function entryOf(context: Context, id: string): Promise<{readonly view: EntryView; readonly declarations: Readonly<Record<string, readonly FieldDeclaration[]>>; readonly removedFields: Readonly<Record<string, readonly {readonly id: string; readonly label: string}[]>>} | {readonly problem: string}> {
    const read = await context.call("entry", {id, position: context.position, mode: "actual"});
    if (!read.ok) return {problem: failureText(read.failure as {code: string} & Record<string, unknown>)};
    if (read.value.view === null || read.value.view.deleted) return {problem: `条目 ${id} 不存在或已删除。`};
    return {view: read.value.view, declarations: read.value.declarations ?? {}, removedFields: read.value.removedFields ?? {}};
}

/** 模型写的字段声明里照搬的几项。 */
const DECLARATION_KEYS: readonly string[] = ["id", "label", "kind", "precision", "unit", "min", "max", "options", "suggestions", "retold", "targets", "keyedBy", "carry", "item"];
/** 字段的种类（`FieldKindSchema`）：写错时回话列出来，不交给内核报一串互相矛盾的形状错误。 */
const FIELD_KINDS: readonly FieldKind[] = ["text", "number", "enum", "boolean", "list", "image", "ref"];

/**
 * 模型写的一条字段声明换成内核的写法：要有非空的 `label`，`kind` 不写是文字、写了要是几种之一；`extra` 是这一项里另外允许的
 * 键（`addField` 的 op、entry、component、value），别的键回话指出来，不悄悄丢掉（模型常顺手把初值写进声明）。其余形状由内核判。
 */
function fieldDraftOf(given: unknown, extra: readonly string[] = []): FieldDraft | {readonly problem: string} {
    if (typeof given !== "object" || given === null || Array.isArray(given)) return {problem: "字段声明是一个对象，要写 label（显示名）。"};
    const record = given as Record<string, unknown>;
    if (typeof record.label !== "string" || record.label.trim() === "") return {problem: "字段声明要写 label（显示名，不能是空的）。"};
    if (record.kind !== undefined && !FIELD_KINDS.includes(record.kind as FieldKind)) return {problem: `kind 只能是：${FIELD_KINDS.join("、")}（缺省 text）；enum 要写 options，list 要写 item，ref 可以写 targets。`};
    const unknown = Object.keys(record).find((key) => !DECLARATION_KEYS.includes(key) && !extra.includes(key));
    if (unknown === "value") return {problem: "声明里不写初值：create 的初值写在 fields 里（\"设定组.字段\": 值）。"};
    if (unknown !== undefined) return {problem: `字段声明里不认识“${unknown}”；能写的有：${DECLARATION_KEYS.join("、")}。`};
    return {kind: "text", ...Object.fromEntries(DECLARATION_KEYS.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]))} as FieldDraft;
}

function fieldDrafts(given: unknown): readonly FieldDraft[] | {readonly problem: string} {
    if (!Array.isArray(given)) return {problem: "declare 是字段声明的列表。"};
    const drafts: FieldDraft[] = [];
    for (const item of given) {
        const draft = fieldDraftOf(item);
        if ("problem" in draft) return draft;
        drafts.push(draft);
    }
    return drafts;
}

/**
 * 新建条目时一组声明的 id：没写的按内核同一个函数（`generateFieldId`）在这里先定好，同一项的 `fields` 初值与 `max` 才认得到它（显示名
 * 带空格、括号时生成的 id 不等于显示名）。`max` 按显示名写的换成这一组里那个字段的 id。
 */
function withFieldIds(type: ComponentType, drafts: readonly FieldDraft[]): readonly FieldDraft[] {
    const taken = new Set<string>([...type.fields.map((field) => field.id), ...drafts.flatMap((draft) => (draft.id === undefined ? [] : [draft.id]))]);
    const named = drafts.map((draft) => {
        if (draft.id !== undefined) return draft;
        const id = generateFieldId(draft.label, taken);
        taken.add(id);
        return {...draft, id};
    });
    const all = [...type.fields, ...named];
    return named.map((draft) => {
        if (typeof draft.max !== "string" || all.some((field) => field.id === draft.max)) return draft;
        const byLabel = all.find((field) => field.label === draft.max);
        return byLabel === undefined ? draft : {...draft, max: byLabel.id};
    });
}

/** 值按声明预检，并把引用的名字换成 `{ref: id}`；只为回话好懂，内核的校验才是最终的。 */
async function resolveValue(context: Context, declaration: FieldDeclaration | undefined, value: unknown, keys: ReadonlyMap<string, string>): Promise<{readonly value: unknown} | {readonly problem: string}> {
    if (declaration === undefined || value === null) return {value};
    switch (declaration.kind) {
        case "enum":
            if (typeof value === "string" && declaration.options !== undefined && !declaration.options.includes(value)) return {problem: `“${declaration.label}”只能取：${declaration.options.join("、")}。`};
            return {value};
        case "number":
            if (declaration.precision !== "semantic" && typeof value !== "number") return {problem: `“${declaration.label}”是数。`};
            if (typeof value === "number" && typeof declaration.min === "number" && value < declaration.min) return {problem: `“${declaration.label}”最小是 ${String(declaration.min)}。`};
            if (typeof value === "number" && typeof declaration.max === "number" && value > declaration.max) return {problem: `“${declaration.label}”最大是 ${String(declaration.max)}。`};
            return {value};
        case "ref": {
            if (typeof value === "object" && value !== null && "ref" in value) return {value};
            if (typeof value !== "string") return {problem: `“${declaration.label}”是引用，值写条目名字或 id。`};
            const resolved = await resolveEntry(context, value, keys);
            return "id" in resolved ? {value: {ref: resolved.id}} : resolved;
        }
        default:
            return {value};
    }
}

/* ---------- 工具 ---------- */

export interface AgentToolServices {
    readonly projects: ProjectsService | null;
    readonly remote: ActivationContext["remote"];
    /** 登记的条目种类（`canon.entry-kinds`），每次调用现读：装上插件以后会多。 */
    readonly entryKinds: () => readonly EntryKind[];
}
type Services = AgentToolServices;

function lookupTool(services: Services): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, ctx) => withWorld(services.projects, services.remote, session.project, ctx.signal, async (call) => {
                const context = await contextOf(call, args.at, services.entryKinds());
                if ("text" in context) return context;
                const lines: string[] = [];
                let version = 0;
                let digest = "";
                for (const name of (args.names as string[]).slice(0, 20)) {
                    const found = await call("findEntries", {query: name, position: context.position, limit: 10});
                    if (!found.ok) return worldFailed(found.failure);
                    version = found.value.version;
                    digest = (found.value as {inputDigest?: string}).inputDigest ?? "";
                    const exact = found.value.items.filter((item) => item.name === name || item.matchedAlias === name).slice(0, 5);
                    if (exact.length === 0) {
                        lines.push(`“${name}”：没有这个名字的条目${found.value.items.length === 0 ? "" : `；名字相近的：${found.value.items.slice(0, 3).map(candidateText).join("；")}`}`);
                        continue;
                    }
                    for (const item of exact) {
                        const entry = await entryOf(context, item.id);
                        const groups = "view" in entry ? Object.keys(entry.view.namespaces).map((namespace) => context.components.find((type) => type.namespace === namespace)?.label ?? namespace).join("、") : "";
                        const summary = "view" in entry && entry.view.summary !== "" ? `｜${entry.view.summary}` : "";
                        const aliases = "view" in entry && entry.view.aliases.length > 0 ? `（别名：${entry.view.aliases.join("、")}）` : "";
                        lines.push(`“${name}”：${item.id} ${item.kind}「${item.name}」${aliases}｜设定组：${groups || "无"}${summary}`.slice(0, 160));
                    }
                }
                return {text: clip(`${head(context, version, digest)}\n${lines.join("\n")}`, 3000, "少查几个名字"), details: {version}};
            }),
        }),
    };
}

function treeTool(services: Services): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, ctx) => withWorld(services.projects, services.remote, session.project, ctx.signal, async (call) => {
                const context = await contextOf(call, args.at, services.entryKinds());
                if ("text" in context) return context;
                let parent: string | null = null;
                if (typeof args.parent === "string" && args.parent !== "") {
                    const resolved = await resolveEntry(context, args.parent, new Map());
                    if ("problem" in resolved) return failed("not-found", resolved.problem);
                    parent = resolved.id;
                }
                const page = await call("tree", {parent, position: context.position, limit: typeof args.limit === "number" ? Math.min(args.limit, 50) : 30, ...(typeof args.cursor === "string" ? {cursor: args.cursor} : {})});
                if (!page.ok) return worldFailed(page.failure);
                const lines = page.value.items.map((item) => `${item.id} ${item.nameAt ?? item.name} [${item.type}]${item.hasChildren ? " 有子条目" : ""}${item.deleted ? " 已删除" : item.appeared === false ? " 还没出场" : ""}`);
                const more = page.value.cursor === undefined ? "" : `\n还有 ${String(page.value.remaining)} 项，cursor: ${page.value.cursor}`;
                return {text: clip(`${head(context, page.value.version, (page.value as {inputDigest?: string}).inputDigest ?? "")}\n${lines.join("\n") || "（这一层没有条目）"}${more}`, 3000, "用 cursor 续读"), details: {version: page.value.version}};
            }),
        }),
    };
}

/** 渲染给 Agent 的一块（nb-canon 的 `AgentBlock`）。 */
interface AgentBlockView {
    readonly id: string;
    readonly text: string;
    readonly error?: {readonly message: string; readonly line?: number; readonly column?: number};
}

/** 读到的一块：方括号里是块 id；出错的块标出来并带原因（canon.rendering 输出 14），里面的标签没有值。 */
const blockLine = (block: AgentBlockView): string => `[${block.id}]${block.error === undefined ? "" : `（出错：${block.error.message}，第 ${String(block.error.line ?? 1)} 行；这一块照原文给，标签没有值）`} ${block.text}`;

function readTool(services: Services): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, ctx) => withWorld(services.projects, services.remote, session.project, ctx.signal, async (call) => {
                const context = await contextOf(call, args.at, services.entryKinds());
                if ("text" in context) return context;
                const resolved = await resolveEntry(context, String(args.entry), new Map());
                if ("problem" in resolved) return failed("not-found", resolved.problem);
                const mode = args.mode === "planned" ? "planned" : "actual";
                const read = await call("entry", {id: resolved.id, position: context.position, mode});
                if (!read.ok) return worldFailed(read.failure);
                const view = read.value.view;
                if (view === null) return failed("not-found", `条目 ${resolved.id} 不存在。`);
                const declarations = read.value.declarations ?? {};
                const show = Array.isArray(args.show) && args.show.length > 0 ? (args.show as string[]) : ["fields"];
                const parts: string[] = [`${head(context, read.value.version, (read.value as {inputDigest?: string}).inputDigest ?? "")}`, `${resolved.id}「${view.name}」${view.deleted ? "（已删除）" : view.appeared ? "" : "（还没出场）"}${view.aliases.length > 0 ? ` 别名：${view.aliases.join("、")}` : ""}${view.summary === "" ? "" : `\n简介：${view.summary}`}`];
                let field: string | undefined;
                if (typeof args.field === "string") {
                    const address = resolveField(args.field, view, declarations, context.components);
                    if ("problem" in address) return failed("unknown-field", address.problem);
                    field = address.path;
                }
                // 只读主文字的一块（`text[b1]`）：整块分页给，`cursor` 是从第几个字续读（长的块整篇读时会被截断）。
                if (field?.startsWith("text[") === true) {
                    const id = field.slice("text[".length, -1);
                    const rendered = await call("render", {entry: resolved.id, position: context.position, mode, audience: "agent", block: id});
                    if (!rendered.ok) return worldFailed(rendered.failure);
                    const block = ((rendered.value?.blocks ?? []) as AgentBlockView[]).find((candidate) => candidate.id === id);
                    if (block === undefined) return failed("unknown-field", `没有块 ${id}；块 id 见 show: ["text"] 里的方括号。`);
                    const from = typeof args.cursor === "string" && /^\d+$/u.test(args.cursor) ? Number(args.cursor) : 0;
                    const page = block.text.slice(from, from + BLOCK_PAGE);
                    const rest = block.text.length - from - page.length;
                    parts.push(`${blockLine({...block, text: page})}${rest > 0 ? `\n……（这一块共 ${String(block.text.length)} 字，后面还有 ${String(rest)} 字：cursor "${String(from + page.length)}" 续读。这么长的块用 replace 改局部）` : ""}`);
                    return {text: parts.join("\n\n"), details: {version: read.value.version, entry: resolved.id}};
                }
                if (show.includes("fields")) parts.push(fieldsText(view, declarations, context.components, field === undefined ? {} : {field}));
                const limit = show.includes("text") && show.length === 1 ? 4000 : 6000;
                if (show.includes("text")) {
                    const rendered = await call("render", {entry: resolved.id, position: context.position, mode, audience: "agent"});
                    if (!rendered.ok) return worldFailed(rendered.failure);
                    const blocks = (rendered.value?.blocks ?? []) as AgentBlockView[];
                    // 一块要么整块给，要么只写它多长、怎么单独读：不在块中间截断。照截断的文字整段写回（set text[块]）会丢掉没读到的字。
                    let room = limit - parts.join("\n\n").length - "\n\n主文字：\n".length;
                    const lines = blocks.map((block) => {
                        const whole = blockLine(block);
                        const line = whole.length < room ? whole : `[${block.id}] 这一块共 ${String(block.text.length)} 字，这里放不下：用 field: "text[${block.id}]" 读`;
                        room -= line.length + 1;
                        return line;
                    });
                    parts.push(`主文字：\n${lines.join("\n") || "（没有主文字）"}`);
                }
                if (show.includes("origins")) {
                    if (field === undefined) return failed("unknown-field", "show 含 origins 时要给 field。");
                    const origins = await call("origins", {at: {entry: resolved.id, path: field}, position: context.position, mode, limit: 15, ...(typeof args.cursor === "string" ? {cursor: args.cursor} : {})});
                    if (!origins.ok) return worldFailed(origins.failure);
                    const steps = origins.value.items.map((step) => `- ${JSON.stringify(step)}`.slice(0, 200));
                    parts.push(`${field} 的来历（从最近一步往前，共 ${String(origins.value.total)} 步）：\n${steps.join("\n")}${origins.value.initial === null ? "" : `\n- 最初：${JSON.stringify(origins.value.initial.value)}`}${origins.value.cursor === undefined ? "" : `\n更早的：cursor ${origins.value.cursor}`}`);
                }
                if (show.includes("history")) {
                    const revisions = await call("revisions", {filter: {entry: resolved.id}, limit: 10});
                    if (!revisions.ok) return worldFailed(revisions.failure);
                    parts.push(`最近的修订：\n${revisions.value.items.map((revision) => `- ${revision.id} 版本 ${String(revision.version)}｜${revision.by.kind === "author" ? "作者" : revision.by.kind === "agent" ? "Agent" : revision.by.kind}｜${revision.title}`).join("\n") || "（没有）"}`);
                }
                return {text: clip(parts.join("\n\n"), limit, show.includes("text") ? "主文字用 field: \"text[块 id]\" 一块一块读" : "用 field 只读一个字段"), details: {version: read.value.version, entry: resolved.id}};
            }),
        }),
    };
}

type Edit = Record<string, unknown> & {readonly op: string};

/**
 * 一项改动换成的操作。写主文字的带着回话里要提的：交回的值与当时不同的几处（`notes`），交回的块与现在存下的相同（`unchanged`：
 * 不写，agent-tools 输出 6）。
 */
type Translated = {readonly op: EntryOp; readonly notes?: readonly string[]; readonly unchanged?: true};

/**
 * 整段写一块（`set text[块]`）的上限：这一块的带值写法超过它时，canon_read 一页读不全（`BLOCK_PAGE`），照读到的一页整段写回会丢掉后面的
 * 文字，所以只能用 `replace` 改局部。
 */
const BLOCK_PAGE = 8000;

/**
 * 这一块按实际模式的带值写法、存下的源文与它是不是出错的块（agent-tools 输出 6：`replace` 在带值写法里找，交回的值按它比，`read` 是
 * 存下的源文）。只渲染这一块。
 */
async function currentBlock(context: Context, entry: string, path: string): Promise<{readonly text: string; readonly source: string; readonly broken: boolean} | {readonly problem: string}> {
    const id = path.slice("text[".length, -1);
    const rendered = await context.call("render", {entry, position: context.position, mode: "actual", audience: "agent", block: id});
    if (!rendered.ok) return {problem: failureText(rendered.failure as {code: string} & Record<string, unknown>)};
    const block = ((rendered.value?.blocks ?? []) as Array<{id?: string; text?: string; source?: string; error?: unknown}>).find((candidate) => candidate.id === id);
    if (block === undefined || typeof block.text !== "string" || typeof block.source !== "string") return {problem: `这个位置上没有块 ${id}。`};
    return {text: block.text, source: block.source, broken: block.error !== undefined};
}

/**
 * 整段写一块主文字：去值（出错的块读到的就是源文，原样写），按当时的带值写法比出改了的值；与现在存下的相同（规范化以后）标成没有
 * 改动。`replaced` 是 `replace` 换好的整块：它不受整段写的长度限制。
 */
async function writeBlock(context: Context, entry: string, path: string, submitted: string, keys: ReadonlyMap<string, string>, current: Awaited<ReturnType<typeof currentBlock>>, replaced = false): Promise<Translated | {readonly problem: string}> {
    if ("problem" in current) return current;
    if (!replaced && current.text.length > BLOCK_PAGE) return {problem: `这一块有 ${String(current.text.length)} 字，canon_read 一页读不全；整段写回会丢掉没读到的部分。改局部用 replace（find 写要换掉的那几句）。`};
    const written = agentBlockText(submitted, keys, {current: current.text, verbatim: current.broken});
    if ("problem" in written) return written;
    const unchanged = written.unchanged === true;
    return {op: {op: "set", at: {entry, path}, value: written.source, read: current.source}, ...(written.notes.length === 0 ? {} : {notes: written.notes}), ...(unchanged ? {unchanged: true as const} : {})};
}

/** 模型写的一项换成内核的操作；名字、地址与引用都在这里换成 id。 */
async function translate(context: Context, edit: Edit, index: number, keys: Map<string, string>): Promise<Translated | {readonly problem: string}> {
    const at = (problem: string) => ({problem: `第 ${String(index + 1)} 项（${edit.op}）：${problem}`});
    if (edit.op === "create") {
        if (typeof edit.name !== "string" || typeof edit.kind !== "string") return at("create 要写 name 与 kind。");
        // 没写代号的用“#第几项”：模型写的代号里不会有，不会撞上。
        const key = typeof edit.key === "string" ? edit.key : `#${String(index + 1)}`;
        if (keys.has(key)) return at(`代号“${key}”在这一批里前面已经用过；每个新条目的 key 各不相同。`);
        const tmp = `tmp:${key}`;
        keys.set(key, tmp);
        let parent: string | null = null;
        if (typeof edit.parent === "string") {
            const resolved = await resolveEntry(context, edit.parent, keys);
            if ("problem" in resolved) return at(resolved.problem);
            parent = resolved.id;
        }
        let text: string | undefined;
        if (typeof edit.text === "string") {
            const written = agentBlockText(edit.text, keys);
            if ("problem" in written) return at(written.problem);
            text = written.source;
        }
        const components: {type: string; fields?: Record<string, unknown>; declare?: FieldDraft[]}[] = [];
        // 写了却不是列表（一个名字、null）：回话指出来，不当成没写去套默认。
        if (edit.components !== undefined && !Array.isArray(edit.components)) return at("components 是设定组名字的列表，例如 [\"人物\"]；一组也不要就写 []，不写就用这个种类的默认。");
        if (edit.declare !== undefined && (typeof edit.declare !== "object" || edit.declare === null || Array.isArray(edit.declare))) return at("declare 写 {\"设定组\": [声明…]}。");
        if (edit.fields !== undefined && (typeof edit.fields !== "object" || edit.fields === null || Array.isArray(edit.fields))) return at("fields 写 {\"设定组.字段\": 值}。");
        if (Array.isArray(edit.components)) {
            for (const name of edit.components as string[]) {
                const type = componentNamed(context.components, String(name));
                if ("problem" in type) return at(type.problem);
                if (components.some((component) => component.type === type.id)) return at(`设定组“${name}”列了两次。`);
                components.push({type: type.id});
            }
        } else {
            // 没写 components：用这个种类登记的默认设定组（agent-tools.md 输出 7）；写了空列表就是不要默认。
            for (const type of defaultComponents(context.kinds, edit.kind, new Set(context.components.map((candidate) => candidate.id)))) components.push({type});
        }
        // `declare`：`{"设定组": [声明…]}`，新建时就在那组设定上声明这个条目自己的字段；没列在 `components` 里的一并启用。
        const declaring = new Map<string, readonly FieldDraft[]>();
        for (const [group, given] of Object.entries((edit.declare ?? {}) as Record<string, unknown>)) {
            const type = componentNamed(context.components, group);
            if ("problem" in type) return at(`declare 的“${group}”：${type.problem}`);
            if (declaring.has(type.id)) return at(`declare 里设定组“${type.label}”写了两次（用了两个名字），合成一组写。`);
            const drafts = fieldDrafts(given);
            if ("problem" in drafts) return at(`declare 的“${group}”：${drafts.problem}`);
            const named = withFieldIds(type, drafts);
            let target = components.find((component) => component.type === type.id);
            if (target === undefined) {
                target = {type: type.id};
                components.push(target);
            }
            target.declare = [...named];
            declaring.set(type.id, named);
        }
        // `fields` 写到的设定组没列在 `components` 里时一并启用（agent-tools.md 输出 6）。
        for (const [path, value] of Object.entries((edit.fields ?? {}) as Record<string, unknown>)) {
            const [group = "", name = ""] = path.split(".");
            const type = componentNamed(context.components, group);
            if ("problem" in type) return at(`初值的字段“${path}”：${type.problem}`);
            // 这一项里刚声明的字段也能给初值（它们的 id 在上面已经定好）。
            const declaredHere = (declaring.get(type.id) ?? []) as readonly FieldDeclaration[];
            const field = uniqueNamed([...type.fields, ...declaredHere], name, (candidate) => candidate.id, (candidate) => candidate.label);
            if ("problem" in field) return at(`初值的字段“${path}”：${field.problem === "none" ? `设定组 ${type.namespace} 里没有字段“${name}”；有：${[...type.fields, ...declaredHere].map((candidate) => candidate.label).join("、")}。` : `“${name}”对应几个字段：${field.candidates.join("、")}，写字段 id。`}`);
            const checked = await resolveValue(context, field, value, keys);
            if ("problem" in checked) return at(checked.problem);
            let target = components.find((component) => component.type === type.id);
            if (target === undefined) {
                target = {type: type.id};
                components.push(target);
            }
            target.fields = {...(target.fields ?? {}), [field.id]: checked.value};
        }
        return {op: {op: "create", id: tmp, entry: {name: edit.name, kind: edit.kind, parent, ...(typeof edit.folder === "string" ? {folder: edit.folder} : {}), ...(typeof edit.summary === "string" ? {summary: edit.summary} : {}), ...(Array.isArray(edit.aliases) ? {aliases: edit.aliases as string[]} : {}), ...(components.length === 0 ? {} : {components}), ...(text === undefined ? {} : {text: [text]})}}};
    }
    if (typeof edit.entry !== "string") return at("要写 entry。");
    const entry = await resolveEntry(context, edit.entry, keys);
    if ("problem" in entry) return at(entry.problem);
    const id = entry.id;
    switch (edit.op) {
        case "delete":
        case "restore":
            return {op: {op: edit.op, entry: id}};
        case "aliases":
            return {op: {op: "aliases", entry: id, ...(Array.isArray(edit.add) ? {add: edit.add as string[]} : {}), ...(Array.isArray(edit.remove) ? {remove: edit.remove as string[]} : {})}};
        case "addBlock":
            if (typeof edit.text !== "string") return at("addBlock 要写 text。");
            const written = agentBlockText(edit.text, keys);
            if ("problem" in written) return at(written.problem);
            return {op: {op: "addBlock", entry: id, source: written.source, ...(typeof edit.after === "string" || edit.after === null ? {after: edit.after} : {})}};
        case "removeBlock":
            if (typeof edit.block !== "string") return at("removeBlock 要写 block（块 id，canon_read 的 show: [\"text\"] 里方括号中的）。");
            return {op: {op: "removeBlock", at: {entry: id, path: `text[${edit.block}]`}}};
        case "addComponent":
        case "removeComponent": {
            const type = context.components.find((candidate) => candidate.id === edit.component || candidate.label === edit.component || candidate.namespace === edit.component);
            if (type === undefined) return at(`没有设定组“${String(edit.component)}”；有：${context.components.map((candidate) => candidate.label).join("、")}。`);
            // 已经在条目上的一组再加：内核报的 id-taken 说不清是哪件事，这里先说明白（这一批新建的条目还读不到）。
            if (edit.op === "addComponent" && !id.startsWith("tmp:")) {
                const read = await entryOf(context, id);
                if ("problem" in read) return at(read.problem);
                if (Object.values(read.view.namespaces).some((data) => data.type === type.id)) return at(`这个条目已经有设定组“${type.label}”：改值用 set，加字段用 addField。`);
            }
            if (edit.op === "removeComponent" || edit.declare === undefined) return {op: {op: "component", entry: id, type: type.id, action: edit.op === "addComponent" ? "add" : "remove"}};
            const drafts = fieldDrafts(edit.declare);
            if ("problem" in drafts) return at(drafts.problem);
            return {op: {op: "component", entry: id, type: type.id, action: "add", declare: [...drafts]}};
        }
        case "addField": {
            if (id.startsWith("tmp:")) return at("这一批新建的条目，字段声明写在 create 的 declare 里。");
            const type = componentNamed(context.components, String(edit.component));
            if ("problem" in type) return at(type.problem);
            const draft = fieldDraftOf(edit, ["op", "entry", "component", "value"]);
            if ("problem" in draft) return at(draft.problem);
            // 不给初值的新字段是未知，不预检（数与引用的预检会把“没有值”当成写错）。
            if (edit.value === undefined) return {op: {op: "fieldAdd", entry: id, namespace: type.namespace, field: draft}};
            const checked = await resolveValue(context, {...draft, id: draft.id ?? draft.label} as FieldDeclaration, edit.value, keys);
            if ("problem" in checked) return at(checked.problem);
            return {op: {op: "fieldAdd", entry: id, namespace: type.namespace, field: draft, value: checked.value}};
        }
        case "restoreField": {
            // 去掉过的字段不在生效的声明里，按条目读取另列的那一份找。
            if (typeof edit.field !== "string") return at("要写 field。");
            if (id.startsWith("tmp:")) return at("这一批新建的条目没有去掉过的字段。");
            const read = await entryOf(context, id);
            if ("problem" in read) return at(read.problem);
            const [group = "", name = ""] = edit.field.split(".");
            const type = componentNamed(context.components, group);
            if ("problem" in type) return at(type.problem);
            const removed = read.removedFields[type.namespace] ?? [];
            const found = uniqueNamed(removed, name, (candidate) => candidate.id, (candidate) => candidate.label);
            if ("problem" in found) return at(found.problem === "none" ? `${type.label}里没有去掉过的字段“${name}”${removed.length === 0 ? "。" : `；去掉过的有：${removed.map((candidate) => candidate.label).join("、")}。`}` : `“${name}”对应几个去掉过的字段：${found.candidates.join("、")}，写字段 id。`);
            return {op: {op: "fieldRestore", at: {entry: id, path: `${type.namespace}.${found.id}`}}};
        }
        case "move": {
            let parent: string | null | undefined;
            if (edit.parent === null) parent = null;
            else if (typeof edit.parent === "string") {
                const resolved = await resolveEntry(context, edit.parent, keys);
                if ("problem" in resolved) return at(resolved.problem);
                parent = resolved.id;
            }
            let after: string | null | undefined;
            if (edit.after === null) after = null;
            else if (typeof edit.after === "string") {
                const resolved = await resolveEntry(context, edit.after, keys);
                if ("problem" in resolved) return at(resolved.problem);
                after = resolved.id;
            }
            return {op: {op: "place", entry: id, ...(parent === undefined ? {} : {parent}), ...(after === undefined ? {} : {after}), ...(typeof edit.folder === "string" ? {folder: edit.folder} : {}), ...(typeof edit.kind === "string" ? {kind: edit.kind} : {})}};
        }
    }
    if (typeof edit.field !== "string") return at("要写 field。");
    if (id.startsWith("tmp:")) return at("这一批新建的条目，初值写在 create 里。");
    const read = await entryOf(context, id);
    if ("problem" in read) return at(read.problem);
    const address = resolveField(edit.field, read.view, read.declarations, context.components);
    if ("problem" in address) return at(address.problem);
    const target = {entry: id, path: address.path};
    switch (edit.op) {
        case "renameField":
            if (typeof edit.label !== "string" || edit.label.trim() === "") return at("renameField 要写 label（新的显示名，不能是空的）。");
            return {op: {op: "fieldRename", at: target, label: edit.label}};
        case "removeField":
            return {op: {op: "fieldRemove", at: target}};
        case "set": {
            if (address.path.startsWith("text[")) {
                if (typeof edit.value !== "string") return at("主文字的块写成一段文字。");
                const written = await writeBlock(context, id, address.path, edit.value, keys, await currentBlock(context, id, address.path));
                return "problem" in written ? at(written.problem) : written;
            }
            const declaration = address.item ?? (address.path.includes("[") ? undefined : address.field);
            const checked = await resolveValue(context, declaration, edit.value, keys);
            if ("problem" in checked) return at(checked.problem);
            return {op: {op: "set", at: target, value: checked.value}};
        }
        case "replace": {
            if (typeof edit.find !== "string" || typeof edit.with !== "string") return at("replace 要写 find 与 with。");
            if (!address.path.startsWith("text[")) return {op: {op: "replace", at: target, find: edit.find, with: edit.with}};
            // 主文字的块：在读到的带值写法里找与换，整块去值后写回（find 与 with 不单独去值：半个带值标签也能当 find）。
            const current = await currentBlock(context, id, address.path);
            if ("problem" in current) return at(current.problem);
            const replaced = replaceInBlock(current.text, edit.find, edit.with);
            if ("problem" in replaced) return at(replaced.problem);
            const written = await writeBlock(context, id, address.path, replaced.text, keys, current, true);
            return "problem" in written ? at(written.problem) : written;
        }
        case "add":
            if (typeof edit.delta !== "number") return at("add 要写 delta（数）。");
            return {op: {op: "add", at: target, delta: edit.delta}};
        case "note":
            if (typeof edit.text !== "string") return at("note 要写 text。");
            return {op: {op: "note", at: target, text: edit.text}};
        case "listAdd": {
            const field = address.field;
            if (field?.kind !== "list" || address.path.includes("[")) return at("listAdd 的 field 写到列表字段本身。");
            const element: Record<string, unknown> = {};
            for (const [name, value] of Object.entries((edit.value ?? {}) as Record<string, unknown>)) {
                if (name === "label" || name === "名字") {
                    element.label = value;
                    continue;
                }
                const sub = (field.item ?? []).find((candidate) => candidate.id === name || candidate.label === name);
                if (sub === undefined) return at(`元素没有字段“${name}”；有：${(field.item ?? []).map((candidate) => candidate.label).join("、")}${field.keyedBy === "ref" ? "" : "、label"}。`);
                const checked = await resolveValue(context, sub, value, keys);
                if ("problem" in checked) return at(checked.problem);
                element[sub.id] = checked.value;
            }
            if (field.keyedBy === "ref") {
                if (typeof edit.target !== "string") return at("以条目为键的列表要写 target（这一行指向的条目）。");
                const resolved = await resolveEntry(context, edit.target, keys);
                if ("problem" in resolved) return at(resolved.problem);
                element.id = resolved.id;
            } else if (typeof element.label !== "string") return at("这个列表的元素要有名字：value 里写 label。");
            return {op: {op: "listAdd", at: target, element}};
        }
        case "listRemove":
            if (!address.path.endsWith("]")) return at("listRemove 的 field 写到元素：设定组.字段[元素]。");
            return {op: {op: "listRemove", at: target}};
        default:
            return at(`不认识的 op“${edit.op}”。`);
    }
}

/**
 * 读取戳从 Agent 读过之后变了没有：用内核 `editEntries` 比读取戳的同一个函数（`staleRead`），变了交回 `stale-read`，带上之间的修订。
 * 修订表按最新在前给，取最近 5 条里版本更新的；取不到时不列修订（回话照样请它重读）。`now` 是这次调用里读到的章表的读取戳。
 */
async function staleSince(call: Call, wanted: {readonly version: number; readonly input: string}, now: {readonly version: number; readonly inputDigest: string}): Promise<CanonFailure | null> {
    if (staleRead(wanted, now, []) === null) return null;
    const recent = await call("revisions", {limit: 5});
    return staleRead(wanted, now, recent.ok ? recent.value.items : []);
}

/** 内核的失败里操作的序号（`op`、`problems[].op`、`ops[N]` 路径）换成第几项：没写的项不在操作里。 */
function renumbered(failure: CanonFailure, opEdits: readonly number[]): CanonFailure {
    const edit = (op: number) => opEdits[op] ?? op;
    const record = failure as unknown as Record<string, unknown>;
    const problems = Array.isArray(record.problems)
        ? (record.problems as Array<Record<string, unknown>>).map((problem) => ({
            ...problem,
            ...(typeof problem.op === "number" ? {op: edit(problem.op)} : {}),
            ...(typeof problem.path === "string" ? {path: problem.path.replace(/^ops\[(\d+)\]/u, (_, op: string) => `ops[${String(edit(Number(op)))}]`)} : {}),
        }))
        : undefined;
    return {...record, ...(typeof record.op === "number" ? {op: edit(record.op)} : {}), ...(problems === undefined ? {} : {problems})} as unknown as CanonFailure;
}

/**
 * 写入成功的回话（输出 11）。新建条目的代号到 id 取自修订的 `idMap`：临时 id 是“tmp:代号”，没写代号的是“#第几项”。
 * 重发同一次调用时没有“后面还有几条记录”（那是写入那一刻算的）。
 */
async function writtenReply(call: Call, written: {readonly revision: string; readonly version: number; readonly repeated: boolean; readonly laterRecords?: number; readonly groups?: ReadonlyMap<string, readonly string[]>; readonly note?: string}): Promise<ToolResult> {
    const read = await call("revision", {id: written.revision});
    const revision = read.ok ? read.value.revision : null;
    const ids = revision?.idMap ?? {};
    // 新建的条目带了哪几组设定：没写 components 时套的是种类的默认，模型要看得到套上了什么。
    const created = Object.entries(ids).map(([tmp, id]) => {
        const key = tmp.startsWith("tmp:") ? tmp.slice("tmp:".length) : tmp;
        const groups = written.groups?.get(tmp);
        const carried = groups === undefined ? "" : groups.length === 0 ? "（没有设定组）" : `（设定组：${groups.join("、")}）`;
        return `${key.startsWith("#") ? `第 ${key.slice(1)} 项` : key} → ${id}${carried}`;
    });
    const impact = revision === null ? "" : impactText(revision.impact, (entry) => entry);
    const text = [
        // 不在这里给新的读取戳：写入之后另查一次状态，两步之间别人的写入会被算成模型读过（staleRead 就拦不住了）。
        `已写入：修订 ${written.revision}，版本 ${String(written.version)}${written.repeated ? "（同一次调用重发，返回第一次的结果）" : ""}。接着改要先用 canon_read 重读，拿新的版本。`,
        created.length === 0 ? "" : `新建：${created.join("；")}`,
        impact === "" ? "" : `带来的变化：\n${impact}`,
        written.laterRecords !== undefined && written.laterRecords > 0 ? `后面还有 ${String(written.laterRecords)} 条记录改过同一处，看一眼是否也要改。` : "",
        written.note ?? "",
    ].filter((line) => line !== "").join("\n");
    return {text: clip(text, 1500, "看改动记录"), details: {revision: written.revision, version: written.version, ids: {...ids}}};
}

function writeTool(services: Services): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, ctx) => withWorld(services.projects, services.remote, session.project, ctx.signal, async (call): Promise<ToolResult> => {
                const context = await contextOf(call, args.at, services.entryKinds());
                if ("text" in context) return context;
                const by = {kind: "agent" as const, session: session.sessionId};
                const requestId = `agent:${session.sessionId}:${ctx.invocation}`;
                const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim().slice(0, 60) : "Agent 改设定";
                if (typeof args.revert === "object" && args.revert !== null) {
                    const target = args.revert as {revision: string; withDependents?: boolean};
                    const reverted = await call("revert", {revision: target.revision, withDependents: target.withDependents === true, requestId, by, title});
                    if (!reverted.ok) return worldFailed(reverted.failure);
                    return {text: `已还原：修订 ${reverted.value.revision}，版本 ${String(reverted.value.version)}。`, details: {revision: reverted.value.revision, version: reverted.value.version}};
                }
                // 同一次调用重发（输出 10）：先按请求 id 查结局，写过就按那次修订回话。名字与地址要等这一步之后再解析：
                // 第一次可能改了名字或删了条目，重发的参数照当前世界解析不出来，走不到内核的请求去重。
                const prior = await call("outcome", {requestId});
                if (prior.ok && prior.value.published) return writtenReply(call, {revision: prior.value.revision, version: prior.value.version, repeated: true});
                const edits = Array.isArray(args.edits) ? (args.edits as Edit[]) : [];
                if (edits.length === 0) return failed("no-edits", "edits 至少一项，或写 revert。");
                if (edits.length > 30) return failed("too-large", "一次最多 30 项，分成几次写。");
                const stamp = typeof args.version === "string" ? parseStamp(args.version) : null;
                if (typeof args.version === "string" && stamp === null) return failed("bad-version", "version 原样带回 canon_read 第一行的版本，例如 \"12·a1b2c3d4e5f6\"。");
                if (stamp === null && !edits.every((edit) => edit.op === "create")) return failed("no-version", "要带 version（canon_read 或 canon_lookup 第一行的版本）；只建新条目时可以不给。");
                // 读过之后世界变了：先回 stale-read，与内核比读取戳的结果相同（只在会带读取戳时比）。不先比的话，主文字的 `replace` 在
                // 现在的文字里找不到 find，回话会把 Agent 引向“抄错了”，而它要的是重读。
                if (stamp !== null && stamp.input !== null) {
                    const stale = await staleSince(call, stamp as {version: number; input: string}, context.chapters);
                    if (stale !== null) return worldFailed(stale);
                }
                const keys = new Map<string, string>();
                const ops: EntryOp[] = [];
                // 每个操作是第几项：交回的块与现在相同的不写（不进 ops），内核回话里的操作序号要换回项号。
                const opEdits: number[] = [];
                const notes: string[] = [];
                for (const [index, edit] of edits.entries()) {
                    const translated = await translate(context, edit, index, keys);
                    if ("problem" in translated) return failed("bad-edit", translated.problem);
                    notes.push(...(translated.notes ?? []));
                    if (translated.unchanged === true) continue;
                    ops.push(translated.op);
                    opEdits.push(index);
                }
                const valueNote = notes.length === 0 ? "" : `文字里的值不写入：${[...new Set(notes)].join("；")}。`;
                // 只交回了主文字、去值以后都与现在相同：没有要写的，不发布（不留一条空的修订）。
                if (ops.length === 0) return {text: ["主文字没有改动：去掉读到的值以后与现在相同，没有写入。", valueNote].filter((line) => line !== "").join("\n"), details: {unchanged: true}};
                const input: EntryEdits = {
                    requestId,
                    by,
                    what: "creative",
                    title,
                    ...(typeof args.why === "string" ? {why: args.why} : {}),
                    intent: args.intent === "story" ? "story" : "creative",
                    position: context.position,
                    ...(stamp === null ? {} : {baseVersion: stamp.version, ...(stamp.input === null ? {} : {readStamp: {version: stamp.version, input: stamp.input}})}),
                    ops,
                };
                const written = await call("editEntries", {input});
                if (!written.ok) return worldFailed(renumbered(written.failure, opEdits));
                const groups = new Map(ops.flatMap((op) => (op.op === "create" ? [[op.id, (op.entry.components ?? []).map((component) => context.components.find((type) => type.id === component.type)?.label ?? component.type)] as const] : [])));
                return writtenReply(call, {revision: written.value.revision, version: written.value.version, repeated: written.value.repeated === true, groups, ...(written.value.laterRecords === undefined ? {} : {laterRecords: written.value.laterRecords.length}), ...(valueNote === "" ? {} : {note: valueNote})});
            }),
        }),
    };
}

/** 四个工具的实现，按工具 id。 */
export function canonAgentTools(services: AgentToolServices): Readonly<Record<string, AgentToolImplementation>> {
    return {[AGENT_TOOL_IDS.lookup]: lookupTool(services), [AGENT_TOOL_IDS.tree]: treeTool(services), [AGENT_TOOL_IDS.read]: readTool(services), [AGENT_TOOL_IDS.write]: writeTool(services)};
}

/** 四个工具的声明（贡献点上的），测试与文档核对用。 */
export const CANON_AGENT_TOOL_CONTRIBUTIONS = [lookup.contribution, tree.contribution, read.contribution, write.contribution] as const;

/**
 * canon 的服务端入口：只贡献 Agent 工具。服务端把内置插件都列为必需（server/start.ts），入口随启动激活；激活事件给不必需它的
 * 场地用，第一次调到工具才激活。依赖项目登记（可选）：只装了 canon 的测试场地里没有它，工具回“这个实例没有项目登记”。
 */
export const canonServerPlugin: PluginDefinition = {
    id: descriptor.id,
    // 种类的登记是顶层声明，服务端实例里也要定义贡献点才登记（plugin-manifest.md 输出 10、11）。
    contributionPoints: [entryKindsPoint],
    entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: [lookup.activationEvent, tree.activationEvent, read.activationEvent, write.activationEvent],
        dependencies: [{key: projectsKey, required: false}],
        contributions: [...CANON_AGENT_TOOL_CONTRIBUTIONS],
        activate: async (context) => {
            const projects = await context.services.resolve(projectsKey);
            const services: Services = {
                projects: projects.status === "resolved" ? projects.instance : null,
                remote: context.remote,
                entryKinds: () => mergeEntryKinds(context.declarations.list<EntryKindDeclaration>(CANON_ENTRY_KINDS_POINT)),
            };
            return {contributions: {[TOOLS_POINT]: canonAgentTools(services)}};
        },
    })],
};

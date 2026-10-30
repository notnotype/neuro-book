/**
 * 给人读的输出：每个方法一个格式化函数。出处一律写成“章.段”（docs/specs/story/cli-skill.md 输出 2）。
 * 这里只排版方法结果，不另外过滤或补数据。
 */

import type {Awareness, StoryMethod, StoryResult, Tags} from "../contract/contract";

const STATE_WORDS: Record<Awareness, string> = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道", "no-record": "没有记录"};
const QUESTION_WORDS = {open: "未解", partial: "有进展", answered: "已解"} as const;
const TRACK_WORDS = {resource: "资源", task: "任务", item: "道具"} as const;
const IDENTITY_WORDS = {uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）", suspects: "其实是同一人（怀疑）", "no-record": "可能知道（没有记录）"} as const;

function tagText(tags: Tags | null): string {
    if (!tags) return "";
    const kind = tags.kind === "fact" ? "明说" : tags.kind === "claim" ? "角色的说法" : tags.kind === "belief" ? "角色认为" : "";
    return [kind, tags.inferred ? "推断" : ""].filter(Boolean).join("、");
}

function at(refs: readonly string[]): string {
    return refs.length > 0 ? `〔${refs.join("，")}〕` : "";
}

/** 续页提示写给谁：命令行写 `--cursor` 选项；问答 Agent 的工具写 `cursor` 参数（docs/specs/story/qa.md 输出 3）。 */
export type CursorStyle = "option" | "param";

function pageFooter(result: {total: number; items: unknown[]; next: string | null}, style: CursorStyle): string[] {
    const next = result.next === null ? "" : style === "option" ? `；下一页：--cursor ${result.next}` : `；下一页：cursor 参数传 "${result.next}"`;
    return [`共 ${result.total} 条，本页 ${result.items.length} 条${next}`];
}

/** 只影响排版的选项；问答工具不传，输出与不分级时相同（docs/specs/story/qa.md 输出 3）。 */
export interface FormatOptions {
    /** 说法与情节的行前写等级。 */
    tiers?: boolean;
}

type Formatter<M extends StoryMethod> = (result: StoryResult<M>, style: CursorStyle, options: FormatOptions) => string[];

const FLAG_WORDS = {unconfirmed: "待证实", foreshadow: "伏笔候选"} as const;
const EVIDENCE_WORDS = {unknown: "未知（后文读得还不够）", none: "没有", some: "有一点", strong: "强"} as const;

/** 行前的等级：`[2 级·待证实] `；不写等级或没有等级时为空。 */
function tierText(options: FormatOptions, tier: 1 | 2 | 3 | null, flag: keyof typeof FLAG_WORDS | null = null): string {
    if (!options.tiers || tier === null) return "";
    return `[${tier} 级${flag ? `·${FLAG_WORDS[flag]}` : ""}] `;
}

/** `tier.explain` 的人话：等级怎么来的、后文有哪些证据。 */
function explainLines(result: StoryResult<"tier.explain">): string[] {
    if (result.kind === "episode") {
        return [result.tier === null ? `情节 ${result.id}：没有分级（抽取时模型没有给重要程度）` : `情节 ${result.id}：${result.tier} 级（抽取时模型给的重要程度；情节不算后文证据）`];
    }
    const head = `说法 ${result.id}：${result.tier} 级${result.flag ? `（${FLAG_WORDS[result.flag]}）` : ""}`;
    const prior = result.prior === null ? "模型没有给重要程度，按类别与后文证据定" : `抽取时模型给 ${result.prior} 级`;
    const lines = [head, `  ${prior}；后文证据：${EVIDENCE_WORDS[result.ev!]}`];
    const signals = result.signals!;
    const refs = signals.refs;
    const cited = [
        refs.confirms ? `被后文确认 ${refs.confirms} 次` : "",
        refs.contradicts ? `被后文反驳 ${refs.contradicts} 次` : "",
        refs.revises ? `被后文修订 ${refs.revises} 次` : "",
        refs.knowers ? `后来有 ${refs.knowers} 人得知` : "",
        refs.secrets ? `被后文的 ${refs.secrets} 个秘密收录` : "",
        refs.answers ? `是 ${refs.answers} 个悬念的解答` : "",
    ].filter(Boolean);
    lines.push(`  后文引用：${cited.length ? cited.join("，") : "没有"}`);
    lines.push(`  后文再提起：${signals.echo.phrases.length ? signals.echo.phrases.map(phrase => `“${phrase}”`).join("、") : "没有"}`);
    if (result.ev === "unknown") lines.push(`  这条之后只读了 ${result.window} 章，还看不出后文会不会再提`);
    return lines;
}

const REVISION_STATE_WORDS = {pending: "待确认", adopted: "已采纳", rejected: "已驳回", closed: "后文已确认", stale: "对不上", withdrawn: "已撤销"} as const;
const REVISION_SOURCE_WORDS = {"persona-check": "马甲核对", extraction: "抽取候选", user: "我的", scan: "扫描"} as const;

const writtenRevision = (result: StoryResult<"revisions.confirm">): string[] => [`${REVISION_STATE_WORDS[result.revision.state]}：${result.revision.summary}（${result.revision.id}，依据 ${result.revision.evidence}）`];

const FORMATTERS: {[M in StoryMethod]?: Formatter<M>} = {
    "books.list": result => (result.books.length === 0 ? ["书库里还没有书"] : result.books.map(book => `${book.id}  ${book.title}  ${book.chapters} 章，抽取到 ${book.extractedThrough.chapter}.${book.extractedThrough.paragraph}`)),
    "revisions.list": (result, style) => [
        ...(result.items.length === 0 ? ["没有符合的修订"] : result.items.map(item => `${item.id}  ${REVISION_STATE_WORDS[item.state]}  ${REVISION_SOURCE_WORDS[item.source]}  ${item.summary}〔${item.evidence}〕`)),
        `待确认 ${result.counts.pending}，已采纳 ${result.counts.adopted}，已驳回 ${result.counts.rejected}，后文已确认 ${result.counts.closed}，对不上 ${result.counts.stale}`,
        ...pageFooter(result, style),
    ],
    "revisions.evidence": (result, style) => [...result.items.map(item => `${item.ref}  ${item.text.length > 60 ? `${item.text.slice(0, 60)}…` : item.text}`), ...pageFooter(result, style)],
    "revisions.confirm": writtenRevision,
    "revisions.reject": writtenRevision,
    "revisions.link": writtenRevision,
    "revisions.kind": writtenRevision,
    "revisions.moveName": writtenRevision,
    "revisions.undo": writtenRevision,
    "book.import": result => [`已导入：${result.id}`],
    "book.remove": () => ["已删除"],
    "book.info": result => [
        `${result.title}（${result.id}）`,
        `来源：${result.source.title}，${result.source.file}`,
        `共 ${result.chapters} 章，抽取到 ${result.extractedThrough.chapter}.${result.extractedThrough.paragraph}；阅读位置 ${result.at.chapter}.${result.at.paragraph}`,
        ...(result.revisions.pending + result.revisions.stale > 0 ? [`待确认的修订：${result.revisions.pending} 条${result.revisions.stale > 0 ? `，对不上的 ${result.revisions.stale} 条` : ""}（nbstory revisions list）`] : []),
        "目录：",
        ...result.toc.map(item => `  ${item.chapter}  ${item.title ?? "（未读）"}`),
    ],
    "book.stats": result => [
        `到 ${result.at.chapter}.${result.at.paragraph} 为止的可见记录：`,
        ...Object.entries(result.visible).map(([key, count]) => `  ${key}  ${count}`),
        "全书抽取统计（全书的，不随阅读位置变）：",
        ...Object.entries(result.extraction.written).map(([key, count]) => `  草稿写了 ${key}  ${count}`),
        ...Object.entries(result.extraction.generated).map(([key, count]) => `  程序生成 ${key}  ${count}`),
    ],
    "chapter.digest": result => [
        result.title,
        "情节：",
        ...result.episodes.map(item => `  ${item.title}：${item.summary} ${at(item.refs)}`),
        ...(result.newEntities.length ? ["新出现：", `  ${result.newEntities.map(item => `${item.label}〔${item.ref}〕`).join("、")}`] : []),
        ...(result.revealedSecrets.length ? ["揭晓的秘密：", ...result.revealedSecrets.map(item => `  ${item.title}〔${item.ref}〕`)] : []),
        ...(result.ledger.length ? ["数值变动：", ...result.ledger.map(item => `  ${item.owner.label} ${item.track} ${item.change === null ? "" : item.change > 0 ? `+${item.change}` : item.change}${item.value === null ? "" : ` → ${item.value}`}〔${item.ref}〕`)] : []),
        ...(result.questions.raised.length ? ["新悬念：", ...result.questions.raised.map(item => `  ${item.text}〔${item.ref}〕`)] : []),
        ...(result.questions.progressed.length ? ["悬念进展：", ...result.questions.progressed.map(item => `  ${item.text}（${item.type === "answered" ? "已解" : "有进展"}）〔${item.ref}〕`)] : []),
    ],
    "entities.list": (result, style) => [
        ...result.items.map(item => `${item.id}  ${item.label}（${item.kind}，出场 ${item.mentions}）称呼：${item.names.top.join("、")}${item.names.total > item.names.top.length ? ` 等 ${item.names.total} 个` : ""}${item.entities.length > 1 ? `；同一身份：${item.entities.join("、")}` : ""}`),
        ...pageFooter(result, style),
    ],
    "entity.card": result => [
        `${result.label}（${result.id}，${result.kind}）`,
        `称呼：${result.names.map(name => `${name.text}〔${name.ref}〕`).join("、")}`,
        ...(result.identities.length ? [`同一身份：${result.identities.map(item => `${item.label}（${item.id}${item.statement ? `，说法 ${item.statement}` : ""}）〔${item.ref}〕`).join("、")}`] : []),
        ...result.facets.map(facet => `${facet.facet}（到第 ${facet.through} 章）：${facet.items.join(" ")}`),
        // 没有秘密行（书关掉了秘密，或阅读位置还没有秘密）时不出空标题。
        ...(result.secrets.length ? ["秘密：", ...result.secrets.map(item => `  ${item.title}：${STATE_WORDS[item.state]}${item.ref ? `〔${item.ref}〕` : ""}`)] : []),
        `条数：关系 ${result.counts.relations}，知情 ${result.counts.knowledge}，说法 ${result.counts.statements}，情节 ${result.counts.episodes}`,
    ],
    "entity.knowledge": (result, style) => [...result.items.map(item => `${STATE_WORDS[item.state]}：${item.text}${item.how ? `（${item.how}）` : ""} [${tagText(item.tags)}${item.secret ? "、秘密" : ""}] ${at(item.refs)}`), ...pageFooter(result, style)],
    "entity.statements": (result, style, options) => [
        ...result.items.map(item => `${tierText(options, item.tier, item.tierFlag)}${item.text} [${tagText(item.tags)}] ${at(item.refs)}`),
        ...pageFooter(result, style),
        ...(options.tiers ? [`各级条数：1 级 ${result.tiers[0]}，2 级 ${result.tiers[1]}，3 级 ${result.tiers[2]}`] : []),
    ],
    "entity.episodes": (result, style, options) => [...result.items.map(item => `${tierText(options, item.tier)}第 ${item.chapter} 章  ${item.title} ${at(item.refs)}`), ...pageFooter(result, style)],
    "entity.relations": result =>
        result.items.map(item => {
            const head = [item.other.label, item.word ? `（${item.word}）` : "", item.identity ? ` ${IDENTITY_WORDS[item.identity]}` : ""].join("");
            const counts = [item.counts.statements ? `说法 ${item.counts.statements}` : "", item.counts.episodes ? `同场 ${item.counts.episodes}` : "", item.counts.knows && (item.counts.knows.ab || item.counts.knows.ba) ? `互相知道 ${item.counts.knows.ab}/${item.counts.knows.ba}` : ""].filter(Boolean).join("，");
            const line = item.summary ? `${item.summary.text}〔${item.summary.ref}〕` : item.lastEpisode ? `一起出场：${item.lastEpisode.title}（第 ${item.lastEpisode.chapter} 章）` : "";
            return `${head}  ${counts}${line ? `\n  ${line}` : ""}`;
        }),
    "entity.relation": result => [
        `${result.a.label} 与 ${result.b.label}${result.word ? `：${result.word}` : ""}${result.identity ? `，${IDENTITY_WORDS[result.identity]}` : ""}`,
        ...(result.statements.length ? ["说法：", ...result.statements.map(item => `  第 ${item.chapter} 章 [${item.family}] ${item.text} [${tagText(item.tags)}] ${at(item.refs)}`)] : []),
        ...(result.episodes.length ? ["一起出场：", ...result.episodes.map(item => `  第 ${item.chapter} 章 ${item.title} ${at(item.refs)}`)] : []),
        ...(result.knows && result.knows.ab.length ? [`${result.a.label}知道的关于${result.b.label}的事：`, ...result.knows.ab.map(item => `  ${STATE_WORDS[item.state]}：${item.text} ${at(item.refs)}`)] : []),
        ...(result.knows && result.knows.ba.length ? [`${result.b.label}知道的关于${result.a.label}的事：`, ...result.knows.ba.map(item => `  ${STATE_WORDS[item.state]}：${item.text} ${at(item.refs)}`)] : []),
    ],
    "secrets.matrix": result =>
        result.rows.flatMap(row => [
            `${row.title}（${row.id}）`,
            ...row.cells.map(cell => {
                const column = result.columns.find(item => item.id === cell.column)!;
                const name = column.aliases.length ? `${column.label}（${column.aliases.join("、")}）` : column.label;
                return `  ${name}：${STATE_WORDS[cell.state]}${cell.how ? `，${cell.how}` : ""}${cell.ref ? `〔${cell.ref}〕` : ""}`;
            }),
        ]),
    "graph.relations": result => [
        ...(result.view.perspective === "reader" ? [] : [`视角 ${result.view.perspective}：用了 ${result.view.statements} 条说法`]),
        ...result.edges.map(edge => {
            const label = (id: string) => result.nodes.find(node => node.id === id)?.label ?? id;
            const parts = [
                edge.relation ? `关系${edge.relation.word ? `“${edge.relation.word}”` : ""} ${edge.relation.statements} 条` : "",
                edge.together ? `同场 ${edge.together} 次` : "",
                edge.knows && (edge.knows.ab || edge.knows.ba) ? `认知 ${edge.knows.ab}/${edge.knows.ba}` : "",
                edge.identity ? IDENTITY_WORDS[edge.identity] : "",
            ].filter(Boolean);
            return `${label(edge.a)} — ${label(edge.b)}：${parts.join("，")}`;
        }),
    ],
    "ledger.tracks": result => result.tracks.map(track => `${track.owner.label} ${track.name}（${TRACK_WORDS[track.kind]}）：${track.current ?? "—"}${track.relative ? "（相对值）" : ""}${track.mismatches ? `，${track.mismatches} 处与原文对不上` : ""}〔${track.lastRef}〕`),
    "ledger.track": result => [
        `${result.track.owner.label} ${result.track.name}：${result.track.current ?? "—"}${result.track.relative ? "（相对值）" : ""}`,
        ...result.entries.map(entry => {
            const change = entry.change === null ? "" : entry.change > 0 ? `+${entry.change}` : String(entry.change);
            const balance = entry.balance === null ? (entry.value ?? "") : `${entry.relative ? "相对 " : ""}${entry.balance}`;
            const gap = entry.gap ? `（原文比累加${entry.gap > 0 ? "多" : "少"} ${Math.abs(entry.gap)}）` : "";
            return `  ${entry.op} ${change} → ${balance}${gap} ${entry.reason} ${at(entry.refs)}`;
        }),
    ],
    "questions.list": (result, style) => [
        ...result.items.flatMap(item => [
            `${item.text}（${QUESTION_WORDS[item.state]}${item.trivial ? "，琐碎" : ""}）提出 ${at(item.raised.refs)}`,
            ...item.updates.filter(update => update.type !== "raised").map(update => `  ${update.type === "answered" ? "解答" : "进展"}：${update.answer ?? update.note ?? ""} ${at(update.refs)}`),
        ]),
        ...pageFooter(result, style),
    ],
    timeline: result =>
        result.points.flatMap(point => [
            `${point.day === null ? "日子不明" : `第 ${point.day} 天`}${point.part ? ` ${point.part}` : ""}${point.clock ? ` ${point.clock}` : ""}  ${point.label}${point.relative ? `（${point.relative}）` : ""}${point.flashback ? `  第 ${point.flashback} 章补叙` : ""} ${at(point.refs)}`,
            ...point.episodes.map(episode => `  情节 ${episode.id} ${episode.title}（${episode.who.map(who => who.label).join("、")}${episode.place ? `；${episode.place.label}` : ""}）`),
        ]),
    "episodes.list": (result, style, options) => [
        ...result.items.flatMap(item => [
            `${tierText(options, item.tier)}第 ${item.chapter} 章  ${item.title}（${item.who.map(who => (who.as ? `${who.label}，以${who.as}` : who.label)).join("、")}）${item.arcs.length ? "" : "  未归入主线"} ${at(item.refs)}`,
            ...(item.time || item.place ? [`  ${[item.time ? `时间：${item.time.label}` : "", item.place ? `地点：${item.place.label}` : ""].filter(Boolean).join("；")}`] : []),
            `  ${item.summary}`,
            ...item.links.map(link => `  ${link.type} → ${link.to.title}${link.note ? `（${link.note}）` : ""}`),
        ]),
        ...pageFooter(result, style),
    ],
    "arcs.list": result => (result.through === null ? ["还没有主线"] : [`归纳到第 ${result.through} 章：`, ...result.arcs.map(arc => `${arc.title}（${arc.status === "closed" ? "已结束" : "进行中"}，${arc.episodes.length} 段情节）：${arc.summary}`)]),
    "source.read": result => result.paragraphs.map(paragraph => `${paragraph.chapter}.${paragraph.paragraph}  ${paragraph.text}${paragraph.recordCount ? `  〔${paragraph.recordCount} 条记录〕` : ""}`),
    "source.records": result => (result.records.length === 0 ? ["这一段没有可见的记录"] : result.records.map(record => `${record.type}  ${record.text}${record.tags ? ` [${tagText(record.tags)}]` : ""} ${at(record.refs)}`)),
    "tier.explain": result => explainLines(result),
    search: (result, style) => [
        `对象 ${result.counts.entity}、说法 ${result.counts.statement}、原文 ${result.counts.source}`,
        ...result.items.map(item => `${item.kind === "entity" ? "对象" : item.kind === "statement" ? "说法" : "原文"}〔${item.ref}〕 ${item.text}`),
        ...pageFooter(result, style),
    ],
};

export function formatResult<M extends StoryMethod>(method: M, result: StoryResult<M>, style: CursorStyle = "option", options: FormatOptions = {}): string {
    const formatter = FORMATTERS[method] as Formatter<M> | undefined;
    return formatter ? formatter(result, style, options).join("\n") : JSON.stringify(result, null, 2);
}

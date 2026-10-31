/**
 * 剧情图谱的查询接口合同：方法清单与每个方法参数、结果的 schema。行为见 docs/specs/story/queries.md 的“方法清单”
 * 与“输出与可观察行为”；结果里必须有的字段按那张表，这里可以多、不可以少。
 *
 * 同一份合同有三种用法：命令行在进程内调用（src/core/api.ts）、独立服务的 `POST /api/rpc/<方法名>`、以后插件通道的
 * `defineRemoteService`。参数一律是 `additionalProperties: false` 的对象，多余字段报 `invalid_params`。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {ENTITY_KINDS, FACETS, KNOWLEDGE_STATES, STATEMENT_KINDS} from "../core/dataset";
import {ConfigSchema, EffortSchema, ENV_NAME_PATTERN} from "./config-schema";
import {QaAnswerModeSchema, QaModeSchema, QaPositionSchema, QaStatusSchema, QaTurnSchema} from "./qa-record";

const strict = {additionalProperties: false} as const;

function oneOf<const T extends readonly string[]>(values: T) {
    return Type.Union(values.map(value => Type.Literal(value))) as unknown as ReturnType<typeof Type.Union<{-readonly [K in keyof T]: ReturnType<typeof Type.Literal<T[K]>>}>>;
}

/**
 * 首轮还没有记录时，`qa.get` 的 `continuable` 给的两种原因。服务端读到“记录不存在”时按运行状态给；网页数据源在看着首轮结束时
 * 自己换成其中一种（不等重读），所以两边共用这两句。
 */
export const QA_FIRST_TURN_RUNNING = "第一轮还在运行";
export const QA_FIRST_TURN_UNSAVED = "第一轮没有保存，不能续问";

// ---- 公共形状 ----

export const PositionInputSchema = Type.Object({chapter: Type.Integer(), paragraph: Type.Optional(Type.Integer())}, strict);
/** 结果里的阅读位置总是落到具体的段上。 */
export const PositionSchema = Type.Object({chapter: Type.Integer(), paragraph: Type.Integer()});
/** 出处：“38.57”或“38.50—38.81”。 */
export const RefSchema = Type.String();
export const EntityKindSchema = oneOf(ENTITY_KINDS);
/** 记录标记：明说（fact）、角色的说法（claim）、角色认为（belief），以及是否推断。知情记录指向秘密时 kind 为 null。 */
export const TagsSchema = Type.Object({kind: Type.Union([oneOf(STATEMENT_KINDS), Type.Null()]), inferred: Type.Boolean()});
/** 结果里引用的点（可能由几个对象合并而成）：id 是点的代表对象，label 是显示名。 */
export const NodeRefSchema = Type.Object({id: Type.String(), label: Type.String()});
/** 对秘密或身份说法的知情状态；“没有记录”与“明确不知道”不同。 */
export const AwarenessSchema = Type.Union([oneOf(KNOWLEDGE_STATES), Type.Literal("no-record")]);
export const IdentityStateSchema = oneOf(["uncertain", "unaware", "no-record", "heard", "believes", "suspects"] as const);

const Perspective = Type.String({minLength: 1});
const BookParams = {
    book: Type.Optional(Type.String({minLength: 1})),
    at: Type.Optional(PositionInputSchema),
    perspective: Type.Optional(Perspective),
};
const PageParams = {
    cursor: Type.Optional(Type.String({minLength: 1})),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 500})),
};

function page<T extends TSchema>(item: T) {
    return Type.Object({items: Type.Array(item), total: Type.Integer(), next: Type.Union([Type.String(), Type.Null()])});
}

const Empty = Type.Object({}, strict);

// ---- 书库与书 ----

/** 这本书记不记数值与秘密（生效值：缺省的已补成开）。 */
const Features = Type.Object({ledger: Type.Boolean(), secrets: Type.Boolean()});

const BookSummary = Type.Object({id: Type.String(), title: Type.String(), generation: Type.String(), chapters: Type.Integer(), extractedThrough: PositionSchema, features: Features});

const BookInfo = Type.Object({
    id: Type.String(),
    title: Type.String(),
    generation: Type.String(),
    source: Type.Object({bookId: Type.String(), title: Type.String(), file: Type.String()}),
    chapters: Type.Integer(),
    paragraphs: Type.Array(Type.Integer()),
    /** 未抽取尾部各章的段数（书还在抽取时，已切好但还没进图的章）；没有尾部为空数组。`paragraphs` 与 `chapters` 只含已提交的章。 */
    unextracted: Type.Array(Type.Integer()),
    /** P 所在章及之前各章有标题；之后的章 title 为 null。 */
    toc: Type.Array(Type.Object({chapter: Type.Integer(), title: Type.Union([Type.String(), Type.Null()])})),
    extractedThrough: PositionSchema,
    /** 这次查询实际用的阅读位置。 */
    at: PositionSchema,
    features: Features,
    /** 待确认的修订数（按阅读位置算）与对不上、已不套用的数（docs/specs/story/revisions.md）。 */
    revisions: Type.Object({pending: Type.Integer(), stale: Type.Integer()}),
});

const BookStats = Type.Object({
    at: PositionSchema,
    /** 到阅读位置为止各类可见记录的条数。 */
    visible: Type.Record(Type.String(), Type.Integer()),
    /** 全书抽取统计，不随阅读位置变。 */
    /** 第 1 章到阅读位置所在章，各章成立的可见记录数（输出 2）。 */
    chapters: Type.Array(Type.Object({
        chapter: Type.Integer(),
        statements: Type.Integer(),
        knowledge: Type.Integer(),
        episodes: Type.Integer(),
        ledger: Type.Integer(),
        /** 这一章新提出的悬念。 */
        raised: Type.Integer(),
        /** 这一章得到解答的悬念。 */
        answered: Type.Integer(),
    })),
    /** 出场最多的至多 12 个人物；`counts[i]` 是第 i+1 章里被提到的次数，长度与 `chapters` 相同。 */
    cast: Type.Array(Type.Object({id: Type.String(), label: Type.String(), counts: Type.Array(Type.Integer())})),
    extraction: Type.Object({scope: Type.Literal("book"), written: Type.Record(Type.String(), Type.Number()), generated: Type.Record(Type.String(), Type.Number()), chars: Type.Number()}),
});

const ReadingState = Type.Object({position: PositionInputSchema, view: Type.Unknown(), savedAt: Type.Union([Type.String(), Type.Null()])});

// ---- 对象 ----

const RosterItem = Type.Object({
    id: Type.String(),
    label: Type.String(),
    kind: EntityKindSchema,
    mentions: Type.Integer(),
    names: Type.Object({top: Type.Array(Type.String()), total: Type.Integer()}),
    /** 组成这个点的对象 id。 */
    entities: Type.Array(Type.String()),
    /** 无名：组成这个点的对象可见称呼全是泛称（或没有称呼）。缺省按否。 */
    anonymous: Type.Optional(Type.Boolean()),
});

const EntityCard = Type.Object({
    id: Type.String(),
    label: Type.String(),
    kind: EntityKindSchema,
    entities: Type.Array(Type.String()),
    names: Type.Array(Type.Object({text: Type.String(), ref: RefSchema})),
    /** 读者此时知道的同一身份：组成这个点的其它对象，各带连接成立的出处。 */
    identities: Type.Array(Type.Object({id: Type.String(), label: Type.String(), ref: RefSchema, /** 把它连进来的身份说法的编号，`revisions.reject` 用它断开这条连接；找不到连接说法时是 null。 */ statement: Type.Union([Type.String(), Type.Null()]), mark: Type.Union([oneOf(["confirmed", "added"] as const), Type.Null()])})),
    facets: Type.Array(Type.Object({facet: oneOf(FACETS), through: Type.Integer(), items: Type.Array(Type.String())})),
    secrets: Type.Array(Type.Object({id: Type.String(), title: Type.String(), state: AwarenessSchema, ref: Type.Union([RefSchema, Type.Null()])})),
    counts: Type.Object({relations: Type.Integer(), knowledge: Type.Integer(), statements: Type.Integer(), episodes: Type.Integer()}),
});

const KnowledgeItem = Type.Object({
    id: Type.String(),
    /** 知道了什么：说法的原文转述或秘密的标题。 */
    text: Type.String(),
    about: Type.Object({type: oneOf(["statement", "secret"] as const), id: Type.String()}),
    state: oneOf(KNOWLEDGE_STATES),
    how: Type.Union([Type.String(), Type.Null()]),
    refs: Type.Array(RefSchema),
    secret: Type.Boolean(),
    tags: TagsSchema,
    chapter: Type.Integer(),
});

// ---- 记录等级（docs/specs/story/queries.md 的“记录等级”） ----

export const TierSchema = Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]);
const TierFlagSchema = oneOf(["unconfirmed", "foreshadow"] as const);
const EvidenceSchema = oneOf(["unknown", "none", "some", "strong"] as const);

const TierExplain = Type.Object({
    id: Type.String(),
    kind: oneOf(["statement", "episode"] as const),
    /** 情节没有先验时为 null（不分级）。 */
    tier: Type.Union([TierSchema, Type.Null()]),
    prior: Type.Union([TierSchema, Type.Null()]),
    flag: Type.Union([TierFlagSchema, Type.Null()]),
    /** 以下只有说法有，情节为 null。 */
    ev: Type.Union([EvidenceSchema, Type.Null()]),
    window: Type.Union([Type.Integer(), Type.Null()]),
    signals: Type.Union([
        Type.Object({
            refs: Type.Object({confirms: Type.Integer(), contradicts: Type.Integer(), revises: Type.Integer(), knowers: Type.Integer(), secrets: Type.Integer(), answers: Type.Integer()}),
            echo: Type.Object({count: Type.Integer(), phrases: Type.Array(Type.String())}),
        }),
        Type.Null(),
    ]),
});

const StatementItem = Type.Object({
    id: Type.String(),
    text: Type.String(),
    family: Type.String(),
    tags: TagsSchema,
    holder: Type.Union([NodeRefSchema, Type.Null()]),
    refs: Type.Array(RefSchema),
    chapter: Type.Integer(),
    tier: TierSchema,
    tierFlag: Type.Union([TierFlagSchema, Type.Null()]),
    /** 修订相关的标记（docs/specs/story/revisions.md）：`candidate` 还是候选，`confirmed` 你确认的，`added` 你加的；没有为 null。 */
    mark: Type.Union([oneOf(["candidate", "confirmed", "added"] as const), Type.Null()]),
});

/** `tier` 是情节的先验等级，没有为 null。 */
const EpisodeBrief = Type.Object({id: Type.String(), title: Type.String(), chapter: Type.Integer(), refs: Type.Array(RefSchema), tier: Type.Union([TierSchema, Type.Null()])});

// ---- 两个对象之间的关系（输出 20、21） ----

/** 一条关系最要紧的联系：身份连接、关系说法（亲属、交往、所属）、态度、其他说法、同场、认知，从强到弱。 */
const RelationStrength = oneOf(["identity", "relation", "attitude", "statement", "together", "knows"] as const);
const RelationListItem = Type.Object({
    other: Type.Object({id: Type.String(), label: Type.String(), kind: EntityKindSchema}),
    strength: RelationStrength,
    /** 关系词（姐妹、朋友……），推不出时为 null。 */
    word: Type.Union([Type.String(), Type.Null()]),
    identity: Type.Union([IdentityStateSchema, Type.Null()]),
    /** 两人之间的说法条数、同场的情节段数；认知是 a 知道关于 b 的条数与反过来的条数（a 是这次查询的对象），角色视角下为 null。 */
    counts: Type.Object({statements: Type.Integer(), episodes: Type.Integer(), knows: Type.Union([Type.Object({ab: Type.Integer(), ba: Type.Integer()}), Type.Null()])}),
    /**
     * 最能说明这段关系的一句：只涉及这两人的说法优先，其中最近的关系说法 → 最近的态度说法 → 最近的一条；只有和别人
     * 一起提到的说法时照同样的顺序挑；都没有为 null。
     */
    summary: Type.Union([Type.Object({text: Type.String(), family: Type.String(), holder: Type.Union([NodeRefSchema, Type.Null()]), ref: RefSchema, chapter: Type.Integer()}), Type.Null()]),
    /** 最近一段两人一起出场的情节；没有为 null。 */
    lastEpisode: Type.Union([Type.Object({id: Type.String(), title: Type.String(), chapter: Type.Integer()}), Type.Null()]),
});
const RelationDetail = Type.Object({
    a: NodeRefSchema,
    b: NodeRefSchema,
    word: Type.Union([Type.String(), Type.Null()]),
    identity: Type.Union([IdentityStateSchema, Type.Null()]),
    /** 两人之间的全部说法（about 同时含两人），按出处先后。label 是数据里这条说法的短标签。 */
    statements: Type.Array(Type.Object({
        id: Type.String(),
        text: Type.String(),
        label: Type.Union([Type.String(), Type.Null()]),
        family: Type.String(),
        tags: TagsSchema,
        holder: Type.Union([NodeRefSchema, Type.Null()]),
        refs: Type.Array(RefSchema),
        chapter: Type.Integer(),
    })),
    /** 两人一起出场的情节。 */
    episodes: Type.Array(EpisodeBrief),
    /** a 知道的关于 b 的事、b 知道的关于 a 的事（各取最近的至多 20 条）；角色视角下为 null。 */
    knows: Type.Union([Type.Object({ab: Type.Array(Type.Object({text: Type.String(), state: oneOf(KNOWLEDGE_STATES), how: Type.Union([Type.String(), Type.Null()]), refs: Type.Array(RefSchema)})), ba: Type.Array(Type.Object({text: Type.String(), state: oneOf(KNOWLEDGE_STATES), how: Type.Union([Type.String(), Type.Null()]), refs: Type.Array(RefSchema)}))}), Type.Null()]),
});

// ---- 秘密、数值、悬念、时间、情节 ----

const SecretsMatrix = Type.Object({
    /** 读者一列在前；人物列的 `aliases` 是读者此时知道的他的其他身份名（读者列为空）。 */
    columns: Type.Array(Type.Object({id: Type.String(), label: Type.String(), aliases: Type.Array(Type.String())})),
    rows: Type.Array(
        Type.Object({
            id: Type.String(),
            title: Type.String(),
            /** 读者知道这个秘密的出处；读者还不知道时为 null。 */
            revealedAt: Type.Union([RefSchema, Type.Null()]),
            /** `how` 是取到的那条记录写的“怎么知道的”；读者凭身份说法知道时为“旁白”；没有记录时为 null。 */
            cells: Type.Array(Type.Object({column: Type.String(), state: AwarenessSchema, how: Type.Union([Type.String(), Type.Null()]), ref: Type.Union([RefSchema, Type.Null()])})),
        }),
    ),
});

const TrackKind = oneOf(["resource", "task", "item"] as const);
const LedgerTrack = Type.Object({
    name: Type.String(),
    owner: NodeRefSchema,
    kind: TrackKind,
    current: Type.Union([Type.Number(), Type.String(), Type.Null()]),
    relative: Type.Boolean(),
    lastRef: RefSchema,
    /** 原文报数与累加对不上的笔数。 */
    mismatches: Type.Integer(),
    entries: Type.Integer(),
});
const LedgerEntry = Type.Object({
    id: Type.String(),
    op: Type.String(),
    change: Type.Union([Type.Number(), Type.Null()]),
    value: Type.Union([Type.Number(), Type.String(), Type.Null()]),
    item: Type.Union([NodeRefSchema, Type.Null()]),
    balance: Type.Union([Type.Number(), Type.Null()]),
    relative: Type.Boolean(),
    gap: Type.Union([Type.Number(), Type.Null()]),
    reason: Type.String(),
    refs: Type.Array(RefSchema),
});

const QuestionState = oneOf(["open", "partial", "answered"] as const);
const QuestionItem = Type.Object({
    id: Type.String(),
    text: Type.String(),
    state: QuestionState,
    trivial: Type.Boolean(),
    about: Type.Array(NodeRefSchema),
    raised: Type.Object({refs: Type.Array(RefSchema), chapter: Type.Integer()}),
    updates: Type.Array(Type.Object({type: oneOf(["raised", "partial", "answered"] as const), answer: Type.Union([Type.String(), Type.Null()]), note: Type.Union([Type.String(), Type.Null()]), refs: Type.Array(RefSchema), chapter: Type.Integer()})),
    /** 出处与提出或可见进展的出处重叠的情节，按章排序（输出 11）。 */
    episodes: Type.Array(EpisodeBrief),
});

const TimelinePoint = Type.Object({
    id: Type.String(),
    label: Type.String(),
    day: Type.Union([Type.Number(), Type.Null()]),
    part: Type.Union([Type.String(), Type.Null()]),
    clock: Type.Union([Type.String(), Type.Null()]),
    date: Type.Union([Type.String(), Type.Null()]),
    /** 相对时间的说明，例如“t3-3 之后 2 天”；没有时为 null。 */
    relative: Type.Union([Type.String(), Type.Null()]),
    /** 故事时间更早、却在后面的章才写到：给出写到它的那一章；不是补叙时为 null。 */
    flashback: Type.Union([Type.Integer(), Type.Null()]),
    refs: Type.Array(RefSchema),
    chapter: Type.Integer(),
    /** 故事时间是这个点的可见情节（输出 12）。 */
    episodes: Type.Array(Type.Object({id: Type.String(), title: Type.String(), who: Type.Array(NodeRefSchema), place: Type.Union([NodeRefSchema, Type.Null()])})),
});

const EpisodeLinkType = oneOf(["after", "continues", "retells", "causes", "motivates", "enables"] as const);
const EpisodeItem = Type.Object({
    id: Type.String(),
    title: Type.String(),
    chapter: Type.Integer(),
    /** 参与者；`as` 是读者此时认得出的出场身份（例如“风信子”），没有或还认不出时为 null（输出 13）。 */
    who: Type.Array(Type.Object({id: Type.String(), label: Type.String(), as: Type.Union([Type.String(), Type.Null()])})),
    place: Type.Union([NodeRefSchema, Type.Null()]),
    /** 所挂的时间点；不可见时为 null。 */
    time: Type.Union([Type.Object({id: Type.String(), label: Type.String()}), Type.Null()]),
    summary: Type.String(),
    steps: Type.Array(Type.Object({text: Type.String(), ref: RefSchema})),
    outcome: Type.Union([Type.String(), Type.Null()]),
    links: Type.Array(Type.Object({type: EpisodeLinkType, to: Type.Object({id: Type.String(), title: Type.String()}), note: Type.Union([Type.String(), Type.Null()])})),
    /** 所属主线（当前这一批里的 id，可以有几条）；为空表示“未归入主线”。 */
    arcs: Type.Array(Type.String()),
    refs: Type.Array(RefSchema),
    tier: Type.Union([TierSchema, Type.Null()]),
});

const ArcsList = Type.Object({
    /** 当前这一批归纳到第几章；还没有任何一批时为 null。 */
    through: Type.Union([Type.Integer(), Type.Null()]),
    arcs: Type.Array(Type.Object({id: Type.String(), title: Type.String(), summary: Type.String(), status: oneOf(["ongoing", "closed"] as const), episodes: Type.Array(Type.String())})),
});

const ChapterDigest = Type.Object({
    chapter: Type.Integer(),
    title: Type.String(),
    episodes: Type.Array(Type.Object({id: Type.String(), title: Type.String(), summary: Type.String(), refs: Type.Array(RefSchema)})),
    newEntities: Type.Array(Type.Object({id: Type.String(), label: Type.String(), kind: EntityKindSchema, ref: RefSchema})),
    revealedSecrets: Type.Array(Type.Object({id: Type.String(), title: Type.String(), ref: RefSchema})),
    ledger: Type.Array(Type.Object({track: Type.String(), owner: NodeRefSchema, op: Type.String(), change: Type.Union([Type.Number(), Type.Null()]), value: Type.Union([Type.Number(), Type.String(), Type.Null()]), ref: RefSchema})),
    questions: Type.Object({
        raised: Type.Array(Type.Object({id: Type.String(), text: Type.String(), ref: RefSchema})),
        progressed: Type.Array(Type.Object({id: Type.String(), text: Type.String(), type: oneOf(["partial", "answered"] as const), ref: RefSchema})),
    }),
});

// ---- 原文与搜索 ----

const SourceParagraph = Type.Object({
    chapter: Type.Integer(),
    paragraph: Type.Integer(),
    text: Type.String(),
    names: Type.Array(Type.Object({entity: Type.String(), text: Type.String(), start: Type.Integer(), end: Type.Integer()})),
    /** 从这一段开始的段落概要；没有或还不完整时为 null。 */
    beat: Type.Union([Type.Object({id: Type.String(), gist: Type.String(), from: Type.Integer(), to: Type.Integer()}), Type.Null()]),
    recordCount: Type.Integer(),
});

const RecordItem = Type.Object({
    type: oneOf(["statement", "knowledge", "episode", "ledger", "question", "time", "secret"] as const),
    id: Type.String(),
    text: Type.String(),
    tags: Type.Union([TagsSchema, Type.Null()]),
    refs: Type.Array(RefSchema),
});

const SearchKind = oneOf(["entity", "statement", "source"] as const);
const SearchItem = Type.Object({
    kind: SearchKind,
    /** 对象的点 id、说法 id；原文为 null。 */
    id: Type.Union([Type.String(), Type.Null()]),
    text: Type.String(),
    ref: RefSchema,
});

// ---- 图 ----

export const RelationNodeSchema = Type.Object({id: Type.String(), label: Type.String(), kind: EntityKindSchema, mentions: Type.Integer(), entities: Type.Array(Type.String()), names: Type.Optional(Type.Array(Type.String())), anonymous: Type.Optional(Type.Boolean())});
export const RelationEdgeSchema = Type.Object({
    a: Type.String(),
    b: Type.String(),
    relation: Type.Union([Type.Object({word: Type.Union([Type.String(), Type.Null()]), statements: Type.Integer()}), Type.Null()]),
    together: Type.Integer(),
    knows: Type.Union([Type.Object({ab: Type.Integer(), ba: Type.Integer()}), Type.Null()]),
    identity: Type.Union([IdentityStateSchema, Type.Null()]),
});
const RelationGraph = Type.Object({
    nodes: Type.Array(RelationNodeSchema),
    edges: Type.Array(RelationEdgeSchema),
    view: Type.Object({
        perspective: Type.String(),
        statements: Type.Integer(),
        unmerged: Type.Array(Type.Object({a: Type.String(), b: Type.String(), identity: IdentityStateSchema})),
    }),
    /** 这个位置可选的视角：至少有一条知情记录的人物。 */
    perspectives: Type.Array(NodeRefSchema),
});

const BookGraph = Type.Object({
    nodes: Type.Array(Type.Object({id: Type.String(), type: oneOf(["entity", "arc", "episode", "secret", "question"] as const), label: Type.String(), weight: Type.Integer(), names: Type.Optional(Type.Array(Type.String()))})),
    edges: Type.Array(Type.Object({a: Type.String(), b: Type.String(), type: oneOf(["participates", "about", "link", "relation"] as const), count: Type.Integer()})),
});

const Storyline = Type.Object({
    lanes: Type.Array(NodeRefSchema),
    dots: Type.Array(Type.Object({episode: Type.String(), title: Type.String(), chapter: Type.Integer(), lane: Type.String()})),
});

// ---- 图的修订 ----

const RevisionState = oneOf(["pending", "adopted", "rejected", "closed", "stale", "withdrawn"] as const);
const RevisionSource = oneOf(["persona-check", "extraction", "user", "scan"] as const);
export const RevisionItemSchema = Type.Object({
    /** 待确认与自动关闭的候选是 `st:<说法编号>`，有决定或用户自己的修订是 `r<n>`。 */
    id: Type.String(),
    op: oneOf(["identity.candidate", "identity.confirm", "identity.reject", "identity.link", "kind.set", "name.move"] as const),
    state: RevisionState,
    source: RevisionSource,
    by: Type.Union([Type.Literal("user"), Type.Literal("auto"), Type.Null()]),
    summary: Type.String(),
    /** 涉及的对象与它们在依据位置的显示名：候选与连接是两个，改种类是一个，挪称呼是 from 与 to。 */
    entities: Type.Array(Type.Object({id: Type.String(), label: Type.String()})),
    evidence: RefSchema,
    /** 依据那一段原文（截到 120 字）。 */
    quote: Type.String(),
    refs: Type.Array(RefSchema),
    decidedAt: Type.Union([Type.String(), Type.Null()]),
    undoable: Type.Boolean(),
});
const RevisionCounts = Type.Object({pending: Type.Integer(), adopted: Type.Integer(), rejected: Type.Integer(), closed: Type.Integer(), stale: Type.Integer()});
const RevisionWritten = Type.Object({revision: RevisionItemSchema, version: Type.Integer()});
const RevisionWriteErrors = {
    book_not_found: Type.Object({}),
    book_ambiguous: Type.Object({}),
    unsupported_format: Type.Object({}),
    invalid_params: Type.Object({}),
    revision_target_not_found: Type.Object({}),
    revision_not_candidate: Type.Object({}),
    revision_conflict: Type.Object({}),
    revision_not_found: Type.Object({}),
    evidence_invalid: Type.Object({}),
    entity_ambiguous: Type.Object({candidates: Type.Array(Type.Object({id: Type.String(), label: Type.String(), note: Type.String()}))}),
};
const WriteBook = {book: BookParams.book};

// ---- 方法清单 ----

const BookErrors = {book_not_found: Type.Object({}), book_ambiguous: Type.Object({}), position_out_of_range: Type.Object({}), invalid_params: Type.Object({})};
const EntityErrors = {...BookErrors, entity_not_found: Type.Object({}), entity_ambiguous: Type.Object({candidates: Type.Array(Type.Object({id: Type.String(), label: Type.String(), note: Type.String()}))})};
const PageErrors = {cursor_invalid: Type.Object({})};

export const STORY_METHODS = {
    "books.list": {input: Empty, output: Type.Object({books: Type.Array(BookSummary)}), effect: "read", errors: {invalid_params: Type.Object({})}},
    "book.import": {
        input: Type.Object({file: Type.String({minLength: 1}), title: Type.String({minLength: 1}), id: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({id: Type.String(), generation: Type.String()}),
        effect: "write",
        errors: {book_exists: Type.Object({}), unsupported_format: Type.Object({}), invalid_params: Type.Object({})},
    },
    "book.remove": {input: Type.Object({book: Type.String({minLength: 1})}, strict), output: Empty, effect: "write", errors: {book_not_found: Type.Object({}), unsupported_format: Type.Object({}), invalid_params: Type.Object({})}},
    "book.info": {input: Type.Object({...BookParams}, strict), output: BookInfo, effect: "read", errors: BookErrors},
    "book.stats": {input: Type.Object({...BookParams}, strict), output: BookStats, effect: "read", errors: BookErrors},
    "reading.get": {input: Type.Object({book: BookParams.book}, strict), output: ReadingState, effect: "read", errors: BookErrors},
    "reading.set": {
        input: Type.Object({book: BookParams.book, position: PositionInputSchema, view: Type.Unknown()}, strict),
        output: ReadingState,
        effect: "write",
        errors: {...BookErrors, state_too_large: Type.Object({}), unsupported_format: Type.Object({})},
    },
    "chapter.digest": {input: Type.Object({...BookParams, chapter: Type.Integer()}, strict), output: ChapterDigest, effect: "read", errors: {...BookErrors, beyond_position: Type.Object({})}},
    "entities.list": {
        input: Type.Object({...BookParams, ...PageParams, kind: Type.Optional(EntityKindSchema), query: Type.Optional(Type.String())}, strict),
        output: page(RosterItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "entity.card": {input: Type.Object({...BookParams, entity: Type.String({minLength: 1})}, strict), output: EntityCard, effect: "read", errors: EntityErrors},
    "entity.knowledge": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), state: Type.Optional(oneOf(KNOWLEDGE_STATES)), query: Type.Optional(Type.String())}, strict),
        output: page(KnowledgeItem),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "entity.statements": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), query: Type.Optional(Type.String()), maxTier: Type.Optional(TierSchema)}, strict),
        /** `tiers`：满足 `query` 的说法里 1、2、3 级各几条，不随 `maxTier` 与分页变；`total` 是按 `maxTier` 过滤后的。 */
        output: Type.Object({...page(StatementItem).properties, tiers: Type.Tuple([Type.Integer(), Type.Integer(), Type.Integer()])}),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "entity.episodes": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), query: Type.Optional(Type.String())}, strict),
        output: page(EpisodeBrief),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "entity.relations": {
        input: Type.Object({...BookParams, entity: Type.String({minLength: 1})}, strict),
        output: Type.Object({items: Type.Array(RelationListItem)}),
        effect: "read",
        errors: EntityErrors,
    },
    "entity.relation": {
        input: Type.Object({...BookParams, entity: Type.String({minLength: 1}), other: Type.String({minLength: 1})}, strict),
        output: RelationDetail,
        effect: "read",
        errors: EntityErrors,
    },
    "secrets.matrix": {input: Type.Object({...BookParams}, strict), output: SecretsMatrix, effect: "read", errors: BookErrors},
    "ledger.tracks": {input: Type.Object({...BookParams}, strict), output: Type.Object({tracks: Type.Array(LedgerTrack)}), effect: "read", errors: BookErrors},
    "ledger.track": {
        input: Type.Object({...BookParams, track: Type.String({minLength: 1}), owner: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({track: LedgerTrack, entries: Type.Array(LedgerEntry)}),
        effect: "read",
        errors: {...EntityErrors},
    },
    "questions.list": {
        input: Type.Object({...BookParams, ...PageParams, state: Type.Optional(QuestionState), query: Type.Optional(Type.String()), sort: Type.Optional(oneOf(["recent", "raised"] as const))}, strict),
        output: page(QuestionItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    timeline: {input: Type.Object({...BookParams, order: Type.Optional(oneOf(["story", "source"] as const))}, strict), output: Type.Object({points: Type.Array(TimelinePoint)}), effect: "read", errors: BookErrors},
    "episodes.list": {
        input: Type.Object({...BookParams, ...PageParams, arc: Type.Optional(Type.String({minLength: 1})), query: Type.Optional(Type.String())}, strict),
        output: page(EpisodeItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "arcs.list": {input: Type.Object({...BookParams}, strict), output: ArcsList, effect: "read", errors: BookErrors},
    "source.read": {
        input: Type.Object({...BookParams, from: PositionInputSchema, to: Type.Optional(PositionInputSchema)}, strict),
        output: Type.Object({paragraphs: Type.Array(SourceParagraph)}),
        effect: "read",
        errors: {...BookErrors, beyond_position: Type.Object({})},
    },
    "tier.explain": {
        input: Type.Object({book: BookParams.book, at: BookParams.at, id: Type.String({minLength: 1})}, strict),
        output: TierExplain,
        effect: "read",
        errors: {...BookErrors, record_not_found: Type.Object({})},
    },
    "source.records": {
        input: Type.Object({...BookParams, chapter: Type.Integer(), paragraph: Type.Integer()}, strict),
        output: Type.Object({records: Type.Array(RecordItem)}),
        effect: "read",
        errors: {...BookErrors, beyond_position: Type.Object({})},
    },
    search: {
        input: Type.Object({...BookParams, ...PageParams, query: Type.String({minLength: 1}), kinds: Type.Optional(Type.Array(SearchKind))}, strict),
        output: Type.Object({...page(SearchItem).properties, counts: Type.Object({entity: Type.Integer(), statement: Type.Integer(), source: Type.Integer()})}),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "graph.relations": {
        input: Type.Object({...BookParams, kinds: Type.Optional(Type.Array(EntityKindSchema)), minTogether: Type.Optional(Type.Integer({minimum: 1})), includeAnonymous: Type.Optional(Type.Boolean())}, strict),
        output: RelationGraph,
        effect: "read",
        errors: EntityErrors,
    },
    "graph.book": {
        input: Type.Object({...BookParams, grain: Type.Optional(oneOf(["arc", "episode"] as const)), types: Type.Optional(Type.Array(oneOf(["entity", "arc", "episode", "secret", "question"] as const)))}, strict),
        output: BookGraph,
        effect: "read",
        errors: BookErrors,
    },
    "graph.storyline": {input: Type.Object({...BookParams}, strict), output: Storyline, effect: "read", errors: BookErrors},
    "revisions.list": {
        input: Type.Object({...BookParams, ...PageParams, state: Type.Optional(oneOf(["pending", "adopted", "rejected", "closed", "stale", "processed"] as const)), source: Type.Optional(RevisionSource), entity: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({items: Type.Array(RevisionItemSchema), total: Type.Integer(), next: Type.Union([Type.String(), Type.Null()]), counts: RevisionCounts}),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "revisions.evidence": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), text: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: page(Type.Object({ref: RefSchema, text: Type.String(), names: Type.Array(Type.String())})),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "revisions.confirm": {input: Type.Object({...WriteBook, statement: Type.String({minLength: 1})}, strict), output: RevisionWritten, effect: "write", errors: RevisionWriteErrors},
    "revisions.reject": {input: Type.Object({...WriteBook, statement: Type.String({minLength: 1}), reason: Type.Optional(Type.String({minLength: 1}))}, strict), output: RevisionWritten, effect: "write", errors: RevisionWriteErrors},
    "revisions.link": {
        input: Type.Object({...WriteBook, a: Type.String({minLength: 1}), b: Type.String({minLength: 1}), evidence: Type.String({minLength: 1}), certainty: oneOf(["candidate", "certain"] as const)}, strict),
        output: RevisionWritten,
        effect: "write",
        errors: RevisionWriteErrors,
    },
    "revisions.kind": {input: Type.Object({...WriteBook, entity: Type.String({minLength: 1}), kind: EntityKindSchema, evidence: Type.String({minLength: 1})}, strict), output: RevisionWritten, effect: "write", errors: RevisionWriteErrors},
    "revisions.moveName": {
        input: Type.Object({...WriteBook, text: Type.String({minLength: 1}), from: Type.String({minLength: 1}), to: Type.String({minLength: 1}), evidence: Type.String({minLength: 1})}, strict),
        output: RevisionWritten,
        effect: "write",
        errors: RevisionWriteErrors,
    },
    "revisions.undo": {input: Type.Object({...WriteBook, revision: Type.String({minLength: 1})}, strict), output: RevisionWritten, effect: "write", errors: RevisionWriteErrors},
} as const;

// ---- 抽取（docs/specs/story/ingest.md 的“网页”） ----

const Costs = Type.Array(Type.Object({currency: Type.String(), amount: Type.Number()}));
/** 一组用量：有任何一次请求的用量拿不到时 `complete` 为 false，数值是下界。费用按币种分开。 */
const IngestUsage = Type.Object({input: Type.Integer(), output: Type.Integer(), cacheRead: Type.Integer(), costs: Costs, complete: Type.Boolean()});
const IngestStatusSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    state: oneOf(["running", "stopped", "done"] as const),
    /** 运行中由谁运行。 */
    runner: Type.Union([oneOf(["cli", "serve"] as const), Type.Null()]),
    stopReason: Type.Union([
        Type.Object({kind: Type.Literal("user")}),
        Type.Object({kind: Type.Literal("failed"), code: Type.String(), errorKind: Type.Optional(Type.String()), message: Type.String()}),
        Type.Object({kind: Type.Literal("exited")}),
        Type.Null(),
    ]),
    total: Type.Integer(),
    committed: Type.Integer(),
    /** 只在运行中：正在抽的章与步骤、正在等待的重试。 */
    current: Type.Union([
        Type.Object({
            chapter: Type.Union([Type.Integer(), Type.Null()]),
            step: Type.Union([oneOf(["recall", "beats", "draft", "review", "repair", "persona", "consolidation"] as const), Type.Null()]),
            retry: Type.Union([Type.Object({attempt: Type.Integer(), waitMs: Type.Number(), until: Type.String()}), Type.Null()]),
        }),
        Type.Null(),
    ]),
    thisRun: Type.Object({...IngestUsage.properties, ms: Type.Number()}),
    allRuns: Type.Object({...IngestUsage.properties, ms: Type.Number()}),
    /** 分子含失败与作废的尝试，分母是已提交的章数；还没有提交的章时为 null。 */
    average: Type.Union([Type.Object({ms: Type.Number(), costs: Costs}), Type.Null()]),
    chapters: Type.Array(Type.Object({chapter: Type.Integer(), title: Type.String(), ms: Type.Number(), usage: IngestUsage, dropped: Type.Integer()})),
    /** 这本书保存的开关。 */
    features: Features,
});
const IngestPlanSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    action: oneOf(["new", "resume", "append", "done"] as const),
    chapters: Type.Array(Type.Object({chapter: Type.Integer(), title: Type.String(), chars: Type.Integer()})),
    preambleChars: Type.Integer(),
    volumeLines: Type.Integer(),
    newChapters: Type.Integer(),
    /** 已提交到第几章。 */
    committed: Type.Integer(),
    /** 抽取会用的模型；配置读不出来、或没写抽取模型而问答的默认模型不能给抽取用时为 null（开始时得到 qa_unconfigured）。 */
    model: Type.Union([Type.Object({id: Type.String(), source: oneOf(["ingest.model", "model"] as const)}), Type.Null()]),
    /** 配置读得出来、但抽取没有能用的模型时的原因（例如“抽取要单独写模型”）；其余为 null。 */
    modelProblem: Type.Union([Type.String(), Type.Null()]),
    /** 生效的开关：新建时是请求值（没给的项为开），已有抽取记录时是保存的值。 */
    features: Features,
});
/** 请求里的开关：只在新建时生效；已有抽取记录时给了与保存值不同的项得到 invalid_params。 */
const FeaturesInput = {features: Type.Optional(Type.Object({ledger: Type.Optional(Type.Boolean()), secrets: Type.Optional(Type.Boolean())}, strict))};
/** 原文文件的字节，base64。 */
const SourceContent = {content: Type.String(), title: Type.Optional(Type.String({minLength: 1})), id: Type.Optional(Type.String({minLength: 1})), ...FeaturesInput};
const IngestErrors = {invalid_params: Type.Object({}), unsupported_format: Type.Object({}), book_exists: Type.Object({}), ingest_bad_text: Type.Object({}), ingest_text_changed: Type.Object({}), ingest_running: Type.Object({})};

/**
 * 抽取的方法只在独立服务里有：任务要跑在服务进程的抽取线程里，命令行用 `nbstory ingest`。所以不在 STORY_METHODS
 * 里，核心库的 api 不认它们。
 */
export const INGEST_METHODS = {
    "ingest.preview": {input: Type.Object(SourceContent, strict), output: IngestPlanSchema, effect: "read", errors: IngestErrors},
    "ingest.start": {
        input: Type.Union([Type.Object(SourceContent, strict), Type.Object({book: Type.String({minLength: 1}), ...FeaturesInput}, strict)]),
        output: Type.Object({id: Type.String(), action: oneOf(["new", "resume", "append", "done"] as const)}),
        effect: "write",
        errors: {...IngestErrors, book_not_found: Type.Object({}), qa_unconfigured: Type.Object({})},
    },
    /**
     * 导入一份 V9 记忆图文件（命令行 `nbstory import` 的网页版，t29）：`content` 是文件字节的 base64（JSON，或 gzip 压缩的
     * JSON）；书名不给时取文件里的书名。同 id 的书已存在是 `book_exists`，文件不是 V9 记忆图是 `unsupported_format`。
     */
    "book.importGraph": {
        input: Type.Object({content: Type.String(), title: Type.Optional(Type.String({minLength: 1})), id: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({id: Type.String()}),
        effect: "write",
        errors: {invalid_params: Type.Object({}), book_exists: Type.Object({}), unsupported_format: Type.Object({}), ingest_bad_text: Type.Object({})},
    },
    /**
     * 把随包的 Skill 装进外部 Agent 的用户级 Skill 目录（命令行 `nbstory skill install` 的网页版，t29）。只认 `claude`
     * 与 `codex` 两个固定位置，网页不能指定任意目录；目标已有不同内容的目录时是 `skill_exists`，`force` 才换掉。
     */
    "skill.install": {
        input: Type.Object({agent: oneOf(["claude", "codex"] as const), force: Type.Optional(Type.Boolean())}, strict),
        output: Type.Object({state: oneOf(["installed", "unchanged", "replaced"] as const), path: Type.String(), leftover: Type.Optional(Type.Object({path: Type.String(), code: Type.String()}))}),
        effect: "write",
        errors: {invalid_params: Type.Object({}), skill_exists: Type.Object({}), skill_target_invalid: Type.Object({}), skill_install_failed: Type.Object({})},
    },
    "ingest.stop": {input: Type.Object({book: Type.String({minLength: 1})}, strict), output: Empty, effect: "write", errors: {invalid_params: Type.Object({}), book_not_found: Type.Object({}), ingest_running: Type.Object({})}},
    "ingest.status": {
        input: Type.Object({book: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({books: Type.Array(IngestStatusSchema)}),
        effect: "read",
        errors: {invalid_params: Type.Object({}), book_not_found: Type.Object({})},
    },
} as const;

// ---- 网页问答与设置（docs/specs/story/qa.md 的“网页”） ----

const QaRefs = {book: Type.String({minLength: 1})};
/** 运行中或刚结束的一轮（服务进程内存里的，不是记录）。 */
const QaRunSchema = Type.Object({
    runId: Type.String(),
    conversation: Type.String(),
    /** 这一轮是对话的第几轮（从 1 数）。 */
    turn: Type.Integer({minimum: 1}),
    /** 开始时记录里有几轮：页面拿到的记录轮数不等于它时（命令行同时续问并先保存了），运行的这一轮不接在记录后面。 */
    baseTurns: Type.Integer({minimum: 0}),
    /** 运行开始时记录里的位置改动次数：和读到的记录对不上，说明位置被别处改过，这一轮不接进来。 */
    baseChanges: Type.Integer({minimum: 0}),
    /** 这一轮在会话日志里从哪一条开始。 */
    logFrom: Type.Integer({minimum: 1}),
    question: Type.String(),
    at: QaPositionSchema,
    mode: QaModeSchema,
    /** 这一轮用的模型，`服务商/模型名`。 */
    model: Type.String(),
    startedAt: Type.String(),
    state: oneOf(["running", "ended"] as const),
    /** 结束后的这一轮；运行中为 null。 */
    result: Type.Union([QaTurnSchema, Type.Null()]),
    /** 结束后记录有没有保存；运行中为 null。没保存时这一轮只在这里。 */
    saved: Type.Union([Type.Object({ok: Type.Literal(true)}), Type.Object({ok: Type.Literal(false), reason: Type.String(), message: Type.Optional(Type.String())}), Type.Null()]),
});
/** 会话日志的一条（nb-session 的 SessionEntry）；全读对话的第一条用户消息不带原文。 */
const LogEntrySchema = Type.Object({seq: Type.Integer({minimum: 1}), kind: Type.String()});
const QaRecordViewSchema = Type.Object({
    id: Type.String(),
    at: QaPositionSchema,
    mode: QaModeSchema,
    /** 作答方式；之前的记录按结构化给。 */
    answer: QaAnswerModeSchema,
    maxChapters: Type.Union([Type.Integer(), Type.Null()]),
    turns: Type.Array(QaTurnSchema),
    /** 下一问用的阅读位置（对话中途改过位置时有，t25）；没有时按最后一轮用的位置。 */
    currentAt: Type.Optional(QaPositionSchema),
    positionChanges: Type.Optional(Type.Integer({minimum: 0})),
    startedAt: Type.String(),
});

/** 每百万 token 的单价（nb-harness 的 `ModelPrice`）；目录里的带缓存写单价，配置里的没有。 */
const CatalogPriceSchema = Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Optional(Type.Number()), cacheWrite: Type.Optional(Type.Number()), currency: Type.String()});

/** 目录或自定义服务商里的一个模型（nb-harness 的 `CatalogModel`）；自定义模型没写的参数已按模型名从目录补上。 */
const CatalogModelSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    api: Type.String(),
    contextWindow: Type.Union([Type.Integer(), Type.Null()]),
    maxTokens: Type.Union([Type.Integer(), Type.Null()]),
    reasoning: Type.Boolean(),
    /** 能选的推理档；不支持推理或推理档不可控时为空。 */
    efforts: Type.Array(EffortSchema),
    images: Type.Boolean(),
    /** 未知时为 null（目录单价全为 0 的也算未知）。 */
    price: Type.Union([CatalogPriceSchema, Type.Null()]),
});
const CatalogProviderSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    source: oneOf(["catalog", "custom"] as const),
    /** 只认环境变量时能不能用（nb-harness 的 `ProviderAccess`）；自定义服务商是 `key`。 */
    access: oneOf(["keyless", "login", "key", "unsupported"] as const),
    /** 可以设的密钥变量，按查找的顺序。 */
    keyEnvs: Type.Array(Type.String()),
    /** 服务启动时有没有可用的密钥（自定义服务商按此刻的服务环境）。 */
    keySet: Type.Boolean(),
    models: Type.Array(CatalogModelSchema),
});
const SuggestionSchema = Type.Object({from: Type.String(), contextWindow: Type.Union([Type.Integer(), Type.Null()]), maxTokens: Type.Union([Type.Integer(), Type.Null()]), reasoning: Type.Boolean(), images: Type.Boolean()});
const QaErrors = {invalid_params: Type.Object({}), book_not_found: Type.Object({}), unsupported_format: Type.Object({})};
const ConfigState = {
    /** 配置文件此刻的摘要，`config.set` 时原样带回；文件不在时是 `absent`。 */
    digest: Type.String(),
    path: Type.String(),
    /** 配置里写到的每个密钥环境变量名，在服务进程的环境里有没有值。 */
    keys: Type.Record(Type.String(), Type.Boolean()),
};

/**
 * 网页问答与设置页的方法：一轮问答跑在服务进程里，运行中的进展经 `GET /api/qa/events` 推送（`QaFrame`），所以也
 * 只在独立服务里有，核心库的 api 不认它们。
 */
export const QA_METHODS = {
    "qa.list": {
        input: Type.Object(QaRefs, strict),
        output: Type.Object({
            conversations: Type.Array(
                Type.Object({
                    id: Type.String(),
                    question: Type.String(),
                    /** 记录里的轮数；首轮还在运行或没保存时为 0。 */
                    turns: Type.Integer({minimum: 0}),
                    /** 最后一轮的状态；首轮还在运行时为 null。 */
                    status: Type.Union([QaStatusSchema, Type.Null()]),
                    /** 对话开始时的阅读位置。 */
                    at: QaPositionSchema,
                    /** 下一问用的阅读位置（改过位置、或最后一轮用了别的位置时与 `at` 不同）。 */
                    currentAt: QaPositionSchema,
                    /** 整个对话出现过的最高位置：剧透警告按它判断，位置往回调不解除旧答案的警告。 */
                    highestAt: QaPositionSchema,
                    mode: QaModeSchema,
                    startedAt: Type.String(),
                    /** 最后一轮的开始时间。 */
                    updatedAt: Type.String(),
                    run: Type.Union([Type.Object({runId: Type.String(), state: oneOf(["running", "ended"] as const), saved: Type.Union([Type.Boolean(), Type.Null()])}), Type.Null()]),
                }),
            ),
            /** 读不成的记录：只能删除。 */
            broken: Type.Array(Type.Object({id: Type.String(), problem: Type.String()})),
        }),
        effect: "read",
        errors: QaErrors,
    },
    "qa.get": {
        input: Type.Object({...QaRefs, id: Type.String({minLength: 1})}, strict),
        output: Type.Object({
            /** 首轮还在运行或没保存时为 null。 */
            record: Type.Union([QaRecordViewSchema, Type.Null()]),
            log: Type.Union([Type.Object({ok: Type.Literal(true), entries: Type.Array(LogEntrySchema)}), Type.Object({ok: Type.Literal(false), problem: Type.String()})]),
            continuable: Type.Union([Type.Object({ok: Type.Literal(true)}), Type.Object({ok: Type.Literal(false), reason: Type.String()})]),
            run: Type.Union([QaRunSchema, Type.Null()]),
        }),
        effect: "read",
        errors: {...QaErrors, qa_record_not_found: Type.Object({}), qa_record_broken: Type.Object({})},
    },
    "qa.start": {
        input: Type.Object(
            {
                ...QaRefs,
                question: Type.String({minLength: 1}),
                /** 续问的对话；不给是新对话。 */
                conversation: Type.Optional(Type.String({minLength: 1})),
                /** 只在新对话时用；续问时写了是 invalid_params。 */
                mode: Type.Optional(QaModeSchema),
                /** 新对话是第一问的阅读位置；续问时是这一问要改成的位置（先写进会话，全读对话不能改，t25）。 */
                at: Type.Optional(PositionInputSchema),
                answer: Type.Optional(QaAnswerModeSchema),
                /** 这一轮的模型，必须在配置的候选里；不给时新对话用默认模型，续问接着用最近一轮的。 */
                model: Type.Optional(Type.String({minLength: 1})),
                /** 这一轮的推理档，必须是 `model` 支持的档，给它就要同时给 `model`；不给时按 qa.md 输出 40。 */
                thinking: Type.Optional(EffortSchema),
            },
            strict,
        ),
        output: Type.Object({conversation: Type.String(), runId: Type.String(), turn: Type.Integer({minimum: 1})}),
        effect: "write",
        errors: {...QaErrors, qa_record_not_found: Type.Object({}), qa_record_broken: Type.Object({}), position_out_of_range: Type.Object({}), qa_unconfigured: Type.Object({}), full_read_unavailable: Type.Object({}), qa_not_continuable: Type.Object({}), qa_busy: Type.Object({}), qa_position_fixed: Type.Object({}), qa_conflict: Type.Object({})},
    },
    /** 在对话中途改阅读位置（t25）：往会话里写提醒消息，不发模型请求；对话在运行时是 `qa_busy`。 */
    "qa.position": {
        input: Type.Object({...QaRefs, conversation: Type.String({minLength: 1}), at: PositionInputSchema}, strict),
        output: Type.Object({changed: Type.Boolean(), at: QaPositionSchema}),
        effect: "write",
        errors: {...QaErrors, qa_record_not_found: Type.Object({}), qa_record_broken: Type.Object({}), position_out_of_range: Type.Object({}), qa_not_continuable: Type.Object({}), qa_busy: Type.Object({}), qa_position_fixed: Type.Object({}), qa_conflict: Type.Object({})},
    },
    "qa.stop": {input: Type.Object({...QaRefs, conversation: Type.String({minLength: 1})}, strict), output: Empty, effect: "write", errors: {invalid_params: Type.Object({})}},
    "qa.remove": {
        input: Type.Object({...QaRefs, id: Type.String({minLength: 1})}, strict),
        output: Empty,
        effect: "write",
        errors: {...QaErrors, qa_record_not_found: Type.Object({}), qa_busy: Type.Object({})},
    },
    "config.get": {
        input: Empty,
        output: Type.Union([
            /** 没有配置文件：给一份起始配置。 */
            Type.Object({state: Type.Literal("absent"), config: Type.Unknown(), ...ConfigState}),
            Type.Object({state: Type.Literal("valid"), config: ConfigSchema, ...ConfigState}),
            /** 文件读不成或不合格式：只给原因（不回传原文：里面可能有贴错的密钥），可以整份重写。 */
            Type.Object({state: Type.Literal("invalid"), problem: Type.String(), ...ConfigState}),
        ]),
        effect: "read",
        errors: {invalid_params: Type.Object({})},
    },
    "config.set": {
        /** `config` 在服务端按配置的 schema 校验，失败给 invalid_params（说明里不带原值）。 */
        input: Type.Object({config: Type.Unknown(), expect: Type.String({minLength: 1})}, strict),
        output: Type.Object(ConfigState),
        effect: "write",
        errors: {invalid_params: Type.Object({}), config_conflict: Type.Object({}), qa_config_write_failed: Type.Object({})},
    },
    "models.catalog": {
        /** OMP 目录的全部服务商加配置里的自定义服务商（自定义的在前），给设置页与输入框选模型。 */
        input: Empty,
        output: Type.Object({providers: Type.Array(CatalogProviderSchema)}),
        effect: "read",
        errors: {invalid_params: Type.Object({})},
    },
    "models.discover": {
        /** 用对话框里正在编辑的值读这个服务的 `/models`，不读配置文件；只认 OpenAI 兼容的两种接口。 */
        input: Type.Object({api: oneOf(["openai-completions", "openai-responses"] as const), baseUrl: Type.String({minLength: 1}), apiKeyEnv: Type.String({minLength: 1, pattern: ENV_NAME_PATTERN})}, strict),
        output: Type.Object({
            state: oneOf(["found", "empty", "not_supported", "auth", "unreachable", "failed"] as const),
            status: Type.Union([Type.Integer(), Type.Null()]),
            message: Type.Union([Type.String(), Type.Null()]),
            /** 读到的模型；`suggested` 是按模型名在目录里找到的参照，界面显示为“自动”，不写进配置。 */
            models: Type.Array(Type.Object({id: Type.String(), name: Type.String(), suggested: Type.Union([SuggestionSchema, Type.Null()])})),
            /** 这个环境变量在服务的环境里有没有值。 */
            keySet: Type.Boolean(),
        }),
        effect: "read",
        errors: {invalid_params: Type.Object({})},
    },
    "config.test": {
        input: Empty,
        output: Type.Object({
            ok: Type.Boolean(),
            model: Type.String(),
            thinking: Type.Union([Type.String(), Type.Null()]),
            ms: Type.Number(),
            /** 没通过时的原因（模型错误已经遮盖过密钥）。 */
            error: Type.Union([Type.Object({kind: Type.String(), message: Type.String()}), Type.Null()]),
        }),
        effect: "read",
        errors: {invalid_params: Type.Object({}), qa_unconfigured: Type.Object({})},
    },
} as const;

export type QaMethods = typeof QA_METHODS;
export type QaMethod = keyof QaMethods;
export type QaRunView = Static<typeof QaRunSchema>;
export type QaRecordView = Static<typeof QaRecordViewSchema>;

/**
 * `GET /api/qa/events?book=&conversation=` 推送的帧（SSE 的 data 是它的 JSON）。订阅时先给一帧 `snapshot`：
 * 没有运行、或运行已经结束时服务端随即结束这条流；运行中之后按发生顺序推 `log`、`event`，最后一帧是 `ended`。
 */
export type QaFrame =
    | {type: "snapshot"; run: QaRunView | null; entries: readonly unknown[]}
    | {type: "log"; runId: string; entries: readonly unknown[]}
    | {type: "event"; runId: string; event: unknown}
    | {type: "ended"; run: QaRunView};

export type IngestMethods = typeof INGEST_METHODS;
export type IngestMethod = keyof IngestMethods;
export type IngestStatusView = Static<typeof IngestStatusSchema>;
export type IngestPlanView = Static<typeof IngestPlanSchema>;

/** 网页能调的全部方法：查询、抽取、问答与设置。 */
export type ViewerMethods = StoryMethods & IngestMethods & QaMethods;
export type ViewerMethod = keyof ViewerMethods;
export type ViewerParams<M extends ViewerMethod> = Static<ViewerMethods[M]["input"]>;
export type ViewerResult<M extends ViewerMethod> = Static<ViewerMethods[M]["output"]>;

export type StoryMethods = typeof STORY_METHODS;
export type StoryMethod = keyof StoryMethods;
export type StoryParams<M extends StoryMethod> = Static<StoryMethods[M]["input"]>;
export type StoryResult<M extends StoryMethod> = Static<StoryMethods[M]["output"]>;

export type PositionInput = Static<typeof PositionInputSchema>;
export type Ref = Static<typeof RefSchema>;
export type Tags = Static<typeof TagsSchema>;
export type NodeRef = Static<typeof NodeRefSchema>;
export type Awareness = Static<typeof AwarenessSchema>;
export type IdentityState = Static<typeof IdentityStateSchema>;
export type RelationNode = Static<typeof RelationNodeSchema>;
export type RelationEdge = Static<typeof RelationEdgeSchema>;

/**
 * 以后接进 NeuroBook 时插件通道用的同一份合同。独立服务与命令行不经过插件通道，只用 STORY_METHODS。
 */
export const storyContract = defineRemoteService({
    id: "nb-story/queries",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: STORY_METHODS,
});

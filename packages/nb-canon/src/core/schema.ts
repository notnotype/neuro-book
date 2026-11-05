/**
 * 世界里存的对象、修订与写入请求的形状（docs/specs/canon/model.md 输入与前置条件、revisions.md 输入与前置条件）。
 * 这些形状进世界日志，是持久化格式：只加字段，不改已有字段的含义。
 *
 * 对象里未知的字段原样保留：只用 `Check`，不 `Clean`。字段值（`fields` 里的值、补丁的 `value`）在这里是
 * `unknown`，按字段声明的校验在 components 里做，因为它取决于登记的类型。
 */

import {Type, type Static, type TSchema} from "typebox";
import {Compile} from "typebox/compile";

const Text = Type.String();
const Id = Type.String({minLength: 1});

export const PlacementSchema = Type.Union([
    Type.Object({kind: Type.Literal("prehistory"), order: Type.Number()}),
    Type.Object({kind: Type.Literal("chapter"), chapter: Id, key: Type.Number()}),
    Type.Object({kind: Type.Literal("unscheduled")}),
]);

export const ReadPositionSchema = Type.Union([
    Type.Object({kind: Type.Literal("initial")}),
    Type.Object({kind: Type.Literal("chapter"), chapter: Id, edge: Type.Union([Type.Literal("start"), Type.Literal("end")])}),
]);

export const AddressSchema = Type.Object({entry: Id, path: Text});

export const ActorSchema = Type.Union([
    Type.Object({kind: Type.Literal("author")}),
    Type.Object({kind: Type.Literal("agent"), session: Text}),
    Type.Object({kind: Type.Literal("task"), name: Text}),
    Type.Object({kind: Type.Literal("system")}),
]);

/**
 * 标注（model.md 输出 28）：`kind` 是登记的标注种类 id，`version` 是写入时登记的版本，其余的键是载荷，按种类登记的
 * schema 校验（components.md 输出 17）。种类不在或版本对不上时原样保留、只读，所以这里只管这两个键。
 */
export const MarkSchema = Type.Intersect([Type.Object({kind: Id, version: Type.Integer({minimum: 1})}), Type.Record(Type.String(), Type.Unknown())]);

/**
 * 讲述（model.md 输入的“讲述”表）。`id` 由程序在写入时补上，写入请求里新的讲述不带 id。按来源的必填项
 * （正文要章与原句，细纲要章与锚点，作者消息与界面要锚点）由写入时校验查（`invalid-telling`），这里只管形状。
 */
export const TellingSchema = Type.Object({
    id: Id,
    source: Type.Union([Type.Literal("chapter"), Type.Literal("outline"), Type.Literal("seed"), Type.Literal("message"), Type.Literal("ui"), Type.Literal("note")]),
    chapter: Type.Optional(Id),
    quote: Type.Optional(Text),
    nth: Type.Optional(Type.Integer({minimum: 1})),
    anchor: Type.Optional(Text),
    marks: Type.Optional(Type.Array(MarkSchema)),
});

export const BasisSchema = Type.Union([
    Type.Object({kind: Type.Literal("quote"), quote: Text}),
    Type.Object({kind: Type.Literal("derived"), check: Id}),
    Type.Object({kind: Type.Literal("estimate"), note: Text}),
    Type.Object({kind: Type.Literal("author")}),
]);

export const FieldKindSchema = Type.Union([Type.Literal("number"), Type.Literal("text"), Type.Literal("enum"), Type.Literal("boolean"), Type.Literal("list"), Type.Literal("image"), Type.Literal("ref")]);

const FieldDeclarationCore = {
    id: Id,
    label: Text,
    kind: FieldKindSchema,
    precision: Type.Optional(Type.Union([Type.Literal("exact"), Type.Literal("semantic")])),
    unit: Type.Optional(Text),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Union([Type.Number(), Id])),
    options: Type.Optional(Type.Array(Text)),
    retold: Type.Optional(Type.Boolean()),
    /** `ref` 与以引用为键的列表允许指向的条目种类（条目的 `type`）；没有时任何种类都行（components.md 输出 18）。 */
    targets: Type.Optional(Type.Array(Text)),
    /** 为 `ref` 时列表的元素 id 就是被引用的条目 id（components.md 输出 19）。 */
    keyedBy: Type.Optional(Type.Literal("ref")),
    /** 回溯时随回溯者保留（canon/worldlines.md 输出 7）。 */
    carry: Type.Optional(Type.Boolean()),
};

/** 字段声明；`item` 是列表元素的子字段声明，不再嵌套列表（components.md 输入与前置条件）。 */
export const FieldDeclarationSchema = Type.Object({...FieldDeclarationCore, item: Type.Optional(Type.Array(Type.Object(FieldDeclarationCore)))});

/** 贡献点 `canon.components` 的一条声明的形状（components.md 输入与前置条件的表）；更细的规则由登记时再判。 */
export const ComponentDeclarationSchema = Type.Object({
    id: Id,
    label: Type.String({minLength: 1}),
    namespace: Type.Optional(Text),
    version: Type.Optional(Type.Integer({minimum: 1})),
    fields: Type.Optional(Type.Array(FieldDeclarationSchema)),
    instanceFields: Type.Optional(Type.Boolean()),
    agentView: Type.Optional(Text),
    bookkeepingNotes: Type.Optional(Text),
    usageNotes: Type.Optional(Text),
}, {additionalProperties: false});

export const NamespaceDataSchema = Type.Object({
    type: Id,
    version: Type.Integer({minimum: 1}),
    enabled: Type.Boolean(),
    removed: Type.Optional(Type.Boolean()),
    fields: Type.Record(Type.String(), Type.Unknown()),
    declared: Type.Optional(Type.Array(FieldDeclarationSchema)),
});

export const BlockSchema = Type.Object({id: Id, source: Text});

export const EntryStateSchema = Type.Object({
    name: Text,
    aliases: Type.Array(Text),
    summary: Text,
    text: Type.Array(BlockSchema),
    data: Type.Record(Type.String(), NamespaceDataSchema),
    components: Type.Optional(Type.Array(Id)),
});

export const EntrySchema = Type.Object({
    id: Id,
    type: Text,
    parent: Type.Union([Id, Type.Null()]),
    folder: Text,
    order: Type.Number(),
    sameAs: Type.Optional(Id),
    appears: Type.Optional(PlacementSchema),
    init: EntryStateSchema,
    initBasis: Type.Optional(Type.Record(Type.String(), BasisSchema)),
    retold: Type.Optional(Type.Record(Type.String(), Type.Array(TellingSchema))),
    deleted: Type.Optional(Type.Boolean()),
});

export const PatchOpSchema = Type.Union([Type.Literal("set"), Type.Literal("add"), Type.Literal("note"), Type.Literal("listAdd"), Type.Literal("listRemove"), Type.Literal("aliasAdd"), Type.Literal("aliasRemove"), Type.Literal("replaceBlock"), Type.Literal("addBlock"), Type.Literal("removeBlock")]);

/**
 * 补丁。`value` 的形状随 `op`：`listAdd` 是整个元素（带 `id`），`listRemove` 是元素 id，`addBlock` 是
 * `{after: 块 id | null, source}`（`at` 指向新块 `text[新 id]`），`removeBlock` 不用它。
 */
export const PatchSchema = Type.Object({
    op: PatchOpSchema,
    at: AddressSchema,
    value: Type.Unknown(),
    basis: Type.Optional(BasisSchema),
    version: Type.Optional(Type.Integer({minimum: 1})),
});

export const LinkSchema = Type.Union([
    Type.Object({kind: Type.Literal("fulfills"), plan: Id}),
    Type.Object({kind: Type.Literal("replaces"), plan: Id}),
    Type.Object({kind: Type.Literal("splitFrom"), plan: Id, by: Id}),
]);

/**
 * 参与者（model.md 输出 29）：`who` 与 `label` 二者之一，由写入时校验查（`invalid-cast`）；`as` 是这一场用的马甲。
 * 没有 `cast` 表示“没记参与者”，空列表表示“记了，没有人”。
 */
export const CastMemberSchema = Type.Object({
    who: Type.Optional(Id),
    label: Type.Optional(Text),
    role: Type.Union([Type.Literal("present"), Type.Literal("mentioned")]),
    as: Type.Optional(Id),
});

export const StoryChangeSchema = Type.Object({
    id: Id,
    kind: Type.Union([Type.Literal("written"), Type.Literal("plan")]),
    text: Text,
    at: PlacementSchema,
    told: Type.Array(TellingSchema),
    involves: Type.Array(Id),
    lines: Type.Array(Id),
    links: Type.Array(LinkSchema),
    patches: Type.Array(PatchSchema),
    status: Type.Union([Type.Literal("active"), Type.Literal("held"), Type.Literal("undone")]),
    held: Type.Optional(Type.Object({reason: Type.Union([Type.Literal("conflict"), Type.Literal("unsure")]), note: Text, against: Type.Optional(AddressSchema)})),
    undoneReason: Type.Optional(Text),
    by: ActorSchema,
    marks: Type.Optional(Type.Array(MarkSchema)),
    /** 性质（model.md 输出 30）：没有时是 `event`；`fork` 随世界线加。 */
    nature: Type.Optional(Type.Union([Type.Literal("event"), Type.Literal("narration")])),
    cast: Type.Optional(Type.Array(CastMemberSchema)),
});

export const CheckSchema = Type.Object({
    id: Id,
    at: AddressSchema,
    value: Type.Number(),
    told: TellingSchema,
    place: PlacementSchema,
    anchor: Type.Optional(Type.Object({change: Id, side: Type.Union([Type.Literal("before"), Type.Literal("after")])})),
});

/** 决策挂的对象（model.md 输出 33）。 */
export const AboutSchema = Type.Union([
    Type.Object({kind: Type.Literal("entry"), id: Id}),
    Type.Object({kind: Type.Literal("change"), id: Id}),
    Type.Object({kind: Type.Literal("address"), at: AddressSchema}),
    Type.Object({kind: Type.Literal("chapter"), id: Id}),
    Type.Object({kind: Type.Literal("decision"), id: Id}),
    Type.Object({kind: Type.Literal("diagnostic"), id: Id, key: Type.Record(Type.String(), Type.Unknown()), version: Type.Integer({minimum: 1})}),
]);

/**
 * 决策（原“未决问题”，model.md 输入的“决策”表）。各状态必有的字段与允许的转换见 model.md 的“状态与转换”；
 * 出处 `source` 只由内核写（revisions.md 输出 21）。
 */
export const DecisionSchema = Type.Object({
    id: Id,
    text: Text,
    status: Type.Union([Type.Literal("pending"), Type.Literal("decided"), Type.Literal("superseded"), Type.Literal("dropped")]),
    about: Type.Array(AboutSchema),
    scope: Type.Optional(Type.Object({from: Type.Optional(Id), to: Type.Optional(Id)})),
    due: Type.Optional(Id),
    candidates: Type.Optional(Type.Array(Text)),
    suggestion: Type.Optional(Type.Object({conclusion: Text, reason: Type.Optional(Text), by: Type.Unknown()})),
    conclusion: Type.Optional(Text),
    reason: Type.Optional(Text),
    risks: Type.Optional(Text),
    constraints: Type.Optional(Type.Array(Text)),
    supersededBy: Type.Optional(Id),
    source: Type.Optional(Type.Unknown()),
    quote: Type.Optional(Text),
    hints: Type.Array(Type.Object({chapter: Id, quote: Text})),
    marks: Type.Optional(Type.Array(MarkSchema)),
});

export const SuggestionSchema = Type.Object({
    id: Id,
    cause: Id,
    target: Type.Union([
        Type.Object({kind: Type.Literal("chapter"), chapter: Id}),
        Type.Object({kind: Type.Literal("outline"), chapter: Id}),
        Type.Object({kind: Type.Literal("entryText"), entry: Id, block: Id}),
    ]),
    group: Text,
    before: Text,
    after: Type.Union([Text, Type.Null()]),
    reason: Text,
    judgment: Type.Union([Type.Literal("sure"), Type.Literal("ask"), Type.Literal("notThisOne")]),
    found: Type.Union([Type.Literal("linked"), Type.Literal("agent")]),
    status: Type.Union([Type.Literal("open"), Type.Literal("applied"), Type.Literal("declined")]),
});

export const ObjectKindSchema = Type.Union([Type.Literal("entry"), Type.Literal("change"), Type.Literal("check"), Type.Literal("decision"), Type.Literal("suggestion")]);

export const ObjectRefSchema = Type.Object({kind: ObjectKindSchema, id: Id});

export const FieldChangeSchema = Type.Object({path: Text, before: Type.Optional(Type.Unknown()), after: Type.Optional(Type.Unknown())});

export const OpSchema = Type.Union([
    Type.Object({ref: ObjectRefSchema, kind: Type.Literal("create"), after: Type.Unknown()}),
    Type.Object({ref: ObjectRefSchema, kind: Type.Literal("modify"), fields: Type.Array(FieldChangeSchema)}),
    Type.Object({ref: ObjectRefSchema, kind: Type.Literal("delete"), before: Type.Unknown()}),
    Type.Object({kind: Type.Literal("chapters"), before: Type.Array(Id), after: Type.Array(Id)}),
]);

/** 带来的变化：只存结构化的位置与地址（revisions.md 输出 6）。 */
export const ImpactSchema = Type.Object({
    where: Type.Optional(ReadPositionSchema),
    pendingResolved: Type.Array(Text),
    pendingAdded: Type.Array(Text),
    values: Type.Array(Type.Object({at: AddressSchema, before: Type.Optional(Type.Unknown()), after: Type.Optional(Type.Unknown())})),
    broken: Type.Array(Id),
});

export const RevisionWhatSchema = Type.Union([Type.Literal("opening"), Type.Literal("plan"), Type.Literal("bookkeeping"), Type.Literal("edit"), Type.Literal("creative"), Type.Literal("resolve"), Type.Literal("suggest"), Type.Literal("revert"), Type.Literal("reorder")]);

/**
 * 作者来源（revisions.md 输出 21）：宿主判断作者确实说了、确认了，按将要发出的请求填 `binds` 并签名。`binds` 由
 * `authorizationBinds` 算（宿主与内核共用一个函数），签名覆盖除 `signature` 以外的全部字段，由宿主注入的校验验。
 */
export const BindsSchema = Type.Object({project: Text, requestId: Text, request: Text, decision: Id, transition: Text, fields: Text});
export const AuthorSourceSchema = Type.Object({
    author: Text,
    via: Type.Union([Type.Literal("message"), Type.Literal("confirm")]),
    id: Id,
    session: Type.Optional(Text),
    quote: Text,
    range: Type.Optional(Type.Unknown()),
    time: Text,
    binds: BindsSchema,
    signature: Text,
});
/** 写入请求与还原请求里的一项授权：哪条决策（新建的写临时 id）、哪种转换、来源。 */
export const AuthorizationSchema = Type.Object({decision: Id, transition: Text, source: AuthorSourceSchema});

export const RevisionSchema = Type.Object({
    id: Id,
    version: Type.Integer({minimum: 1}),
    requestId: Text,
    requestDigest: Text,
    time: Text,
    by: ActorSchema,
    what: Text,
    title: Text,
    why: Type.Optional(Text),
    chapter: Type.Optional(Id),
    baseVersion: Type.Integer({minimum: 0}),
    ops: Type.Array(OpSchema),
    notes: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    reverts: Type.Optional(Type.Array(Id)),
    /** 这次修订接受的作者授权（revisions.md 输出 21）：普通写入的来自请求，还原的来自还原请求。 */
    authorizations: Type.Optional(Type.Array(AuthorizationSchema)),
    impact: ImpactSchema,
    idMap: Type.Optional(Type.Record(Type.String(), Id)),
    /**
     * 这次修订新写或改过的引用（revisions.md 的“存下来的修订”）：发布时按当时的登记算好；依赖与改动记录按条目筛只读它，
     * 插件停用以后结果也不变。
     */
    refs: Type.Optional(Type.Array(Type.Object({path: Text, target: Type.Object({kind: Type.Union([Type.Literal("entry"), Type.Literal("change"), Type.Literal("line"), Type.Literal("decision"), Type.Literal("check")]), id: Id})}))),
});

export const ReadSchema = Type.Object({at: AddressSchema, position: ReadPositionSchema, value: Type.Unknown(), origin: Type.Unknown()});

export const WriteRequestSchema = Type.Object({
    requestId: Type.String({minLength: 1}),
    by: ActorSchema,
    what: RevisionWhatSchema,
    title: Text,
    why: Type.Optional(Text),
    chapter: Type.Optional(Id),
    baseVersion: Type.Integer({minimum: 0}),
    puts: Type.Array(Type.Object({ref: ObjectRefSchema, after: Type.Unknown()})),
    reads: Type.Optional(Type.Array(ReadSchema)),
    notes: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    authorizations: Type.Optional(Type.Array(AuthorizationSchema)),
});

export type Placement = Static<typeof PlacementSchema>;
export type ReadPosition = Static<typeof ReadPositionSchema>;
export type Address = Static<typeof AddressSchema>;
export type Actor = Static<typeof ActorSchema>;
export type Mark = Static<typeof MarkSchema>;
export type Binds = Static<typeof BindsSchema>;
export type AuthorSource = Static<typeof AuthorSourceSchema>;
export type Authorization = Static<typeof AuthorizationSchema>;
export type CastMember = Static<typeof CastMemberSchema>;
export type Telling = Static<typeof TellingSchema>;
/** 写入请求里的讲述：新的不带 id（model.md 输出 25）。 */
export type TellingDraft = Omit<Telling, "id"> & {readonly id?: string};
export type Basis = Static<typeof BasisSchema>;
export type FieldKind = Static<typeof FieldKindSchema>;
export type FieldDeclaration = Static<typeof FieldDeclarationSchema>;
export type NamespaceData = Static<typeof NamespaceDataSchema>;
export type Block = Static<typeof BlockSchema>;
export type EntryState = Static<typeof EntryStateSchema>;
export type Entry = Static<typeof EntrySchema>;
export type PatchOp = Static<typeof PatchOpSchema>;
export type Patch = Static<typeof PatchSchema>;
export type Link = Static<typeof LinkSchema>;
export type StoryChange = Static<typeof StoryChangeSchema>;
/** 写入请求里的剧情变更：讲述可以不带 id。 */
export type StoryChangeDraft = Omit<StoryChange, "told"> & {told: TellingDraft[]};
export type Check = Static<typeof CheckSchema>;
export type About = Static<typeof AboutSchema>;
export type Decision = Static<typeof DecisionSchema>;
export type Suggestion = Static<typeof SuggestionSchema>;
export type ObjectKind = Static<typeof ObjectKindSchema>;
export type ObjectRef = Static<typeof ObjectRefSchema>;
export type Op = Static<typeof OpSchema>;
export type Impact = Static<typeof ImpactSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type WriteRequest = Static<typeof WriteRequestSchema>;

/** 每种对象的 schema，按 `ObjectRef.kind` 取。 */
export const OBJECT_SCHEMAS = {entry: EntrySchema, change: StoryChangeSchema, check: CheckSchema, decision: DecisionSchema, suggestion: SuggestionSchema} as const;

export interface SchemaProblem {
    readonly path: string;
    readonly message: string;
}

const compiled = new Map<TSchema, ReturnType<typeof Compile<TSchema>>>();

/** 按 schema 校验；合格返回 null，否则返回前几处问题（JSON 指针与说明）。 */
export function schemaProblems(schema: TSchema, value: unknown): SchemaProblem[] | null {
    let check = compiled.get(schema);
    if (check === undefined) compiled.set(schema, (check = Compile(schema)));
    if (check.Check(value)) return null;
    return [...check.Errors(value)].slice(0, 5).map((error) => ({path: error.instancePath === "" ? "/" : error.instancePath, message: error.message}));
}

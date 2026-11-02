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

export const TellingSchema = Type.Object({
    source: Type.Union([Type.Literal("chapter"), Type.Literal("outline"), Type.Literal("seed"), Type.Literal("message"), Type.Literal("ui"), Type.Literal("note")]),
    chapter: Type.Optional(Id),
    quote: Text,
});

export const BasisSchema = Type.Union([
    Type.Object({kind: Type.Literal("quote"), quote: Text}),
    Type.Object({kind: Type.Literal("derived"), check: Id}),
    Type.Object({kind: Type.Literal("estimate"), note: Text}),
    Type.Object({kind: Type.Literal("author")}),
]);

export const FieldKindSchema = Type.Union([Type.Literal("number"), Type.Literal("text"), Type.Literal("enum"), Type.Literal("boolean"), Type.Literal("list"), Type.Literal("image")]);

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
};

/** 字段声明；`item` 是列表元素的子字段声明，不再嵌套列表（components.md 输入与前置条件）。 */
export const FieldDeclarationSchema = Type.Object({...FieldDeclarationCore, item: Type.Optional(Type.Array(Type.Object(FieldDeclarationCore)))});

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
});

export const CheckSchema = Type.Object({
    id: Id,
    at: AddressSchema,
    value: Type.Number(),
    told: TellingSchema,
    place: PlacementSchema,
    anchor: Type.Optional(Type.Object({change: Id, side: Type.Union([Type.Literal("before"), Type.Literal("after")])})),
});

export const QuestionSchema = Type.Object({
    id: Id,
    text: Text,
    quote: Type.Optional(Text),
    about: Type.Optional(
        Type.Union([
            Type.Object({kind: Type.Literal("entry"), id: Id}),
            Type.Object({kind: Type.Literal("change"), id: Id}),
            Type.Object({kind: Type.Literal("address"), at: AddressSchema}),
        ]),
    ),
    status: Type.Union([Type.Literal("open"), Type.Literal("answered"), Type.Literal("dropped")]),
    answer: Type.Optional(Text),
    hints: Type.Array(Type.Object({chapter: Id, quote: Text})),
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

export const ObjectKindSchema = Type.Union([Type.Literal("entry"), Type.Literal("change"), Type.Literal("check"), Type.Literal("question"), Type.Literal("suggestion")]);

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
    impact: ImpactSchema,
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
});

export type Placement = Static<typeof PlacementSchema>;
export type ReadPosition = Static<typeof ReadPositionSchema>;
export type Address = Static<typeof AddressSchema>;
export type Actor = Static<typeof ActorSchema>;
export type Telling = Static<typeof TellingSchema>;
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
export type Check = Static<typeof CheckSchema>;
export type Question = Static<typeof QuestionSchema>;
export type Suggestion = Static<typeof SuggestionSchema>;
export type ObjectKind = Static<typeof ObjectKindSchema>;
export type ObjectRef = Static<typeof ObjectRefSchema>;
export type Op = Static<typeof OpSchema>;
export type Impact = Static<typeof ImpactSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type WriteRequest = Static<typeof WriteRequestSchema>;

/** 每种对象的 schema，按 `ObjectRef.kind` 取。 */
export const OBJECT_SCHEMAS = {entry: EntrySchema, change: StoryChangeSchema, check: CheckSchema, question: QuestionSchema, suggestion: SuggestionSchema} as const;

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

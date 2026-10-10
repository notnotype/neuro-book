/**
 * `HarnessConfig` 的形状（docs/specs/harness/config.md 的“输入与前置条件”）。TypeBox schema 负责字段与类型，
 * `additionalProperties: false` 让未知字段成为问题而不是被静默忽略；唯一性、模型引用语法这类 schema 说不清的规则在 validate.ts。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

const ID_PATTERN = "^[A-Za-z0-9._-]+$";
export const MODEL_REF_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

const Id = Type.String({pattern: ID_PATTERN});
/** 空字符串按未给出处理，所以这里允许空串，由 validate.ts 规范化掉。 */
const ModelRefOrEmpty = Type.String();

const ProviderModelConfig = Type.Object(
    {
        id: Id,
        name: Type.Optional(Type.String({minLength: 1})),
        contextWindow: Type.Optional(Type.Integer({minimum: 1})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1})),
        input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
        reasoning: Type.Optional(Type.Boolean()),
        supportsTools: Type.Optional(Type.Boolean()),
    },
    {additionalProperties: false},
);

const ProviderConfig = Type.Object(
    {
        id: Id,
        api: Type.String({minLength: 1}),
        baseUrl: Type.String({pattern: "^https?://"}),
        headers: Type.Optional(Type.Record(Type.String(), Type.String())),
        models: Type.Array(ProviderModelConfig),
    },
    {additionalProperties: false},
);

const RoleItem = Type.Object(
    {
        id: Id,
        axis: Type.Union([Type.Literal("gradient"), Type.Literal("specialist")]),
        name: Type.String({minLength: 1}),
        description: Type.String(),
        modelKey: Type.Union([ModelRefOrEmpty, Type.Null()]),
    },
    {additionalProperties: false},
);

const ProfileConfig = Type.Object({model: Type.Optional(ModelRefOrEmpty), settings: Type.Optional(Type.Unknown())}, {additionalProperties: false});

export const HarnessConfigSchema = Type.Object(
    {
        providers: Type.Optional(Type.Array(ProviderConfig)),
        models: Type.Optional(Type.Object({defaultModel: Type.Optional(ModelRefOrEmpty)}, {additionalProperties: false})),
        roles: Type.Optional(Type.Object({items: Type.Optional(Type.Array(RoleItem))}, {additionalProperties: false})),
        profiles: Type.Optional(Type.Record(Type.String({pattern: ID_PATTERN}), ProfileConfig)),
        approval: Type.Optional(
            Type.Object(
                {
                    mode: Type.Optional(Type.Union([Type.Literal("always-ask"), Type.Literal("write"), Type.Literal("auto"), Type.Literal("yolo")])),
                    tools: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("ask")]))),
                },
                {additionalProperties: false},
            ),
        ),
    },
    {additionalProperties: false},
);

export type HarnessConfigInput = Static<typeof HarnessConfigSchema>;

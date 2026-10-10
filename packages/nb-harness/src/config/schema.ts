/**
 * `HarnessConfig` 的形状（docs/specs/harness/config.md 的“输入与前置条件”）。TypeBox schema 负责字段与类型，
 * `additionalProperties: false` 让未知字段成为问题而不是被静默忽略；唯一性、模型引用语法这类 schema 说不清的规则在 validate.ts。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

const ID_PATTERN = "^[A-Za-z0-9._-]+$";
/** 服务 id 是受限字符集；模型 id 是第一个 `/` 之后的全部（OMP 目录里的模型 id 本身带 `/`、`:`、`~`），只要求非空且没有空白与控制字符。 */
export const MODEL_ID_PATTERN = "^[^\\s\\p{Cc}]+$";
export const MODEL_REF_PATTERN = /^[A-Za-z0-9._-]+\/[^\s\p{Cc}]+$/u;

const Id = Type.String({pattern: ID_PATTERN});
/** 空字符串按未给出处理，所以这里允许空串，由 validate.ts 规范化掉。 */
const ModelRefOrEmpty = Type.String();

const ProviderModelConfig = Type.Object(
    {
        id: Type.String({pattern: MODEL_ID_PATTERN}),
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
        api: Type.String({pattern: "^[a-z0-9-]+$"}), // OMP 的 Api 名；能不能派发由 models 解析时判断
        baseUrl: Type.String(), // 协议与主机名在 validate.ts 的规则里查，schema 只定形状，免得同一字段报两条
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
        // 键的格式在 validate.ts 的规则里查：Record 的键 pattern 会让不匹配的键跳过值的校验，问题就列不全。
        profiles: Type.Optional(Type.Record(Type.String(), ProfileConfig)),
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

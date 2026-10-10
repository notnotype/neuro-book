/**
 * 主机：节点类型、数据源与字段的注册表，加上用它渲染 Profile 的能力。每个主机独立，没有全局注册表。
 * `prepare` 拷一份注册表快照放进准备结果，所以之后的注册与 dispose 不影响已准备好的 Profile（Spec 输出 1）。
 */

import type {TSchema} from "typebox";
import {BUILTIN_DEFINITIONS} from "./builtin/builtin";
import {fieldDefinitionProblem, nodeDefinitionProblem, sourceDefinitionProblem} from "./definitions";
import {RESERVED_IDS} from "./nodes";
import {isPrepared, prepare, refresh} from "./prepare";
import type {Prepared} from "./prepare";
import {renderAppending, renderRequest, renderSeeds, renderSystem} from "./render";
import type {FieldDefinition, NodeTypeDefinition, PreparedProfile, ProfileHost, ProfileResult, SourceDefinition} from "./types";

function register<T extends {id: string}>(table: Map<string, T>, definition: T, problem: string | null): ProfileResult<{dispose(): void}> {
    if (problem !== null) return {ok: false, code: "invalid-definition", detail: problem, diagnostics: []};
    if (RESERVED_IDS.has(definition.id)) return {ok: false, code: "reserved-node", detail: `${definition.id} 是布局节点或 Fragment，由本模块固定`, diagnostics: []};
    if (table.has(definition.id)) return {ok: false, code: "duplicate-registration", detail: `${definition.id} 已注册`, diagnostics: []};
    table.set(definition.id, definition);
    return {
        ok: true,
        value: {
            dispose: () => {
                if (table.get(definition.id) === definition) table.delete(definition.id);
            },
        },
    };
}

function asPrepared(value: PreparedProfile): Prepared {
    if (!isPrepared(value)) throw new TypeError("不是本模块 prepare 返回的准备结果");
    return value;
}

export function createProfileHost(): ProfileHost {
    const nodeTypes = new Map<string, NodeTypeDefinition>();
    const sourceTypes = new Map<string, SourceDefinition>();
    const fieldTypes = new Map<string, TSchema>();
    const fields = new Map<string, FieldDefinition>();
    for (const definition of BUILTIN_DEFINITIONS) {
        const result = register(nodeTypes, definition, nodeDefinitionProblem(definition));
        if (!result.ok) throw new Error(`内置节点 ${definition.id} 的定义不合规则：${result.detail}`);
    }
    return {
        registerNodeType: (definition) => register(nodeTypes, definition, nodeDefinitionProblem(definition)),
        registerSource: (definition) => register(sourceTypes, definition, sourceDefinitionProblem(definition)),
        registerField: (definition) => {
            const result = register(fields, definition, fieldDefinitionProblem(definition));
            if (!result.ok) return result;
            fieldTypes.set(definition.id, definition.schema);
            return {
                ok: true,
                value: {
                    dispose: () => {
                        result.value.dispose();
                        if (!fields.has(definition.id)) fieldTypes.delete(definition.id);
                    },
                },
            };
        },
        prepare: (profile, input) => prepare({nodeTypes, sourceTypes, fieldTypes}, profile, input),
        refresh: (prepared, input) => refresh(asPrepared(prepared), input),
        renderSeeds: (prepared, occasion) => renderSeeds(asPrepared(prepared), occasion),
        renderAppending: (prepared, input) => renderAppending(asPrepared(prepared), input),
        renderRequest: (prepared, input) => renderRequest(asPrepared(prepared), input),
        renderSystem: (prepared) => renderSystem(asPrepared(prepared)),
    };
}

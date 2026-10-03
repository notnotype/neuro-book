/** Variable definition authoring 的唯一稳定入口。 */
export {Type} from "typebox";
export type {Static, TSchema} from "typebox";
export type {
    DefineVariableInput,
    VariableDefinition,
    VariableJsonValue,
} from "nbook/variable-sdk/contracts";

import type {TSchema} from "typebox";
import type {DefineVariableInput, VariableDefinition} from "nbook/variable-sdk/contracts";

/** 定义 Workspace Root `.nbook` 下的 global variable；不执行宿主 normalize。 */
export function defineWorkspaceRootVariable<const TSchemaValue extends TSchema>(
    input: DefineVariableInput<TSchemaValue>,
): VariableDefinition<TSchemaValue> {
    return {...input, namespace: "global"};
}

/** 定义单个 Project Workspace 下的 project variable；不执行宿主 normalize。 */
export function defineProjectVariable<const TSchemaValue extends TSchema>(
    input: DefineVariableInput<TSchemaValue>,
): VariableDefinition<TSchemaValue> {
    return {...input, namespace: "project"};
}

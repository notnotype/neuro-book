import type {TSchema} from "typebox";

/** Variable authoring 允许持久化的 JSON 值。 */
export type VariableJsonValue =
    | null
    | boolean
    | number
    | string
    | VariableJsonValue[]
    | {[key: string]: VariableJsonValue};

export type VariableNamespace = "client" | "global" | "project" | "session";
export type VariableWriter = "frontend" | "agent" | "user";
export type VariableWriteMode = "patch" | "replace";

/** Workspace/Project definition 文件可声明的稳定结构。 */
export type VariableDefinition<TSchemaValue extends TSchema = TSchema> = {
    namespace: VariableNamespace;
    key: string;
    schema: TSchemaValue;
    title?: string;
    summary?: string;
    default?: VariableJsonValue;
    readable?: boolean;
    writableBy?: VariableWriter[];
    writeMode?: VariableWriteMode;
};

/** 固定 namespace helper 的输入；namespace 由 helper 决定。 */
export type DefineVariableInput<TSchemaValue extends TSchema = TSchema> = Omit<VariableDefinition<TSchemaValue>, "namespace">;

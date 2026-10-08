/**
 * `nbook.storage` 的服务键与远程服务合同（docs/specs/storage/persistence.md）。
 *
 * 两份远程合同的方法与事件相同，只是分区不同：`nbook.storage/user` 由服务端实例提供，`nbook.storage/project`
 * 由项目实例提供。调用方身份（owner 与客户端身份）由内核填写，输入里没有这些字段。分区拥有者一侧的失败统一
 * 以业务失败码 `storage-failed` 返回，详情里带 Storage 的失败码：Storage 的 `denied`、`unavailable`、
 * `unknown-outcome` 与路由层失败码同名，不能直接声明为业务失败码。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import {STORAGE_FAILURES} from "nbook/shared/storage";
import type {StorageService} from "nbook/shared/storage";

/** 插件依赖它取得按调用方生成的 Storage 服务。 */
export const storageKey: ServiceKey<StorageService> = defineServiceKey<StorageService>("nbook.storage/storage");

export const StorageFailureSchema = Type.Enum(STORAGE_FAILURES);

const NullableString = Type.Union([Type.String(), Type.Null()]);

/** 记录描述在链路上的形状；更细的规则由分区拥有者用 `descriptorProblem` 再核对一次。 */
export const RecordDescriptorSchema = Type.Object(
    {
        key: Type.String(),
        scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
        locality: Type.Union([Type.Literal("local"), Type.Literal("shared")]),
        version: Type.Integer(),
        keyed: Type.Boolean(),
        maxBytes: Type.Integer(),
        schema: Type.Unknown(),
    },
    {additionalProperties: false},
);

export const RecordSnapshotSchema = Type.Union([
    Type.Object({status: Type.Literal("missing"), revision: NullableString}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("ok"), value: Type.Unknown(), revision: Type.String()}, {additionalProperties: false}),
    Type.Object({status: Type.Union([Type.Literal("corrupt"), Type.Literal("unsupported-version")]), revision: Type.String(), detail: Type.String()}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("error"), code: StorageFailureSchema, detail: Type.String()}, {additionalProperties: false}),
]);

const StorageFailedDetail = Type.Object({code: StorageFailureSchema, detail: Type.String()}, {additionalProperties: false});
const failures = {"storage-failed": StorageFailedDetail};
const Address = {record: RecordDescriptorSchema, resource: Type.String()};
const Written = Type.Object({revision: Type.String()}, {additionalProperties: false});

const methods = {
    /** 登记描述并核对本调用方能不能用这条记录；不读值。 */
    open: {input: Type.Object(Address, {additionalProperties: false}), output: Type.Null(), effect: "read", errors: failures},
    read: {input: Type.Object(Address, {additionalProperties: false}), output: RecordSnapshotSchema, effect: "read"},
    save: {input: Type.Object({...Address, value: Type.Unknown(), expect: NullableString}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
    remove: {input: Type.Object({...Address, expect: NullableString}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
    reset: {input: Type.Object({...Address, value: Type.Unknown(), expect: NullableString}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
} as const;

/** 订阅先推一次当前快照，之后推送分区拥有者进程里对这条记录的每次写入。 */
const events = {changes: {filter: Type.Object(Address, {additionalProperties: false}), payload: RecordSnapshotSchema}} as const;

export const userStorageContract = defineRemoteService({id: "nbook.storage/user", version: 1, provider: "server", callers: ["browser", "tui", "project"], methods, events});

export const projectStorageContract = defineRemoteService({id: "nbook.storage/project", version: 1, provider: "project", callers: ["browser", "tui"], methods, events});

export type StorageContract = typeof userStorageContract | typeof projectStorageContract;

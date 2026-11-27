/**
 * 账号合同里不带 TypeBox 运行时的部分：路径前缀与路径、失败码、`social_error` 的码与参数名、字段规则、角色与上游名、
 * 管理列表的筛选项与审计的动作名，
 * 以及全部类型（只作类型转出，编译后不留导入）。官方站前端只从这里导入（`nb-site-web` 的 `tests/boundary.test.ts`）。
 *
 * 为什么另开一个入口：包入口转出的 schema 是模块顶层的 `Type.Object(...)` 调用，打包器判断不了它们没有副作用，只用到一个常量
 * 也会把这些调用连同 TypeBox 的运行时打进访客第一屏要下载的入口块（w00037 t10 B2 审查第 11 条：入口块 gzip 73.1 KB，
 * 改从这里导入后 59.1 KB）。给包加 `"sideEffects": false` 不够：没用到的模块去掉了，用到的 `./fields` 里与常量同文件的 schema 还在，
 * TypeBox 的运行时跟着留下。这里转出的文件都不导入 TypeBox，`constants.test.ts` 顺着
 * 导入检查；前端要新的常量时，先把它挪进这样的文件，不从这里转出带 schema 的模块。
 */

export * from "./account-constants";
export * from "./admin-constants";
export * from "./failure-codes";
export * from "./field-rules";
export * from "./path-constants";

export type * from "./account";
export type * from "./admin";
export type * from "./errors";
export type * from "./fields";
export type * from "./oauth";
export type * from "./paths";
export type * from "./social";
export type * from "./time";

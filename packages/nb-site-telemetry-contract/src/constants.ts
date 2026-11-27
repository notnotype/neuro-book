/**
 * 统计合同里不带 TypeBox 运行时的部分：站点地址上的路径前缀，以及写入口与收集清单的类型（只作类型转出，编译后不留导入）。
 * 官方站前端只从这里导入（`nb-site-web` 的 `tests/boundary.test.ts`）。
 *
 * 为什么另开一个入口（与账号合同包的 `./constants` 同一种做法）：包入口转出的写入口与收集清单在模块顶层调用 `Type.Object(...)`，
 * 打包器判断不了这些调用没有副作用，前端只取一个路径前缀也会把它们连同 TypeBox 的运行时打进看板的块（w00037 t10 B5，量过多约
 * 20 KB）。这里转出的文件都不导入 TypeBox，`constants.test.ts` 顺着运行时导入检查；前端要新的常量时，先把它挪进这样的文件，
 * 不从这里转出带 schema 的模块。
 */

export * from "./path-constants";

export type * from "./ingest";
export type * from "./manifest/types";

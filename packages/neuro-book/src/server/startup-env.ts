/**
 * 进程启动时的环境快照：`nbook.models` 的 `env:<变量名>` 只认它（docs/specs/models/service.md 输出 1，口径同 ADR 0032）。
 *
 * OMP 的 `pi-utils` 被导入时会把家目录、`~/.omp`、`~/.omp/agent` 等处的 `.env` 并进 `process.env`，那些不算；所以这份
 * 快照要在任何导入 OMP 的模块求值之前拍下。ESM 按导入顺序先求值第一条导入的整棵依赖，本模块不导入任何东西，又是每个
 * 能起服务端的入口（`main.ts`、`development-main.ts`、`testing/fixture-entry.ts`、`cli/main.ts`）的第一条导入，所以先于
 * 它们后面的导入求值。新增服务端入口时同样把它放在第一条，第二条是 `omp-process.ts`。
 */

export const startupEnv: Readonly<Record<string, string | undefined>> = Object.freeze({...process.env});

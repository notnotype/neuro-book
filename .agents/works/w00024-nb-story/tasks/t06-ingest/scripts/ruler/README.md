# 尺子（验收 11）

20 章 53 条关键记录的尺子，从 w00005 t33（`.worktree/w00005-novel-understanding-spike` 的 `tasks/t33-v9-extraction-v2/`，没有入库）原样迁来：

- `checklist-ch1-20.json`、`check.ts`、`aggregate.ts`：t33 的尺子与汇总，只改了导入路径；`luna.ts` 来自 t19 `scripts/`，`query.ts`、`schema.ts` 来自 t27。迁来后在 t33 的 `run-baseline-1` 上用 `--reuse` 复跑，53 条结论与 t33 当时逐条相同。
- `score.ts`：按 对 3、部分 2、缺 1、错 0 计总分，并数翻转（新写，计分法同 t33 的过程记录）。

用法（仓库根执行，模型判定用 `.env` 的 `NBOOK_LLM_*`）：

```bash
bun --env-file=.env <本目录>/check.ts --run <含 dataset-v9.json 的目录> --out <结果目录>
bun <本目录>/score.ts <结果目录 1> <结果目录 2> <结果目录 3>
```

一次抽取由上一级的 `regress-20.sh` 产生（图导出为 `dataset-v9.json`）。

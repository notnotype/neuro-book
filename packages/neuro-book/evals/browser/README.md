# 浏览器 Agent 评测

在同一批浏览器任务上比较 NeuroBook 的浏览器插件与 browser-use 1.0（同一个模型、同一台机器、同一种浏览器）。设计、决定与实施计划都在 Task 记录里，本文只讲怎么跑：

- 设计稿：[`.agents/works/w00034-browser-use/tasks/t02-eval/design.md`](../../../../.agents/works/w00034-browser-use/tasks/t02-eval/design.md)
- 实施计划：[`plan.md`](../../../../.agents/works/w00034-browser-use/tasks/t02-eval/plan.md)

## 准备

- **browser-use 的环境**：单独一份 Python 环境，装钉住的版本：

  ```bash
  prox uv venv --python 3.12 .local/agent/evals/browser/venv
  prox uv pip install --python .local/agent/evals/browser/venv/bin/python "browser-use==1.0.6"
  ```

  （路径相对主工作区根；运行时用 `--bu-python` 指过去。）
- **模型密钥**：主工作区根的 `.env` 要有 `JIJI_LUNA_BASE_URL`、`JIJI_LUNA_API_KEY`（gpt-6-luna），`EXTREMELYCAT_BASE_URL`、`EXTREMELYCAT_API_KEY`（两个 Gemini）。评测缺省读主工作区的 `.env`（worktree 里没有），`--env-file` 可以换。取值只交给评测自己的模型网关，不进运行记录。
- **代理**：extremelycat 直连时握手被重置，发往它的模型请求要经代理。评测进程的环境里不能有代理变量（Bun 的 `fetch` 会自动读它们，luna 就会悄悄经代理走），代理地址用 `--model-proxy` 或环境变量 `NBOOK_EVAL_MODEL_PROXY` 给，例如 `--model-proxy "$(prox printenv https_proxy)"`；Chrome 与执行者的流量不走代理。
- **bwrap**：执行者与 Chrome 都在 bwrap 的沙箱里跑（看不到 `.env`、`~/.omp` 与评测的私有目录）。

## 运行

在 `packages/neuro-book` 里：

```bash
# 每个模型跑一道最小题，核对网关记下的实收参数（推理档、工具数、图片），走到多轮工具调用
bun run eval:browser probe --model-proxy "$(prox printenv https_proxy)"

# 跑题：缺省第一阶段的 8 道题、三个模型、各 1 次；同一个 --out 再跑时续跑
bun run eval:browser run --repeat 5 --out <运行目录> --model-proxy "$(prox printenv https_proxy)" --max-total-input-tokens <止损线>

# 只起假站，人工打开看页面
bun run eval:browser sites
```

`run` 的标准输出是一行 `nbook.browser-eval.run-summary/v1`，进度在标准错误。运行目录的布局是 `<题>/<模型>/<执行者>/a<第几次>/try-<第几回>/`：`record.json` 是运行记录，`score.json` 是判分，`shots/` 是观察者的截图，`executor-stderr.txt` 是执行者的日志。

## 测试

```bash
bun test evals/browser                    # 快速类
NBOOK_EVAL_LIVE=1 bun test .live.test.ts  # 要真 Chrome、真 bwrap 的用例（包脚本 eval:live）
```

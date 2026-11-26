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
- **代理**：extremelycat 直连时握手被重置，评测要用 `prox` 起；只有发往它的模型请求走代理，Chrome 与执行者的流量不走。
- **bwrap**：执行者与 Chrome 都在 bwrap 的沙箱里跑（看不到 `.env`、`~/.omp` 与评测的私有目录）。

## 测试

```bash
bun test evals/browser                    # 快速类
NBOOK_EVAL_LIVE=1 bun test .live.test.ts  # 要真 Chrome、真 bwrap 的用例（包脚本 eval:live）
```

# scripts/release 目录规则

- 保持 Source、Product、Manager、Desktop 的现有发布入口和外部命令参数。
- 中间 staging、browser smoke、pack 与验证日志按 [`../../docs/testing/README.md`](../../docs/testing/README.md) 使用系统临时根；最终发布资产遵循既有 release output 合同。
- 修改发布复制闭包、安装器路径、workflow 命令或版本身份时，同步对应 contract test 和工作流断言。
- 未获开发者对本次动作的明确授权，不运行发布、不推送资产、不创建 Release、不删除历史发布数据。

## 发布流程

- 发布、推送资产、创建 Release、删除历史发布数据分别需要开发者对本次动作的明确授权，一项授权不外推到其它动作；本文件只定义门禁，不代表已获授权。
- 发布前读取 `PROJECT-STATUS.md` 和相关 Task walkthrough；用 `git log <上一个应用发布 tag>..origin/master --oneline` 核对合并范围，并把用户可见变化写入当前 `RELEASE.md`。正文与上一版本相同即视为未更新，不得发布；基线 tag 使用 `v*` 应用 tag，不混用 `manager-v*` 等其它 tag 线。历史版本放在 `vitepress/locales/{zh-Hans,en-US}/changelog/`。
- Canary 命令只能在开发者明确授权本次发布后执行：`bun run release -- canary --next patch --push --yes --no-watch` 或对应 minor 命令。命令会更新版本、提交、push 并创建 GitHub prerelease，不得把未获授权的命令写成已运行。
- 命令中断后先检查工作区、最近提交和 `package.json` 版本，再用 `gh release view <tag> --repo notnotype/neuro-book` 判断是否已经完成，避免重复发布。

## RELEASE.md 内容

- `RELEASE.md` 只保留当前版本；历史版本进入 `vitepress/locales/{zh-Hans,en-US}/changelog/`。版本段落必须覆盖自上一次发布以来合并的全部 PR；面向用户的变更各写一条并在末尾标注 PR 号（如 `(#63)`），纯内部改动可合并为一条“内部维护”并列出 PR 号；Task 不进入正文，通过 PR 描述追溯。
- 版本段落按需包含以下小节，不保留空标题：

```markdown
## <版本> - <日期>

一段话说明本版本解决的问题。

### 新功能
### 改进
### 修复
### 升级须知
```

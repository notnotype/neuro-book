# llmlint

`llmlint` 用规则稳定定位中文 LLM 输出中的模式，再由人或 Agent 结合语境判断修复。可安装的 Skill 与 CLI 位于项目的 `skill/`。

## 安装

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

首次在 skill root 安装依赖后运行：

```bash
bun install --frozen-lockfile
bun bin/llmlint.ts check <file>
```

`check` 提供完整静态扫描。`detect` 是独立外部检测链路，会把未缓存正文块发往配置服务；`contribute` 当前只写本机发件箱。启用前请阅读[数据共享与隐私](https://github.com/notnotype/neuro-book/blob/master/packages/llmlint/skill/README.md#数据共享与隐私)。CLI 参数与 JSON schema 见[使用说明](https://github.com/notnotype/neuro-book/blob/master/packages/llmlint/skill/references/cli-usage.md)。

# 实现与验证记录

> **已被取代（历史记录）**：本文是首稿作者记录，其中的隔离与磁盘断言表述低于 [返工证据（第二稿）](./rework-evidence.md) 覆盖，
> 以返工证据为准。

## 结果

新增 `packages/neuro-book/scripts/smoke/storage-project-adapter.ts`，并在 `packages/neuro-book/package.json` 登记 `smoke:storage-project-adapter`。脚本使用真实 Chrome、esbuild 打包的产品浏览器 Storage 模块、ofetch、Node/H3 最小宿主、真实 Project Session/Project Storage lazy Module 与隔离磁盘目录；未启动或访问完整 Nuxt，也未使用 `localhost:3001`。

覆盖场景：

- 缺少 `publicId`、错误 Project 的 `publicId` 均不签发 Project 上下文，不回退到 user。
- 精确 ready 的 Project A/B 分别完成 context、bind、read、CAS save；相同 owner/key 在 A/B 隔离。
- 同一浏览器上下文两个标签共享客户端身份，但拥有独立访问生命周期；释放第二标签后第一标签仍可写，已释放标签停止订阅请求。
- 订阅从初始确认值开始，并观察另一个标签的提交；陈旧凭据返回 `STORAGE_REVISION_CONFLICT`。
- 独立浏览器上下文取得不同客户端凭证，Project/local 记录隔离。
- Project A 关闭后旧 session 与旧 ready 均拒绝；同路径重开得到新 `publicId`，显式重建后从 `ProjectRoot/.nbook/storage` 读回已提交值。
- 直接读取 Project 记录文件，确认最终值 `700` 已落盘。

## 实际验证

工作目录：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book`

命令：

```text
node --import tsx scripts/smoke/storage-project-adapter.ts --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

退出码：`0`。最终 JSON：

```json
{
  "schema": "nbook.storage-project-adapter-smoke/v1",
  "status": "passed",
  "findings": []
}
```


脚本类型检查：

```text
bunx tsc --noEmit --pretty false -p scripts/tsconfig.json
```

退出码：`2`。本次新增 `storage-project-adapter.ts` 零报错；唯一错误来自未修改的 `scripts/deploy/product-agent-state-root-smoke.ts:318`，其 theme fixture 缺少 `colorwayId`、`userColorways`。未将该命令记录为通过。

最终运行隔离根：`C:\Users\NOTNOT~1\AppData\Local\Temp\neuro-book\storage-project-adapter\89ee4fa2`；HTTP：`http://storage.test:33460/`（绑定 `127.0.0.1`）。脚本结束时关闭三个页面所属浏览器上下文、Chrome、随机端口 HTTP 服务、全部 Project Session 与 Storage Host，然后只删除本次隔离根。HTTP 使用 `listen(0, "127.0.0.1")`，未占用、访问、重启或关闭 3001。隔离根清理完成；未操作旧临时根 `storage-browser-MxfyHy`。

## 边界

本证据是最小 HTTP 宿主下的真实浏览器、产品适配器与 Project Storage 磁盘链路，不是完整 Nuxt、Project Picker 或主页面 UI 验收。未执行全包 typecheck/build，未联网、未提交、未 push，未调用真实 Provider/Model。

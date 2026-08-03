# ADR 0012：Release Candidate 验证与激活

- 状态：Accepted
- 日期：2026-08-02
- 关联任务：[Task 130](../tasks/130-desktop-application-foundation/README.md)、[Task 105](../tasks/105-unified-installation-manager/README.md)、[ADR 0009](0009-product-runtime-image-generation.md)、[ADR 0010](0010-desktop-storage-loopback-shutdown.md)

## 背景

旧发行链先创建公开 GitHub Release，再由 `release.published` 事件开始构建。容器多架构合并阶段又会立即写版本 tag；完整资产、校验和、Portable smoke 和公开下载验证在其后才发生。任何中途失败都会留下一个已经可见但不完整的 Release，或留下没有通过最终验收的正式 OCI tag。

Canary 还共用一个会互相取消的并发组。一个候选开始后再创建另一个候选，会使前者失去完整、独立的验收结果。

## 决策

1. Release CLI 只能创建 Draft Release，没有直接公开参数或分支。CLI 创建后读取 GitHub 返回的 numeric release ID，核验 tag 与 Draft 状态，再显式 dispatch `release-container.yml`。
2. workflow 输入固定为 `release_id`、`tag`、`revision` 和 `prerelease`。所有 checkout 都使用输入中的精确 revision；不得使用可能随分支前进的默认 checkout identity。
3. concurrency 只按 release ID 隔离，`cancel-in-progress=false`。不同 Candidate 可以并行，且不能互相取消。
4. Source、五个平台 Product、Windows Portable、release manifest 与 checksum 先作为 Actions artifact 生成并验收，再上传到指定 Draft。已有同名资产只有摘要相同才可复用；摘要不同必须失败。
5. 容器候选阶段只推 app 的架构 digest，并合并成 `candidate-<release-id>` 引用。Release Manifest 记录 `repository@sha256:digest`；Candidate 阶段不得创建版本 tag 或 `latest`。
6. `neuro-book-runtime` 只保留为 Dockerfile 内部 build stage 和 BuildKit cache，不再作为独立公开发行资产。
7. 所有正确性 gate 完成、最后的 manifest 与 checksum 已进入 Draft 后，`publish-index` 才把同一个 release ID 改为公开。OCI 激活必须是下一个独立 job：它先核验已公开 Release 的 ID、tag、revision 与 prerelease 状态，再把已验收 digest 绑定到版本 tag；只有 stable 额外绑定 `latest`。
8. Release 公开与 OCI 激活分成两个 job，使 OCI 失败后可以只重跑激活步骤；不得让重试重新经过只接受 Draft 的上传器。版本 tag/`latest` 写入必须幂等，并在写入后复算 manifest digest。
9. `docker:publish` 只允许写 `candidate-<id>`，不能接受任意 tag，也不能发布 runtime 镜像。正式别名只由本 ADR 的最终激活 job 拥有。
10. Draft、Actions artifact 和候选 OCI 引用是可重试的候选资产，不另建 Release 状态数据库。GitHub Release 是产品发现入口，Release Manifest 中的 digest 是容器安装真相源。

## 原因

GitHub Release、Actions artifact 与 GHCR 不能组成真正的跨服务原子事务。把“公开 Release”定义为唯一发现激活点，可以在不建设分布式事务系统的前提下保证：所有可执行资产先完成验证，失败时用户看不到半成品；OCI tag 只是 digest 的可重建别名，不承担安装身份。

numeric release ID 避免同 tag、并发 rerun 或事件上下文把资产上传到错误对象。精确 revision 输入避免 workflow dispatch 所在分支在排队期间前进后构建出另一代 Source。

## 后果

- Candidate 失败时 Draft 会保留诊断和已上传候选资产，但不会公开，也不会产生正式 OCI tag。
- Release 公开和 OCI alias 激活之间仍是两个顺序动作。若 alias 激活失败，Release Manifest 的 digest 仍可执行，独立激活 job 可幂等重试；不为此增加跨服务回滚数据库。
- Canary 不再自动取消旧 Candidate，Actions 并发消耗可能略高，但每个候选都有完整结论。
- 人工 GHCR 调试必须显式给 Candidate ID；不能再把本地构建直接伪装成版本发行。

## 未采用方案

- 继续使用 `release.published` 触发：公开发生在验证之前。
- 在候选阶段预写版本 tag，失败后删除：并发读者可能已经消费，删除不能撤回。
- 用一个全局 canary concurrency group：无法证明每个 tag 都完成独立验收。
- 建立跨 GitHub/GHCR 的事务数据库：复杂度超过当前单仓、低频发行的实际需求。

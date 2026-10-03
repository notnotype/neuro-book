---
schema: nbook.spec/v1
kind: architecture
status: implemented
capability: media.image-variants
owners:
  - media
  - server
---

# 图片原图与变体

本文是 NeuroBook 图片原图所有权、授权 Adapter、变体参数、缓存和 Project 封面的稳定实现契约。取舍原因见 [ADR 0006](../../../packages/neuro-book/docs/adr/0006-image-variant-and-original-ownership.md)，受管 Cache Root 的物理 locator 见 [ADR 0010](../../../packages/neuro-book/docs/adr/0010-desktop-storage-loopback-shutdown.md)。

## 所有权边界

- Agent Attachment 原图由 Attachment Store 保存，Session entry locator 决定读取权。
- Project 封面原图是 Project Workspace 普通内容，`project.yaml.cover` 是当前引用真相源。
- Image Variant Module 只拥有可重建 WebP 缓存，不拥有或登记原图。
- 不存在通用媒体 ID、`MediaAsset` 表或 `/api/media`。新领域通过自己的授权 Adapter 接入。

领域 Adapter 必须先授权，再构造：

```typescript
type ImageVariantSource = {
    identity: string;
    revision: string;
    read: () => Promise<Uint8Array>;
};
```

`identity` 与 `revision` 只用于缓存键。HTTP 响应、错误和日志不得泄漏原图物理路径或缓存内部路径。

## 规格

HTTP 只接受以下两种互斥形式：

- `preset=<name>`
- `width`、`height`、`fit`、`quality`

显式参数合同：

- `width`/`height` 至少一个，整数 `1..2048`；
- `fit=contain|cover`，默认 `contain`；`cover` 必须同时提供宽高；
- `quality` 为整数 `40..95`，默认 `80`；
- preset 不能与任何显式参数混用。

内置 preset：

| 名称 | 最终规格 | 消费方 |
| --- | --- | --- |
| `project-cover` | 384×576、cover、80 | Project 书架 |
| `attachment-grid` | 384×216、contain、80 | Session 附件面板 |
| `attachment-chat` | width 768、contain、80 | Chat Flow 图片 |

preset 先规范化成最终规格，因此与同规格显式参数共享缓存键。输出固定为 WebP；自动应用 EXIF 方向、剥离 metadata、禁止放大小图。GIF 原图保留动画，变体只生成静态首帧。

限制：源图最多 64 MP，输出最多 2048×2048。只给一个边长时，派生出的另一边同样不能超过 2048。

## 并发与缓存

- 全局最多同时执行 2 个 source read/transform，队列最多 64 个；队列满返回 503 与 `Retry-After`。
- 同一最终缓存键 single-flight。
- cache root 固定为 `Cache Root/image-variants/`。受管 Product 必须由 Manager 显式注入 Cache Root；只有 Source dev 与隔离测试未配置时才默认设为 `State Root/cache/`，不能反向把两者视为同一个所有权边界。
- 固定上限：512 MiB、10000 项、每个 source 32 个变体。
- 首次使用清理 temp 并建立 inventory；超预算按生成时间淘汰最旧项。命中不更新访问时间，因此不是 LRU。
- cache v2 文件名同时携带 source scope、逻辑变体键与 WebP 内容 SHA-256。写入使用同目录 temp、fsync 和原子 rename；命中时校验 MIME 与内容摘要，截断或同长度篡改都会删除并重新生成，不重新调用图片解码器。旧 v1 文件在首次使用时删除并按需重建。
- 初始化、写入或回收失败后，本进程停止后续持久写入；转换仍可返回内存 bytes，不在故障路径无界积压内存。

缓存不迁移、不备份，不属于 Project Runtime Artifact，也不进入 Project Workspace File Index、History 或 Project Workspace Download Archive。

## HTTP 行为

无变体参数时，领域 GET 保持原图语义。带变体参数时：

- Attachment 仍先按 Session、entryId、contentIndex 授权；变体响应使用 immutable cache-control。
- 非图片 Attachment 的无参数请求仍下载原文件；带变体参数返回 415。前端通用 Attachment 卡展示文件名、MIME、大小和原件下载，只为 canonical raster MIME 请求变体或插入 Composer。
- Project 仍先查 Lifecycle snapshot、manifest cover 和文件身份；变体响应使用 must-revalidate。
- 两者都返回基于变体键的 ETag、`image/webp` 和标记 hit/generated 的 `Server-Timing`。
- 400：非法或混合参数；415：不是支持的图片；422：解码失败或像素超限；503：队列饱和。

Agent Provider、Session snapshot、上传与持久化只读取原图，不允许把 WebP 缓存变体送进模型上下文。

## Project 封面 mutation

- `PUT /api/projects/cover?projectRoot=...`：multipart 严格接收一个 `file`，最大 20 MiB，仅 PNG/JPEG/WebP。空 MIME 与 `application/octet-stream` 只是传输占位，按魔数和完整解码裁决；其它具体 MIME 必须与 bytes 一致。GIF、SVG、文本和损坏图片始终拒绝。
- `DELETE /api/projects/cover?projectRoot=...`：清除当前 manifest 引用。
- 客户端不能提交目标路径。原始 bytes 按 SHA-256 保存到 `assets/project-covers/<hash>.<ext>`，不转码、不修改 metadata。
- 发布原图后再原子更新 manifest；manifest 是提交点。已知未提交时删除本轮新文件；提交未知时保留新旧文件。
- `committed: "unknown"` 与完全没有 HTTP response 都按提交未知处理：客户端不自动重放，先刷新完整 Project snapshot。恢复门禁按 Project 隔离；任一次成功 snapshot 会解除现有门禁并刷新相关封面 URL。
- 已知成功后只清理 `assets/project-covers/` 中不再引用的应用托管文件。手工配置到其他相对路径的图片永不删除。
- 清理失败记录在 Lifecycle 有界诊断中，不回滚已提交封面。

Project 原图 GET 的 filename 来自已授权 `project.yaml.cover` basename，并按 UTF-8 `filename*` 返回；变体响应仍是 WebP inline，不冒充原图扩展名。

封面原图仍是普通 Project 内容，进入下载归档和 File Index，并在 Project 下次打开时由 History 对账。首页 mutation 不为记账强制打开 Project。

## Product 发布合同

`sharp` 必须保持 Nitro external。每个 Product 包包含：

- `sharp`
- `@img/colour`
- 当前平台 `@img/sharp-*`
- Linux/macOS 对应 `@img/sharp-libvips-*`（Windows 包内自带 DLL）

发布门禁必须从打包后的 `.output/server` 执行一次真实生成，再用新 Module 实例命中缓存。只检查目录或在仓库根运行 `sharp` 不算 Product 证据。

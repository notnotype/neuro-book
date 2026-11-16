# t16 设计审查第 3 轮（Opus，11 条：高 2、中 3、低 6）与建议的处理（待开发者定）

三轮审查已满且仍有高级问题，按 autonomous-delivery 停下，下面是建议，开发者定了再改计划 r4、开工。

## 两条高级（都在 nb-host，计划 r3 按原样做不到）

1. Bun 的请求体缺省上限 128 MiB，nb-host 的 `Bun.serve` 没设 `maxRequestBodySize`（审查者本机实测 200 MiB 得到空体 413）。
2. nb-host 转交请求用 `new Request(target.href, request)`，会把整个请求体收进内存（实测 100 MiB 上传峰值多约 80 MiB）；显式传 `body`、`duplex: "half"`、`signal` 后回到正常。

建议：总上限降到 64 MiB、单个 32 MiB（远低于 128 MiB，不动 nb-host 的全局上限）；另把 nb-host 转交改成流式作为前置切片（它对现有的附件、主题素材上传同样有益），加一条经真实 `Bun.serve` 与 nb-host 分发的上传测试。备选：保留 256 MiB，给 nb-host 加 `maxRequestBodySize` 配置（会放宽同一监听上所有路由）。

## 三条中级

3、4. 落点：确认框的遮罩与设置窗口右侧空白都不在插件页根元素里，松手会整页导航（浏览器）或无反应（桌面）。建议：插件页挂载期间在 `window` 上只对 `Files` 拖动 `preventDefault`（防导航，不安装），安装只在插件页内容区（撑满）接收；落在别处提示“拖到插件页”。这与 t15 的落点不冲突：t15 的落点在自己的元素上先处理并 `preventDefault`，插件页的 window 监听看 `defaultPrevented` 跳过。
5. 上传个数：满 8 个时淘汰最久没用的可用上传，不拒绝；接收开始就占位；页面在 `pagehide` 发删除。

## 低级

分帧写死（头长度 ≤ 2048、头形状、`size` 先查、空体）、大小写比较改用 NTFS 的大写比较近似、首次清空只跑一次、停止时取消接收、三种失败形状都处理、Blob 流式在 Windows 上观察一次内存、两条页面规则只留“进行中再拖入不理”。都照建议改，不需要开发者定。

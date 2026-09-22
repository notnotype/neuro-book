# Leader首稿复核

2026-09-16读取约250行的首稿。此时作者仍修语法，以下是确定的合同/验证缺口，收口前逐项处理。

1. 关闭重开场景不能用setStorageHostContextForTest代替Project关闭/打开，也不能用错误路径alpha-reopen加旧publicId拒绝来证明同路径旧代次拒绝。必须通过真实Project owner关闭alpha，在原alpha重新open得到新publicId，旧session/旧publicId拒绝、新上下文读回700。
2. A/B隔离必须使用同客户端，当前B在other context，缺失结果无法区分是client隔离还是project隔离。两个维度分别验证。
3. 精确磁盘断言：user身份域在workspace/.nbook/storage；Project记录在对应Project/.nbook/storage。不要从project storage读取identity.json，不要猜subject为local:local或clientId为空。复用生产身份/地址入口，核原始记录结构/字段，禁止字符串includes("700")冒充值校验。
4. 使用生产readStorageProjectContextRequest，不手写event.req.json；只检查缺字段不等价于现有strict边界。坏publicId、缺ready的真实HTTP响应必须被验证。
5. 新增shared Project定义，用同data、两个client验证共享地址的读写；不宣称在线同步。不同client local缺失仍单独证明。
6. 先释放一个标签后确认另一个仍能读写，当前只测停止轮询不能证明session独立。
7. 浏览器新Context与独立profile不是同一证据；本Task已要求本次root内显式profile。要么launchPersistentContext并用两个本次专属目录，要么明确只验证独立存储context、由Leader裁定额外profile证据；不得写“profile已隔离”但只newContext。
8. cleanup覆盖从首次创建Project开始的全部失败阶段，不仅host/browser启动后。关闭Project→Storage宿主收口与根删除顺序必须安全。root删除前验证真实绝对路径位于本次系统Temp专用根，检查根归属/重解析点；拒绝旧根/任意调用方路径，绝不触碰以前审批拒绝的目录。
9. 报告实际root/端口/浏览器关闭结果，禁止在报告里把最小HTTP冒充Nuxt。先修基本编译错误再运行smoke；scripts类型错误只允许基线已登记的那一条。
10. 当前脚本多处把完整函数挤成一行，影响后续审查与错误定位；按现有编码规范格式化为常规块结构，不引入额外框架。

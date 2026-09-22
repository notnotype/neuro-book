# 验证宿主接线

主Agent恢复并核对用户最新要求：3001属于已有后台服务，不占用、复用、重启或关闭。
产品验收使用独立State Root与Workspace Root；纯nb-ui playground不加载产品数据面。

本轮新增真实Splitter测试时发现nb-ui Vitest配置仍未接统一临时根。主Agent机械接线：
显式配置文件相对root、覆盖现有src/themes/playground的测试入口、支持包setupFiles/globalSetup。
未改变用例行为。配置已被真实聚焦测试和前轮18文件314用例消费；并行修改后的最终全包验证仍待重跑。

补齐nb-ui对测试支持包的workspace开发依赖，避免只依赖monorepo偶然提升的可解析路径。
`bun install --lockfile-only --ignore-scripts`只生成lockfile，不运行生命周期脚本。
首次diff仅在nb-ui登记同名依赖；确定性复跑又补齐contracts/owned-process既有file依赖的两个解析映射，未更新依赖版本。
随后连续两份生成物字节相同，SHA-256均为 `8173A419581401574DB60B1D086841CACA452C401481CA05CF02C03F2A1A3972`。

最终门禁前发现shots.spec.ts仍把截图写到源码相对test-results，绕过Playwright --output隔离参数。
Leader机械改用testInfo.outputPath，截图内容和断言不变；统一E2E指定系统Temp验收根，纯playground不启产品State Root。
t39最终独立复核建议合并（32用例+11探针）；Leader只补充Splitter文档的Enter混序/空操作说明，未改被审组件逻辑。

正式nb-ui typecheck发现Splitter.vue:85的TS2345：原内联方法检查能收窄属性，却不能把整个Vue ref联合类型收窄为Panel公开接口。
Leader将相同的非null/collapse/expand函数检查提取为明确类型守卫，保留运行期判断与保存对象，未使用断言或改动手势行为。最终门禁记录补充修复后的结果。

最终E2E首轮47/48通过，唯一失败是既有switch-field截图：Lab画布宽度约束修复后，场景头部和说明从右侧裁切改为正确收窄，开关卡片在可见画布内居中。Leader直接对照expected/actual/diff确认无组件逻辑回归，使用Playwright更新该一张基线，连续两次生成字节相同，SHA256为EE93AF0CF9A57BE50FA44E7152741C4D172665BD307E613C8228D293AFE02546。
随后完整E2E 48/48通过，exit0，端口3149；浏览器Temp/profile、trace与截图在系统Temp storage-core-final-20260916。此证据是nb-ui playground，不能代替NeuroBook主页面。

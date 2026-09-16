# t31 / t32 本地提交检查

2026-09-16，主 Agent核对实现、原始运行输出与独立审查。

## 已闭合

- 普通HTTP文件读写、上传、索引、History及资产同步按明确target保护Storage；普通同名目录仍可使用。
- Project ZIP保留正式记录、墓碑、原件，逐文件固定快照；完整data备份保留身份域，排除锁和本模块临时文件。
- 普通用户资产ZIP排除Storage。
- CLI new/state/parse/validate都经同源保护；递归修复从普通祖先开始时跳过Storage。最后两处接线由主 Agent逐行复核，
  不采纳t33追加报告中“Storage永远没有index.md”的延期判断。未知原件属于必须保留的数据。

## 实际验证

- 主 Agent先前聚焦：13文件131通过（388.27秒），含真实资产同步与扫描；随后typecheck exit0。
- t31补修：4文件28、1文件8、8文件29通过；t33独立重跑相同集合并建议合并。
- 最后CLI增量：1文件9通过；两项负向探针分别复现显式parse放行、递归fix改写Storage原件，均已还原。
- t32真实Project ZIP与完整data加密/解密/解包：3文件14通过，后续backup规则收口2文件9通过。
- 所有上述补修完成后的主 Agent `bun run typecheck`（主应用cwd）exit0，2026-09-16 10:16收取。
- `git diff --check`通过；`docs:check`5685文件failures=[]，governance failures=[] / warnings=[]。

全库测试未运行。Project identity alias 的已有 ELOCKED 失败及提交前对照见 [leader-baseline](leader-baseline.md)。
没有改用户两份descriptors，没有操作真实data、远端或发布。t30/t35另行提交，整个实现goal继续进行。

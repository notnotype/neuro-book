# 最终追加复核

t40已完成第二轮返工且writer退出，Leader于2026-09-16 12:18在正确worktree独立执行6文件94用例，exit0。
只复核首轮确定缺陷与返工引入的核心问题：两scope allSettled清理、facade同步失效、releaseScope同时启动已有raw.release及等待opening、重复release、未知字段保留、监听器异常隔离。
读最新代码/测试和本Task首轮报告，固定hash。结果写walkthroughs/review-final.md；若原缺陷闭合，不重复扩大完整架构审查。
不修改业务代码。只用绝对cwd，不建.tmp、不递归删除，不跑全包typecheck或build、不启动产品/访问3001/联网。需要临时探针时归Task，退出码及命令不能被管道掩盖。最终明确可否提交、残余风险。

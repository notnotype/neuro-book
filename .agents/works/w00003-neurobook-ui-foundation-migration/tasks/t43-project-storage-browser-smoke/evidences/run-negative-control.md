# 负面对照：修复前的真实失败（不是改写过的通过）

命令（cwd = worktree 内 packages/neuro-book）：
```text
node --import tsx scripts/smoke/storage-project-adapter.ts --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"
```
退出码：1

stderr：
```text
Project Storage smoke 隔离根：C:\Users\NOTNOT~1\AppData\Local\Temp\neuro-book\nb-t43\140eaac9
Project Storage smoke HTTP：http://storage.test:51083/
Project Storage smoke profile(main)：C:\Users\NOTNOT~1\AppData\Local\Temp\neuro-book\nb-t43\140eaac9\profiles\main
Project Storage smoke profile(other)：C:\Users\NOTNOT~1\AppData\Local\Temp\neuro-book\nb-t43\140eaac9\profiles\other
```

最终 JSON（findings 非空即失败）：
```json
{
  "schema": "nbook.storage-project-adapter-smoke/v1",
  "status": "failed",
  "findings": [
    {
      "kind": "assertion",
      "message": "重建应报告并释放被覆盖的旧槽"
    }
  ],
  "cleanupFailed": []
}
```

该 finding 指向脚本自身的问题（失败的 open 会先销毁可用槽），已在同一脚本内改为「先签发成功再释放旧槽」；
修复后同一场景通过。它同时证明：断言失败会真实产生 status=failed 与退出码 1，不会被改写成通过。

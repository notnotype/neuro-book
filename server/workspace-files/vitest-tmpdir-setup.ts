import {mkdtempSync, mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {randomBytes} from "node:crypto";
import {join} from "node:path";

/**
 * 受控测试临时根（仓库级 Vitest setup）。
 *
 * 所有使用 `os.tmpdir()` / `mkdtemp(tmpdir()...)` 的测试目录统一收敛到
 * `<系统Temp>/neuro-book-vitest/<runId>/`，不再散落系统 Temp 根。
 * 位置选在系统 Temp 而不是仓库 `.agent/tmp`：worktree 深路径叠加测试内部
 * UUID 目录名会超过 Windows MAX_PATH（git 对象与 release staging 报
 * "Filename too long" / ENAMETOOLONG）。runId 由 `vitest-global-setup.ts`
 * 生成（8 位 hex）；每次 run 结束 teardown 删除，强杀残留由下一次 run 的
 * setup 按超窗清理，系统 Temp 根保持只有一个 `neuro-book-vitest` 目录。
 * 本文件必须是各 Vitest 配置 setupFiles 的第一项：后续 setup 与测试模块在
 * 运行时读取的 `os.tmpdir()` 都会拿到受控根（Node/Bun 每次调用动态读
 * TMPDIR/TEMP/TMP）。
 */
const BASE_TMP = tmpdir();
const RUN_ID = process.env.NBOOK_TEST_RUN_ID ?? randomBytes(4).toString("hex");
const CONTROLLED_TMP_ROOT = join(BASE_TMP, "neuro-book-vitest", RUN_ID);
mkdirSync(CONTROLLED_TMP_ROOT, {recursive: true});

process.env.TMPDIR = CONTROLLED_TMP_ROOT;
process.env.TEMP = CONTROLLED_TMP_ROOT;
process.env.TMP = CONTROLLED_TMP_ROOT;
process.env.NBOOK_TEST_TMPDIR = CONTROLLED_TMP_ROOT;

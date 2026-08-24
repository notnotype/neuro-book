import {mkdir, mkdtemp, rm, symlink} from "node:fs/promises";
import {join, resolve} from "node:path";
import {
    AGENT_PATH_LENGTH_LIMIT,
    assertContained,
    resolveAgentAcceptanceRoot,
    resolveAgentCacheRoot,
    resolveAgentFixtureRoot,
    resolveAgentRunRoot,
    resolveAgentTempRoot,
    resolveAgentTestRoot,
    resolveAgentWorktreeRoot,
    resolveSystemTempRoot,
} from "@notnotype/neuro-book-test-support/paths";

const env = (values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => values;

describe("Agent 路径解析", () => {
    it("默认根位于系统临时目录下", () => {
        const root = resolveAgentTempRoot(env());
        expect(root).toBe(resolve(resolveSystemTempRoot(env()), "neuro-book"));
    });

    it("显式 Agent 根必须是系统临时目录的后代", () => {
        const systemRoot = resolveSystemTempRoot(env());
        const configured = join(systemRoot, "neuro-book-configured");
        expect(resolveAgentTempRoot(env({NBOOK_AGENT_TEMP_ROOT: configured}))).toBe(configured);
        expect(() => resolveAgentTempRoot(env({NBOOK_AGENT_TEMP_ROOT: resolve(systemRoot, "..", "outside")}))).toThrow("受控根");
        expect(() => resolveAgentTempRoot(env({NBOOK_AGENT_TEMP_ROOT: "relative-temp"}))).toThrow("绝对路径");
    });

    it("worker Temp 改写为 Agent run 根时仍使用稳定宿主 Temp locator", () => {
        const hostRoot = resolveSystemTempRoot(env());
        const agentRoot = join(hostRoot, "neuro-book");
        const workerRoot = join(agentRoot, "vitest", "1234abcd");
        expect(resolveAgentTempRoot(env({
            NBOOK_HOST_SYSTEM_TEMP_ROOT: hostRoot,
            NBOOK_AGENT_TEMP_ROOT: agentRoot,
            TEMP: workerRoot,
            TMP: workerRoot,
            TMPDIR: workerRoot,
        }))).toBe(agentRoot);
    });

    it("拒绝 Temp 下指向仓库的 junction 或 symlink Agent 根", async () => {
        const hostRoot = resolveSystemTempRoot(env());
        const parent = await mkdtemp(join(hostRoot, "neuro-book-agent-paths-"));
        const link = join(parent, "root-link");
        try {
            await symlink(resolve("."), link, process.platform === "win32" ? "junction" : "dir");
            expect(() => resolveAgentTempRoot(env({
                NBOOK_HOST_SYSTEM_TEMP_ROOT: hostRoot,
                NBOOK_AGENT_TEMP_ROOT: link,
            }))).toThrow(/symlink\/reparse|受控根/u);
        } finally {
            await rm(parent, {recursive: true, force: true});
        }
    });

    it("允许系统级 symlink/junction 祖先；锚点自身为链接仍拒绝，逃逸仍阻断", async () => {
        const hostRoot = resolveSystemTempRoot(env());
        const realParent = await mkdtemp(join(hostRoot, "neuro-book-canonical-"));
        const realRoot = join(realParent, "real-root");
        const linkRoot = join(realParent, "link-root");
        await mkdir(realRoot);
        await symlink(realRoot, linkRoot, process.platform === "win32" ? "junction" : "dir");
        const leaf = join(linkRoot, "mid", "leaf");
        try {
            await mkdir(leaf, {recursive: true});
            // macOS /var -> /private/var 场景：祖先链含系统级链接时必须放行。
            expect(() => assertContained(leaf, join(leaf, "kept"), "probe")).not.toThrow();
            expect(() => assertContained(join(linkRoot, "mid"), leaf, "probe")).not.toThrow();
            // 锚点自身是 symlink/junction 仍然拒绝。
            expect(() => assertContained(linkRoot, leaf, "probe")).toThrow(/symlink\/reparse/u);
            // 逃逸到真实父目录下、链接路径之外的目标必须阻断。
            const escapee = join(realParent, "escaped");
            await mkdir(escapee);
            expect(() => assertContained(leaf, escapee, "probe")).toThrow("受控根内");
        } finally {
            await rm(realParent, {recursive: true, force: true});
        }
    });

    it("测试、fixture、run、acceptance 和 cache 都收敛到 Agent 根", () => {
        const root = resolveAgentTempRoot(env());
        expect(resolveAgentTestRoot("1234abcd", env())).toBe(join(root, "vitest", "1234abcd"));
        expect(resolveAgentFixtureRoot("00149-agent", "1234abcd", env())).toBe(join(root, "fixtures", "00149-agent", "1234abcd"));
        expect(resolveAgentRunRoot("00149-agent", "1234abcd", env())).toBe(join(root, "runs", "00149-agent", "1234abcd"));
        expect(resolveAgentAcceptanceRoot(env())).toBe(join(root, "acceptance", "product-runtime"));
        expect(resolveAgentCacheRoot("source-dev", env())).toBe(join(root, "cache", "source-dev"));
    });

    it("测试覆盖根不能逃出 Agent 根，worktree 根独立于临时根", () => {
        const root = resolveAgentTempRoot(env());
        expect(resolveAgentTestRoot("1234abcd", env({NBOOK_TEST_TMPDIR: join(root, "custom-test")}))).toBe(join(root, "custom-test"));
        expect(() => resolveAgentTestRoot("1234abcd", env({NBOOK_TEST_TMPDIR: resolve(root, "..", "outside")}))).toThrow("受控根");
        const repoRoot = resolve("C:", "repo");
        expect(resolveAgentWorktreeRoot(repoRoot, env())).toBe(resolve(repoRoot, ".worktree"));
        expect(resolveAgentWorktreeRoot(repoRoot, env({NBOOK_AGENT_WORKTREE_ROOT: "worktrees"}))).toBe(resolve(repoRoot, "worktrees"));
    });

    it("拒绝不安全的 run/task 段与超长结果", () => {
        expect(() => resolveAgentTestRoot("../escape", env())).toThrow("非法路径段");
        expect(() => resolveAgentRunRoot("00149/escape", "1234abcd", env())).toThrow("非法路径段");
        expect(() => resolveAgentFixtureRoot("00149-agent", "bad\\run", env())).toThrow("非法路径段");
        const longRoot = join(resolveSystemTempRoot(env()), "n".repeat(AGENT_PATH_LENGTH_LIMIT));
        expect(() => resolveAgentTempRoot(env({NBOOK_AGENT_TEMP_ROOT: longRoot}))).toThrow("路径过长");
    });
});

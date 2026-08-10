import {spawn} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {portableLaunchers, writePortableLaunchers} from "#manager/portable-launchers";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Portable Launcher", () => {
    it("六个入口都只委托绑定自身Root的稳定Manager wrapper并传递退出码", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-portable-launchers-"));
        temporaryRoots.push(root);

        await writePortableLaunchers(root);

        const launchers = portableLaunchers();
        expect(launchers.map((launcher) => launcher.name)).toEqual([
            "Start Neuro Book.cmd",
            "Start Neuro Book.ps1",
            "Update Neuro Book.cmd",
            "Update Neuro Book.ps1",
            "Create Admin.cmd",
            "Create Admin.ps1",
        ]);
        for (const launcher of launchers) {
            const content = await readFile(join(root, launcher.name), "utf8");
            expect(content).toBe(launcher.content);
            expect(content).toContain("neuro-book.cmd");
            expect(content).not.toContain("--root");
            expect(content).not.toContain("Set-Location");
            if (launcher.name.endsWith(".cmd")) {
                expect(content).toContain("NEURO_BOOK_EXIT_CODE");
                expect(content).toContain("pause");
            }
            else expect(content).toContain("exit $LASTEXITCODE");
        }
    });

    it("CMD入口只把完整子命令传给已绑定Root的稳定wrapper", async () => {
        if (process.platform !== "win32") return;
        const root = await mkdtemp(join(tmpdir(), "nbook-portable-cmd-"));
        temporaryRoots.push(root);
        const binRoot = join(root, ".runtime", "bin");
        await mkdir(binRoot, {recursive: true});
        await writeFile(join(binRoot, "neuro-book.cmd"), [
            "@echo off",
            "> \"%NEURO_BOOK_LAUNCHER_CAPTURE%\" echo %~1",
            "if not \"%~2\"==\"\" >> \"%NEURO_BOOK_LAUNCHER_CAPTURE%\" echo %~2",
            "if not \"%~3\"==\"\" >> \"%NEURO_BOOK_LAUNCHER_CAPTURE%\" echo %~3",
            "if not \"%~4\"==\"\" >> \"%NEURO_BOOK_LAUNCHER_CAPTURE%\" echo %~4",
            "exit /b 0",
            "",
        ].join("\r\n"), "utf8");
        await writePortableLaunchers(root);

        for (const fixture of [
            {launcher: "Start Neuro Book.cmd", command: ["start"]},
            {launcher: "Update Neuro Book.cmd", command: ["update"]},
            {launcher: "Create Admin.cmd", command: ["admin", "create"]},
        ]) {
            const capture = join(root, `${fixture.launcher}.args.txt`);
            const child = spawn("cmd.exe", ["/d", "/c", fixture.launcher], {
                cwd: root,
                env: {...process.env, NEURO_BOOK_LAUNCHER_CAPTURE: capture},
                windowsHide: true,
                stdio: "ignore",
            });
            await new Promise<void>((resolvePromise, rejectPromise) => {
                child.once("error", rejectPromise);
                child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`Launcher退出码：${code}`)));
            });
            expect((await readFile(capture, "utf8")).trim().split(/\r?\n/u)).toEqual([
                ...fixture.command,
            ]);
        }
    });

    it("CMD入口在Manager失败时保留退出码并等待用户确认", async () => {
        if (process.platform !== "win32") return;
        const root = await mkdtemp(join(tmpdir(), "nbook-portable-cmd-error-"));
        temporaryRoots.push(root);
        const binRoot = join(root, ".runtime", "bin");
        await mkdir(binRoot, {recursive: true});
        await writeFile(join(binRoot, "neuro-book.cmd"), "@echo off\r\nexit /b 23\r\n", "utf8");
        await writePortableLaunchers(root);

        const child = spawn("cmd.exe", ["/d", "/c", "Update Neuro Book.cmd"], {
            cwd: root,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stdin.end("\r\n");
        const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
            child.once("error", rejectPromise);
            // `exit`早于stdio关闭；全套并行测试下可能在最后一段stdout到达前断言。
            child.once("close", resolvePromise);
        });

        expect(exitCode).toBe(23);
        expect(stdout).toContain("NeuroBook command failed with exit code 23.");
    });
});

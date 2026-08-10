import {join} from "node:path";

import {pathExists, writeTextAtomic} from "#manager/files";

export type PortableLauncher = {
    name: string;
    content: string;
};

const actions = [
    {name: "Start Neuro Book", command: "start"},
    {name: "Update Neuro Book", command: "update"},
    {name: "Create Admin", command: "admin create"},
] as const;

/** 返回Windows Portable的薄启动壳；所有部署逻辑继续由Manager命令承担。 */
export function portableLaunchers(): PortableLauncher[] {
    return actions.flatMap(({name, command}) => [
        {
            name: `${name}.cmd`,
            content: [
                "@echo off",
                `call "%~dp0.runtime\\bin\\neuro-book.cmd" ${command}`,
                "set \"NEURO_BOOK_EXIT_CODE=%ERRORLEVEL%\"",
                "if \"%NEURO_BOOK_EXIT_CODE%\"==\"0\" exit /b 0",
                "echo.",
                "echo NeuroBook command failed with exit code %NEURO_BOOK_EXIT_CODE%.",
                "pause",
                "exit /b %NEURO_BOOK_EXIT_CODE%",
                "",
            ].join("\r\n"),
        },
        {
            name: `${name}.ps1`,
            content: `& (Join-Path $PSScriptRoot ".runtime\\bin\\neuro-book.cmd") ${command}\nexit $LASTEXITCODE\n`,
        },
    ]);
}

/** 原子写入Windows Portable入口文件。 */
export async function writePortableLaunchers(root: string, recordCreated?: (path: string) => Promise<void>): Promise<void> {
    for (const launcher of portableLaunchers()) {
        const path = join(root, launcher.name);
        if (recordCreated && await pathExists(path)) {
            throw new Error(`Portable Launcher与既有路径冲突：${launcher.name}`);
        }
        await recordCreated?.(path);
        await writeTextAtomic(path, launcher.content);
    }
}

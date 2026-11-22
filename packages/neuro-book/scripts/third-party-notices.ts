/**
 * 发布包里的 `THIRD-PARTY-NOTICES.md`：打包去掉了各依赖文件头的版权声明，许可义务靠这份文件履行。应用包
 * （`scripts/pack-app.ts`）与 SDK 包（`plugin-sdk/pack.ts`）共用。
 *
 * 来源有两种：Bun 或 rolldown 打包时实际打进去的模块路径（从中取出 `node_modules/<包>` 目录，读它的 `package.json` 与许可文件），
 * 以及 Vite 的 `build.license` 写下的许可清单（只收许可文本，包另有的 NOTICE 在这里补上）。
 */

import {existsSync} from "node:fs";
import {readdir, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";

export interface Notice {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly texts: ReadonlyArray<string>;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotices)(\..*)?$/iu;
const NOTICE_FILE = /^(notice|thirdpartynotices)(\..*)?$/iu;

/**
 * 模块路径里的 `node_modules/<包>` 目录。相对路径按当前工作目录解析：Bun 的 metafile 与 rolldown 的模块 id 都相对它
 * （从包目录运行时是 `../../node_modules/…`）。
 */
export function packageDirectories(modulePaths: Iterable<string>): Set<string> {
    const directories = new Set<string>();
    for (const path of modulePaths) {
        const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(path.replace(/^\0/u, ""));
        if (match) directories.add(resolve(match[1]!));
    }
    return directories;
}

/** 一个包目录的许可：`package.json` 的 `license`，加上目录里的 LICENSE、NOTICE 一类文件。两样都没有时失败。 */
export async function noticeOf(directory: string): Promise<Notice> {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {name: string; version: string; license?: unknown};
    const files = (await readdir(directory)).filter((name) => LICENSE_FILE.test(name)).sort();
    const texts = await Promise.all(files.map(async (name) => (await readFile(join(directory, name), "utf8")).trim()));
    const license = typeof manifest.license === "string" ? manifest.license : "";
    if (license === "" && texts.length === 0) throw new Error(`${manifest.name}@${manifest.version} 没有写许可：不能把它打进发布的包`);
    return {name: manifest.name, version: manifest.version, license: license || "见下文", texts};
}

/**
 * 不用列的包：工作区自己的、与发布包同一许可（AGPL-3.0-only）的包。自己的包换了许可的（nb-layout 是 MIT，ADR 0054 第 5 条）
 * 照列；别人家的包不论什么许可都列，哪怕也是 AGPL：声明要随包走的是它们的版权。
 */
export function sameLicenseAsRelease(name: string, license: string | undefined): boolean {
    return name.startsWith("@notnotype/") && license === "AGPL-3.0-only";
}

/** 一组包目录的许可，按目录排序；与发布包同一许可的自家包不列（`sameLicenseAsRelease`）。 */
export async function packageNotices(directories: Iterable<string>): Promise<Notice[]> {
    const notices = await Promise.all([...directories].sort().map(noticeOf));
    return notices.filter((notice) => !sameLicenseAsRelease(notice.name, notice.license));
}

interface ViteLicense {
    readonly name: string;
    readonly version: string;
    readonly identifier?: string;
    readonly text?: string;
}

/** Vite `build.license` 的许可清单；包在 `nodeModules` 下另有 NOTICE 文件的（例如 monaco-editor 的 ThirdPartyNotices）补上。 */
export async function viteLicenseNotices(licenseFile: string, nodeModules: string): Promise<Notice[]> {
    if (!existsSync(licenseFile)) throw new Error(`${licenseFile} 不存在：要用 vite build 构建（build.license）`);
    const entries = JSON.parse(await readFile(licenseFile, "utf8")) as ViteLicense[];
    return Promise.all(entries.filter((entry) => !sameLicenseAsRelease(entry.name, entry.identifier)).map(async (entry): Promise<Notice> => {
        if (!entry.identifier && !entry.text) throw new Error(`${entry.name}@${entry.version} 没有写许可`);
        const directory = join(nodeModules, entry.name);
        const notices = existsSync(directory) ? (await readdir(directory)).filter((name) => NOTICE_FILE.test(name)).sort() : [];
        const extra = await Promise.all(notices.map(async (name) => (await readFile(join(directory, name), "utf8")).trim()));
        return {name: entry.name, version: entry.version, license: entry.identifier ?? "见下文", texts: [...(entry.text ? [entry.text.trim()] : []), ...extra]};
    }));
}

/** 一节：标题加每个包的许可与文本。 */
export function noticeSection(title: string, notices: ReadonlyArray<Notice>): string {
    return [
        `## ${title}`,
        ...(notices.length === 0 ? ["没有打进第三方包。"] : notices.map((notice) => [`### ${notice.name}@${notice.version}（${notice.license}）`, ...notice.texts.map((text) => `\`\`\`\n${text}\n\`\`\``)].join("\n\n"))),
    ].join("\n\n");
}

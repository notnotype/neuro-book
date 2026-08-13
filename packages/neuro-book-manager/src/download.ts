import {readFile, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {gunzip, unzipSync} from "fflate";

import {ensureDirectory, safeTarget, sha256File} from "#manager/files";
import {run} from "#manager/process";

export type GitHubAsset = {
    name: string;
    url: string;
    sha256: string;
    bytes: number;
};

type GitHubReleaseResponse = {
    tag_name: string;
    prerelease: boolean;
    assets: Array<{
        name: string;
        browser_download_url: string;
        digest: string | null;
        size: number;
    }>;
};

/** 下载文件并验证 SHA256；GitHub Release 资产可能先返回临时 302。 */
export async function downloadVerified(url: string, target: string, sha256: string): Promise<void> {
    const response = await fetch(url, {headers: {"User-Agent": "neuro-book-manager"}, redirect: "follow"});
    if (!response.ok) {
        throw new Error(`下载失败 ${response.status}：${url}`);
    }
    await ensureDirectory(dirname(target));
    await writeFile(target, new Uint8Array(await response.arrayBuffer()));
    const actual = await sha256File(target);
    if (actual.toLowerCase() !== sha256.toLowerCase()) {
        throw new Error(`SHA256 校验失败：${basename(target)}，期望 ${sha256}，实际 ${actual}`);
    }
}

/** 从 GitHub latest release 解析带 digest 的资产。 */
export async function latestGitHubAsset(repository: string, select: (name: string, tag: string) => boolean): Promise<{tag: string; asset: GitHubAsset}> {
    return githubReleaseAsset(repository, undefined, select);
}

/** 从指定或 latest GitHub release 解析带 digest 的资产。 */
export async function githubReleaseAsset(
    repository: string,
    tag: string | undefined,
    select: (name: string, tag: string) => boolean,
): Promise<{tag: string; asset: GitHubAsset}> {
    const endpoint = tag
        ? `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
        : `https://api.github.com/repos/${repository}/releases/latest`;
    const response = await fetch(endpoint, {
        headers: {"Accept": "application/vnd.github+json", "User-Agent": "neuro-book-manager"},
    });
    if (!response.ok) {
        throw new Error(`读取 GitHub Release 失败 ${response.status}：${repository}`);
    }
    const release = await response.json() as GitHubReleaseResponse;
    const asset = release.assets.find((item) => select(item.name, release.tag_name));
    if (!asset) {
        throw new Error(`GitHub Release ${release.tag_name} 中没有匹配资产：${repository}`);
    }
    const digest = asset.digest?.match(/^sha256:([a-fA-F0-9]{64})$/)?.[1];
    if (!digest) {
        throw new Error(`GitHub 资产缺少 SHA256 digest：${asset.name}`);
    }
    return {
        tag: release.tag_name,
        asset: {
            name: asset.name,
            url: asset.browser_download_url,
            sha256: digest,
            bytes: asset.size,
        },
    };
}

/** 解压 zip，拒绝路径穿越。 */
export async function extractZip(archivePath: string, targetRoot: string): Promise<void> {
    const archive = new Uint8Array(await readFile(archivePath));
    // Manager 运行在 Bun；fflate 的异步 unzip 会对 512 KiB 以上高压缩条目启动
    // Blob Worker，而 Bun 1.3 的 Worker 不能稳定接收该 transferable payload。
    // 这里原本就一次性持有完整 archive 与全部解压结果，改用同步 API 不改变内存模型。
    const files = unzipSync(archive);
    for (const [relativePath, bytes] of Object.entries(files)) {
        if (relativePath.endsWith("/")) {
            // ZIP以尾部斜杠表达目录；InstallationRelativePath仍保持拒绝空segment的严格合同。
            await ensureDirectory(safeTarget(targetRoot, relativePath.slice(0, -1)));
            continue;
        }
        const target = safeTarget(targetRoot, relativePath);
        await ensureDirectory(dirname(target));
        await writeFile(target, bytes);
    }
}

/** 解压 tar.gz；Linux Product 与工具包使用系统 tar。 */
export async function extractTarGz(archivePath: string, targetRoot: string): Promise<void> {
    await ensureDirectory(targetRoot);
    await run("tar", ["-xpzf", archivePath, "-C", targetRoot]);
}

/** 根据扩展名解压组件。 */
export async function extractArchive(archivePath: string, targetRoot: string): Promise<void> {
    if (archivePath.endsWith(".zip")) {
        await extractZip(archivePath, targetRoot);
        return;
    }
    if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
        await extractTarGz(archivePath, targetRoot);
        return;
    }
    if (archivePath.endsWith(".gz")) {
        const output = join(targetRoot, basename(archivePath, ".gz"));
        await ensureDirectory(targetRoot);
        const archive = new Uint8Array(await readFile(archivePath));
        const extracted = await new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
            gunzip(archive, (error, bytes) => {
                if (error) rejectPromise(error);
                else resolvePromise(bytes);
            });
        });
        await writeFile(output, extracted);
        return;
    }
    throw new Error(`不支持的归档格式：${archivePath}`);
}

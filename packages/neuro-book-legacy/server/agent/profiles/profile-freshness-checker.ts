import {stat} from "node:fs/promises";
import {
    validateProfileArtifact,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContext,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {resolveRuntimeArtifactPath} from "nbook/server/utils/runtime-artifact-compiler-context";

export type ProfileArtifactPathContextProvider = (
    profileRoot: string,
    rootLabel: string,
) => ProfileArtifactPathContext | Promise<ProfileArtifactPathContext>;

export type ProfileArtifactFreshness = Awaited<ReturnType<typeof validateProfileArtifact>>;

export type ProfileDependencySignature = {
    path: string;
    mtimeMs?: number;
    size?: number;
    missing?: true;
};

export class ProfileFreshnessChecker {
    constructor(private readonly artifactPathContextProvider: ProfileArtifactPathContextProvider) {}

    /** 验证 manifest item 指向的源码、artifact 和依赖是否仍新鲜。 */
    async validate(profileRoot: string, rootLabel: string, item: ProfileArtifactManifestItem, options: {requireTypeArtifact?: boolean; checkDependencies?: boolean} = {}): Promise<ProfileArtifactFreshness> {
        const artifactPathContext = await this.artifactPathContextProvider(profileRoot, rootLabel);
        return validateProfileArtifact(profileRoot, item, artifactPathContext, options);
    }

    /** 生成 catalog dirty cache 的依赖文件签名；仅非 runtime registry 路径使用。 */
    async dependencySignatures(profileRoot: string, rootLabel: string, manifest: ProfileArtifactManifest): Promise<ProfileDependencySignature[]> {
        const artifactPathContext = await this.artifactPathContextProvider(profileRoot, rootLabel);
        const dependencyPaths = [...new Set(manifest.profiles.flatMap((profile) => profile.dependencies.map((dependency) => dependency.path)))].sort();
        return Promise.all(dependencyPaths.map(async (filePath) => {
            try {
                const fileStat = await stat(resolveRuntimeArtifactPath(filePath, artifactPathContext));
                return {
                    path: filePath,
                    mtimeMs: fileStat.mtimeMs,
                    size: fileStat.size,
                };
            } catch {
                return {
                    path: filePath,
                    missing: true,
                };
            }
        }));
    }
}

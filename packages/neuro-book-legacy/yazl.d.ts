declare module "yazl" {
    import type {Readable} from "node:stream";

    export type ZipFileEntryOptions = {
        mtime?: Date;
        mode?: number;
        compress?: boolean;
        compressionLevel?: number;
        forceZip64Format?: boolean;
        forceDosTimestamp?: boolean;
        fileComment?: string | Buffer;
    };

    export class ZipFile {
        readonly outputStream: Readable;

        addFile(realPath: string, metadataPath: string, options?: ZipFileEntryOptions): void;

        addEmptyDirectory(metadataPath: string, options?: ZipFileEntryOptions): void;

        end(): void;
    }
}

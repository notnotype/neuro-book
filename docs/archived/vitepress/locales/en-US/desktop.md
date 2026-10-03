# Desktop and Manager

Most Windows users should download `neuro-book-windows-x64.zip` from GitHub Releases, extract it and follow [Quick Start](/en/quick-start). Servers, multiple instances and existing Source checkouts use NeuroBook Manager:

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

Manager supports six installation profiles: `windows-portable`, `ghcr`, `product-bun`, `source-dev`, `source-product` and `source-docker`. Automation can start with a read-only audit:

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --dry-run --json
```

Electron and Tauri are the two Desktop Envelope hosts. They do not change the data contract: your work remains in a local Workspace. Public desktop releases, automatic updates and cross-platform installation remain governed by [PROJECT-STATUS](https://github.com/notnotype/neuro-book/blob/master/PROJECT-STATUS.md). See [Deployment](/en/deployment) and [Running, Data and Privacy](/en/operations).

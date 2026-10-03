# Content References

This document defines how NeuroBook content points to other workspace files and content nodes. It replaces the older separate content-reference module.

## Positioning

Content references use normal file paths. Current workspace references do not use `chapter://`, `lorebook://`, `db://` or `vfs://` as canonical targets. If old URI protocols enter workspace reference validation, they should be treated as migration errors, not as compatibility fallback.

Goals:

- Use Markdown-like file paths so humans and agents can read references directly.
- Use the same target rules for body inline links and structured `refs`.
- Content node references point to directories.
- Ordinary file references point to files.
- Validation catches broken paths, old protocols and path escapes.

## Legal Targets

Reference targets may be Project-relative, Markdown-relative, or absolute filesystem paths. Project-relative paths are preferred for authored Markdown because they survive file moves inside `manual/`, `manuscript/` and `lorebook/` better than deep relative links.

```text
../location/孤儿院/
../../manuscript/第一卷/第一章/
./draft.md
lorebook/location/initial-stage/
C:/Projects/neuro-book/workspace/my-project/lorebook/location/initial-stage/
```

Rules:

- Content node target points to a directory and keeps a trailing `/`.
- Ordinary file target points to a concrete file name, such as `./draft.md`.
- Project-relative paths resolve from the current Project Workspace root and are preferred in authored Markdown, for example `lorebook/location/initial-stage/`.
- Markdown-relative paths resolve from the current Markdown file directory and remain supported, for example `../location/孤儿院/`.
- Absolute filesystem paths are accepted when needed for local references, but are not recommended for durable project content.
- Workspace-root-like paths resolve from the configured reference base; current project paths are preferred in agent tool calls.
- External URLs stay normal Markdown links and do not enter workspace refs validation.

## Inline References

Inline references are natural mentions inside Markdown body text. Use them for appearance, mention, scene location and ordinary relatedness.

```markdown
她在 [孤儿院](../location/孤儿院/) 门前停下。
这段伏笔会在 [第一章](../../manuscript/第一卷/第一章/) 回收。
补充草稿见 [设定草稿](./draft.md)。
主角在 [荒野祭坛](lorebook/location/initial-stage/) 醒来。
```

The source of truth for inline references is the raw Markdown text. The system may derive `inlineRefs`, but authors and agents should not hand-maintain an `inlineRefs` field.

## Structured Refs

Structured `refs` express explicit stable relationships that the system should understand, such as definitions, constraints, dependencies, parent-child ownership, foreshadowing, payoff, direct causality, conflict or derivation.

```yaml
refs:
  - relation: foreshadows
    target: ../note/主角地球死亡原因/
    note: 该设定仍为 pending。
```

Fields:

- `relation`: free string. Recommended values include `defines`, `constrains`, `depends_on`, `part_of`, `contains`, `foreshadows`, `pays_off`, `conflicts_with`, `derived_from`.
- `target`: Project-relative path, Markdown-relative path, or absolute filesystem path inside the current Project Workspace.
- `note`: optional note.

Structured `refs` express relations. They do not express narrative disclosure, role knowledge or information-control permission.

Do not bulk-add all chapter characters, places and mechanisms into structured refs. If the relationship is only "mentioned", "appears in" or "related to", prefer inline Markdown links or omit it.

## Pending And Status

`pending` is not a reference protocol. It is content state.

- `draft`: draft, not stable fact.
- `pending`: unresolved question or unconfirmed setting.
- `active`: confirmed fact, usable by writing and retrieval.
- `archived`: retained history, not default current fact.

Unresolved settings should be content nodes with pending status, or collected under a project-specific pending notes area.

## Validation

`workspace node validate TARGET` should check:

- Project-relative, Markdown-relative or absolute target resolves inside the current Project Workspace.
- Target exists.
- Content node target uses directory path.
- Old protocols `chapter://`, `lorebook://`, `db://`, `vfs://` do not enter workspace reference validation.
- Deprecated status and legacy extension fields do not survive active content.

Old protocols are migration issues. Do not silently rewrite them without user or migration-tool intent.

## Agent Rules

When creating or editing content:

1. Create content nodes with `workspace node new`.
2. Edit `index.md` frontmatter and body.
3. Prefer Project-relative Markdown links inside prose; use Markdown-relative links only when they are clearer for nearby files.
4. Use structured refs only for stable semantic relations.
5. Run `workspace node validate TARGET` after moving or editing references.

Tool paths are not Markdown links, but Project-bound Agent file tools share the same Project-relative root. Use paths such as `lorebook/character/hero/`; use `workspace/<project>/...` only for explicit cross-project file access.

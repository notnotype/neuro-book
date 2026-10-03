# Markdown Studio

Markdown Studio is the main editing surface for prose and worldbuilding.

Its position is unambiguous: **the Markdown file is the long-term source of truth**, and the editor is only a view. Your manuscript is always a pile of `.md` files on disk that any editor can open, not a private format inside a database.

## Two editing modes

| Mode | Good for |
| --- | --- |
| Rich text | Writing with your head down. WYSIWYG, no syntax in the way |
| Source | Precise work on Markdown, frontmatter, references and dialect tags |

Both modes edit the same file, and you can switch at any time.

::: tip What frontmatter is
A block of configuration wrapped in `---` at the top of a file, recording metadata about it — which chapter it belongs to, for instance. You rarely write it by hand; the system maintains it.
:::

## Extended syntax

On top of standard Markdown, NeuroBook adds a few tags that novel writing actually needs.

**Comments** — leave notes to yourself or to the AI while you write, without them entering the prose:

```markdown
She looked up<comment body="pacing is too fast here">and met his eyes</comment>.
```

When the opening and closing tags each sit on their own line, the comment applies to the whole block:

```markdown
<comment body="POV is muddled throughout, needs a rewrite">
An entire paragraph of prose goes here.
</comment>
```

**Ruby** — pinyin, kana, an original term, a short gloss:

```markdown
Mr. <ruby text="hàn zì">汉字</ruby> was standing in the distance.
```

**Bilingual** — a full paragraph shown against its translation:

```markdown
<bilingual text="老人缓缓走向祭坛。">
The old man walked slowly toward the altar.
</bilingual>
```

**Renderable HTML** — only an explicit `<html>` block ever really renders. By default it shows as a source card, renders when you click it, and runs in a sandbox:

```markdown
<html>
<div style="text-align:center">The layout of a letter</div>
</html>
```

Unknown HTML tags outside `<html>` are **neither lost nor rendered**; the source is kept as is. That is deliberate — a web snippet you paste in will not suddenly execute inside your manuscript.

::: tip Lenient forms
The sloppy form where an opening tag hugs the end of a line and is immediately followed by a newline — something both humans and AI write easily — is normalized to the standard form when the editor reads the file. You do not have to fix it by hand.
:::

## Inline AI

Select a passage and call up the AI to revise it right there in the editor: streaming preview, in-place replacement, no break in your writing flow.

The key design point is that **it does not occupy your main session**. Inline AI runs on a separate background session; sending a request will not pop open the Agent panel on the right, and will not switch the main conversation you have going. In the PromptBar you can pick the current project's Inline AI session, start a new one, or swap the model for one request.

## Input and saving

The editor debounces: typing does not re-serialize the whole document on every keystroke. The debounce window settles on blur, on `Ctrl+S`, on submit, and when you switch modes.

**How external edits are handled**: if an Agent or another tool changes the file you are editing, the system settles your pending input first and then takes the snapshot, so disk content never overwrites the words you just typed. On a real conflict — the optimistic save lock fails — a diff view opens and you choose.

## Beyond files

The file tree you see in the editor is the real directory of your Project Workspace:

- `lorebook/`: stable canon
- `manuscript/`: prose chapters
- `world-engine/`: World Engine configuration

Agents read and write through the same paths. **What you see and what the AI sees are the same files**, with no hidden layer in between.

## Further reading

- [Full Markdown Dialect Spec](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/markdown-dialect.md)
- [llmlint Prose Linting](/en/core/llmlint): lint the manuscript once it is written.
- [Meet Your Novel Studio](/en/tutorials/01-studio-tour): a tour of the interface.

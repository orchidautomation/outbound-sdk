# Agent skills for outbound-sdk

Skills that teach a coding agent to use outbound-sdk well. Each folder is one skill in the [Agent Skills](https://agentskills.io) format: a `SKILL.md` with `name` and `description` frontmatter, plus the files it links to.

| Skill | For |
| --- | --- |
| [`outbound-sdk-answering`](outbound-sdk-answering/SKILL.md) | Answering campaign, sender and deliverability questions through the tools and insights, and reporting the numbers honestly |
| [`outbound-sdk-setup`](outbound-sdk-setup/SKILL.md) | Installing the SDK, choosing an adapter and key, and connecting `outbound mcp` or a server of your own to an agent client |
| [`outbound-sdk-plugin`](outbound-sdk-plugin/SKILL.md) | Writing and testing a plugin, and where adding an adapter is documented |

## Install one

Copy the folder into the agent's skills directory. For Claude Code that is `.claude/skills/` in a project, or `~/.claude/skills/` for every project:

```sh
cp -r skills/outbound-sdk-answering /path/to/project/.claude/skills/
```

Each skill is self-contained: it links only to its own files and to pages on [outbound-sdk.dev](https://outbound-sdk.dev).

## How they are checked

`skills/test/skills.test.ts` runs in `npm test`. It runs every script under a skill's `examples/` on the in-memory adapter and compares what it prints with the recorded `.out.txt`, as the site's samples are run. It also runs every `outbound …` line in a `sh` block through the real CLI on the in-memory adapter, resolves every link, and holds the question map to the SDK's tool and insight names. Re-record outputs with `UPDATE_EXAMPLES=1 npm test`, then read the diff.

Commands the test cannot run (building and installing the tarball, `claude mcp add`, starting the built `bin.js`) were run by hand on the date each skill gives. Run them again before you change what a skill says about them.

The rules are the site's: a skill says only what the SDK does today, holds no program that is not run, and shows no install command while the package is unpublished.

# ccm - Claude Code Model Manager

[![npm version](https://img.shields.io/npm/v/@leeandrew94/ccm.svg)](https://www.npmjs.com/package/@leeandrew94/ccm)
[![npm downloads](https://img.shields.io/npm/dm/@leeandrew94/ccm.svg)](https://www.npmjs.com/package/@leeandrew94/ccm)
[![license](https://img.shields.io/npm/l/@leeandrew94/ccm.svg)](https://www.npmjs.com/package/@leeandrew94/ccm)

Language：[English](#english) | [中文](README.zh.md)

## English

Run Claude Code with different AI models in separate terminals. One command per terminal, zero config conflicts.

ccm (Claude Code Model Manager) is a CLI tool that lets you run Claude Code with different AI models in different terminal windows at the same time. Each terminal gets its own model, API endpoint, and credentials — no shared config files, no conflicts. Switch models by name, track running instances, and manage profiles from the command line.

## Prerequisites

- **Node.js** >= 18.0.0
- **Claude Code** installed globally: `npm i -g @anthropic-ai/claude-code`

## Install

```bash
npm i -g @leeandrew94/ccm
```

## Uninstall

```bash
npm uninstall -g @leeandrew94/ccm

# (Optional) Remove config and runtime data
rm -rf ~/.ccm
```

## Quick Start

```bash
# Add a profile (interactive prompts for Base URL / Token / Model)
ccm add mimo

# Launch
ccm mimo

# Open another terminal, switch to a different model
ccm add deepseek
ccm deepseek

# See what's running
ccm ps
```

## Commands

| Command | Description |
|---|---|
| `ccm <name>` | Load profile and launch claude |
| `ccm add <name>` | Add a new profile |
| `ccm edit <name>` | Edit an existing profile |
| `ccm rm <name>` | Delete a profile |
| `ccm list` | List all profiles |
| `ccm config <name>` | Show profile env vars (no launch) |
| `ccm ps` | Show running instances |
| `ccm kill <name>` | Kill a running instance |
| `ccm kill --all` | Kill all running instances |
| `ccm check` | Check if claude is installed |
| `ccm test [name]` | Test API connection (omit name to test all) |
| `ccm balance [name]` | Query model balance/credits (omit name to query all) |

## Shell Completions

```bash
# zsh — add to ~/.zshrc
source <(ccm completions zsh)

# bash — add to ~/.bashrc
source <(ccm completions bash)
```

## Configuration

Profile config file `~/.ccm/profiles.json` (managed via `ccm add` / `ccm edit`):

```json
{
  "mimo": {
    "ANTHROPIC_BASE_URL": "https://api.example.com",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-name"
  }
}
```

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_BASE_URL` | Yes | API endpoint |
| `ANTHROPIC_AUTH_TOKEN` | Yes | API key |
| `ANTHROPIC_MODEL` | Yes | Model name |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | No | Haiku model mapping |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | Sonnet model mapping |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | No | Opus model mapping |

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=leeandrew94/ccm-cli&type=date&legend=top-left)](https://www.star-history.com/?type=date&repos=leeandrew94%2Fccm-cli)

## License

MIT

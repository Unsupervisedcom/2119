# REQ-007: CLI Help Conventions

## Overview

Found in the field: `npx rfc2119 init --help` executed `init` and scaffolded files into a repo
that was never meant to adopt the tool (2026-07-10, first external deployment). A `--help` flag
is a question, not a command — the CLI answers it with usage text and must never perform the
command's action, and in particular must never write files. Help interception happens before
command dispatch, for every command; it takes precedence because an explicit help request is a
human at a terminal, not an agent hook or scripted invocation.

## Requirements

### REQ-007.1: Help interception

1. Invoking the CLI as `2119 help`, `2119 --help`, or `2119 -h` MUST print the usage text and exit 0.
2. When any command is invoked with a `--help` or `-h` argument, the CLI MUST print the usage text and exit 0 without executing the command or writing any files.
3. Invoking the CLI with an unrecognized command MUST print the usage text and exit non-zero, so typos are distinguishable from successful help requests.

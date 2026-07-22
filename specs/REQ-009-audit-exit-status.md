# REQ-009: Audit Exit Status

## Overview

`2119 review --audit` is a discretionary quality-assurance command: it writes adversarial
instructions for requirements that already have passing verdicts so an operator can challenge
those verdicts with a fresh reviewer. Today, a successful audit-only run exits 1 even though no
required judgment review is pending. That makes a healthy periodic audit sweep look like a gate
failure to shell scripts and CI, and makes the `audit: always` configuration costly to automate.

Audit generation should report whether the command succeeded; the existing non-zero signal for
required, pending judgment reviews remains unchanged.

## Requirements

### REQ-009.1: Optional audit success

1. When `2119 review` generates one or more adversarial audit instruction files and no judgment review is pending, the command MUST exit 0.
2. When any judgment review is pending, `2119 review` MUST retain its non-zero exit status even if it also generates adversarial audit instruction files.

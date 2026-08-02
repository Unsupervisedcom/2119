---
expected_verdict: fail
prompt: test-quality
source: panopticon PR #112 follow-up review, 2026-08-02
failure_mode: scope inflation — singular evidence promoted into a plural category claim
---

## Requirement

> Task-service shell callers MUST authenticate their requests.

## Evidence

```sh
# 2119: FIX-001.1.1
test_task_lib_authenticates() {
  run_shell_with_recording_curl shell/task_lib.sh
  assert_recorded_argv_contains "Authorization: Bearer"
}
```

Candidate verdict summary: “The tests exercise authenticated shell-library requests.”

## Why the correct verdict is FAIL

The recording-stub technique honestly observes `shell/task_lib.sh`, but the candidate verdict
promotes that one named caller into plural “shell-library requests.” Its subject is broader than
its cited evidence. The summary must name `shell/task_lib.sh`; establishing the whole category
requires separate mechanical enumeration of the real caller set.

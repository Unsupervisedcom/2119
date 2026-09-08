---
expected_verdict: pass
prompt: test-quality
source: issue #38
failure_mode: legitimate derived inventory mistaken for a frozen literal
---

## Requirement

> Every registered administrative route MUST enforce authentication.

## Evidence

```ts
// 2119: FIX-001.1.1
const routes = runningApp.registeredRoutes().filter((route) => route.admin);
expect(routes.length).toBeGreaterThan(0);
for (const route of routes) expect(requestWithoutAuth(route)).toHaveStatus(401);
```

## Why the correct verdict is PASS

The inventory comes from the running product rather than a frozen test literal, and the
zero-subject assertion prevents vacuous success.

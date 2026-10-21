---
expected_verdict: pass
prompt: test-quality
source: accretion study (2119#38), 2026-10 (synthetic)
failure_mode: legitimate exception — derived security inventory whose subjects fail loudly
---

## Requirement

> Every admin route MUST reject unauthenticated requests with 401 before touching handlers.

## Evidence

```ts
// 2119: REQ-009.1.1
it("rejects unauthenticated access to every admin route", async () => {
  const app = await buildRealApp(); // the production server factory, not a mock
  const routes = await enumerateRoutes(app); // derived from the running product
  expect(routes.length).toBeGreaterThan(0);
  for (const route of routes.filter((r) => r.startsWith("/admin"))) {
    const res = await app.inject({ method: "GET", url: route });
    expect(res.statusCode).toBe(401);
  }
});
```

## Why the correct verdict is PASS

This resembles an inventory pin, but it is behavioral: the route list is derived from the
running product (not a frozen literal), zero subjects fail loudly (any future admin route
without an auth guard fails this test), and each assertion observes a real status code. A
derived inventory whose enumerated subjects fail loudly is legitimate security evidence. The
reviewer confirms the inventory comes from the real product and that an empty match fails the
test — not that the enumeration be smaller or the loop replaced with a hand-written list.

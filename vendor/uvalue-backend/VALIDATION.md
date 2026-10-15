# Backend release verification

Version 4.0.0, 15 October 2026.

- Standalone package: **123 tests passed**, 0 failures, 0 skipped.
- Complete source workspace: 124 tests passed; the extra test covers the offline browser bundle, which is omitted from this backend package.
- Actual HTTP smoke check: all **16 example constructions** calculated successfully through the supplied client and server.
- JSON Schema validated in strict Draft 2020-12 mode using AJV 8.20.0.
- The dependency-free runtime validator agreed with AJV on **349 valid/invalid construction cases**.
- OpenAPI validated independently using Swagger Parser 13.1.0.
- Frontend client and generated request types compiled under strict NodeNext settings using TypeScript 7.0.2, with an intentionally invalid numeric-string input rejected.

Tests cover published opaque-element and 2D conduction references, component windows/doors, net project areas, bridge accounting, thickness bounds and nonmonotonic correction cases, coupled-space heat conservation, schema errors, UTF-8 JSON handling, HTTP authentication/CORS, request/result limits, rate limiting, queue limits, worker timeout/replacement, cancellation and shutdown.

Node 24.19.0 on Windows was used. The release service has no npm runtime dependencies; independent contract/type validation tools were installed only in the temporary development workspace and are not required or included here.

The default service binds to loopback. No hosting deployment or container runtime was tested. Exact Elmhurst/BuildDesk equivalence, certification and the specialist cases listed in README.md / METHODS.md remain unverified. The browser UI is outside this backend package.

Reproduce service tests with:

```text
node backend/run-tests.mjs
node backend/smoke.mjs
```

Detailed test output: VALIDATION.txt. SHA256SUMS.txt identifies every included file except itself.

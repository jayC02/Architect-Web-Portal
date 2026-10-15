# U-value calculation backend — version 4

This is a standalone Node.js service for your website's frontend. It contains
the calculation engine, a versioned JSON API, strict input validation, batch and
project calculations, a thickness solver and a browser/Node client. It does not
depend on Elmhurst, BuildDesk, a proprietary DLL or an external calculation API.

## Run

Requires Node.js 22 or newer; tested with Node 24. No npm dependencies or
installation step are needed for the service.

```text
node backend/server.mjs
```

On this computer, **Start-backend.cmd** also locates the bundled Node runtime.
The default address is **http://127.0.0.1:8787**. Stop with Ctrl+C.
`GET /health` confirms that the process is running; `GET /ready` confirms a
calculation worker is ready. The service has no HTML interface.

Copy `.env.example` to `.env` if you want different settings, then use:

```text
node --env-file=.env backend/server.mjs
```

The Windows launcher loads `.env` when present. An ordinary `node backend/server.mjs`
reads environment variables already set by your host; it does not load `.env` automatically.

## Connect your frontend

Send JSON to the API from your website server or through a same-origin reverse
proxy. The frontend framework is independent of this service. This client runs
in browsers and Node:

```js
import {UValueClient, UValueApiError} from './backend/client.mjs';

const api = new UValueClient({baseUrl: '/uvalue-api'});
const construction = {
  element: 'layered_wall',
  layers: [
    {name: 'Insulation', thickness_mm: 100, conductivity: 0.04},
    {name: 'Plasterboard', thickness_mm: 12.5, conductivity: 0.21}
  ]
};

try {
  const result = await api.calculate(construction);
  console.log(result.u_value, result.u_value_2dp);
} catch (error) {
  if (error instanceof UValueApiError) {
    console.log(error.code, error.issues, error.requestId);
  }
}
```

Route `/uvalue-api/` on your host to the backend's root path. For a separate
website origin, set `CORS_ORIGINS` to the exact origin, such as
`https://www.example.com`. Origin wildcards and `null` origins are not accepted.
CORS is unnecessary for server-to-server requests without an Origin header.

An optional `UVALUE_API_KEY` enables bearer authentication. Keep a service key
in your website's server or proxy configuration; do not include it in public
frontend code. Your website can provide its own user login and access rules.
No accounts, database or user-project persistence are required by this stateless
calculation service. Store construction JSON and results in your website's database.

The package includes `client.d.ts` / `client.d.mts` and generated `contracts.d.ts`
for TypeScript. For direct use inside an existing Node backend:

```js
import {calculateConstruction, calculateProject, solveThickness}
  from './backend/calculations.mjs';
const result = calculateConstruction(construction);
```

The direct import is synchronous. Use the supplied HTTP service or your own
worker/job system for numerical meshes; its worker pool keeps calculation work
off the HTTP event loop.

## API

All POST requests use `Content-Type: application/json`. Every normal response
has `request_id`, `api_version`, `engine_version` and `data`. Errors replace
`data` with `error: {code, message, issues?}`. Issue paths are JSON Pointers
relative to the submitted request. OpenAPI is served as a raw document.

| Method and endpoint | Request / result |
| --- | --- |
| GET `/health` | Process liveness and pool counters |
| GET `/ready` | 200 when a worker is ready; 503 during startup/shutdown |
| GET `/v1/methods` | Method ids, units, scope and limitations |
| GET `/v1/schema` | JSON Schema in the normal `data` envelope |
| GET `/v1/openapi.json` | Raw OpenAPI 3.1 document |
| GET `/v1/examples` | 16 ids and labels |
| GET `/v1/examples/{id}` | One complete example input |
| POST `/v1/calculate` | `{construction, options?}` → calculated result |
| POST `/v1/validate` | `{construction}` → structural and physical validation |
| POST `/v1/batch` | `{items: [{id, construction}], options?}` → per-item results |
| POST `/v1/project` | Net element areas, openings and separate junction heat loss |
| POST `/v1/solve-thickness` | Minimum passing material thickness on a supplied grid |
| POST `/v1/unheated-network` | Connected passive unheated spaces and adjusted boundary U-values |

The static contracts are `backend/openapi.json` and `backend/schema.json`.
The latter validates a construction at its root; `$defs` also contains each
complete API request type. Unknown fields are rejected; application-specific
information belongs in construction `metadata`. Numeric strings are not coerced.
Physical applicability is checked in addition to JSON Schema. The validate
endpoint performs the calculation to check these conditions.

For example, POST `/v1/calculate`:

```json
{
  "construction": {
    "name": "Homogeneous test wall",
    "element": "layered_wall",
    "area_m2": 10,
    "layers": [{"thickness_mm": 100, "conductivity": 0.04}]
  }
}
```

The result's unrounded U is approximately 0.374531835 W/(m² K), with displayed
U = 0.37 and heat-loss coefficient approximately 3.74531835 W/K. Use unrounded
numbers for aggregation. `u_value_2dp` is a number; render `toFixed(2)` when a
trailing zero matters. Defaults and units are in `METHODS.md` and the method catalogue.

`options: {include_mesh_fields: true}` includes the full 2D cell field. It is
omitted by default to keep website responses compact. No input or output is
written to disk by normal calculation requests.

## Calculation families

The backend supports all 13 original wall/floor/roof/ground/numerical methods,
plus `window`, `door` and `supplied_u`. See `METHODS.md` for the opaque methods'
equations, public reference checks and limits.

Windows and doors use supplied projected component areas, U-values and edge
Ψ values: H = Σ(A U) + Σ(l Ψ), U = H / total projected area. Components partition
the opening and need compatible boundary conditions. The window method requires
frame and glazing; the door method also accepts opaque panels. Component evidence
is required. Glazing gas/radiation and detailed frame-profile U-values are inputs
to this method; they are not derived from raw glass/gas/profile geometry.

The formula and a rounded 0.88 worked example are corroborated by
[F1 Composite's engineering article](https://www.f1composite.com/resources/blog/en-iso-10077-window-u-value-calculation).
The implementation does not claim complete ISO 10077 qualification or a certified
product rating. `supplied_u` records an independently assessed whole-element U
with its evidence; the result clearly identifies that supplied method.

## Batch and project calculations

Batch requests accept up to 100 uniquely identified constructions. The request
must meet the schema. Physical calculation failures are then returned for their
individual items, with successful items preserved. A structurally invalid request
returns 422 for the whole batch.

Projects use gross areas and explicitly deduct their opening areas. They add
opaque H, opening H and separately assessed ΨL / χ×count terms. They return
transmission H, an area-weighted U and, when both temperatures are supplied,
transmission heat flow. Identical ids and openings larger than their parent reject.
Ground and other area-dependent constructions must use their actual calculation
reference area; their U cannot be rescaled to another ground geometry.

```json
{
  "elements": [{
    "id": "external-wall",
    "gross_area_m2": 20,
    "construction": {"element": "layered_wall", "layers": [{"resistance": 4.5}]},
    "openings": [{
      "id": "window-1", "area_m2": 2,
      "construction": {"element": "supplied_u", "u_value_w_m2k": 1.2, "evidence": "Applicable product assessment"}
    }]
  }],
  "junctions": [],
  "inside_temperature_c": 20,
  "outside_temperature_c": 0
}
```

Areas must follow a consistent reference convention. Bridges need evidence and
`not_already_included: true`. Current bridge inputs are non-negative; negative
assessed Ψ/χ values need a separately reviewed reference-dimension treatment.
These totals exclude whole-building ventilation, air leakage, gains and heating
plant. They are transmission calculations, not an energy-assessment model.

## Thickness solver

Supply `construction`, zero-based `layer_index`, `target_u_value_w_m2k`,
`minimum_thickness_mm`, `maximum_thickness_mm` and `increment_mm`. The chosen
layer must be defined by conductivity and thickness, with other inputs fixed.
The allowed family list and applicability are enforced. The grid starts at the
minimum thickness and advances by the supplied increment; the upper bound can
fall between grid points. The solver returns the first passing increment, its
recalculated result and construction, or `achievable: false` with the maximum
grid result. Plane constructions without corrections use binary search. Ground
branches and correction thresholds can create steps or nonmonotonic responses,
so those cases scan every grid point (at most 4096 increments). Targets compare
unrounded U. No regulatory target is selected for you.

## Connected unheated spaces

`/v1/unheated-network` solves a steady conductance matrix for up to 64 unheated
nodes. Each node supplies its external transmission-plus-ventilation H; links
supply inter-space H. Inside elements supply area and an unadjusted construction.
All exterior paths share one temperature and all inside paths share another.
The response includes temperature reduction factors, each effective U, node
temperatures when supplied, and a heat-conservation residual.

This original linear network extends the existing single-space balance. It
supports unequal inside element U-values and connected spaces. An unanchored
or ill-conditioned network rejects. Plane constructions need explicit still-air
cold-face R. Gains, thermal storage and an independent ground-temperature node
are outside the network. See `backend/example-unheated-network.json`.

## Service operation

| Setting | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | HTTP port |
| `UVALUE_API_KEY` | empty | Optional 24–1024 character service bearer key |
| `CORS_ORIGINS` | empty | Comma-separated exact HTTP(S) website origins |
| `CALCULATION_WORKERS` | `2` | 1–8 isolated calculation workers |
| `MAX_QUEUE` | `32` | Maximum waiting jobs |
| `CALCULATION_TIMEOUT_MS` | `15000` | Separate maximum queue wait and execution budgets |
| `MAX_BODY_BYTES` | `1048576` | Request JSON byte limit |
| `REQUESTS_PER_MINUTE` | `120` | Per direct peer IP; 0 disables this limiter |

The server ignores forwarded client-IP headers. Behind a proxy, use your
gateway's per-user/IP limits and account for the backend seeing the proxy's IP.
Workers are terminated and replaced on timeout, cancellation or unexpected exit.
Readiness stays responsive during calculation. Responses omit internal exception
stacks and secrets. The default response limit is 8 MiB; JSON admission also bounds
depth and value count. Large batches/meshes may need splitting.

Typical statuses: 400 malformed JSON/URL, 401 bearer key, 403 origin, 404 endpoint,
405 method, 413 body size, 415 media type, 422 schema/physical scope/result size,
429 rate, 503 queue/shutdown/worker failure, 504 execution deadline. CORS preflight
checks method and headers. Authentication and CORS are service integration
controls; your website supplies user authentication and HTTPS termination.

The included Dockerfile is an optional deployment starting point. Container
build/runtime has not been verified on this computer. The Node service itself
has been tested through real loopback HTTP, including authentication and worker
lifecycle behaviour. Deployment to your hosting account has not been performed.

## Verification and remaining scope

Run the bundled tests:

```text
node backend/run-tests.mjs
node backend/smoke.mjs
```

Rebuild generated contracts after editing the schema:

```text
node backend/generate-contracts.mjs
```

The tests combine the published opaque-element and numerical benchmark checks
with strict API examples, component arithmetic, project area accounting,
minimum-thickness selection, network heat conservation and HTTP/worker failure
cases. The release validation report records the final test count.

This is a working calculation backend with a complete website integration
contract for its stated methods. Exact Elmhurst/BuildDesk matching, full
current-standard qualification, 3D conduction, seasonal ground transfer,
specialist unsupported cavity/correction interactions and a proprietary product
catalogue remain outside the verified scope. No certification is implied.

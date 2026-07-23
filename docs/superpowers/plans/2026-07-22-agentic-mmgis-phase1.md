# Agentic MMGIS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MMGIS MCP server that lets any MCP client (Claude Code/Desktop) administer missions, generate complete dashboards from a description, search STAC catalogs for layers, and drive a live browser session (fly, toggle layers, open tools, set time).

**Architecture:** A standalone TypeScript package `mcp/` speaks MCP over stdio and reaches MMGIS through (a) the REST admin API using a long-term token in the `Authorization` header, (b) the existing WebSocket broadcast relay for browser control, and (c) the `scripts/generate-mission-config.js` CLI for dashboard generation. Browser-side, an `AgentBridge` Plugin-Component (the first in-tree component, per spec 011) executes a whitelisted set of view commands. **Zero backend changes required** — the WS server already relays arbitrary JSON.

**Tech Stack:** TypeScript + `@modelcontextprotocol/sdk` + `zod` + `ws` (mcp/); plain ES6 JS for the frontend component; Vitest for all tests.

## Global Constraints

- Node.js 20+ (repo requirement).
- Test runner is **Vitest**, not Jest (repo root: `npx vitest run tests/unit/<file>.spec.js`; inside `mcp/`: `npm test`). Root `package.json:53` defines `test:unit: vitest run`.
- Frontend code style: 4-space indent, single quotes, camelCase (match `src/essence/`).
- Commits: imperative mood, no `Co-Authored-By` trailer.
- Everything lands on branch `feature/agentic-mmgis`.
- WS envelope constants (used by BOTH `mcp/src/bridge.ts` and `AgentBridge.js` — must match exactly): outer `type: 'agent-bridge'`, `info: { type: 'agentBridge' }`, `body: { mission }`, payload under `agent: { kind: 'command'|'ack'|'presence', id, sessionId?, command?, args?, ok?, result?, error? }`. The `body.mission` + `info.type` fields exist so `src/essence/essence.js:212-319` processes our frames without warnings (it early-returns frames missing `body.mission` at `essence.js:220` and only special-cases `info.type` of `addLayer|updateLayer|removeLayer`).
- **Documented deviation from the design spec:** the spec says WS messages are "authenticated and rate-limited per constitution VII". MMGIS's WS server (`API/websocket.js:48-64`) is an unauthenticated broadcast relay with no rooms, validation, or rate limiting — for anyone, today. Phase 1 therefore keeps bridge commands strictly **view-only** (no data mutation) and schema-validated in the browser before execution. Hardening the relay is deferred (Phase 2 candidate).
- MMGIS env prerequisite for the bridge: `ENABLE_MMGIS_WEBSOCKETS=true` in `.env`.

## Key codebase facts (from research; verified 2026-07-22)

- Mission admin REST (mounted at `ROOT_PATH + /api/configure`, behind `ensureAdmin`): `GET /missions` → `{status, missions: [names]}` (`API/Backend/Config/routes/configs.js:604`); `GET /get?mission=X&full=true` → `{status, mission, config, version}` (`configs.js:245`); `POST /add` body `{mission, config?, makedir?}` (SuperAdmin only, merges posted config over template, does NOT run validate) (`configs.js:383,249`); `POST /upsert` body `{mission, config}` (runs `populateUUIDs` + `validate`, inserts new version) (`configs.js:600,403`).
- Long-term tokens: `Authorization` header, `Bearer ` prefix stripped by `validateLongTermToken` (`scripts/server.js:391-392`); minted via `POST /api/longtermtoken/generate` (session auth only — tokens can't mint tokens); token inherits creator's permission.
- Config generator CLI: `node scripts/generate-mission-config.js <profileNameOrPath> [--out|--stdout|--check]` (`scripts/generate-mission-config.js:8-17`); `--stdout` still runs full validation + template-superset assertion; profile shape = `{name, description, output?, tools: "all"|string[], exclude?, on?, overrides?, scaffold: {msv, projection, look, panelSettings, panels, time, layers}}`; scaffold copied verbatim; generator never mints layer UUIDs.
- WS: server relays every frame to ALL clients including sender (`API/websocket.js:48-64`); upgrade path must be exactly `(WEBSOCKET_ROOT_PATH || ROOT_PATH || '') + '/'` (`websocket.js:66-82`); no auth.
- Plugin-Components: discovery scans `src/essence/` for dirs containing `Plugin-Components`/`Private-Components` (`API/updateTools.js:272-282`), reads `<Component>/config.json`, generates `src/pre/components.js`; `ComponentController_.initializeComponents()` (`src/essence/Basics/ComponentController_/ComponentController_.js:34`) reads `L_.configData.components` (array of `{name, js, on, variables}`), calls `module.init(variables)` in try/catch; called after `fina()` in both `modern.js:342` and `essence.js:540`. `.gitignore:32-33` ignores these dirs — needs a negation for ours.
- Browser internals: `Map_.resetView([lat, lon, zoom])` (`src/essence/Basics/Map_/Map_.js:429`); `L_.asLayerUUID(nameOrUuid)` + `await L_.toggleLayer(L_.layers.data[uuid])` (`Layers_.js:442`), visibility in `L_.layers.on[uuid]`; `ToolController_.makeTool(name)` (`ToolController_.js:514`); `TimeControl.setTime(start, end, isRelative, timeOffset, currentTime)` (`TimeControl.js:92`); current mission in `L_.mission` (`Layers_.js:16`).

---

### Task 1: `mcp/` package scaffold + environment config

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/.gitignore`
- Create: `mcp/src/config.ts`
- Test: `mcp/tests/config.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `loadConfig(env?): McpConfig` where `McpConfig = { mmgisUrl: string; mmgisToken: string; wsUrl: string; repoRoot: string; mapboxToken: string; stacCatalogs: Record<string,string>; titilerUrl: string }`. All later tasks import `McpConfig`/`loadConfig` from `./config.js` (NodeNext ESM — internal imports use `.js` extensions).

- [ ] **Step 1: Create the package files**

`mcp/package.json`:
```json
{
  "name": "@mmgis/mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "mmgis-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "ws": "^8.18.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`mcp/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`mcp/.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 2: Install dependencies**

Run: `cd mcp && npm install`
Expected: lockfile created, no errors. (If a pinned version 404s, take the latest matching major — adjust `package.json` accordingly.)

- [ ] **Step 3: Write the failing test**

`mcp/tests/config.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

const base = { MMGIS_TOKEN: 'tok123' }

describe('loadConfig', () => {
    it('throws without MMGIS_TOKEN', () => {
        expect(() => loadConfig({})).toThrow(/MMGIS_TOKEN/)
    })
    it('defaults MMGIS_URL to localhost:8888 and strips trailing slashes', () => {
        expect(loadConfig({ ...base }).mmgisUrl).toBe('http://localhost:8888')
        expect(loadConfig({ ...base, MMGIS_URL: 'https://gis.example.com/' }).mmgisUrl).toBe('https://gis.example.com')
    })
    it('derives wsUrl from mmgisUrl unless MMGIS_WS_URL is set', () => {
        expect(loadConfig({ ...base }).wsUrl).toBe('ws://localhost:8888/')
        expect(loadConfig({ ...base, MMGIS_URL: 'https://gis.example.com' }).wsUrl).toBe('wss://gis.example.com/')
        expect(loadConfig({ ...base, MMGIS_WS_URL: 'ws://elsewhere:9000/' }).wsUrl).toBe('ws://elsewhere:9000/')
    })
    it('parses STAC_CATALOGS JSON and falls back to defaults', () => {
        expect(loadConfig({ ...base, STAC_CATALOGS: '{"mine":"https://stac.me"}' }).stacCatalogs).toEqual({ mine: 'https://stac.me' })
        expect(Object.keys(loadConfig({ ...base }).stacCatalogs)).toContain('veda')
    })
    it('resolves repoRoot to the MMGIS checkout by default', () => {
        expect(loadConfig({ ...base }).repoRoot.endsWith('MMGIS')).toBe(true)
    })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/config.spec.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 5: Implement `mcp/src/config.ts`**

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface McpConfig {
    mmgisUrl: string
    mmgisToken: string
    wsUrl: string
    repoRoot: string
    mapboxToken: string
    stacCatalogs: Record<string, string>
    titilerUrl: string
}

const DEFAULT_STAC_CATALOGS: Record<string, string> = {
    veda: 'https://openveda.cloud/api/stac',
    'earth-search': 'https://earth-search.aws.element84.com/v1',
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
    if (!env.MMGIS_TOKEN) {
        throw new Error(
            'MMGIS_TOKEN is required. Mint a long-term token: log into MMGIS as an admin, then POST /api/longtermtoken/generate (see mcp/README.md).'
        )
    }
    const mmgisUrl = (env.MMGIS_URL || 'http://localhost:8888').replace(/\/+$/, '')
    // MMGIS's WS upgrade only accepts path (WEBSOCKET_ROOT_PATH || ROOT_PATH || '') + '/'
    const wsUrl = env.MMGIS_WS_URL || mmgisUrl.replace(/^http/, 'ws') + '/'
    // mcp/src (dev) and mcp/dist (built) are both one level below mcp/
    const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    let stacCatalogs = DEFAULT_STAC_CATALOGS
    if (env.STAC_CATALOGS) {
        try {
            stacCatalogs = JSON.parse(env.STAC_CATALOGS)
        } catch {
            throw new Error('STAC_CATALOGS must be a JSON object of {name: url}')
        }
    }
    return {
        mmgisUrl,
        mmgisToken: env.MMGIS_TOKEN,
        wsUrl,
        repoRoot: env.MMGIS_REPO_ROOT || defaultRoot,
        mapboxToken: env.MAPBOX_TOKEN || '',
        stacCatalogs,
        titilerUrl: (env.TITILER_URL || 'https://titiler.xyz').replace(/\/+$/, ''),
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/config.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add mcp/package.json mcp/tsconfig.json mcp/.gitignore mcp/src/config.ts mcp/tests/config.spec.ts mcp/package-lock.json
git commit -m "Scaffold MMGIS MCP server package with env config"
```

---

### Task 2: MMGIS REST client

**Files:**
- Create: `mcp/src/mmgisClient.ts`
- Test: `mcp/tests/mmgisClient.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks (constructed with url/token strings).
- Produces: `class MMGISError extends Error { hint?: string }`; `class MmgisClient { constructor(baseUrl: string, token: string, fetchFn?: typeof fetch); listMissions(): Promise<string[]>; getMission(mission: string): Promise<{mission: string; config: any; version: number}>; addMission(mission: string, config: any): Promise<{mission: string; version: number}>; upsertMission(mission: string, config: any): Promise<{mission: string; version: number}> }`.

- [ ] **Step 1: Write the failing test**

`mcp/tests/mmgisClient.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { MmgisClient, MMGISError } from '../src/mmgisClient.js'

function fakeFetch(status: number, json: unknown) {
    return vi.fn(async () => ({ ok: status < 400, status, json: async () => json })) as unknown as typeof fetch
}

describe('MmgisClient', () => {
    it('sends the Authorization header and returns mission names', async () => {
        const f = fakeFetch(200, { status: 'success', missions: ['Demo'] })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        expect(await client.listMissions()).toEqual(['Demo'])
        const [url, init] = (f as any).mock.calls[0]
        expect(url).toBe('http://mm:8888/api/configure/missions')
        expect(init.headers.Authorization).toBe('Bearer tok')
    })
    it('getMission requests full config with encoded name', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'A B', config: { msv: {} }, version: 3 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const out = await client.getMission('A B')
        expect(out.version).toBe(3)
        expect((f as any).mock.calls[0][0]).toBe('http://mm:8888/api/configure/get?mission=A%20B&full=true')
    })
    it('addMission POSTs {mission, config, makedir}', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'X', version: 0 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await client.addMission('X', { msv: {} })
        const [, init] = (f as any).mock.calls[0]
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ mission: 'X', config: { msv: {} }, makedir: true })
    })
    it('throws MMGISError with the server message on status:failure', async () => {
        const f = fakeFetch(200, { status: 'failure', message: 'Mission already exists.' })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await expect(client.addMission('X', {})).rejects.toThrow('Mission already exists.')
    })
    it('throws MMGISError with a hint on HTTP errors', async () => {
        const f = fakeFetch(500, {})
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const err = await client.listMissions().catch((e) => e)
        expect(err).toBeInstanceOf(MMGISError)
        expect(err.hint).toMatch(/MMGIS_URL/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/mmgisClient.spec.ts`
Expected: FAIL — cannot find module `../src/mmgisClient.js`.

- [ ] **Step 3: Implement `mcp/src/mmgisClient.ts`**

```ts
export class MMGISError extends Error {
    constructor(message: string, public readonly hint?: string) {
        super(message)
        this.name = 'MMGISError'
    }
}

export class MmgisClient {
    constructor(
        private baseUrl: string,
        private token: string,
        private fetchFn: typeof fetch = fetch
    ) {}

    private async request(method: 'GET' | 'POST', apiPath: string, body?: unknown): Promise<any> {
        let res
        try {
            res = await this.fetchFn(`${this.baseUrl}${apiPath}`, {
                method,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            })
        } catch (err) {
            throw new MMGISError(
                `Could not reach MMGIS at ${this.baseUrl}: ${(err as Error).message}`,
                'Check MMGIS_URL and that the MMGIS server is running.'
            )
        }
        if (!res.ok) {
            throw new MMGISError(
                `MMGIS responded ${res.status} for ${apiPath}`,
                'Check MMGIS_URL and that MMGIS_TOKEN is a valid, unexpired long-term token.'
            )
        }
        const json = await res.json()
        if (json && json.status === 'failure') {
            throw new MMGISError(json.message || `MMGIS reported failure for ${apiPath}`)
        }
        return json
    }

    async listMissions(): Promise<string[]> {
        const json = await this.request('GET', '/api/configure/missions')
        return json.missions
    }

    async getMission(mission: string): Promise<{ mission: string; config: any; version: number }> {
        return await this.request('GET', `/api/configure/get?mission=${encodeURIComponent(mission)}&full=true`)
    }

    async addMission(mission: string, config: any): Promise<{ mission: string; version: number }> {
        return await this.request('POST', '/api/configure/add', { mission, config, makedir: true })
    }

    async upsertMission(mission: string, config: any): Promise<{ mission: string; version: number }> {
        return await this.request('POST', '/api/configure/upsert', { mission, config })
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/mmgisClient.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/mmgisClient.ts mcp/tests/mmgisClient.spec.ts
git commit -m "Add MMGIS REST client with long-term token auth"
```

---

### Task 3: MCP server skeleton + admin tools

**Files:**
- Create: `mcp/src/tools/result.ts`
- Create: `mcp/src/tools/admin.ts`
- Create: `mcp/src/server.ts`
- Create: `mcp/src/index.ts`
- Test: `mcp/tests/admin.spec.ts`
- Test: `mcp/tests/server.spec.ts`

**Interfaces:**
- Consumes: `MmgisClient`, `MMGISError` (Task 2); `McpConfig` (Task 1).
- Produces: `ToolDef = { name: string; description: string; schema: z.ZodRawShape; handler: (args: any) => Promise<{content: {type: 'text'; text: string}[]; isError?: boolean}> }`; `toToolResult(data: unknown)`, `toErrorResult(err: unknown)` (result.ts); `makeAdminTools(client: MmgisClient): ToolDef[]`; `buildServer(deps: { tools: ToolDef[] }): McpServer` (server.ts); `index.ts` as the stdio entrypoint. Tasks 5, 6, 8 each add a `make*Tools(...): ToolDef[]` factory and register it in `index.ts`.

- [ ] **Step 1: Write the failing tests**

`mcp/tests/admin.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeAdminTools } from '../src/tools/admin.js'
import { MMGISError } from '../src/mmgisClient.js'

const fakeClient = {
    listMissions: async () => ['Demo', 'Mars2020'],
    getMission: async (m: string) => ({ mission: m, config: { msv: { mission: m } }, version: 2 }),
} as any

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

describe('admin tools', () => {
    const tools = Object.fromEntries(makeAdminTools(fakeClient).map((t) => [t.name, t]))

    it('exposes mission_list and mission_get', () => {
        expect(Object.keys(tools).sort()).toEqual(['mission_get', 'mission_list'])
    })
    it('mission_list returns mission names', async () => {
        expect(parse(await tools.mission_list.handler({}))).toEqual({ missions: ['Demo', 'Mars2020'] })
    })
    it('mission_get returns config and version', async () => {
        const out = parse(await tools.mission_get.handler({ mission: 'Demo' }))
        expect(out.version).toBe(2)
        expect(out.config.msv.mission).toBe('Demo')
    })
    it('errors become structured {error, hint} results with isError', async () => {
        const failing = { listMissions: async () => { throw new MMGISError('boom', 'try this') } } as any
        const t = Object.fromEntries(makeAdminTools(failing).map((x) => [x.name, x]))
        const res = await t.mission_list.handler({})
        expect(res.isError).toBe(true)
        expect(parse(res)).toEqual({ error: 'boom', hint: 'try this' })
    })
})
```

`mcp/tests/server.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../src/server.js'
import { makeAdminTools } from '../src/tools/admin.js'

describe('buildServer', () => {
    it('registers tools and answers listTools over MCP', async () => {
        const server = buildServer({ tools: makeAdminTools({ listMissions: async () => [] } as any) })
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await server.connect(serverTransport)
        const client = new Client({ name: 'test', version: '0.0.0' })
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('mission_list')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp && npx vitest run tests/admin.spec.ts tests/server.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement result helpers, admin tools, server factory, entrypoint**

`mcp/src/tools/result.ts`:
```ts
import type { z } from 'zod'

export interface ToolDef {
    name: string
    description: string
    schema: z.ZodRawShape
    handler: (args: any) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>
}

export function toToolResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function toErrorResult(err: unknown) {
    const e = err as { message?: string; hint?: string }
    return {
        isError: true,
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({ error: e?.message || String(err), ...(e?.hint ? { hint: e.hint } : {}) }),
            },
        ],
    }
}
```

`mcp/src/tools/admin.ts`:
```ts
import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

export function makeAdminTools(client: MmgisClient): ToolDef[] {
    return [
        {
            name: 'mission_list',
            description: 'List all mission (dashboard) names in this MMGIS deployment.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ missions: await client.listMissions() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_get',
            description: "Get a mission's full configuration JSON and current version.",
            schema: { mission: z.string().describe('Mission name (see mission_list)') },
            handler: async ({ mission }: { mission: string }) => {
                try {
                    const out = await client.getMission(mission)
                    return toToolResult({ mission: out.mission, version: out.version, config: out.config })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
```

`mcp/src/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDef } from './tools/result.js'

export function buildServer(deps: { tools: ToolDef[] }): McpServer {
    const server = new McpServer({ name: 'mmgis', version: '0.1.0' })
    for (const t of deps.tools) {
        server.tool(t.name, t.description, t.schema, t.handler)
    }
    return server
}
```
(If the installed SDK version has deprecated `server.tool(name, description, schema, handler)`, use `server.registerTool(name, { description, inputSchema: t.schema }, t.handler)` instead — check `node_modules/@modelcontextprotocol/sdk` README and adapt; the `ToolDef` shape stays the same.)

`mcp/src/index.ts`:
```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { MmgisClient } from './mmgisClient.js'
import { makeAdminTools } from './tools/admin.js'
import { buildServer } from './server.js'

async function main() {
    const cfg = loadConfig()
    const client = new MmgisClient(cfg.mmgisUrl, cfg.mmgisToken)
    const server = buildServer({ tools: [...makeAdminTools(client)] })
    await server.connect(new StdioServerTransport())
    // stdio server runs until the client disconnects
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/admin.spec.ts tests/server.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verify the build compiles**

Run: `cd mcp && npm run build`
Expected: exit 0, `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add mcp/src mcp/tests
git commit -m "Add MCP server skeleton with mission admin tools"
```

---

### Task 4: Profile builder + config-generator invocation

**Files:**
- Create: `mcp/src/profileBuilder.ts`
- Create: `mcp/src/generator.ts`
- Test: `mcp/tests/profileBuilder.spec.ts`
- Test: `mcp/tests/generator.spec.ts`

**Interfaces:**
- Consumes: `MMGISError` (Task 2); `repoRoot` string from `McpConfig` (Task 1).
- Produces:
  - `DashboardSpec = { missionName: string; layers?: any[]; view?: {lat: number; lon: number; zoom: number}; tools?: string[]; on?: string[]; time?: Record<string, unknown>; overrides?: Record<string, {variables: Record<string, unknown>}>; pageName?: string }`
  - `buildProfile(spec: DashboardSpec, repoRoot: string): any` — full generator profile based on `mission-profiles/minimal.json`.
  - `generateConfig(profile: any, repoRoot: string): Promise<any>` — runs the CLI, returns the validated config object.
  - `resolvePlaceholders(config: any, mapboxToken: string): any`
  - `listAvailableTools(repoRoot: string): Promise<string[]>`
  - `AGENT_BRIDGE_COMPONENT = { name: 'AgentBridge', js: 'AgentBridge', on: true, variables: {} }` (exported constant; Task 5 injects it into generated configs — matches the component from Task 7).

- [ ] **Step 1: Write the failing tests**

`mcp/tests/profileBuilder.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProfile } from '../src/profileBuilder.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildProfile', () => {
    it('bases the profile on minimal.json with mission name applied', () => {
        const p = buildProfile({ missionName: 'AQ Atlanta' }, repoRoot)
        expect(p.scaffold.msv.mission).toBe('AQ Atlanta')
        expect(p.scaffold.msv.missionFolderName).toBe('AQ Atlanta')
        expect(p.tools).toContain('Title')
        expect(p.tools).toContain('LayerManager')
        expect(p.output).toBeUndefined()
    })
    it('applies view as a string triple and pageName', () => {
        const p = buildProfile(
            { missionName: 'M', view: { lat: 33.75, lon: -84.39, zoom: 10 }, pageName: 'Air Quality' },
            repoRoot
        )
        expect(p.scaffold.msv.view).toEqual(['33.75', '-84.39', '10'])
        expect(p.scaffold.look.pagename).toBe('Air Quality')
    })
    it('mints uuids for layers that lack one and fills envelope defaults', () => {
        const p = buildProfile(
            { missionName: 'M', layers: [{ name: 'NO2', type: 'TileLayer', url: 'https://t/{z}/{x}/{y}.png' }] },
            repoRoot
        )
        const layer = p.scaffold.layers[0]
        expect(layer.uuid).toMatch(/^[0-9a-f-]{36}$/)
        expect(layer.sublayers).toEqual([])
        expect(layer.visibility).toBe(true)
        expect(layer.name).toBe('NO2')
    })
    it('merges extra tools and overrides without dropping the minimal set', () => {
        const p = buildProfile(
            { missionName: 'M', tools: ['Chart'], on: ['Chart'], overrides: { Chart: { variables: { a: 1 } } } },
            repoRoot
        )
        expect(p.tools).toEqual(expect.arrayContaining(['Title', 'LayerManager', 'Chart']))
        expect(p.on).toContain('Chart')
        expect(p.overrides.Chart.variables.a).toBe(1)
    })
})
```

`mcp/tests/generator.spec.ts` (integration — runs the real repo CLI):
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProfile } from '../src/profileBuilder.js'
import { generateConfig, resolvePlaceholders, listAvailableTools } from '../src/generator.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('generateConfig (integration with scripts/generate-mission-config.js)', () => {
    it('generates a validated config from a built profile', async () => {
        const profile = buildProfile(
            {
                missionName: 'MCP Test',
                view: { lat: 33.75, lon: -84.39, zoom: 10 },
                layers: [
                    {
                        name: 'Basemap Test',
                        type: 'TileLayer',
                        sourceType: 'url',
                        url: 'https://tiles.example.com/{z}/{x}/{y}.png',
                        tileformat: 'wmts',
                        controlled: false,
                        initialOpacity: 1,
                        minZoom: 0,
                        maxNativeZoom: 18,
                        maxZoom: 22,
                    },
                ],
            },
            repoRoot
        )
        const config = await generateConfig(profile, repoRoot)
        expect(config.msv.mission).toBe('MCP Test')
        expect(config.tools.map((t: any) => t.name)).toContain('Title')
        expect(config.layers[0].name).toBe('Basemap Test')
    }, 30000)

    it('surfaces generator validation errors with a hint', async () => {
        const profile = buildProfile({ missionName: 'Bad' }, repoRoot)
        delete profile.scaffold.projection // break the template superset
        const err = await generateConfig(profile, repoRoot).catch((e) => e)
        expect(err.name).toBe('MMGISError')
        expect(err.hint).toMatch(/profile/i)
    }, 30000)
})

describe('resolvePlaceholders', () => {
    it('replaces {{MAPBOX_TOKEN}} everywhere', () => {
        const out = resolvePlaceholders({ a: { token: '{{MAPBOX_TOKEN}}' } }, 'pk.test')
        expect(out.a.token).toBe('pk.test')
    })
})

describe('listAvailableTools', () => {
    it('returns the generatable tool names', async () => {
        const names = await listAvailableTools(repoRoot)
        expect(names).toContain('Title')
        expect(names).toContain('LayerManager')
    }, 30000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp && npx vitest run tests/profileBuilder.spec.ts tests/generator.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `mcp/src/profileBuilder.ts`**

```ts
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface DashboardSpec {
    missionName: string
    layers?: any[]
    view?: { lat: number; lon: number; zoom: number }
    tools?: string[]
    on?: string[]
    time?: Record<string, unknown>
    overrides?: Record<string, { variables: Record<string, unknown> }>
    pageName?: string
}

// Mission-config entry that enables the AgentBridge browser component (Task 7)
export const AGENT_BRIDGE_COMPONENT = {
    name: 'AgentBridge',
    js: 'AgentBridge',
    on: true,
    variables: {},
}

export function buildProfile(spec: DashboardSpec, repoRoot: string): any {
    const minimal = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'mission-profiles', 'minimal.json'), 'utf8')
    )
    const profile = JSON.parse(JSON.stringify(minimal))
    profile.name = `agent-${spec.missionName}`
    profile.description = 'Generated by the MMGIS MCP server'
    delete profile.output
    profile.tools = Array.from(new Set([...minimal.tools, ...(spec.tools || [])]))
    profile.on = Array.from(new Set([...minimal.on, ...(spec.on || [])]))
    profile.overrides = spec.overrides || {}

    const scaffold = profile.scaffold
    scaffold.msv.mission = spec.missionName
    scaffold.msv.missionFolderName = spec.missionName
    if (spec.view) {
        scaffold.msv.view = [String(spec.view.lat), String(spec.view.lon), String(spec.view.zoom)]
    }
    if (spec.pageName) scaffold.look.pagename = spec.pageName
    if (spec.time) scaffold.time = spec.time
    scaffold.layers = (spec.layers || []).map((l) => ({
        uuid: randomUUID(),
        sublayers: [],
        visibility: true,
        ...l,
    }))
    return profile
}
```

- [ ] **Step 4: Implement `mcp/src/generator.ts`**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MMGISError } from './mmgisClient.js'

const execFileAsync = promisify(execFile)

export async function generateConfig(profile: any, repoRoot: string): Promise<any> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-mcp-'))
    const profilePath = path.join(tmpDir, 'profile.json')
    try {
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))
        const { stdout } = await execFileAsync(
            process.execPath,
            ['scripts/generate-mission-config.js', profilePath, '--stdout'],
            { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
        )
        return JSON.parse(stdout)
    } catch (err: any) {
        if (err instanceof SyntaxError) {
            throw new MMGISError('Config generator produced unparseable output', 'Run the generator manually to debug.')
        }
        const detail = String(err?.stderr || err?.message || err).trim()
        throw new MMGISError(`Config generation failed: ${detail}`, 'Fix the profile fields named in the error and retry.')
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
}

export function resolvePlaceholders(config: any, mapboxToken: string): any {
    // Tokens are URL-safe (alphanumeric + dots); plain string replace is safe here
    return JSON.parse(JSON.stringify(config).split('{{MAPBOX_TOKEN}}').join(mapboxToken))
}

export async function listAvailableTools(repoRoot: string): Promise<string[]> {
    const minimal = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'mission-profiles', 'minimal.json'), 'utf8')
    )
    const probe = JSON.parse(JSON.stringify(minimal))
    probe.tools = 'all'
    probe.on = []
    delete probe.output
    const config = await generateConfig(probe, repoRoot)
    return config.tools.map((t: { name: string }) => t.name)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/profileBuilder.spec.ts tests/generator.spec.ts`
Expected: PASS. (These shell out to the repo's real generator — first run may take a few seconds.)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/profileBuilder.ts mcp/src/generator.ts mcp/tests/profileBuilder.spec.ts mcp/tests/generator.spec.ts
git commit -m "Add dashboard profile builder wrapping the mission config generator"
```

---

### Task 5: Dashboard MCP tools (NL → mission)

**Files:**
- Create: `mcp/src/tools/dashboard.ts`
- Modify: `mcp/src/index.ts` (register dashboard tools)
- Test: `mcp/tests/dashboard.spec.ts`

**Interfaces:**
- Consumes: `buildProfile`, `DashboardSpec`, `AGENT_BRIDGE_COMPONENT` (Task 4); `generateConfig`, `resolvePlaceholders`, `listAvailableTools` (Task 4); `MmgisClient`, `MMGISError` (Task 2); `McpConfig` (Task 1); `ToolDef`, `toToolResult`, `toErrorResult` (Task 3).
- Produces: `makeDashboardTools(client: MmgisClient, cfg: McpConfig): ToolDef[]` exposing three tools: `dashboard_profile_schema`, `dashboard_tool_options`, `dashboard_generate`.

- [ ] **Step 1: Write the failing test**

`mcp/tests/dashboard.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeDashboardTools } from '../src/tools/dashboard.js'
import { MMGISError } from '../src/mmgisClient.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cfg = {
    mmgisUrl: 'http://mm:8888',
    mmgisToken: 't',
    wsUrl: 'ws://mm:8888/',
    repoRoot,
    mapboxToken: 'pk.test',
    stacCatalogs: {},
    titilerUrl: 'https://titiler.xyz',
} as any

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

describe('dashboard tools', () => {
    it('dashboard_profile_schema documents the DashboardSpec shape with layer examples', async () => {
        const tools = Object.fromEntries(makeDashboardTools({} as any, cfg).map((t) => [t.name, t]))
        const schema = parse(await tools.dashboard_profile_schema.handler({}))
        expect(schema.spec.missionName).toBeDefined()
        expect(schema.layerExamples.tile.type).toBe('TileLayer')
        expect(schema.layerExamples.geojson.type).toBe('GeoJsonLayer')
    })

    it('dashboard_generate builds, generates, injects AgentBridge, resolves tokens, and adds the mission', async () => {
        const calls: any[] = []
        const client = {
            addMission: async (mission: string, config: any) => {
                calls.push({ mission, config })
                return { mission, version: 0 }
            },
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const out = parse(
            await tools.dashboard_generate.handler({
                missionName: 'AQ Test',
                view: { lat: 33.7, lon: -84.4, zoom: 9 },
                layers: [
                    {
                        name: 'NO2',
                        type: 'TileLayer',
                        sourceType: 'url',
                        url: 'https://tiles.example.com/{z}/{x}/{y}.png',
                        tileformat: 'wmts',
                        controlled: false,
                        initialOpacity: 1,
                        minZoom: 0,
                        maxNativeZoom: 18,
                        maxZoom: 22,
                    },
                ],
            })
        )
        expect(out.mission).toBe('AQ Test')
        expect(out.url).toBe('http://mm:8888/?mission=AQ%20Test')
        const posted = calls[0].config
        expect(posted.components).toEqual([{ name: 'AgentBridge', js: 'AgentBridge', on: true, variables: {} }])
        expect(JSON.stringify(posted)).not.toContain('{{MAPBOX_TOKEN}}')
        expect(posted.msv.basemap.accessToken).toBe('pk.test')
    }, 30000)

    it('falls back to upsert when the mission exists and updateExisting is set', async () => {
        const client = {
            addMission: async () => {
                throw new MMGISError('Mission already exists.')
            },
            upsertMission: async (mission: string) => ({ mission, version: 4 }),
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const out = parse(await tools.dashboard_generate.handler({ missionName: 'AQ Test', updateExisting: true }))
        expect(out.version).toBe(4)
    }, 30000)

    it('reports exists-error with a hint when updateExisting is not set', async () => {
        const client = {
            addMission: async () => {
                throw new MMGISError('Mission already exists.')
            },
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const res = await tools.dashboard_generate.handler({ missionName: 'AQ Test' })
        expect(res.isError).toBe(true)
        expect(parse(res).hint).toMatch(/updateExisting/)
    }, 30000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/dashboard.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcp/src/tools/dashboard.ts`**

```ts
import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import type { McpConfig } from '../config.js'
import { buildProfile, AGENT_BRIDGE_COMPONENT, type DashboardSpec } from '../profileBuilder.js'
import { generateConfig, resolvePlaceholders, listAvailableTools } from '../generator.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

const LAYER_EXAMPLES = {
    tile: {
        name: 'Sentinel-2 True Color',
        type: 'TileLayer',
        sourceType: 'url',
        url: 'https://example.com/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png',
        tileformat: 'wmts',
        controlled: false,
        initialOpacity: 1,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
        boundingBox: [-88.1, 36.0, -86.8, 37.1],
        style: { brightness: 1, contrast: 1, saturation: 1, blend: 'none' },
        time: { enabled: false },
        variables: {},
    },
    geojson: {
        name: 'Monitoring Stations',
        type: 'GeoJsonLayer',
        sourceType: 'url',
        url: 'https://example.com/stations.geojson',
        controlled: false,
        initialOpacity: 1,
        visibility: true,
        style: {},
        variables: {},
    },
}

const dashboardGenerateSchema = {
    missionName: z.string().describe('Name for the new mission/dashboard'),
    layers: z
        .array(z.record(z.any()))
        .optional()
        .describe('MMGIS layer entries (see dashboard_profile_schema layerExamples). uuids are minted automatically.'),
    view: z
        .object({ lat: z.number(), lon: z.number(), zoom: z.number() })
        .optional()
        .describe('Initial map view'),
    tools: z.array(z.string()).optional().describe('Extra tools beyond Title+LayerManager (see dashboard_tool_options)'),
    on: z.array(z.string()).optional().describe('Tools that start opened'),
    time: z.record(z.any()).optional().describe('Time config, e.g. {"enabled": true}'),
    overrides: z.record(z.object({ variables: z.record(z.any()) })).optional(),
    pageName: z.string().optional().describe('Browser page title / branding'),
    updateExisting: z.boolean().optional().describe('If the mission exists, replace its config (new version)'),
}

export function makeDashboardTools(client: MmgisClient, cfg: McpConfig): ToolDef[] {
    return [
        {
            name: 'dashboard_profile_schema',
            description:
                'Get the input schema and layer-entry examples for dashboard_generate. Call this before generating a dashboard.',
            schema: {},
            handler: async () =>
                toToolResult({
                    spec: {
                        missionName: 'string (required)',
                        layers: 'array of MMGIS layer entries — see layerExamples',
                        view: '{lat, lon, zoom} initial map view',
                        tools: 'string[] extra tools (dashboard_tool_options lists valid names)',
                        on: 'string[] tools opened at start',
                        time: 'object, e.g. {"enabled": true} for time-enabled layers',
                        overrides: '{ToolName: {variables: {...}}} per-tool settings',
                        pageName: 'string page title',
                        updateExisting: 'boolean — replace config if mission exists',
                    },
                    layerExamples: LAYER_EXAMPLES,
                }),
        },
        {
            name: 'dashboard_tool_options',
            description: 'List tool names that dashboard_generate can include in a dashboard.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ tools: await listAvailableTools(cfg.repoRoot) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'dashboard_generate',
            description:
                'Generate a complete MMGIS mission (dashboard) from a description of layers, view, and tools, and install it. Returns the mission URL.',
            schema: dashboardGenerateSchema,
            handler: async (args: DashboardSpec & { updateExisting?: boolean }) => {
                try {
                    const profile = buildProfile(args, cfg.repoRoot)
                    let config = await generateConfig(profile, cfg.repoRoot)
                    config = resolvePlaceholders(config, cfg.mapboxToken)
                    // Injected after generation: `components` is not a template key,
                    // and /api/configure/add does not run backend validation.
                    config.components = [AGENT_BRIDGE_COMPONENT]
                    let out
                    try {
                        out = await client.addMission(args.missionName, config)
                    } catch (err: any) {
                        if (/already exists/i.test(err?.message || '') && args.updateExisting) {
                            out = await client.upsertMission(args.missionName, config)
                        } else if (/already exists/i.test(err?.message || '')) {
                            err.hint = 'Pass updateExisting: true to replace the existing mission config.'
                            throw err
                        } else {
                            throw err
                        }
                    }
                    return toToolResult({
                        mission: out.mission,
                        version: out.version,
                        url: `${cfg.mmgisUrl}/?mission=${encodeURIComponent(args.missionName)}`,
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
```

- [ ] **Step 4: Register in `mcp/src/index.ts`**

Add imports and extend the tools array:
```ts
import { makeDashboardTools } from './tools/dashboard.js'
```
and change the `buildServer` call to:
```ts
    const server = buildServer({
        tools: [...makeAdminTools(client), ...makeDashboardTools(client, cfg)],
    })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/dashboard.spec.ts && npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/dashboard.ts mcp/src/index.ts mcp/tests/dashboard.spec.ts
git commit -m "Add dashboard generation MCP tools"
```

---

### Task 6: STAC catalog tools

**Files:**
- Create: `mcp/src/stac.ts`
- Create: `mcp/src/tools/catalog.ts`
- Modify: `mcp/src/index.ts` (register catalog tools)
- Test: `mcp/tests/stac.spec.ts`
- Test: `mcp/tests/catalog.spec.ts`

**Interfaces:**
- Consumes: `McpConfig` (Task 1); `ToolDef`, `toToolResult`, `toErrorResult` (Task 3); `MMGISError` (Task 2).
- Produces:
  - `StacItemSummary = { id: string; collection: string; datetime: string | null; bbox: number[] | null; selfHref: string | null; assets: {key: string; title?: string; type?: string; href: string}[] }`
  - `searchStac(catalogUrl: string, params: {bbox?: number[]; datetime?: string; collections?: string[]; limit?: number}, fetchFn?: typeof fetch): Promise<StacItemSummary[]>`
  - `searchCollections(catalogUrl: string, keyword?: string, fetchFn?: typeof fetch): Promise<{id: string; title?: string; description?: string}[]>`
  - `stacItemToTileLayer(item: StacItemSummary, opts: {name: string; titilerUrl: string; asset?: string; rescale?: string; colormap?: string}): any`
  - `makeCatalogTools(cfg: McpConfig): ToolDef[]` exposing `catalog_collections`, `catalog_search`, `catalog_item_to_layer`.

- [ ] **Step 1: Write the failing tests**

`mcp/tests/stac.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { searchStac, searchCollections, stacItemToTileLayer } from '../src/stac.js'

const ITEM = {
    id: 'i1',
    collection: 'no2-monthly',
    bbox: [-90, 30, -80, 40],
    properties: { datetime: '2026-06-01T00:00:00Z' },
    links: [{ rel: 'self', href: 'https://stac.test/collections/no2-monthly/items/i1' }],
    assets: { cog_default: { href: 'https://data.test/i1.tif', type: 'image/tiff', title: 'COG' } },
}

function fakeFetch(json: unknown) {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => json })) as unknown as typeof fetch
}

describe('searchStac', () => {
    it('POSTs to /search and summarizes items', async () => {
        const f = fakeFetch({ features: [ITEM] })
        const items = await searchStac('https://stac.test', { bbox: [-90, 30, -80, 40], collections: ['no2-monthly'], limit: 5 }, f)
        expect((f as any).mock.calls[0][0]).toBe('https://stac.test/search')
        expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({
            bbox: [-90, 30, -80, 40],
            collections: ['no2-monthly'],
            limit: 5,
        })
        expect(items[0]).toEqual({
            id: 'i1',
            collection: 'no2-monthly',
            datetime: '2026-06-01T00:00:00Z',
            bbox: [-90, 30, -80, 40],
            selfHref: 'https://stac.test/collections/no2-monthly/items/i1',
            assets: [{ key: 'cog_default', title: 'COG', type: 'image/tiff', href: 'https://data.test/i1.tif' }],
        })
    })
})

describe('searchCollections', () => {
    it('filters collections by keyword across id/title/description', async () => {
        const f = fakeFetch({
            collections: [
                { id: 'no2-monthly', title: 'NO2 Monthly', description: 'Nitrogen dioxide' },
                { id: 'dem', title: 'Elevation', description: 'Terrain' },
            ],
        })
        const out = await searchCollections('https://stac.test', 'nitrogen', f)
        expect(out.map((c) => c.id)).toEqual(['no2-monthly'])
    })
})

describe('stacItemToTileLayer', () => {
    it('builds a TileLayer entry with a titiler stac tile URL', () => {
        const item = {
            id: 'i1',
            collection: 'no2-monthly',
            datetime: '2026-06-01T00:00:00Z',
            bbox: [-90, 30, -80, 40],
            selfHref: 'https://stac.test/collections/no2-monthly/items/i1',
            assets: [{ key: 'cog_default', href: 'https://data.test/i1.tif' }],
        }
        const layer = stacItemToTileLayer(item as any, { name: 'NO2 June', titilerUrl: 'https://titiler.xyz', asset: 'cog_default' })
        expect(layer.type).toBe('TileLayer')
        expect(layer.name).toBe('NO2 June')
        expect(layer.boundingBox).toEqual([-90, 30, -80, 40])
        expect(layer.url).toBe(
            'https://titiler.xyz/stac/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?url=' +
                encodeURIComponent('https://stac.test/collections/no2-monthly/items/i1') +
                '&assets=cog_default'
        )
    })
})
```

`mcp/tests/catalog.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeCatalogTools } from '../src/tools/catalog.js'

const cfg = { stacCatalogs: { test: 'https://stac.test' }, titilerUrl: 'https://titiler.xyz' } as any

describe('catalog tools', () => {
    const tools = Object.fromEntries(makeCatalogTools(cfg).map((t) => [t.name, t]))
    it('exposes the three catalog tools', () => {
        expect(Object.keys(tools).sort()).toEqual(['catalog_collections', 'catalog_item_to_layer', 'catalog_search'])
    })
    it('rejects unknown catalog names with the configured list in the hint', async () => {
        const res = await tools.catalog_search.handler({ catalog: 'nope' })
        expect(res.isError).toBe(true)
        expect(JSON.parse(res.content[0].text).hint).toContain('test')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp && npx vitest run tests/stac.spec.ts tests/catalog.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `mcp/src/stac.ts`**

```ts
import { MMGISError } from './mmgisClient.js'

export interface StacItemSummary {
    id: string
    collection: string
    datetime: string | null
    bbox: number[] | null
    selfHref: string | null
    assets: { key: string; title?: string; type?: string; href: string }[]
}

async function stacFetch(url: string, init: RequestInit | undefined, fetchFn: typeof fetch): Promise<any> {
    let res
    try {
        res = await fetchFn(url, init)
    } catch (err) {
        throw new MMGISError(
            `Could not reach STAC catalog at ${url}: ${(err as Error).message}`,
            'The catalog may be down — try another configured catalog, or use layers already in the deployment.'
        )
    }
    if (!res.ok) throw new MMGISError(`STAC catalog responded ${res.status} for ${url}`)
    return await res.json()
}

function summarizeItem(feature: any): StacItemSummary {
    return {
        id: feature.id,
        collection: feature.collection,
        datetime: feature.properties?.datetime ?? null,
        bbox: feature.bbox ?? null,
        selfHref: (feature.links || []).find((l: any) => l.rel === 'self')?.href ?? null,
        assets: Object.entries(feature.assets || {}).map(([key, a]: [string, any]) => ({
            key,
            ...(a.title ? { title: a.title } : {}),
            ...(a.type ? { type: a.type } : {}),
            href: a.href,
        })),
    }
}

export async function searchStac(
    catalogUrl: string,
    params: { bbox?: number[]; datetime?: string; collections?: string[]; limit?: number },
    fetchFn: typeof fetch = fetch
): Promise<StacItemSummary[]> {
    const body: Record<string, unknown> = { limit: params.limit ?? 10 }
    if (params.bbox) body.bbox = params.bbox
    if (params.datetime) body.datetime = params.datetime
    if (params.collections) body.collections = params.collections
    const json = await stacFetch(
        `${catalogUrl.replace(/\/+$/, '')}/search`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        fetchFn
    )
    return (json.features || []).map(summarizeItem)
}

export async function searchCollections(
    catalogUrl: string,
    keyword?: string,
    fetchFn: typeof fetch = fetch
): Promise<{ id: string; title?: string; description?: string }[]> {
    const json = await stacFetch(`${catalogUrl.replace(/\/+$/, '')}/collections`, undefined, fetchFn)
    let collections = (json.collections || []).map((c: any) => ({
        id: c.id,
        ...(c.title ? { title: c.title } : {}),
        ...(c.description ? { description: c.description } : {}),
    }))
    if (keyword) {
        const k = keyword.toLowerCase()
        collections = collections.filter((c: any) =>
            [c.id, c.title, c.description].some((s) => s && s.toLowerCase().includes(k))
        )
    }
    return collections
}

export function stacItemToTileLayer(
    item: StacItemSummary,
    opts: { name: string; titilerUrl: string; asset?: string; rescale?: string; colormap?: string }
): any {
    if (!item.selfHref) {
        throw new MMGISError(`STAC item ${item.id} has no self link; cannot build a tile URL`)
    }
    const asset = opts.asset || item.assets[0]?.key
    if (!asset) throw new MMGISError(`STAC item ${item.id} has no assets`)
    let url =
        `${opts.titilerUrl}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png` +
        `?url=${encodeURIComponent(item.selfHref)}&assets=${asset}`
    if (opts.rescale) url += `&rescale=${opts.rescale}`
    if (opts.colormap) url += `&colormap_name=${opts.colormap}`
    return {
        name: opts.name,
        type: 'TileLayer',
        sourceType: 'url',
        url,
        tileformat: 'wmts',
        controlled: false,
        visibility: true,
        initialOpacity: 1,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
        ...(item.bbox ? { boundingBox: item.bbox } : {}),
        style: { brightness: 1, contrast: 1, saturation: 1, blend: 'none' },
        time: { enabled: false },
        variables: {},
    }
}
```

- [ ] **Step 4: Implement `mcp/src/tools/catalog.ts`**

```ts
import { z } from 'zod'
import type { McpConfig } from '../config.js'
import { searchStac, searchCollections, stacItemToTileLayer } from '../stac.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

function resolveCatalog(cfg: McpConfig, catalog: string): string {
    if (/^https?:\/\//.test(catalog)) return catalog
    const url = cfg.stacCatalogs[catalog]
    if (!url) {
        throw new MMGISError(
            `Unknown catalog "${catalog}"`,
            `Configured catalogs: ${Object.keys(cfg.stacCatalogs).join(', ')} — or pass a full STAC API URL.`
        )
    }
    return url
}

export function makeCatalogTools(cfg: McpConfig): ToolDef[] {
    return [
        {
            name: 'catalog_collections',
            description: 'List/search dataset collections in a STAC catalog. Use to find data for a dashboard.',
            schema: {
                catalog: z.string().describe(`Catalog name (${Object.keys(cfg.stacCatalogs).join(', ')}) or a STAC API URL`),
                keyword: z.string().optional().describe('Filter by keyword, e.g. "no2", "fire", "flood"'),
            },
            handler: async ({ catalog, keyword }: { catalog: string; keyword?: string }) => {
                try {
                    return toToolResult({ collections: await searchCollections(resolveCatalog(cfg, catalog), keyword) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'catalog_search',
            description: 'Search a STAC catalog for items (scenes/granules) by collection, bbox, and datetime.',
            schema: {
                catalog: z.string().describe('Catalog name or STAC API URL'),
                collections: z.array(z.string()).optional(),
                bbox: z.array(z.number()).length(4).optional().describe('[west, south, east, north]'),
                datetime: z.string().optional().describe('RFC3339 interval, e.g. "2026-01-01T00:00:00Z/2026-06-30T23:59:59Z"'),
                limit: z.number().optional(),
            },
            handler: async ({ catalog, ...params }: any) => {
                try {
                    return toToolResult({ items: await searchStac(resolveCatalog(cfg, catalog), params) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'catalog_item_to_layer',
            description:
                'Convert a STAC item (from catalog_search) into an MMGIS TileLayer entry for dashboard_generate, rendered through TiTiler.',
            schema: {
                item: z.record(z.any()).describe('A StacItemSummary object exactly as returned by catalog_search'),
                name: z.string().describe('Display name for the layer'),
                asset: z.string().optional().describe('Asset key to render (defaults to the first asset)'),
                rescale: z.string().optional().describe('e.g. "0,255"'),
                colormap: z.string().optional().describe('e.g. "viridis"'),
            },
            handler: async ({ item, name, asset, rescale, colormap }: any) => {
                try {
                    return toToolResult({
                        layer: stacItemToTileLayer(item, { name, titilerUrl: cfg.titilerUrl, asset, rescale, colormap }),
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
```

- [ ] **Step 5: Register in `mcp/src/index.ts`**

Add `import { makeCatalogTools } from './tools/catalog.js'` and extend the tools array with `...makeCatalogTools(cfg)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/stac.spec.ts tests/catalog.spec.ts && npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/stac.ts mcp/src/tools/catalog.ts mcp/src/index.ts mcp/tests/stac.spec.ts mcp/tests/catalog.spec.ts
git commit -m "Add STAC catalog search and layer conversion tools"
```

---

### Task 7: AgentBridge frontend Plugin-Component

**Files:**
- Modify: `.gitignore` (add negation after line 33)
- Create: `src/essence/MMGIS-Plugin-Components/AgentBridge/config.json`
- Create: `src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`
- Create: `src/essence/MMGIS-Plugin-Components/AgentBridge/AgentBridge.js`
- Test: `tests/unit/agentBridgeCommands.spec.js`

**Interfaces:**
- Consumes: browser internals via injected deps (see Key codebase facts) — never imported by `commands.js` itself (dependency injection keeps it unit-testable).
- Produces: `executeCommand(command, args, deps): Promise<{ok: boolean, result?: any, error?: string}>` and `getViewState(deps)` from `commands.js`; `AgentBridge` default export with `init(vars)` from `AgentBridge.js`. The WS envelope produced here must match `mcp/src/bridge.ts` (Task 8) — see Global Constraints.

- [ ] **Step 1: Un-ignore the component directory**

In `.gitignore`, directly after line 33 (`/src/essence/*Plugin-Components*`), add:
```
!/src/essence/MMGIS-Plugin-Components/
```

Verify: `git check-ignore -v src/essence/MMGIS-Plugin-Components/AgentBridge/config.json || echo NOT_IGNORED` prints `NOT_IGNORED` (create the dir first if needed).

- [ ] **Step 2: Write the failing test**

`tests/unit/agentBridgeCommands.spec.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import {
    executeCommand,
    getViewState,
} from '../../src/essence/MMGIS-Plugin-Components/AgentBridge/commands'

function makeDeps() {
    return {
        Map_: {
            resetView: vi.fn(),
            map: { getCenter: () => ({ lat: 1, lng: 2 }), getZoom: () => 5 },
        },
        L_: {
            mission: 'Demo',
            asLayerUUID: (v) => (v === 'NO2' || v === 'uuid-1' ? 'uuid-1' : null),
            layers: { data: { 'uuid-1': { name: 'NO2' } }, on: { 'uuid-1': false } },
            toggleLayer: vi.fn(async function (l) {
                this.layers.on['uuid-1'] = !this.layers.on['uuid-1']
            }),
        },
        ToolController_: { makeTool: vi.fn(), activeToolName: 'LayerManager' },
        TimeControl: {
            setTime: vi.fn(() => true),
            getTime: () => '2026-06-01T00:00:00Z',
        },
    }
}

describe('executeCommand', () => {
    it('fly_to validates lat/lon and calls Map_.resetView', async () => {
        const deps = makeDeps()
        const res = await executeCommand('fly_to', { lat: 33.7, lon: -84.4, zoom: 9 }, deps)
        expect(res.ok).toBe(true)
        expect(deps.Map_.resetView).toHaveBeenCalledWith([33.7, -84.4, 9])
    })
    it('fly_to rejects non-numeric coordinates', async () => {
        const res = await executeCommand('fly_to', { lat: 'x', lon: 0 }, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/lat/)
    })
    it('toggle_layer resolves names to uuids and toggles', async () => {
        const deps = makeDeps()
        const res = await executeCommand('toggle_layer', { layer: 'NO2' }, deps)
        expect(res.ok).toBe(true)
        expect(res.result).toEqual({ layer: 'uuid-1', on: true })
    })
    it('toggle_layer is a no-op when already in the requested state', async () => {
        const deps = makeDeps()
        const res = await executeCommand('toggle_layer', { layer: 'NO2', on: false }, deps)
        expect(res.ok).toBe(true)
        expect(deps.L_.toggleLayer).not.toHaveBeenCalled()
    })
    it('toggle_layer errors on unknown layers', async () => {
        const res = await executeCommand('toggle_layer', { layer: 'Nope' }, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Unknown layer/)
    })
    it('open_tool calls ToolController_.makeTool', async () => {
        const deps = makeDeps()
        const res = await executeCommand('open_tool', { name: 'Chart' }, deps)
        expect(res.ok).toBe(true)
        expect(deps.ToolController_.makeTool).toHaveBeenCalledWith('Chart')
    })
    it('set_time requires startTime and endTime', async () => {
        const res = await executeCommand('set_time', { startTime: '2026-01-01T00:00:00Z' }, makeDeps())
        expect(res.ok).toBe(false)
    })
    it('get_view_state reports mission, center, zoom, layers, tool', async () => {
        const res = await executeCommand('get_view_state', {}, makeDeps())
        expect(res.ok).toBe(true)
        expect(res.result.mission).toBe('Demo')
        expect(res.result.center).toEqual({ lat: 1, lng: 2 })
        expect(res.result.zoom).toBe(5)
        expect(res.result.activeTool).toBe('LayerManager')
    })
    it('rejects unknown commands', async () => {
        const res = await executeCommand('rm_rf', {}, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Unknown command/)
    })
})

describe('getViewState', () => {
    it('tolerates a missing map object', () => {
        const deps = makeDeps()
        deps.Map_.map = null
        const state = getViewState(deps)
        expect(state.center).toBe(null)
        expect(state.zoom).toBe(null)
    })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/agentBridgeCommands.spec.js` (from repo root)
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `commands.js`**

`src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`:
```js
// Whitelisted, view-only commands the agent bridge can execute.
// All MMGIS internals arrive via `deps` so this module stays unit-testable.

function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v)
}

export function getViewState(deps) {
    const { Map_, L_, ToolController_, TimeControl } = deps
    return {
        mission: L_.mission || null,
        center: Map_.map && Map_.map.getCenter ? Map_.map.getCenter() : null,
        zoom: Map_.map && Map_.map.getZoom ? Map_.map.getZoom() : null,
        layersOn: L_.layers ? L_.layers.on : {},
        activeTool: ToolController_ ? ToolController_.activeToolName : null,
        currentTime: TimeControl && TimeControl.getTime ? TimeControl.getTime() : null,
    }
}

export async function executeCommand(command, args, deps) {
    const { Map_, L_, ToolController_, TimeControl } = deps
    const a = args || {}
    switch (command) {
        case 'fly_to': {
            if (!isFiniteNumber(a.lat) || !isFiniteNumber(a.lon))
                return { ok: false, error: 'fly_to requires numeric lat and lon' }
            Map_.resetView([a.lat, a.lon, isFiniteNumber(a.zoom) ? a.zoom : undefined])
            return { ok: true, result: getViewState(deps) }
        }
        case 'toggle_layer': {
            if (typeof a.layer !== 'string')
                return { ok: false, error: 'toggle_layer requires a layer name or uuid' }
            const uuid = L_.asLayerUUID(a.layer)
            if (uuid == null || L_.layers.data[uuid] == null)
                return { ok: false, error: `Unknown layer: ${a.layer}` }
            const current = L_.layers.on[uuid]
            if (typeof a.on === 'boolean' && current === a.on)
                return { ok: true, result: { layer: uuid, on: current } }
            await L_.toggleLayer(L_.layers.data[uuid])
            return { ok: true, result: { layer: uuid, on: L_.layers.on[uuid] } }
        }
        case 'open_tool': {
            if (typeof a.name !== 'string')
                return { ok: false, error: 'open_tool requires a tool name' }
            ToolController_.makeTool(a.name)
            return { ok: true, result: { activeTool: ToolController_.activeToolName } }
        }
        case 'set_time': {
            if (!a.startTime || !a.endTime)
                return { ok: false, error: 'set_time requires startTime and endTime (ISO strings)' }
            const ok = TimeControl.setTime(a.startTime, a.endTime, false, '00:00:00', a.currentTime)
            if (ok === false)
                return { ok: false, error: 'Time is not enabled for this mission' }
            return { ok: true, result: { currentTime: TimeControl.getTime() } }
        }
        case 'get_view_state':
            return { ok: true, result: getViewState(deps) }
        default:
            return { ok: false, error: `Unknown command: ${command}` }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agentBridgeCommands.spec.js`
Expected: PASS (10 tests).

- [ ] **Step 6: Implement `AgentBridge.js` and `config.json`**

`src/essence/MMGIS-Plugin-Components/AgentBridge/config.json`:
```json
{
    "AgentBridge": {
        "name": "AgentBridge",
        "description": "Lets the MMGIS MCP server drive this browser session (fly, toggle layers, open tools, set time) over the MMGIS websocket.",
        "defaultIcon": "robot",
        "hasVars": false,
        "config": { "rows": [] },
        "paths": {
            "AgentBridge": "essence/MMGIS-Plugin-Components/AgentBridge/AgentBridge"
        }
    }
}
```

`src/essence/MMGIS-Plugin-Components/AgentBridge/AgentBridge.js`:
```js
import Map_ from '../../Basics/Map_/Map_'
import L_ from '../../Basics/Layers_/Layers_'
import ToolController_ from '../../Basics/ToolController_/ToolController_'
import TimeControl from '../../Basics/TimeControl_/TimeControl'
import { executeCommand } from './commands'

// Envelope contract shared with mcp/src/bridge.ts — keep in sync.
const FRAME_TYPE = 'agent-bridge'
const RECONNECT_MS = 10000

const AgentBridge = {
    ws: null,
    sessionId: null,

    init: function (vars) {
        this.sessionId =
            window.crypto && window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : String(Math.random()).slice(2)
        this.connect()
    },

    getWsPath: function () {
        const g = window.mmgisglobal || {}
        if (g.ENABLE_MMGIS_WEBSOCKETS !== 'true') return null
        const protocol =
            window.location.protocol.indexOf('https') !== -1 ? 'wss' : 'ws'
        const rootPath = g.WEBSOCKET_ROOT_PATH || g.ROOT_PATH || ''
        const host =
            g.NODE_ENV === 'development'
                ? `localhost:${parseInt(g.PORT || '8888', 10)}`
                : window.location.host
        return `${protocol}://${host}${rootPath}/`
    },

    connect: function () {
        const path = this.getWsPath()
        if (path == null) {
            console.warn(
                '[AgentBridge] Websockets disabled (ENABLE_MMGIS_WEBSOCKETS != true); agent bridge inactive.'
            )
            return
        }
        try {
            this.ws = new WebSocket(path)
        } catch (err) {
            console.warn('[AgentBridge] Failed to open websocket:', err)
            setTimeout(() => this.connect(), RECONNECT_MS)
            return
        }
        this.ws.onopen = () => {
            this.send({ kind: 'presence', sessionId: this.sessionId })
        }
        this.ws.onmessage = (event) => this.onMessage(event)
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), RECONNECT_MS)
        }
    },

    send: function (agent) {
        if (!this.ws || this.ws.readyState !== 1) return
        this.ws.send(
            JSON.stringify({
                type: FRAME_TYPE,
                body: { mission: L_.mission },
                info: { type: 'agentBridge' },
                agent,
            })
        )
    },

    onMessage: async function (event) {
        let parsed
        try {
            parsed = JSON.parse(event.data)
        } catch (err) {
            return
        }
        if (parsed == null || parsed.type !== FRAME_TYPE) return
        if (parsed.agent == null || parsed.agent.kind !== 'command') return
        if (parsed.body == null || parsed.body.mission !== L_.mission) return

        const { id, command, args } = parsed.agent
        let outcome
        try {
            outcome = await executeCommand(command, args, {
                Map_,
                L_,
                ToolController_,
                TimeControl,
            })
        } catch (err) {
            outcome = { ok: false, error: `Command threw: ${err.message}` }
        }
        this.send({
            kind: 'ack',
            id,
            sessionId: this.sessionId,
            ok: outcome.ok,
            result: outcome.result,
            error: outcome.error,
        })
    },
}

export default AgentBridge
```

- [ ] **Step 7: Regenerate the component registry and verify discovery**

Run: `node -e "require('./API/updateTools').updateComponents()"`
Expected: `src/pre/components.js` now imports AgentBridge and exports it in `componentModules`; `configure/public/componentConfigs.json` includes AgentBridge. Verify with: `grep AgentBridge src/pre/components.js`.

- [ ] **Step 8: Run the full unit suite to check for regressions**

Run: `npx vitest run`
Expected: all tests pass (pre-existing suite + new commands tests). If root vitest picks up `mcp/tests/*.spec.ts` and fails on them, add `mcp/**` to the root vitest config's `exclude` (check `vitest.config.*` at repo root) — mcp tests run via `cd mcp && npm test`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore src/essence/MMGIS-Plugin-Components tests/unit/agentBridgeCommands.spec.js
git commit -m "Add AgentBridge plugin component for browser-side agent control"
```

**Known risk (verify during Task 9 manual E2E):** in modern mode the active tool controller may be `ToolControllerModern_` rather than `ToolController_` — if `open_tool` doesn't activate tools in the live app, wire the modern controller into the deps object in `AgentBridge.js` (commands.js needs no change).

---

### Task 8: Bridge client + view MCP tools

**Files:**
- Create: `mcp/src/bridge.ts`
- Create: `mcp/src/tools/view.ts`
- Modify: `mcp/src/index.ts` (register view tools)
- Test: `mcp/tests/bridge.spec.ts`

**Interfaces:**
- Consumes: `wsUrl` from `McpConfig` (Task 1); `ToolDef`/result helpers (Task 3); envelope contract (Global Constraints, matching Task 7's `AgentBridge.js`).
- Produces: `class BridgeClient { constructor(wsUrl: string, timeoutMs?: number); sendCommand(mission: string, command: string, args: object): Promise<any>; close(): void }`; `makeViewTools(bridge: BridgeClient): ToolDef[]` exposing `view_fly_to`, `view_toggle_layer`, `view_open_tool`, `view_set_time`, `view_get_state`.

- [ ] **Step 1: Write the failing test**

`mcp/tests/bridge.spec.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import { BridgeClient } from '../src/bridge.js'

// Mimics MMGIS API/websocket.js: relay every frame to ALL clients (sender included)
function startRelay(): Promise<{ wss: WebSocketServer; url: string }> {
    return new Promise((resolve) => {
        const wss = new WebSocketServer({ port: 0 }, () => {
            const { port } = wss.address() as { port: number }
            resolve({ wss, url: `ws://127.0.0.1:${port}/` })
        })
        wss.on('connection', (ws) => {
            ws.on('message', (m) => {
                for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(m.toString())
            })
        })
    })
}

// Fake AgentBridge browser session
function fakeBrowser(url: string, mission: string, respond: (agent: any) => any): WebSocket {
    const ws = new WebSocket(url)
    ws.on('message', (m) => {
        const parsed = JSON.parse(m.toString())
        if (parsed.type !== 'agent-bridge' || parsed.agent?.kind !== 'command') return
        if (parsed.body?.mission !== mission) return
        ws.send(
            JSON.stringify({
                type: 'agent-bridge',
                body: { mission },
                info: { type: 'agentBridge' },
                agent: { kind: 'ack', id: parsed.agent.id, sessionId: 's1', ...respond(parsed.agent) },
            })
        )
    })
    return ws
}

describe('BridgeClient', () => {
    let wss: WebSocketServer, browser: WebSocket | null = null, bridge: BridgeClient

    afterEach(() => {
        bridge?.close()
        browser?.close()
        wss?.close()
    })

    it('sends a command frame and resolves with the ack result', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'Demo', (agent) => ({ ok: true, result: { echoed: agent.command } }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 2000)
        const result = await bridge.sendCommand('Demo', 'fly_to', { lat: 1, lon: 2 })
        expect(result).toEqual({ echoed: 'fly_to' })
    })

    it('rejects with the browser-reported error on failed acks', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'Demo', () => ({ ok: false, error: 'Unknown layer: X' }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 2000)
        await expect(bridge.sendCommand('Demo', 'toggle_layer', { layer: 'X' })).rejects.toThrow('Unknown layer: X')
    })

    it('times out with a helpful hint when no session responds', async () => {
        const relay = await startRelay()
        wss = relay.wss
        bridge = new BridgeClient(relay.url, 300)
        const err = await bridge.sendCommand('Demo', 'fly_to', {}).catch((e) => e)
        expect(err.message).toMatch(/No browser session/)
        expect(err.hint).toMatch(/AgentBridge/)
    })

    it('ignores acks for other missions (browser filters by mission)', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'OtherMission', () => ({ ok: true, result: {} }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 300)
        await expect(bridge.sendCommand('Demo', 'fly_to', {})).rejects.toThrow(/No browser session/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/bridge.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcp/src/bridge.ts`**

```ts
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { MMGISError } from './mmgisClient.js'

export class BridgeClient {
    private ws: WebSocket | null = null

    constructor(private wsUrl: string, private timeoutMs = 5000) {}

    private connect(): Promise<WebSocket> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve(this.ws)
        }
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl)
            ws.once('open', () => {
                this.ws = ws
                resolve(ws)
            })
            ws.once('error', (err) => {
                reject(
                    new MMGISError(
                        `Could not connect to the MMGIS websocket at ${this.wsUrl}: ${err.message}`,
                        'Set ENABLE_MMGIS_WEBSOCKETS=true in the MMGIS .env and check MMGIS_WS_URL.'
                    )
                )
            })
        })
    }

    async sendCommand(mission: string, command: string, args: object): Promise<any> {
        const ws = await this.connect()
        const id = randomUUID()
        const frame = JSON.stringify({
            type: 'agent-bridge',
            body: { mission },
            info: { type: 'agentBridge' },
            agent: { kind: 'command', id, command, args },
        })
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup()
                reject(
                    new MMGISError(
                        `No browser session responded for mission "${mission}" within ${this.timeoutMs}ms`,
                        'Open the mission in a browser — the AgentBridge component must be enabled in its config (dashboard_generate does this automatically).'
                    )
                )
            }, this.timeoutMs)
            const onMessage = (data: WebSocket.RawData) => {
                try {
                    const parsed = JSON.parse(data.toString())
                    if (parsed?.type === 'agent-bridge' && parsed.agent?.kind === 'ack' && parsed.agent.id === id) {
                        cleanup()
                        if (parsed.agent.ok) resolve(parsed.agent.result)
                        else reject(new MMGISError(parsed.agent.error || 'Command failed in the browser'))
                    }
                } catch {
                    // non-JSON or unrelated frame — ignore
                }
            }
            const cleanup = () => {
                clearTimeout(timer)
                ws.off('message', onMessage)
            }
            ws.on('message', onMessage)
            ws.send(frame)
        })
    }

    close() {
        this.ws?.close()
        this.ws = null
    }
}
```

- [ ] **Step 4: Implement `mcp/src/tools/view.ts`**

```ts
import { z } from 'zod'
import type { BridgeClient } from '../bridge.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

export function makeViewTools(bridge: BridgeClient): ToolDef[] {
    const run = async (mission: string, command: string, args: object) => {
        try {
            return toToolResult({ result: await bridge.sendCommand(mission, command, args) })
        } catch (err) {
            return toErrorResult(err)
        }
    }
    const mission = z.string().describe('Mission name of the browser session to drive')
    return [
        {
            name: 'view_fly_to',
            description: "Fly a connected browser session's map to a lat/lon (and optional zoom).",
            schema: { mission, lat: z.number(), lon: z.number(), zoom: z.number().optional() },
            handler: ({ mission, ...args }: any) => run(mission, 'fly_to', args),
        },
        {
            name: 'view_toggle_layer',
            description: 'Toggle (or set) a layer\'s visibility in a connected browser session.',
            schema: {
                mission,
                layer: z.string().describe('Layer name or uuid'),
                on: z.boolean().optional().describe('Target state; omit to flip'),
            },
            handler: ({ mission, ...args }: any) => run(mission, 'toggle_layer', args),
        },
        {
            name: 'view_open_tool',
            description: 'Open a tool panel (e.g. Chart, Measure) in a connected browser session.',
            schema: { mission, name: z.string().describe('Tool name') },
            handler: ({ mission, ...args }: any) => run(mission, 'open_tool', args),
        },
        {
            name: 'view_set_time',
            description: 'Set the global time range in a connected browser session (time must be enabled).',
            schema: {
                mission,
                startTime: z.string().describe('ISO datetime'),
                endTime: z.string().describe('ISO datetime'),
                currentTime: z.string().optional(),
            },
            handler: ({ mission, ...args }: any) => run(mission, 'set_time', args),
        },
        {
            name: 'view_get_state',
            description: 'Get the current view state (center, zoom, layers on, active tool, time) of a connected browser session.',
            schema: { mission },
            handler: ({ mission }: any) => run(mission, 'get_view_state', {}),
        },
    ]
}
```

- [ ] **Step 5: Register in `mcp/src/index.ts`**

Final `index.ts` main body:
```ts
import { BridgeClient } from './bridge.js'
import { makeViewTools } from './tools/view.js'
```
and:
```ts
    const bridge = new BridgeClient(cfg.wsUrl)
    const server = buildServer({
        tools: [
            ...makeAdminTools(client),
            ...makeDashboardTools(client, cfg),
            ...makeCatalogTools(cfg),
            ...makeViewTools(bridge),
        ],
    })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/bridge.spec.ts && npm test && npm run build`
Expected: bridge tests PASS; full mcp suite PASS; build exit 0.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/bridge.ts mcp/src/tools/view.ts mcp/src/index.ts mcp/tests/bridge.spec.ts
git commit -m "Add websocket bridge client and browser view control tools"
```

---

### Task 9: Wiring, docs, and the demo runbook

**Files:**
- Create: `.mcp.json` (repo root)
- Create: `mcp/README.md`
- Modify: `AGENTS.md` (one line in Project Structure)

**Interfaces:**
- Consumes: everything prior; no new code.
- Produces: a registered project MCP server + a human-executable demo checklist.

- [ ] **Step 1: Register the MCP server for this project**

`.mcp.json` (repo root; if the file already exists, merge the `mmgis` entry into `mcpServers`):
```json
{
    "mcpServers": {
        "mmgis": {
            "command": "node",
            "args": ["mcp/dist/index.js"],
            "env": {
                "MMGIS_URL": "http://localhost:8888",
                "MMGIS_TOKEN": "${MMGIS_TOKEN}"
            }
        }
    }
}
```

- [ ] **Step 2: Write `mcp/README.md`**

```markdown
# MMGIS MCP Server

Lets AI agents (any MCP client — Claude Code, Claude Desktop, ...) drive MMGIS:
administer missions, generate dashboards from natural language, search STAC
catalogs for data layers, and control a live browser session.

## Setup

1. `cd mcp && npm install && npm run build`
2. In the MMGIS `.env`, set `ENABLE_MMGIS_WEBSOCKETS=true` (needed for
   browser control) and start MMGIS (`npm start`).
3. Mint a long-term API token (must be done with an admin **session** — tokens
   cannot mint tokens). Log into MMGIS as an admin in a browser, then run in
   the devtools console:

   ```js
   fetch('/api/longtermtoken/generate', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ name: 'mcp', period: 'never' }),
   }).then((r) => r.json()).then(console.log)
   ```

   Copy `body.token`. The token inherits your permission (create missions
   requires a SuperAdmin's token).
4. `export MMGIS_TOKEN=<token>` — the repo `.mcp.json` picks it up, or
   register manually: `claude mcp add mmgis -- node mcp/dist/index.js`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MMGIS_URL` | `http://localhost:8888` | MMGIS base URL (include ROOT_PATH if set) |
| `MMGIS_TOKEN` | (required) | Long-term token, sent as `Authorization: Bearer ...` |
| `MMGIS_WS_URL` | derived from `MMGIS_URL` | Websocket endpoint (`ws://host:port/`) |
| `MMGIS_REPO_ROOT` | auto (this checkout) | MMGIS repo containing `scripts/generate-mission-config.js` |
| `MAPBOX_TOKEN` | empty | Substituted into generated configs' basemap |
| `STAC_CATALOGS` | veda + earth-search | JSON object `{name: stacApiUrl}` |
| `TITILER_URL` | `https://titiler.xyz` | TiTiler used for `catalog_item_to_layer` tile URLs |

## Tools

- `mission_list`, `mission_get` — admin plane
- `dashboard_profile_schema`, `dashboard_tool_options`, `dashboard_generate` — NL → dashboard
- `catalog_collections`, `catalog_search`, `catalog_item_to_layer` — STAC data discovery
- `view_fly_to`, `view_toggle_layer`, `view_open_tool`, `view_set_time`, `view_get_state` — live browser control (requires an open browser session on the mission; `dashboard_generate` enables the AgentBridge component automatically)

## Demo (end-to-end)

Ask your MCP client:

> Set up an MMGIS dashboard called "Air Quality Atlanta" showing NO2 data
> over the southeastern US, then fly the view to Atlanta.

Expected flow: `catalog_collections`(keyword no2) → `catalog_search` →
`catalog_item_to_layer` → `dashboard_generate` → open the returned URL in a
browser → `view_fly_to`.

## Manual E2E checklist

- [ ] `mission_list` returns the deployment's missions
- [ ] `dashboard_generate` creates a mission that loads in the browser
- [ ] With the mission open in a browser: `view_get_state` returns the mission name
- [ ] `view_fly_to` visibly moves the map
- [ ] `view_toggle_layer` flips a layer on/off (check LayerManager)
- [ ] `view_open_tool` opens a tool panel (if not: wire `ToolControllerModern_` — see Task 7 note)
- [ ] `view_*` with no browser open returns the "No browser session" hint

## Security notes

- Bridge commands are view-only and whitelist-validated in the browser
  (`src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`).
- The MMGIS websocket relay is unauthenticated upstream; do not expose it
  publicly on deployments where that matters (Phase 2 hardening candidate).
```

- [ ] **Step 3: Add `mcp/` to AGENTS.md project structure**

In the `Project Structure` tree in `AGENTS.md`, after the `configure/` line, add:
```
├── mcp/                          # MCP server: agents drive MMGIS + generate dashboards
```

- [ ] **Step 4: Full verification sweep**

Run: `cd mcp && npm test && npm run build && cd .. && npx vitest run`
Expected: all suites pass.

- [ ] **Step 5: Execute the manual E2E checklist against a live deployment**

Use the `mmgis-deployment` skill to boot a dev instance (with `ENABLE_MMGIS_WEBSOCKETS=true`), mint a token, register the MCP server, and walk the checklist in `mcp/README.md`. Record any deviations (especially the modern-mode `open_tool` risk from Task 7) and fix before closing the task.

- [ ] **Step 6: Commit**

```bash
git add .mcp.json mcp/README.md AGENTS.md
git commit -m "Register MMGIS MCP server and add setup/demo documentation"
```

---

## Spec coverage map

| Spec (Phase 1) requirement | Task |
| --- | --- |
| MCP server package, stdio transport, MMGIS_URL/MMGIS_TOKEN config | 1, 3 |
| Admin plane tools over existing REST | 2, 3 — trimmed to `mission_list`/`mission_get`; layers are managed via `dashboard_generate`, and geodataset CRUD (not needed for the milestone demo) moves to Phase 2 |
| `dashboard_generate` + `get_profile_schema` (named `dashboard_profile_schema`) via config generator | 4, 5 |
| Catalog search (STAC) returning profile-ready layers | 6 |
| AgentBridge Plugin-Component, whitelisted commands, per-mission scoping | 7 |
| ~5 browser commands (`fly_to`, `toggle_layer`, `open_tool`, `set_time`, `get_view_state`) | 7, 8 |
| Structured errors `{error, hint}`, atomic generation, 5s browser timeout, catalog degradation | 2, 4, 6, 8 |
| Testing: unit (mocked REST/WS), integration (real generator), manual E2E runbook | all, 9 |
| Deviation: WS auth/rate-limit deferred (upstream relay has none) | Global Constraints |

Out of Phase 1 scope (per spec): streamable HTTP transport, CMR search (STAC covers the demo; CMR is additive later), data upload/ingestion tools, screenshots, plugin scaffolding (Phase 3).

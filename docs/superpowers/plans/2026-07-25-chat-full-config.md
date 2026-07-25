# Chat-Driven Full Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 14 new MCP tools so the chat can edit existing dashboards live (merge-patch + layer tools with real-time refresh in open sessions) and run admin operations (mission clone/delete, geodataset list/ingest/delete, user list/create/permissions) with a visible confirm-in-chat protocol.

**Architecture:** Everything lands in `mcp/` (TypeScript, NodeNext ESM): `MmgisClient` grows methods for the existing REST endpoints; a `mergePatch` util + `editConfig` helper implement get → mutate → upsert(`forceClientUpdate`); new tool groups `edit.ts` and admin additions register in `index.ts`. One tiny frontend addition (`reload` bridge command) and one minimal, flagged backend change (token annotation for `/api/users/signup`). Chat app: only the system prompt changes.

**Tech Stack:** existing mcp/ package (TS, zod, vitest); one bridge command in `chat`-side AgentBridge component (plain JS); ~15 lines of backend JS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-chat-full-config-design.md`. Branch: `feature/agentic-mmgis`.
- TypeScript NodeNext, `.js` internal imports in mcp/; frontend 4-space single-quote; commits imperative, NO Co-Authored-By trailer.
- Structured tool results only (`toToolResult`/`toErrorResult`; `{error, hint}`).
- Destructive tools (`mission_delete`, `geodataset_delete`, `user_create`, `user_set_permission`) require `confirm: true`; without it return `{needsConfirmation: true, ...preview}` and make NO mutating client call.
- Merge-patch semantics are RFC 7386: non-object patch (incl. arrays) replaces; object patches recurse; `null` deletes the key.
- Live refresh contract (verified in code): `/upsert` accepts `forceClientUpdate` and optional `info`; the frontend AUTO-APPLIES only when `info.type ∈ {addLayer, updateLayer, removeLayer}` AND `forceClientUpdate` (essence.js:229-271); any other `info.type` shows a one-click RELOAD button. Layer tools therefore send layer-typed `info`; `mission_update_config`/`tool_toggle` rely on RELOAD or the new `view_reload` bridge command.
- Tests: `cd mcp && npm test` (+ targeted vitest runs per task); root `npx vitest run` must stay green.

## Verified endpoint facts (from code research, 2026-07-25 — file:line refs in `.superpowers/sdd/` explorer reports)

- `POST /api/configure/upsert` body `{mission, config, forceClientUpdate?, info?}`; guarded by `checkMissionPermission` (honors long-term tokens); response `{status, mission, version, newlyAddedUUIDs}`; broadcasts `{info, body, forceClientUpdate}` over WS after persisting (configs.js:561-571). Default `info.type` is `'upsert'`.
- `POST /api/configure/clone` body `{existingMission, cloneMission, hasPaths?}`; shells out to `execFile("python", ["private/api/create_mission.py", ...])` — **may fail on hosts without a `python` binary** (macOS often has only `python3`); response = add()'s response. No route-level permission check (behind ensureAdmin only).
- `POST /api/configure/destroy` body `{mission}`; deletes all config rows, renames `Missions/<name>` dir to `<name>_deleted_`; success `{status:'success', message:'Successfully Deleted Mission: <name>'}`. No route-level permission check.
- `POST /api/geodatasets/entries` (no body) → `{status, body: {entries: [{name, updated, filename, num_features, occurrences: {mission: [...]}}]}}`. Token-friendly (ensureAdmin no-args).
- `POST /api/geodatasets/recreate/:name` — HTTP body is the RAW GeoJSON FeatureCollection; response `{status, message, body}`. `DELETE /api/geodatasets/remove/:name` → `{status, message}`. Both token-friendly.
- Geodataset → layer: layer entry `type: 'vector'`, `url: 'geodatasets:<name>'` (Layers_.js:3918).
- `GET /api/accounts/entries` → `{status, body: {entries: [{id, username, email, permission, missions_managing, ...}]}}`. `POST /api/accounts/update` body `{id, permission?, email?, missions_managing?}` — permission applied ONLY if exactly `'110'` or `'001'`; `missions_managing` only with `'110'`; user id 1 permission-protected. Both behind ensureAdmin → token-friendly.
- `POST /api/users/signup` body `{username, password, skipLogin: true}` — creates permission `'001'`; password must be ≥8 chars with upper+lower+number+symbol; **gate checks `req.session.permission === '111'` only** (users.js:82-96) and `/api/users` is NOT behind ensureAdmin, so `req.isLongTermToken` is never set → token-based creation requires the Task 5 backend change (flagged).

---

### Task 1: MmgisClient endpoint methods

**Files:**
- Modify: `mcp/src/mmgisClient.ts`
- Test: `mcp/tests/mmgisClient.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `request()` private helper, `MMGISError`.
- Produces (later tasks rely on these EXACT signatures):
  - `upsertMission(mission: string, config: any, opts?: {forceClientUpdate?: boolean; info?: {type: string; layerName?: string | string[]}}): Promise<{mission, version}>` — body gains `forceClientUpdate`/`info` only when provided (existing two-arg callers unchanged).
  - `cloneMission(existingMission: string, cloneMission: string): Promise<any>` → POST `/api/configure/clone`.
  - `destroyMission(mission: string): Promise<{message: string}>` → POST `/api/configure/destroy`.
  - `geodatasetEntries(): Promise<any[]>` → POST `/api/geodatasets/entries`, returns `json.body.entries`.
  - `geodatasetRecreate(name: string, geojson: any): Promise<any>` → POST `/api/geodatasets/recreate/${encodeURIComponent(name)}` with the RAW geojson as body.
  - `geodatasetRemove(name: string): Promise<{message: string}>` → DELETE `/api/geodatasets/remove/${encodeURIComponent(name)}`.
  - `accountEntries(): Promise<any[]>` → GET `/api/accounts/entries`, returns `json.body.entries`.
  - `accountUpdate(input: {id: number; permission?: '110' | '001'; missionsManaging?: string[]}): Promise<any>` → POST `/api/accounts/update` body `{id, permission, missions_managing}` (snake_case on the wire).
  - `userSignup(username: string, password: string): Promise<any>` → POST `/api/users/signup` body `{username, password, skipLogin: true}`.
  - `request` gains DELETE support: change its method union to `'GET' | 'POST' | 'DELETE'`.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('MmgisClient', ...)` in `mcp/tests/mmgisClient.spec.ts` (reuse its `fakeFetch` helper):

```ts
    it('upsertMission passes forceClientUpdate and info only when provided', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'X', version: 2 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await client.upsertMission('X', { a: 1 })
        expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ mission: 'X', config: { a: 1 } })
        await client.upsertMission('X', { a: 1 }, { forceClientUpdate: true, info: { type: 'updateLayer', layerName: 'L' } })
        expect(JSON.parse((f as any).mock.calls[1][1].body)).toEqual({
            mission: 'X', config: { a: 1 }, forceClientUpdate: true, info: { type: 'updateLayer', layerName: 'L' },
        })
    })
    it('cloneMission and destroyMission hit the configure endpoints', async () => {
        const f = fakeFetch(200, { status: 'success' })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await client.cloneMission('A', 'B')
        expect((f as any).mock.calls[0][0]).toBe('http://mm:8888/api/configure/clone')
        expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ existingMission: 'A', cloneMission: 'B' })
        await client.destroyMission('A')
        expect((f as any).mock.calls[1][0]).toBe('http://mm:8888/api/configure/destroy')
        expect(JSON.parse((f as any).mock.calls[1][1].body)).toEqual({ mission: 'A' })
    })
    it('geodataset methods use the right verbs, paths, and raw bodies', async () => {
        const f = fakeFetch(200, { status: 'success', body: { entries: [{ name: 'g1' }] } })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        expect(await client.geodatasetEntries()).toEqual([{ name: 'g1' }])
        expect((f as any).mock.calls[0][1].method).toBe('POST')
        const fc = { type: 'FeatureCollection', features: [] }
        await client.geodatasetRecreate('my set', fc)
        expect((f as any).mock.calls[1][0]).toBe('http://mm:8888/api/geodatasets/recreate/my%20set')
        expect(JSON.parse((f as any).mock.calls[1][1].body)).toEqual(fc)
        await client.geodatasetRemove('my set')
        expect((f as any).mock.calls[2][1].method).toBe('DELETE')
        expect((f as any).mock.calls[2][0]).toBe('http://mm:8888/api/geodatasets/remove/my%20set')
    })
    it('account and signup methods match the backend wire shapes', async () => {
        const f = fakeFetch(200, { status: 'success', body: { entries: [{ id: 1, username: 'admin' }] } })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        expect(await client.accountEntries()).toEqual([{ id: 1, username: 'admin' }])
        expect((f as any).mock.calls[0][1].method === undefined || (f as any).mock.calls[0][1].method === 'GET').toBe(true)
        await client.accountUpdate({ id: 2, permission: '110', missionsManaging: ['Demo'] })
        expect(JSON.parse((f as any).mock.calls[1][1].body)).toEqual({ id: 2, permission: '110', missions_managing: ['Demo'] })
        await client.userSignup('alice', 'Str0ng!Pass')
        expect((f as any).mock.calls[2][0]).toBe('http://mm:8888/api/users/signup')
        expect(JSON.parse((f as any).mock.calls[2][1].body)).toEqual({ username: 'alice', password: 'Str0ng!Pass', skipLogin: true })
    })
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd mcp && npx vitest run tests/mmgisClient.spec.ts`
Expected: FAIL — new methods undefined.

- [ ] **Step 3: Implement in `mcp/src/mmgisClient.ts`** — change `request`'s signature to `private async request(method: 'GET' | 'POST' | 'DELETE', apiPath: string, body?: unknown)` (no other change needed there), adjust `upsertMission`, and append the new methods:

```ts
    async upsertMission(
        mission: string,
        config: any,
        opts?: { forceClientUpdate?: boolean; info?: { type: string; layerName?: string | string[] } }
    ): Promise<{ mission: string; version: number }> {
        return await this.request('POST', '/api/configure/upsert', {
            mission,
            config,
            ...(opts?.forceClientUpdate !== undefined ? { forceClientUpdate: opts.forceClientUpdate } : {}),
            ...(opts?.info ? { info: opts.info } : {}),
        })
    }

    async cloneMission(existingMission: string, cloneMission: string): Promise<any> {
        return await this.request('POST', '/api/configure/clone', { existingMission, cloneMission })
    }

    async destroyMission(mission: string): Promise<{ message: string }> {
        return await this.request('POST', '/api/configure/destroy', { mission })
    }

    async geodatasetEntries(): Promise<any[]> {
        const json = await this.request('POST', '/api/geodatasets/entries', {})
        return json.body?.entries ?? []
    }

    async geodatasetRecreate(name: string, geojson: any): Promise<any> {
        return await this.request('POST', `/api/geodatasets/recreate/${encodeURIComponent(name)}`, geojson)
    }

    async geodatasetRemove(name: string): Promise<{ message: string }> {
        return await this.request('DELETE', `/api/geodatasets/remove/${encodeURIComponent(name)}`)
    }

    async accountEntries(): Promise<any[]> {
        const json = await this.request('GET', '/api/accounts/entries')
        return json.body?.entries ?? []
    }

    async accountUpdate(input: { id: number; permission?: '110' | '001'; missionsManaging?: string[] }): Promise<any> {
        return await this.request('POST', '/api/accounts/update', {
            id: input.id,
            ...(input.permission ? { permission: input.permission } : {}),
            ...(input.missionsManaging ? { missions_managing: input.missionsManaging } : {}),
        })
    }

    async userSignup(username: string, password: string): Promise<any> {
        return await this.request('POST', '/api/users/signup', { username, password, skipLogin: true })
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/mmgisClient.spec.ts && npm run build`
Expected: PASS (existing 7 + 4 new); build exit 0.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/mmgisClient.ts mcp/tests/mmgisClient.spec.ts
git commit -m "Add REST client methods for config editing and admin operations"
```

---

### Task 2: Merge-patch util + editConfig helper

**Files:**
- Create: `mcp/src/configEdit.ts`
- Test: `mcp/tests/configEdit.spec.ts`

**Interfaces:**
- Consumes: `MmgisClient.getMission`/`upsertMission` (Task 1 signatures).
- Produces:
  - `mergePatch(target: any, patch: any): any` — RFC 7386; returns a NEW value (does not mutate target).
  - `editConfig(client: MmgisClient, missionName: string, mutate: (config: any) => {info?: {type: string; layerName?: string | string[]}} | void): Promise<{mission: string; version: number}>` — fetches config, deep-clones it, runs `mutate` (mutates the clone in place; may return `{info}`), upserts with `forceClientUpdate: true` and `info` (default `{type: 'upsert'}`).
  - `findLayerIndex(config: any, nameOrUuid: string): number` — index in `config.layers` matching `name` or `uuid` (top level only), else -1.

- [ ] **Step 1: Write the failing test**

`mcp/tests/configEdit.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { mergePatch, editConfig, findLayerIndex } from '../src/configEdit.js'

describe('mergePatch (RFC 7386)', () => {
    it.each([
        ['nested objects merge', { a: { b: 1, c: 2 } }, { a: { c: 3 } }, { a: { b: 1, c: 3 } }],
        ['null deletes a key', { a: 1, b: 2 }, { b: null }, { a: 1 }],
        ['arrays replace wholesale', { a: [1, 2] }, { a: [3] }, { a: [3] }],
        ['scalars replace', { a: 1 }, { a: 'x' }, { a: 'x' }],
        ['non-object patch replaces target', { a: 1 }, 'str', 'str'],
        ['new nested keys are created', { a: {} }, { a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }],
        ['null inside new object is dropped', {}, { a: { b: null } }, { a: {} }],
    ])('%s', (_name, target, patch, expected) => {
        expect(mergePatch(target, patch)).toEqual(expected)
    })
    it('does not mutate the target', () => {
        const target = { a: { b: 1 } }
        mergePatch(target, { a: { b: 2 } })
        expect(target.a.b).toBe(1)
    })
})

describe('editConfig', () => {
    function fakeClient(config: any) {
        return {
            getMission: vi.fn(async () => ({ mission: 'M', config, version: 3 })),
            upsertMission: vi.fn(async () => ({ mission: 'M', version: 4 })),
        } as any
    }
    it('fetches, mutates a clone, and upserts with forceClientUpdate and default info', async () => {
        const original = { look: { pagename: 'Old' }, layers: [] }
        const client = fakeClient(original)
        const out = await editConfig(client, 'M', (config) => {
            config.look.pagename = 'New'
        })
        expect(out.version).toBe(4)
        expect(original.look.pagename).toBe('Old')
        const [mission, sent, opts] = client.upsertMission.mock.calls[0]
        expect(mission).toBe('M')
        expect(sent.look.pagename).toBe('New')
        expect(opts).toEqual({ forceClientUpdate: true, info: { type: 'upsert' } })
    })
    it('uses the info returned by the mutator', async () => {
        const client = fakeClient({ layers: [] })
        await editConfig(client, 'M', (config) => {
            config.layers.push({ name: 'L' })
            return { info: { type: 'addLayer', layerName: 'L' } }
        })
        expect(client.upsertMission.mock.calls[0][2]).toEqual({
            forceClientUpdate: true, info: { type: 'addLayer', layerName: 'L' },
        })
    })
})

describe('findLayerIndex', () => {
    const config = { layers: [{ name: 'A', uuid: 'u1' }, { name: 'B', uuid: 'u2' }] }
    it('finds by name and by uuid', () => {
        expect(findLayerIndex(config, 'B')).toBe(1)
        expect(findLayerIndex(config, 'u1')).toBe(0)
    })
    it('returns -1 for unknown and missing layers array', () => {
        expect(findLayerIndex(config, 'nope')).toBe(-1)
        expect(findLayerIndex({}, 'A')).toBe(-1)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mcp && npx vitest run tests/configEdit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcp/src/configEdit.ts`**

```ts
import type { MmgisClient } from './mmgisClient.js'

function isPlainObject(v: any): boolean {
    return v != null && typeof v === 'object' && !Array.isArray(v)
}

// RFC 7386 JSON Merge Patch. Returns a new value; never mutates `target`.
export function mergePatch(target: any, patch: any): any {
    if (!isPlainObject(patch)) return patch
    const base = isPlainObject(target) ? target : {}
    const out: any = { ...base }
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete out[key]
        else out[key] = mergePatch(base[key], value)
    }
    return out
}

export interface EditInfo {
    type: string
    layerName?: string | string[]
}

export async function editConfig(
    client: MmgisClient,
    missionName: string,
    mutate: (config: any) => { info?: EditInfo } | void
): Promise<{ mission: string; version: number }> {
    const current = await client.getMission(missionName)
    const config = JSON.parse(JSON.stringify(current.config))
    const result = mutate(config) || {}
    return await client.upsertMission(missionName, config, {
        forceClientUpdate: true,
        info: result.info ?? { type: 'upsert' },
    })
}

export function findLayerIndex(config: any, nameOrUuid: string): number {
    const layers = Array.isArray(config?.layers) ? config.layers : []
    return layers.findIndex((l: any) => l?.name === nameOrUuid || l?.uuid === nameOrUuid)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run tests/configEdit.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/configEdit.ts mcp/tests/configEdit.spec.ts
git commit -m "Add RFC 7386 merge patch and config edit helper"
```

---

### Task 3: Editing tools (`edit.ts`)

**Files:**
- Create: `mcp/src/tools/edit.ts`
- Modify: `mcp/src/index.ts` (register)
- Test: `mcp/tests/edit.spec.ts`

**Interfaces:**
- Consumes: `mergePatch`, `editConfig`, `findLayerIndex` (Task 2); `MmgisClient` (Task 1); `ToolDef`/`toToolResult`/`toErrorResult`; `randomUUID` from `node:crypto`.
- Produces: `makeEditTools(client: MmgisClient): ToolDef[]` with exactly: `mission_update_config`, `layer_add`, `layer_update`, `layer_remove`, `tool_toggle`.

- [ ] **Step 1: Write the failing test**

`mcp/tests/edit.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { makeEditTools } from '../src/tools/edit.js'

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

function fakeClient(config: any) {
    return {
        getMission: vi.fn(async () => ({ mission: 'M', config, version: 1 })),
        upsertMission: vi.fn(async (_m: string, cfg: any) => ({ mission: 'M', version: 2, _sent: cfg })),
    } as any
}

const baseConfig = () => ({
    look: { pagename: 'Old' },
    layers: [{ name: 'OSM', uuid: 'u1', visibility: true }],
    tools: [{ name: 'LayerManager', on: true }, { name: 'Chart', on: false }],
})

describe('edit tools', () => {
    const tools = (client: any) => Object.fromEntries(makeEditTools(client).map((t) => [t.name, t]))

    it('exposes exactly the five editing tools', () => {
        expect(Object.keys(tools(fakeClient({}))).sort()).toEqual([
            'layer_add', 'layer_remove', 'layer_update', 'mission_update_config', 'tool_toggle',
        ])
    })

    it('mission_update_config applies a merge patch and upserts with reload info', async () => {
        const client = fakeClient(baseConfig())
        const out = parse(await tools(client).mission_update_config.handler({
            missionName: 'M', patch: { look: { pagename: 'New' } },
        }))
        expect(out.version).toBe(2)
        expect(out.refresh).toMatch(/RELOAD|view_reload/)
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.look.pagename).toBe('New')
        expect(sent.layers).toHaveLength(1)
        expect(client.upsertMission.mock.calls[0][2]).toEqual({ forceClientUpdate: true, info: { type: 'upsert' } })
    })

    it('layer_add appends (or inserts at position), mints uuid, and sends addLayer info', async () => {
        const client = fakeClient(baseConfig())
        const out = parse(await tools(client).layer_add.handler({
            missionName: 'M', layer: { name: 'NewLayer', type: 'vector', url: 'geodatasets:g1' }, position: 0,
        }))
        expect(out.layer.uuid).toMatch(/^[0-9a-f-]{36}$/)
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers[0].name).toBe('NewLayer')
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'addLayer', layerName: 'NewLayer' })
    })

    it('layer_update merge-patches one layer found by name or uuid', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).layer_update.handler({ missionName: 'M', layer: 'u1', patch: { visibility: false } })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers[0]).toEqual({ name: 'OSM', uuid: 'u1', visibility: false })
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'updateLayer', layerName: 'OSM' })
    })

    it('layer_remove deletes by name and sends removeLayer info', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).layer_remove.handler({ missionName: 'M', layer: 'OSM' })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers).toHaveLength(0)
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'removeLayer', layerName: 'OSM' })
    })

    it('unknown layers error with the available names and no upsert', async () => {
        const client = fakeClient(baseConfig())
        const res = await tools(client).layer_update.handler({ missionName: 'M', layer: 'Nope', patch: {} })
        expect(res.isError).toBe(true)
        expect(parse(res).hint).toContain('OSM')
        expect(client.upsertMission).not.toHaveBeenCalled()
    })

    it('tool_toggle flips the named tool and errors on unknown tools', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).tool_toggle.handler({ missionName: 'M', toolName: 'Chart', on: true })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.tools.find((t: any) => t.name === 'Chart').on).toBe(true)
        const res = await tools(client).tool_toggle.handler({ missionName: 'M', toolName: 'Nope', on: true })
        expect(res.isError).toBe(true)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mcp && npx vitest run tests/edit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcp/src/tools/edit.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { mergePatch, editConfig, findLayerIndex } from '../configEdit.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

const RELOAD_NOTE =
    'Change saved. Open sessions show a RELOAD button; or call view_reload to apply it immediately.'
const LIVE_NOTE = 'Change saved and pushed live to open sessions.'

function layerNames(config: any): string {
    return (config?.layers ?? []).map((l: any) => l.name).join(', ') || '(none)'
}

export function makeEditTools(client: MmgisClient): ToolDef[] {
    const missionName = z.string().describe('Mission to edit (see mission_list)')
    return [
        {
            name: 'mission_update_config',
            description:
                'Edit ANY part of a mission config with an RFC 7386 JSON merge-patch (objects merge, null deletes a key, arrays replace). Backend validation runs server-side. Prefer layer_*/tool_toggle for common edits.',
            schema: {
                missionName,
                patch: z.record(z.any()).describe('Merge patch, e.g. {"look": {"pagename": "New Name"}} or {"msv": {"basemap": {...}}}'),
            },
            handler: async ({ missionName, patch }: any) => {
                try {
                    const out = await editConfig(client, missionName, (config) => {
                        const merged = mergePatch(config, patch)
                        for (const key of Object.keys(config)) delete config[key]
                        Object.assign(config, merged)
                    })
                    return toToolResult({ ...out, refresh: RELOAD_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_add',
            description: 'Add a layer entry to a mission. Applies live in open sessions.',
            schema: {
                missionName,
                layer: z.record(z.any()).describe('MMGIS layer entry (see dashboard_profile_schema layerExamples; vector layers can use url "geodatasets:<name>")'),
                position: z.number().optional().describe('Index to insert at (default: end)'),
            },
            handler: async ({ missionName, layer, position }: any) => {
                try {
                    const entry = { uuid: randomUUID(), sublayers: [], visibility: true, ...layer }
                    const out = await editConfig(client, missionName, (config) => {
                        config.layers = config.layers ?? []
                        const at = position === undefined ? config.layers.length : Math.max(0, Math.min(position, config.layers.length))
                        config.layers.splice(at, 0, entry)
                        return { info: { type: 'addLayer', layerName: entry.name } }
                    })
                    return toToolResult({ ...out, layer: entry, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_update',
            description: 'Merge-patch a single layer (found by name or uuid). Applies live in open sessions.',
            schema: {
                missionName,
                layer: z.string().describe('Layer name or uuid'),
                patch: z.record(z.any()).describe('Merge patch for the layer entry, e.g. {"visibility": false} or {"initialOpacity": 0.5}'),
            },
            handler: async ({ missionName, layer, patch }: any) => {
                try {
                    let updatedName = ''
                    const out = await editConfig(client, missionName, (config) => {
                        const idx = findLayerIndex(config, layer)
                        if (idx === -1) {
                            throw Object.assign(new Error(`Unknown layer: ${layer}`), {
                                hint: `Available layers: ${layerNames(config)}`,
                            })
                        }
                        config.layers[idx] = mergePatch(config.layers[idx], patch)
                        updatedName = config.layers[idx].name
                        return { info: { type: 'updateLayer', layerName: updatedName } }
                    })
                    return toToolResult({ ...out, layer: updatedName, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_remove',
            description: 'Remove a layer (by name or uuid). Applies live in open sessions.',
            schema: { missionName, layer: z.string().describe('Layer name or uuid') },
            handler: async ({ missionName, layer }: any) => {
                try {
                    let removedName = ''
                    const out = await editConfig(client, missionName, (config) => {
                        const idx = findLayerIndex(config, layer)
                        if (idx === -1) {
                            throw Object.assign(new Error(`Unknown layer: ${layer}`), {
                                hint: `Available layers: ${layerNames(config)}`,
                            })
                        }
                        removedName = config.layers[idx].name
                        config.layers.splice(idx, 1)
                        return { info: { type: 'removeLayer', layerName: removedName } }
                    })
                    return toToolResult({ ...out, removed: removedName, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'tool_toggle',
            description: "Turn a mission's tool on or off (e.g. Chart, Measure).",
            schema: { missionName, toolName: z.string(), on: z.boolean() },
            handler: async ({ missionName, toolName, on }: any) => {
                try {
                    const out = await editConfig(client, missionName, (config) => {
                        const tool = (config.tools ?? []).find((t: any) => t.name === toolName)
                        if (!tool) {
                            throw Object.assign(new Error(`Unknown tool: ${toolName}`), {
                                hint: `Configured tools: ${(config.tools ?? []).map((t: any) => t.name).join(', ') || '(none)'}`,
                            })
                        }
                        tool.on = on
                    })
                    return toToolResult({ ...out, tool: toolName, on, refresh: RELOAD_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
```

- [ ] **Step 4: Register in `mcp/src/index.ts`** — `import { makeEditTools } from './tools/edit.js'` and add `...makeEditTools(client)` to the tools array.

- [ ] **Step 5: Run tests + build**

Run: `cd mcp && npx vitest run tests/edit.spec.ts && npm run build`
Expected: PASS (7 tests); build clean.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/edit.ts mcp/src/index.ts mcp/tests/edit.spec.ts
git commit -m "Add live config editing tools"
```

---

### Task 4: Admin tools — missions + geodatasets

**Files:**
- Modify: `mcp/src/tools/admin.ts`
- Test: `mcp/tests/admin.spec.ts` (extend)

**Interfaces:**
- Consumes: `MmgisClient` methods from Task 1; `ToolDef` helpers; `MMGISError`.
- Produces: `makeAdminTools(client)` additionally returns `mission_clone`, `mission_delete`, `geodataset_list`, `geodataset_ingest`, `geodataset_delete` (existing `mission_list`/`mission_get` unchanged). Internal helper `needsConfirmation(preview: object)` → `toToolResult({needsConfirmation: true, ...preview})`.

- [ ] **Step 1: Write the failing tests** — append to `mcp/tests/admin.spec.ts` (reuse its `parse`; note its existing fakeClient only has list/get — build local fakes per test):

```ts
    it('mission_clone calls the clone endpoint', async () => {
        const client = { cloneMission: vi.fn(async () => ({ status: 'success', mission: 'B', version: 0 })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const out = parse(await t.mission_clone.handler({ fromMission: 'A', toMission: 'B' }))
        expect(out.mission).toBe('B')
        expect(client.cloneMission).toHaveBeenCalledWith('A', 'B')
    })

    it('mission_delete requires confirm and previews first', async () => {
        const client = { destroyMission: vi.fn(async () => ({ message: 'Successfully Deleted Mission: A' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.mission_delete.handler({ missionName: 'A' }))
        expect(preview.needsConfirmation).toBe(true)
        expect(client.destroyMission).not.toHaveBeenCalled()
        const done = parse(await t.mission_delete.handler({ missionName: 'A', confirm: true }))
        expect(done.message).toContain('Deleted')
        expect(client.destroyMission).toHaveBeenCalledWith('A')
    })

    it('geodataset_list returns entries', async () => {
        const client = { geodatasetEntries: vi.fn(async () => [{ name: 'g1', num_features: 5 }]) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.geodataset_list.handler({})).geodatasets).toEqual([{ name: 'g1', num_features: 5 }])
    })

    it('geodataset_ingest accepts inline FeatureCollections and rejects bad shapes', async () => {
        const client = { geodatasetRecreate: vi.fn(async () => ({ status: 'success' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] }
        const out = parse(await t.geodataset_ingest.handler({ name: 'g1', geojson: fc }))
        expect(out.name).toBe('g1')
        expect(out.features).toBe(1)
        expect(client.geodatasetRecreate).toHaveBeenCalledWith('g1', fc)
        const bad = await t.geodataset_ingest.handler({ name: 'g1', geojson: { type: 'Point' } })
        expect(bad.isError).toBe(true)
    })

    it('geodataset_ingest fetches from a url with a size cap', async () => {
        const fc = { type: 'FeatureCollection', features: [] }
        const fetcher = vi.fn(async () => ({
            ok: true, headers: { get: () => null }, text: async () => JSON.stringify(fc),
        })) as any
        const client = { geodatasetRecreate: vi.fn(async () => ({ status: 'success' })) } as any
        const t = Object.fromEntries(makeAdminTools(client, fetcher).map((x) => [x.name, x]))
        const out = parse(await t.geodataset_ingest.handler({ name: 'g2', url: 'https://x/y.geojson' }))
        expect(out.features).toBe(0)
        expect(fetcher).toHaveBeenCalledWith('https://x/y.geojson')
        const big = vi.fn(async () => ({ ok: true, headers: { get: () => String(30 * 1024 * 1024) }, text: async () => '' })) as any
        const t2 = Object.fromEntries(makeAdminTools(client, big).map((x) => [x.name, x]))
        expect((await t2.geodataset_ingest.handler({ name: 'g3', url: 'https://x/big.geojson' })).isError).toBe(true)
    })

    it('geodataset_delete requires confirm', async () => {
        const client = { geodatasetRemove: vi.fn(async () => ({ message: "Successfully deleted geodataset 'g1'." })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.geodataset_delete.handler({ name: 'g1' })).needsConfirmation).toBe(true)
        expect(client.geodatasetRemove).not.toHaveBeenCalled()
        parse(await t.geodataset_delete.handler({ name: 'g1', confirm: true }))
        expect(client.geodatasetRemove).toHaveBeenCalledWith('g1')
    })
```

Also update the existing `'exposes mission_list and mission_get'` test's expected name list to the new full sorted set: `['geodataset_delete', 'geodataset_ingest', 'geodataset_list', 'mission_clone', 'mission_delete', 'mission_get', 'mission_list']`. Add `import { vi } from 'vitest'` if absent.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd mcp && npx vitest run tests/admin.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `mcp/src/tools/admin.ts`** — change the signature to `makeAdminTools(client: MmgisClient, fetchFn: typeof fetch = fetch)` and append after `mission_get`:

```ts
const MAX_GEOJSON_BYTES = 20 * 1024 * 1024

function isFeatureCollection(v: any): boolean {
    return v != null && v.type === 'FeatureCollection' && Array.isArray(v.features)
}
```

and the tools:

```ts
        {
            name: 'mission_clone',
            description: 'Clone an existing mission (dashboard) to a new name.',
            schema: {
                fromMission: z.string().describe('Existing mission to copy'),
                toMission: z.string().describe('Name for the new mission'),
            },
            handler: async ({ fromMission, toMission }: any) => {
                try {
                    const out = await client.cloneMission(fromMission, toMission)
                    return toToolResult({ mission: toMission, ...out })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_delete',
            description: 'DESTRUCTIVE: delete a mission and all its config versions. Requires confirm: true — without it returns a preview. Always show the preview to the user and get their explicit yes first.',
            schema: {
                missionName: z.string(),
                confirm: z.boolean().optional().describe('Must be true to actually delete'),
            },
            handler: async ({ missionName, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({
                            needsConfirmation: true,
                            wouldDelete: `Mission "${missionName}" and every config version of it (the Missions/ folder is renamed, not erased).`,
                        })
                    }
                    return toToolResult(await client.destroyMission(missionName))
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_list',
            description: 'List geodatasets (uploaded vector datasets) and which missions use them.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ geodatasets: await client.geodatasetEntries() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_ingest',
            description: 'Create or replace a geodataset from GeoJSON — inline `geojson` OR a `url` to fetch (max 20MB). Use it in a layer with type "vector" and url "geodatasets:<name>".',
            schema: {
                name: z.string().describe('Geodataset name'),
                geojson: z.record(z.any()).optional().describe('Inline GeoJSON FeatureCollection'),
                url: z.string().optional().describe('URL of a GeoJSON file to fetch'),
            },
            handler: async ({ name, geojson, url }: any) => {
                try {
                    if (!geojson === !url) {
                        return toErrorResult(new MMGISError('Provide exactly one of geojson or url'))
                    }
                    let data = geojson
                    if (url) {
                        const res = await fetchFn(url)
                        if (!res.ok) throw new MMGISError(`Fetch failed (${res.status}) for ${url}`)
                        const len = Number(res.headers.get('content-length') || 0)
                        if (len > MAX_GEOJSON_BYTES) throw new MMGISError(`File too large (${len} bytes; max ${MAX_GEOJSON_BYTES})`)
                        const text = await res.text()
                        if (text.length > MAX_GEOJSON_BYTES) throw new MMGISError(`File too large (max ${MAX_GEOJSON_BYTES} bytes)`)
                        try {
                            data = JSON.parse(text)
                        } catch {
                            throw new MMGISError(`${url} is not valid JSON`)
                        }
                    }
                    if (!isFeatureCollection(data)) {
                        return toErrorResult(new MMGISError('GeoJSON must be a FeatureCollection with a features array'))
                    }
                    await client.geodatasetRecreate(name, data)
                    return toToolResult({ name, features: data.features.length, layerUrl: `geodatasets:${name}` })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_delete',
            description: 'DESTRUCTIVE: delete a geodataset and its data table. Requires confirm: true — without it returns a preview. Get the user\'s explicit yes first.',
            schema: { name: z.string(), confirm: z.boolean().optional() },
            handler: async ({ name, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({ needsConfirmation: true, wouldDelete: `Geodataset "${name}" and its feature table. Layers referencing geodatasets:${name} will break.` })
                    }
                    return toToolResult(await client.geodatasetRemove(name))
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
```

Add `import { MMGISError } from '../mmgisClient.js'` if not present. Update `mcp/src/index.ts` only if the `makeAdminTools` call needs no change (it doesn't — `fetchFn` defaults).

- [ ] **Step 4: Run tests + build**

Run: `cd mcp && npx vitest run tests/admin.spec.ts && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/admin.ts mcp/tests/admin.spec.ts
git commit -m "Add mission and geodataset admin tools with confirmation gating"
```

---

### Task 5: User tools + minimal backend token support for signup (FLAGGED backend change)

**Files:**
- Modify: `mcp/src/tools/admin.ts` (three user tools)
- Modify: `scripts/server.js` (expose a non-blocking token-annotation middleware)
- Modify: `API/Backend/Users/setup.js` (mount it)
- Modify: `API/Backend/Users/routes/users.js` (extend the signup gate)
- Test: `mcp/tests/admin.spec.ts` (extend)

**Interfaces:**
- Consumes: `accountEntries`, `accountUpdate`, `userSignup` (Task 1).
- Produces: `user_list`, `user_create`, `user_set_permission` tools. Backend: `s.annotateLongTermToken` middleware — validates an `Authorization` long-term token if present and sets `req.isLongTermToken`/`req.tokenUserPermission`, ALWAYS calls `next()` (never rejects); signup's SuperAdmin gate additionally accepts `req.isLongTermToken === true && req.tokenUserPermission === '111'`.

**⚠️ FLAG FOR STAKEHOLDER:** this task changes backend auth surface (annotation middleware on `/api/users` + widened signup gate). It is strictly additive — requests without an Authorization header behave exactly as before — and mirrors the pattern already accepted for `/configure/add`.

- [ ] **Step 1: Write the failing MCP tests** — append to `mcp/tests/admin.spec.ts`:

```ts
    it('user_list returns account entries without passwords', async () => {
        const client = { accountEntries: vi.fn(async () => [{ id: 1, username: 'admin', permission: '111' }]) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.user_list.handler({})).users).toEqual([{ id: 1, username: 'admin', permission: '111' }])
    })

    it('user_create requires confirm, calls signup, and never echoes the password', async () => {
        const client = { userSignup: vi.fn(async () => ({ status: 'success', username: 'alice' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.user_create.handler({ username: 'alice', password: 'Str0ng!Pass' }))
        expect(preview.needsConfirmation).toBe(true)
        expect(client.userSignup).not.toHaveBeenCalled()
        const res = await t.user_create.handler({ username: 'alice', password: 'Str0ng!Pass', confirm: true })
        expect(res.content[0].text).not.toContain('Str0ng!Pass')
        expect(parse(res).username).toBe('alice')
        expect(client.userSignup).toHaveBeenCalledWith('alice', 'Str0ng!Pass')
    })

    it('user_set_permission resolves username to id and requires confirm', async () => {
        const client = {
            accountEntries: vi.fn(async () => [{ id: 1, username: 'admin', permission: '111' }, { id: 2, username: 'bob', permission: '001' }]),
            accountUpdate: vi.fn(async () => ({ status: 'success' })),
        } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.user_set_permission.handler({ username: 'bob', permission: '110', missionsManaging: ['Demo'] }))
        expect(preview.needsConfirmation).toBe(true)
        await t.user_set_permission.handler({ username: 'bob', permission: '110', missionsManaging: ['Demo'], confirm: true })
        expect(client.accountUpdate).toHaveBeenCalledWith({ id: 2, permission: '110', missionsManaging: ['Demo'] })
        const unknown = await t.user_set_permission.handler({ username: 'nope', permission: '001', confirm: true })
        expect(unknown.isError).toBe(true)
    })
```

Update the tool-name list test again to include `user_create`, `user_list`, `user_set_permission` (full sorted set of 10 admin tools).

- [ ] **Step 2: Run to verify failure**

Run: `cd mcp && npx vitest run tests/admin.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three tools in `mcp/src/tools/admin.ts`**

```ts
        {
            name: 'user_list',
            description: 'List MMGIS user accounts (id, username, permission: 111=SuperAdmin, 110=Admin, 001=Viewer).',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ users: await client.accountEntries() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'user_create',
            description: "Create a user account (created as Viewer '001'; use user_set_permission to promote to Admin '110'). Password needs 8+ chars with upper, lower, number, symbol. Requires confirm: true after the user agrees. Never repeat the password back in chat.",
            schema: {
                username: z.string(),
                password: z.string().describe('8+ chars with upper, lower, number, symbol'),
                confirm: z.boolean().optional(),
            },
            handler: async ({ username, password, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({ needsConfirmation: true, wouldCreate: `User "${username}" with Viewer (001) permission.` })
                    }
                    const out = await client.userSignup(username, password)
                    return toToolResult({ username: out.username ?? username, created: true })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'user_set_permission',
            description: "Change a user's permission: '110' (Admin, optionally with missionsManaging list) or '001' (Viewer). SuperAdmin (111) cannot be granted, and user id 1 cannot be changed (backend rules). Requires confirm: true.",
            schema: {
                username: z.string(),
                permission: z.enum(['110', '001']),
                missionsManaging: z.array(z.string()).optional().describe("Missions an Admin ('110') manages"),
                confirm: z.boolean().optional(),
            },
            handler: async ({ username, permission, missionsManaging, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({ needsConfirmation: true, wouldChange: `Set "${username}" permission to ${permission}${missionsManaging ? ` managing [${missionsManaging.join(', ')}]` : ''}.` })
                    }
                    const users = await client.accountEntries()
                    const user = users.find((u: any) => u.username === username)
                    if (!user) {
                        return toErrorResult(Object.assign(new Error(`Unknown user: ${username}`), { hint: `Users: ${users.map((u: any) => u.username).join(', ')}` }))
                    }
                    await client.accountUpdate({ id: user.id, permission, ...(missionsManaging ? { missionsManaging } : {}) })
                    return toToolResult({ username, permission, ...(missionsManaging ? { missionsManaging } : {}) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
```

- [ ] **Step 4: Run MCP tests + build**

Run: `cd mcp && npx vitest run tests/admin.spec.ts && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Backend — token annotation (read each file first, match local style)**

(a) `scripts/server.js`: find where the shared `s` object gets `ensureAdmin` (search `ensureAdmin`). Nearby, add and expose a non-blocking annotator that reuses the existing `validateLongTermToken` (defined ~line 391):

```js
function annotateLongTermToken(req, res, next) {
    if (req.headers.authorization) {
        validateLongTermToken(
            req.headers.authorization,
            (tokenData) => {
                req.isLongTermToken = true;
                req.tokenUserPermission = tokenData.permission;
                req.tokenUserMissions = tokenData.missions_managing;
                req.user = tokenData.username;
                next();
            },
            () => next()
        );
    } else next();
}
```

Attach it wherever `s.ensureAdmin = ensureAdmin` (or equivalent) happens: `s.annotateLongTermToken = annotateLongTermToken`. (Check `validateLongTermToken`'s callback signature at its definition — success and failure callbacks — and match exactly.)

(b) `API/Backend/Users/setup.js`: read it; add `s.annotateLongTermToken` into the middleware chain for the users router mount (before the router, after `checkHeadersCodeInjection`).

(c) `API/Backend/Users/routes/users.js` signup gate (~lines 82-96): read the exact conditions; extend each `req.session.permission !== "111"` check that gates admin-only creation with `&& !(req.isLongTermToken === true && req.tokenUserPermission === "111")` so a SuperAdmin token passes. Touch ONLY the signup gate; leave `first_signup` and all other routes unchanged.

No automated backend test harness exists for these routes (verified in the Phase 1 work) — verification is the live E2E in Task 7. Keep the change minimal and quote it fully in your report.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/admin.ts mcp/tests/admin.spec.ts scripts/server.js API/Backend/Users/setup.js API/Backend/Users/routes/users.js
git commit -m "Add user admin tools and honor SuperAdmin tokens in signup"
```

---

### Task 6: `view_reload` bridge command

**Files:**
- Modify: `src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`
- Modify: `src/essence/MMGIS-Plugin-Components/AgentBridge/AgentBridge.js`
- Modify: `mcp/src/tools/view.ts`
- Test: `tests/unit/agentBridgeCommands.spec.js` (extend)

**Interfaces:**
- Consumes: existing `executeCommand(command, args, deps)` switch; existing `makeViewTools(bridge)`.
- Produces: command `'reload'` → calls injected `deps.reload()` and returns `{ok: true, result: {reloading: true}}` (the ack races the page unload — the MCP tool treats a timeout after a successful send as acceptable); AgentBridge wires `reload: () => window.location.reload()` into deps; MCP tool `view_reload(mission)`.

- [ ] **Step 1: Extend the frontend test** — add to `tests/unit/agentBridgeCommands.spec.js` (add `reload: vi.fn()` to `makeDeps()`'s returned object first):

```js
    it('reload calls the injected reload and reports', async () => {
        const deps = makeDeps()
        const res = await executeCommand('reload', {}, deps)
        expect(res.ok).toBe(true)
        expect(res.result).toEqual({ reloading: true })
        expect(deps.reload).toHaveBeenCalled()
    })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/agentBridgeCommands.spec.js` (repo root)
Expected: FAIL — Unknown command: reload.

- [ ] **Step 3: Implement** — in `commands.js` add a case before `default`:

```js
        case 'reload': {
            deps.reload()
            return { ok: true, result: { reloading: true } }
        }
```

In `AgentBridge.js`, add to the deps object passed to `executeCommand` (alongside Map_, L_, ...): `reload: () => window.location.reload(),` — send the ack BEFORE calling executeCommand for this command? No: keep flow unchanged (ack after execute); `window.location.reload()` does not interrupt the synchronous send that follows in the same tick, and if the ack is lost the MCP tool's message will time out — acceptable, documented in the tool description.

In `mcp/src/tools/view.ts` add to the returned array:

```ts
        {
            name: 'view_reload',
            description: 'Reload an open browser session so non-layer config changes (basemap, page name, tools) take effect. A timeout after sending can mean the page reloaded before acking — treat that as success if view_get_state works afterwards.',
            schema: { mission },
            handler: ({ mission }: any) => run(mission, 'reload', {}),
        },
```

- [ ] **Step 4: Run tests + builds**

Run: `npx vitest run tests/unit/agentBridgeCommands.spec.js && cd mcp && npm run build && npm test`
Expected: all pass (frontend spec now 12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/essence/MMGIS-Plugin-Components/AgentBridge tests/unit/agentBridgeCommands.spec.js mcp/src/tools/view.ts
git commit -m "Add view_reload bridge command for applying non-layer config changes"
```

---

### Task 7: System prompt, docs, sweep + live E2E

**Files:**
- Modify: `chat/lib/agentLoop.js` (SYSTEM_PROMPT additions)
- Modify: `mcp/README.md` (tools + security notes)
- Modify: `chat/README.md` (what-you-can-do + E2E checklist additions)

- [ ] **Step 1: Extend `SYSTEM_PROMPT` in `chat/lib/agentLoop.js`** — append these lines inside the template string (before the final "Be concise" line):

```
- Editing existing dashboards: prefer layer_add/layer_update/layer_remove and tool_toggle (these apply LIVE in open sessions). For anything else use mission_update_config with a JSON merge-patch (null deletes a key; arrays replace) — then call view_reload so an open session shows the change.
- DESTRUCTIVE tools (mission_delete, geodataset_delete, user_create, user_set_permission) return needsConfirmation first. Show the user exactly what will happen, get their explicit yes, then retry with confirm: true. Never set confirm on your own.
- Geodata: ingest GeoJSON with geodataset_ingest (inline for small data, url for hosted files), then add a layer with type "vector" and url "geodatasets:<name>".
- User management: new users start as Viewer (001); promote with user_set_permission (110 Admin / 001 Viewer; SuperAdmin cannot be granted). Never repeat passwords back.
```

Run `cd chat && npm test` — the agentLoop tests assert the system prompt is message[0] but not its content, so all 25 should still pass.

- [ ] **Step 2: Update `mcp/README.md`** — Tools section adds:

```markdown
- `mission_update_config`, `layer_add`, `layer_update`, `layer_remove`, `tool_toggle` — live config editing (layer changes auto-apply in open sessions; others need one RELOAD click or `view_reload`)
- `mission_clone`, `mission_delete`†, `geodataset_list`, `geodataset_ingest`, `geodataset_delete`†, `user_list`, `user_create`†, `user_set_permission`† — admin operations († = requires `confirm: true` after a preview)
- `view_reload` — reload an open session to apply non-layer config changes
```

Security notes add: "`/api/configure/clone` and `/destroy` have no per-permission check upstream — ANY valid long-term token can invoke them (pre-existing MMGIS behavior); scope who gets tokens accordingly. `mission_clone` shells out to a `python` binary on the MMGIS server; hosts with only `python3` will see clone failures."

- [ ] **Step 3: Update `chat/README.md`** — "What you can do" adds editing examples ("make the OSM layer 50% transparent", "rename the page to Flood Watch then reload the view", "upload this GeoJSON and add it as a layer", "delete the JSON Demo mission" → confirmation round-trip). Manual E2E checklist adds:

```markdown
- [ ] layer_update from chat visibly changes an open dashboard WITHOUT reloading (e.g. opacity)
- [ ] mission_update_config + view_reload applies a basemap/page-name change
- [ ] geodataset_ingest (inline) → layer_add with geodatasets:<name> renders the data
- [ ] mission_delete asks for confirmation in chat before acting
- [ ] user_create + user_set_permission work with the long-term token (exercises the flagged backend change)
- [ ] mission_clone (may fail if the MMGIS host lacks a `python` binary — record outcome)
```

- [ ] **Step 4: Full verification sweep**

Run: `cd mcp && npm test && npm run build && cd ../chat && npm test && cd .. && npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add chat/lib/agentLoop.js mcp/README.md chat/README.md
git commit -m "Teach the chat agent config editing and admin workflows"
```

- [ ] **Step 6 (controller): live E2E** — with the running deployment + chat: walk the new checklist items end-to-end; especially verify (a) live layer refresh without reload, (b) the flagged signup-token backend change, (c) whether `python` exists for clone. Fix deviations before closing.

---

## Spec coverage map

| Spec requirement | Task |
| --- | --- |
| `mission_update_config` (RFC 7386, backend validation, live refresh contract) | 2, 3 |
| `layer_add`/`layer_update`/`layer_remove` (find by name/uuid, layer-typed info → auto-apply) | 2, 3 |
| `tool_toggle` | 3 |
| `mission_clone`, `mission_delete` (+confirm) | 1, 4 |
| `geodataset_list`/`ingest` (inline+url, 20MB cap, FeatureCollection validation)/`delete` (+confirm) | 1, 4 |
| `user_list`, `user_create` (+confirm, password never echoed), `user_set_permission` (+confirm) | 1, 5 |
| Flagged minimal backend change for session-only signup | 5 (annotation middleware + gate extension) |
| forceClientUpdate live refresh + view_reload gap-closer | 1, 2, 3, 6 |
| System prompt confirmation protocol + workflows | 7 |
| Testing: unit merge-patch table, confirmation gating, ingest validation; live E2E checklist | 2-7 |
| Non-goals respected (no new endpoints beyond flagged guard; no UI attach; last-write-wins documented) | all |

Spec deviations locked in by research (documented in Global Constraints): only layer-typed events auto-apply (hence `view_reload`); `user_set_permission` cannot grant 111 and cannot change user id 1; user creation lands as 001 then promote; `mission_clone` python dependency; clone/destroy lack upstream per-permission checks (README security note).

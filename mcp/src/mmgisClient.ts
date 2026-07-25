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

    private async request(method: 'GET' | 'POST' | 'DELETE', apiPath: string, body?: unknown): Promise<any> {
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
        let json
        try {
            json = await res.json()
        } catch (err) {
            throw new MMGISError(
                `MMGIS returned a non-JSON response for ${apiPath}`,
                'Check MMGIS_URL — it may be pointing at a proxy, login page, or the wrong port instead of the MMGIS API.'
            )
        }
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
}

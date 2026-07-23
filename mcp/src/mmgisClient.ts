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

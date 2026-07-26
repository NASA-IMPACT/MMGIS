// --- Pure helpers (unit-tested; no DOM access at module top level) ---

export function parseSseChunks(buffer) {
    const frames = buffer.split('\n\n')
    const rest = frames.pop()
    const events = []
    for (const frame of frames) {
        const data = frame.replace(/^data: /, '').trim()
        if (!data) continue
        try {
            events.push(JSON.parse(data))
        } catch {
            // skip malformed frame
        }
    }
    return { events, rest }
}

export function extractUrls(resultText) {
    let parsed
    try {
        parsed = JSON.parse(resultText)
    } catch {
        return []
    }
    const urls = []
    const walk = (node) => {
        if (node == null || typeof node !== 'object') return
        for (const [key, value] of Object.entries(node)) {
            if (key === 'url' && typeof value === 'string') urls.push(value)
            else walk(value)
        }
    }
    walk(parsed)
    return urls
}

// --- Browser wiring ---

if (typeof document !== 'undefined') {
    const transcript = document.getElementById('transcript')
    const composer = document.getElementById('composer')
    const input = document.getElementById('input')
    const status = document.getElementById('status')
    const send = document.getElementById('send')
    const newChat = document.getElementById('newChat')
    const drawerToggle = document.getElementById('jsonDrawerToggle')
    const drawer = document.getElementById('jsonDrawer')
    const jsonCreate = document.getElementById('jsonCreate')
    const split = document.getElementById('split')
    const chatCol = document.getElementById('chatCol')
    const divider = document.getElementById('divider')
    const dashToggle = document.getElementById('dashToggle')
    const dashFrame = document.getElementById('dashFrame')
    const dashPop = document.getElementById('dashPop')
    const missionPicker = document.getElementById('missionPicker')

    let messages = []
    try {
        messages = JSON.parse(localStorage.getItem('mmgisChat') || '[]')
    } catch {
        messages = []
    }
    let busy = false

    const save = () => localStorage.setItem('mmgisChat', JSON.stringify(messages))

    function addBubble(cls, text) {
        const div = document.createElement('div')
        div.className = `msg ${cls}`
        div.textContent = text
        transcript.appendChild(div)
        transcript.scrollTop = transcript.scrollHeight
        return div
    }

    function addToolCard(name, args) {
        const details = document.createElement('details')
        details.className = 'tool'
        const summary = document.createElement('summary')
        summary.textContent = `🔧 ${name}`
        details.appendChild(summary)
        const argsPre = document.createElement('pre')
        argsPre.textContent = `args: ${JSON.stringify(args, null, 2)}`
        details.appendChild(argsPre)
        transcript.appendChild(details)
        transcript.scrollTop = transcript.scrollHeight
        return details
    }

    function finishToolCard(card, result, isError) {
        if (isError) card.classList.add('error')
        const pre = document.createElement('pre')
        try {
            pre.textContent = JSON.stringify(JSON.parse(result), null, 2)
        } catch {
            pre.textContent = result
        }
        card.appendChild(pre)
        for (const url of extractUrls(result)) {
            const a = document.createElement('a')
            a.className = 'dash-link'
            a.href = url
            a.target = '_blank'
            a.textContent = 'Open dashboard →'
            card.appendChild(a)
            if (url.includes('?mission=')) showDashboard(url)
        }
    }

    // --- Dashboard panel ---

    let mmgisUrl = null

    function missionFromUrl(url) {
        try {
            return new URL(url).searchParams.get('mission')
        } catch {
            return null
        }
    }

    function showDashboard(url) {
        if (dashFrame.src !== url) dashFrame.src = url
        dashPop.href = url
        split.classList.add('has-dash')
        const mission = missionFromUrl(url)
        if (mission) {
            if (![...missionPicker.options].some((o) => o.value === mission)) {
                missionPicker.appendChild(new Option(mission, mission))
            }
            missionPicker.value = mission
            localStorage.setItem('mmgisChatMission', mission)
        }
    }

    async function refreshMissions() {
        try {
            const out = await (await fetch('/api/missions')).json()
            const current = missionPicker.value
            missionPicker.length = 1
            for (const m of out.missions || []) missionPicker.appendChild(new Option(m, m))
            if (current) missionPicker.value = current
        } catch {
            // panel picker stays as-is; status strip already reports server issues
        }
    }

    missionPicker.addEventListener('change', () => {
        if (missionPicker.value && mmgisUrl) {
            showDashboard(`${mmgisUrl}/?mission=${encodeURIComponent(missionPicker.value)}`)
        }
    })

    dashToggle.addEventListener('click', () => {
        split.classList.toggle('panel-hidden')
        localStorage.setItem('mmgisChatPanelHidden', split.classList.contains('panel-hidden') ? '1' : '')
    })

    divider.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        divider.setPointerCapture(e.pointerId)
        const move = (ev) => {
            const min = 380
            const max = window.innerWidth - 320
            chatCol.style.flexBasis = `${Math.min(max, Math.max(min, ev.clientX))}px`
        }
        const up = () => {
            divider.removeEventListener('pointermove', move)
            divider.removeEventListener('pointerup', up)
        }
        divider.addEventListener('pointermove', move)
        divider.addEventListener('pointerup', up)
    })

    function render() {
        transcript.innerHTML = ''
        for (const m of messages) addBubble(m.role, m.content)
    }

    async function refreshHealth() {
        try {
            const h = await (await fetch('/api/health')).json()
            status.textContent = `${h.model} · ${h.toolCount} tools · MCP ${h.mcpConnected ? 'connected' : 'DISCONNECTED'}`
            status.className = `status ${h.mcpConnected ? 'ok' : 'bad'}`
            if (h.mmgisUrl && !mmgisUrl) {
                mmgisUrl = h.mmgisUrl.replace(/\/+$/, '')
                const remembered = localStorage.getItem('mmgisChatMission')
                if (remembered && !split.classList.contains('has-dash')) {
                    showDashboard(`${mmgisUrl}/?mission=${encodeURIComponent(remembered)}`)
                }
            }
        } catch {
            status.textContent = 'server unreachable'
            status.className = 'status bad'
        }
    }

    async function sendConversation() {
        busy = true
        send.disabled = true
        newChat.disabled = true
        const toolCards = new Map()
        let assistantDiv = null
        let bubbleText = ''
        let fullText = ''
        let thinkingDiv = addBubble('assistant thinking', 'thinking…')
        const clearThinking = () => {
            if (thinkingDiv) {
                thinkingDiv.remove()
                thinkingDiv = null
            }
        }
        const ctrl = new AbortController()
        const abortTimer = setTimeout(() => ctrl.abort(), 180000)
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages }),
                signal: ctrl.signal,
            })
            if (!res.ok) throw new Error(`server ${res.status}`)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const { events, rest } = parseSseChunks(buffer)
                buffer = rest
                for (const ev of events) {
                    clearThinking()
                    if (ev.type === 'text') {
                        if (!assistantDiv) {
                            assistantDiv = addBubble('assistant', '')
                            bubbleText = ''
                            if (fullText) fullText += '\n'
                        }
                        bubbleText += ev.delta
                        fullText += ev.delta
                        assistantDiv.textContent = bubbleText
                        transcript.scrollTop = transcript.scrollHeight
                    } else if (ev.type === 'tool_call') {
                        // a new assistant bubble will follow the tool round
                        assistantDiv = null
                        toolCards.set(ev.id, addToolCard(ev.name, ev.args))
                    } else if (ev.type === 'tool_result') {
                        const card = toolCards.get(ev.id)
                        if (card) finishToolCard(card, ev.result, ev.isError)
                    } else if (ev.type === 'error') {
                        addBubble('error', `Error: ${ev.message}`)
                    }
                }
            }
            if (fullText) {
                messages.push({ role: 'assistant', content: fullText })
                save()
            }
        } catch (err) {
            const message =
                err && err.name === 'AbortError'
                    ? 'Request timed out after 3 minutes — the server may be down or overloaded. Reload the page and try again.'
                    : err.message
            addBubble('error', `Error: ${message}`)
        } finally {
            clearTimeout(abortTimer)
            clearThinking()
            busy = false
            send.disabled = false
            newChat.disabled = false
            refreshMissions()
        }
    }

    function submitUserMessage(content) {
        if (busy || !content.trim()) return
        messages.push({ role: 'user', content })
        save()
        addBubble('user', content)
        sendConversation()
    }

    composer.addEventListener('submit', (e) => {
        e.preventDefault()
        if (busy) return
        const content = input.value
        input.value = ''
        submitUserMessage(content)
    })
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            composer.requestSubmit()
        }
    })
    newChat.addEventListener('click', () => {
        if (busy) return
        messages = []
        save()
        render()
    })
    drawerToggle.addEventListener('click', () => drawer.classList.toggle('hidden'))
    jsonCreate.addEventListener('click', () => {
        const name = document.getElementById('jsonMissionName').value.trim() || 'From JSON'
        const json = document.getElementById('jsonConfig').value.trim()
        if (!json) return
        try {
            JSON.parse(json)
        } catch {
            addBubble('error', 'Error: the JSON config drawer contains invalid JSON')
            return
        }
        drawer.classList.add('hidden')
        submitUserMessage(
            `Create a dashboard named "${name}" from this exact config JSON using dashboard_create_from_config (updateExisting: true):\n\`\`\`json\n${json}\n\`\`\``
        )
    })

    render()
    if (localStorage.getItem('mmgisChatPanelHidden') === '1') split.classList.add('panel-hidden')
    refreshHealth()
    refreshMissions()
    setInterval(refreshHealth, 15000)
}

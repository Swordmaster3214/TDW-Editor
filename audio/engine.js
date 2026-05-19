// Web Audio engine. One shared AudioContext for the whole app -- browsers
// only allow a small number of these and they're expensive to create.
//
// Sound files are proxied through our dev server at /sounds/{id}.wav
// to avoid CORS issues with thirtydollar.website.

let ctx = null

function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
        return ctx
}

// id -> Promise<AudioBuffer> so concurrent fetches for the same id
// share one request instead of firing several
const bufferCache = new Map()

// All currently playing source nodes, so we can cut them all at once
const activeSources = new Set()

function semitonesToRate(semitones) {
    return Math.pow(2, semitones / 12)
}

// Fetch and decode a sound buffer, with shared-promise deduplication
export function fetchBuffer(id) {
    if (bufferCache.has(id)) return bufferCache.get(id)

        const promise = (async () => {
            const url = `/sounds/${encodeURIComponent(id)}.wav`
            const res = await fetch(url)
            if (!res.ok) throw new Error(`Sound not found: ${id} (${res.status})`)
                const raw = await res.arrayBuffer()
                return await getCtx().decodeAudioData(raw)
        })()

        bufferCache.set(id, promise)

        // If it fails, evict from cache so a retry can happen
        promise.catch(() => bufferCache.delete(id))

        return promise
}

// Prefetch a batch of sounds without playing them -- called before sequence
// playback starts so there are no stutter gaps
export async function prefetchSounds(ids) {
    await Promise.allSettled(ids.map(id => fetchBuffer(id)))
}

// Play a sound and return its source node (or null on error)
// playAt is an AudioContext timestamp; omit it to play immediately
export async function playSound(id, {
    pitch  = 0,
    volume = 100,
    pan    = 0,
    playAt = null,
} = {}) {
    const ac = getCtx()
    if (ac.state === 'suspended') await ac.resume()

        let buffer
        try {
            buffer = await fetchBuffer(id)
        } catch (e) {
            console.warn(`[audio] Could not load "${id}":`, e.message)
            return null
        }

        const when = playAt ?? ac.currentTime

        // source -> gain -> panner -> destination
        const source  = ac.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = semitonesToRate(pitch)

        const gain = ac.createGain()
        // Divide by 200 to match TDW's headroom convention (100% vol -> gain 0.5)
        gain.gain.value = Math.max(0, volume / 200)

        const panner = ac.createStereoPanner()
        panner.pan.value = Math.max(-1, Math.min(1, pan / 100))

        source.connect(gain)
        gain.connect(panner)
        panner.connect(ac.destination)

        source.start(when)
        activeSources.add(source)
        source.onended = () => activeSources.delete(source)

        return source
}

// Quick preview play -- no scheduling, no prefetch requirement
// Used for right-click, insert feedback, and pitch-change feedback
export function previewSound(id, { pitch = 0, volume = 100, pan = 0 } = {}) {
    playSound(id, { pitch, volume, pan })
}

// Stop every currently playing sound immediately
export function cutAll() {
    for (const src of activeSources) {
        try { src.stop() } catch { /* already stopped */ }
    }
    activeSources.clear()
}

export function getCurrentTime() {
    return getCtx().currentTime
}

export function resumeContext() {
    return getCtx().resume()
}

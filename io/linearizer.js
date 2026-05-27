// Linearizer -- used by the multi-track exporter only, not for playback.
//
// Simulates the full control flow (loops, jumps, speed/volume/transpose
// changes) for a single track and returns a flat list of timed events
// measured in exact fractions of global project beats.

const MAX_EVENTS = 20000

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// --- Pure Integer Fraction Helpers ---
function gcd(a, b) {
    while (b !== 0n) {
        const r = a % b
        a = b
        b = r
    }
    return a < 0n ? -a : a
}

function createFract(n, d = 1n) {
    if (d === 0n) throw new Error("Division by zero")
        if (d < 0n) { n = -n; d = -d; }
        const g = gcd(n < 0n ? -n : n, d)
        return { n: n / g, d: d / g }
}

function numToFract(v) {
    const s = Number(v).toString()
    const dot = s.indexOf('.')
    if (dot === -1) return createFract(BigInt(Math.round(v)), 1n)
        const decPlaces = s.length - dot - 1
        const denom = 10n ** BigInt(decPlaces)
        const num = BigInt(s.replace('.', ''))
        return createFract(num, denom)
}

function addFract(a, b) {
    return createFract(a.n * b.d + b.n * a.d, a.d * b.d)
}

function mulFract(a, b) {
    return createFract(a.n * b.n, a.d * b.d)
}

function divFract(a, b) {
    return createFract(a.n * b.d, a.d * b.n)
}

function cmpFract(a, b) {
    const diff = a.n * b.d - b.n * a.d
    return diff < 0n ? -1 : (diff > 0n ? 1 : 0)
}

function clampFract(v, loNum, hiNum) {
    const lo = createFract(BigInt(loNum))
    const hi = createFract(BigInt(hiNum))
    if (cmpFract(v, lo) < 0) return lo
        if (cmpFract(v, hi) > 0) return hi
            return v
}

function applyModifierFract(current, newVal, modifier) {
    switch (modifier) {
        case '+':      return addFract(current, newVal)
        case 'x':      return mulFract(current, newVal)
        case 'divide': return newVal.n === 0n ? current : divFract(current, newVal)
        default:       return newVal
    }
}

// Clears jumpFired flags and remaining counts for loop bodies.
function clearRangeExclusive(dst, src, slots, triggered, remaining) {
    for (const k of triggered) {
        if (k > dst && k < src) {
            const s = slots[k]
            if (s?.isControl && (s.name === 'jump' || s.name === 'loop' || s.name === 'loopmany')) {
                triggered.delete(k)
            }
        }
    }
    for (const k of remaining.keys()) {
        if (k > dst && k < src) remaining.delete(k)
    }
}

export function linearizeTrack(project, track) {
    const slots = track.slots

    const projectBpmFract = createFract(BigInt(project.bpm))
    let bpm               = createFract(BigInt(project.bpm))
    let volume            = 100
    let transpose         = 0
    let loopTarget        = 0

    // Accumulated time tracked entirely in master project beats
    let timer = createFract(0n)

    const remaining = new Map()
    const triggered = new Set()

    const events = []
    let index = 0

    while (index < slots.length && events.length < MAX_EVENTS) {
        const slot = slots[index]

        if (slot.isControl) {
            const name = slot.name
            const val  = slot.value ?? 0
            const mod  = slot.modifier

            switch (name) {
                case 'speed':
                    bpm = clampFract(applyModifierFract(bpm, numToFract(val), mod), 5, 20000)
                    break

                case 'volume':
                    if (mod === '+') volume = clamp(volume + val, 0, 400)
                        else if (mod === 'x') volume = clamp(volume * val, 0, 400)
                            else if (mod === 'divide') volume = val <= 0 ? volume : clamp(volume / val, 0, 400)
                                else volume = clamp(val, 0, 400)
                                    break

                case 'transpose':
                    if (mod === '+') transpose = clamp(transpose + val, -60, 60)
                        else if (mod === 'x') transpose = clamp(transpose * val, -60, 60)
                            else if (mod === 'divide') transpose = val <= 0 ? transpose : clamp(transpose / val, -60, 60)
                                else transpose = clamp(val, -60, 60)
                                    break

                case 'stop': {
                    const beats = remaining.has(index) ? remaining.get(index) : val
                    if (beats > 0) {
                        const stepsToTake = Math.min(1, beats)
                        const projectBeats = mulFract(numToFract(stepsToTake), divFract(projectBpmFract, bpm))
                        timer = addFract(timer, projectBeats)
                        remaining.set(index, Math.max(0, beats - 1))
                        index--
                    } else {
                        remaining.delete(index)
                    }
                    break
                }

                case 'loopmany': {
                    const left = remaining.has(index) ? remaining.get(index) : val
                    if (left > 0) {
                        remaining.set(index, left - 1)
                        clearRangeExclusive(loopTarget, index, slots, triggered, remaining)
                        index = loopTarget - 1
                    } else {
                        remaining.delete(index)
                    }
                    break
                }

                case 'loop': {
                    const left = remaining.has(index) ? remaining.get(index) : 1
                    if (left > 0) {
                        remaining.set(index, left - 1)
                        clearRangeExclusive(loopTarget, index, slots, triggered, remaining)
                        index = loopTarget - 1
                    } else {
                        remaining.delete(index)
                    }
                    break
                }

                case 'looptarget':
                    loopTarget = index
                    break

                case 'jump': {
                    if (!triggered.has(index)) {
                        triggered.add(index)
                        const targetIdx = slots.findIndex((s, i) =>
                        s.isControl && s.name === 'target' && s.value == val
                        )
                        if (targetIdx >= 0) {
                            for (const k of remaining.keys()) {
                                if (k > targetIdx) remaining.delete(k)
                            }
                            index = targetIdx
                        }
                    }
                    break
                }

                case 'cut':
                    events.push({ type: 'cut', t: timer })
                    break
            }

            index++
            continue
        }

        if (slot.isRest) {
            const slotDur = createFract(BigInt(slot.duration.numerator), BigInt(slot.duration.denominator))
            const projectBeats = mulFract(slotDur, divFract(projectBpmFract, bpm))
            timer = addFract(timer, projectBeats)
            index++
            continue
        }

        const sounds = slot.sounds.map(s => ({
            id:     s.id,
            pitch:  clamp((s.pitch || 0) + transpose, -72, 72),
                                             volume: clamp((s.volume ?? 100) * volume / 100, 0, 400),
        }))

        events.push({ type: 'sound', t: timer, sounds })

        const slotDur = createFract(BigInt(slot.duration.numerator), BigInt(slot.duration.denominator))
        const projectBeats = mulFract(slotDur, divFract(projectBpmFract, bpm))
        timer = addFract(timer, projectBeats)
        index++
    }

    return events
}

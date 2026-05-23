// Linearizer -- used by the multi-track exporter only, not for playback.
//
// Simulates the full control flow (loops, jumps, speed/volume/transpose
// changes) for a single track and returns a flat list of timed events:
//
//   { type: 'sound', t: seconds, sounds: [{ id, pitch, volume }] }
//   { type: 'cut',   t: seconds }
//
// Key differences from the sequencer:
//   - Transpose is baked into each sound's pitch at event-build time
//   - Volume is baked into each sound's effective volume (0-600 range)
//   - !speed changes alter the timer accumulation instead of being emitted
//   - Visual-only controls (flash, pulse, bg, divider) are silently dropped
//   - Hard cap of 20,000 events prevents runaway loops

const MAX_EVENTS = 20000

function beatLen(bpm)        { return 60 / bpm }
function clamp(v, lo, hi)    { return Math.max(lo, Math.min(hi, v)) }

function applyModifier(current, newVal, modifier) {
    switch (modifier) {
        case '+':      return current + newVal
        case 'x':      return current * newVal
        case 'divide': return newVal <= 0 ? current : current / newVal
        default:       return newVal   // null = set
    }
}

// Clears jumpFired flags and remaining counts for loop bodies.
// Called when !loop or !loopmany jumps backward from src to dst.
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

    let bpm       = project.bpm
    let volume    = 100   // percentage; 100 = unity gain in TDW terms
    let transpose = 0     // semitone offset
    let loopTarget = 0

    let timer = 0   // accumulated time in seconds

    const remaining = new Map()   // slotIndex -> beats/loops remaining
    const triggered = new Set()   // slotIndices of one-shot jumps that have fired

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
                    bpm = clamp(applyModifier(bpm, val, mod), 5, 20000)
                    break

                case 'volume':
                    volume = clamp(applyModifier(volume, val, mod), 0, 600)
                    break

                case 'transpose':
                    transpose = clamp(applyModifier(transpose, val, mod), -60, 60)
                    break

                case 'stop': {
                    // !stop@N inserted via the actions panel acts as N beats of rest
                    const beats = remaining.has(index) ? remaining.get(index) : val
                    if (beats > 0) {
                        timer += beatLen(bpm) * Math.min(1, beats)
                        remaining.set(index, Math.max(0, beats - 1))
                        index--   // revisit next iteration
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
                            // Only clear loops after the landing point, not jump markers
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

                    // target, startpos, divider, flash, pulse, bg -- no effect on audio
            }

            index++
            continue
        }

        if (slot.isRest) {
            timer += beatLen(bpm) * slot.duration.toDecimal()
            index++
            continue
        }

        // Sound slot -- bake transpose and global volume into each sound
        const sounds = slot.sounds.map(s => ({
            id:     s.id,
            pitch:  clamp((s.pitch || 0) + transpose, -72, 72),
                                             volume: clamp((s.volume ?? 100) * volume / 100, 0, 600),
        }))

        events.push({ type: 'sound', t: timer, sounds })
        timer += beatLen(bpm) * slot.duration.toDecimal()
        index++
    }

    return events
}

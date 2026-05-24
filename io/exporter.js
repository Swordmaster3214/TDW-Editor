// Converts a Project to a flat TDW-compatible sequence string.

import { ControlSlot } from '../model/controlslot.js'
import { linearizeTrack } from './linearizer.js'

export function exportToTDW(project) {
    if (project.tracks.length === 1) {
        return exportSingleTrack(project, project.tracks[0].slots)
    }
    return exportMultiTrack(project)
}

// --- Single-track path (unchanged from original) ---
function exportSingleTrack(project, slots) {
    const tokens       = []
    let currentStepBPM = null

    let i = 0
    while (i < slots.length) {
        const slot = slots[i]

        if (slot.isControl) {
            tokens.push(slot.toTDWToken())
            if (slot.name === 'speed' && slot.value !== null && slot.modifier === null) {
                currentStepBPM = slot.value
            }
            i++
            continue
        }

        const dur     = slot.duration
        const stepBPM = computeStepBPM(project.bpm, dur)

        if (stepBPM !== currentStepBPM) {
            tokens.push(`!speed@${stepBPM}`)
            currentStepBPM = stepBPM
        }

        if (slot.isRest) {
            let count = 1
            while (
                i + count < slots.length &&
                slots[i + count].isRest &&
                !slots[i + count].isControl &&
                slots[i + count].duration.equals(dur)
            ) count++
            tokens.push(count > 1 ? `_pause=${count}` : '_pause')
            i += count
        } else if (slot.sounds.length === 1) {
            const soundToken = formatSound(slot.sounds[0])
            let count = 1
            while (
                i + count < slots.length &&
                !slots[i + count].isControl &&
                !slots[i + count].isRest &&
                slots[i + count].sounds.length === 1 &&
                slots[i + count].duration.equals(dur) &&
                formatSound(slots[i + count].sounds[0]) === soundToken
            ) count++
            tokens.push(count > 1 ? `${soundToken}=${count}` : soundToken)
            i += count
        } else {
            tokens.push(slot.sounds.map(formatSound).join('|!combine|'))
            i++
        }
    }

    return tokens.join('|')
}

// --- Multi-track path (Rational Integer Engine) ---
function exportMultiTrack(project) {
    const hasSolo = project.tracks.some(t => t.solo)
    const active  = project.tracks.filter(t => hasSolo ? t.solo : !t.muted)

    if (active.length === 0) return ''

        const allEvents = active.flatMap(t => linearizeTrack(project, t))

        // Sort events purely by fraction cross-multiplication
        allEvents.sort((a, b) => {
            const diff = a.t.n * b.t.d - b.t.n * a.t.d
            return diff < 0n ? -1 : (diff > 0n ? 1 : 0)
        })

        if (allEvents.length === 0) return ''

            const groups = groupByTime(allEvents)

            const tokens        = []
            let   currentBPM    = null
            let   currentVolume = 100

            for (let i = 0; i < groups.length; i++) {
                const group     = groups[i]
                const nextGroup = groups[i + 1]

                let deltaBeats = { n: 0n, d: 1n }
                if (nextGroup) {
                    // nextGroup.t - group.t
                    const n = nextGroup.t.n * group.t.d - group.t.n * nextGroup.t.d
                    const d = nextGroup.t.d * group.t.d
                    const g = gcd(n < 0n ? -n : n, d)
                    deltaBeats = { n: n / g, d: d / g }
                }

                let steps = 1

                // 1. Determine and emit optimal integer BPM based on beat fraction
                if (nextGroup && deltaBeats.n > 0n) {
                    const N = deltaBeats.n
                    const D = deltaBeats.d

                    let localBPM
                    // If projectBPM * Denominator is within the hard 10,000 max tempo limit
                    if (BigInt(project.bpm) * D <= 10000n) {
                        localBPM = Number(BigInt(project.bpm) * D)
                        steps    = Number(N)
                    } else {
                        // Out of range polyrhythm: lock to maximum speed and calculate required pauses
                        localBPM = 10000
                        const num = 10000n * N
                        const den = BigInt(project.bpm) * D
                        steps = Number((num + den / 2n) / den) // Integer rounding
                        if (steps < 1) steps = 1
                    }

                    if (localBPM !== currentBPM) {
                        tokens.push(`!speed@${localBPM}`)
                        currentBPM = localBPM
                    }
                } else if (currentBPM === null) {
                    tokens.push(`!speed@${project.bpm}`)
                    currentBPM = project.bpm
                }

                // 2. Emit the current group's content
                if (group.type === 'cut') {
                    tokens.push('!cut')
                } else {
                    const allSounds = group.events.flatMap(ev => ev.sounds || [])
                    if (allSounds.length > 0) {
                        for (let si = 0; si < allSounds.length; si++) {
                            if (si > 0) tokens.push('!combine')

                                const s       = allSounds[si]
                                const vol     = Math.round(s.volume)
                                if (vol !== currentVolume) {
                                    tokens.push(`!volume@${vol}`)
                                    currentVolume = vol
                                }

                                let token = s.id
                                if (s.pitch !== 0) token += `@${s.pitch}`
                                    tokens.push(token)
                        }
                    }
                }

                // 3. Fill the trailing space using step-accurate pauses
                if (nextGroup && deltaBeats.n > 0n) {
                    if (steps > 1) {
                        emitPauses(tokens, steps - 1)
                    }
                }
            }

            const raw = tokens.join('|')
            return tryRecompress(tokens).join('|') || raw
}

// Group exact simultaneous events (Zero epsilon needed)
function groupByTime(events) {
    const groups = []
    for (const ev of events) {
        const last = groups[groups.length - 1]
        if (last && last.type === 'sound' && ev.type === 'sound' && (ev.t.n * last.t.d === last.t.n * ev.t.d)) {
            last.events.push(ev)
        } else {
            groups.push({
                t:      ev.t,
                type:   ev.type,
                events: ev.type === 'sound' ? [ev] : [],
            })
        }
    }
    return groups
}

function gcd(a, b) {
    while (b !== 0n) {
        const r = a % b
        a = b
        b = r
    }
    return a < 0n ? -a : a
}

function emitPauses(tokens, count) {
    if (count <= 0) return
        tokens.push(count > 1 ? `_pause=${count}` : '_pause')
}

function tryRecompress(tokens) {
    const speedIdx = tokens[0]?.startsWith('!speed') ? 1 : 0
    const body     = tokens.slice(speedIdx)
    const L        = body.length

    for (let P = 1; P <= Math.floor(L / 2); P++) {
        if (L % P !== 0) continue

            let match = true
            for (let i = P; i < L; i++) {
                if (body[i] !== body[i % P]) { match = false; break }
            }

            if (match) {
                const K       = L / P
                const savings = L - (P + 2)
                if (savings >= 10) {
                    return [
                        ...tokens.slice(0, speedIdx),
                        '!looptarget',
                        ...body.slice(0, P),
                        `!loopmany@${K - 1}`,
                    ]
                }
                break
            }
    }
    return tokens
}

function computeStepBPM(baseBPM, duration) {
    const raw = baseBPM * duration.denominator / duration.numerator
    return Math.round(raw * 1e6) / 1e6
}

function formatSound(sound) {
    let token = sound.id
    if (sound.pitch !== 0) token += `@${sound.pitch}`
        return token
}

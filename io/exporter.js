// Converts a Project to a flat TDW-compatible sequence string.
//
// Single track: existing fast path (operates directly on slot objects).
// Multiple tracks: linearize each track into timed events, merge, then
// re-encode into a single flat TDW sequence at a computed export BPM.

import { ControlSlot } from '../model/controlslot.js'
import { linearizeTrack } from './linearizer.js'

export function exportToTDW(project) {
    if (project.tracks.length === 1) {
        return exportSingleTrack(project, project.tracks[0].slots)
    }
    return exportMultiTrack(project)
}

// --- Single-track path (unchanged from original, just takes a slots array) ---

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

// --- Multi-track path ---

function exportMultiTrack(project) {
    // Determine which tracks are active (solo beats mute)
    const hasSolo = project.tracks.some(t => t.solo)
    const active  = project.tracks.filter(t => hasSolo ? t.solo : !t.muted)

    if (active.length === 0) return ''

        // Linearize each active track and merge all events
        const allEvents = active.flatMap(t => linearizeTrack(project, t))
        allEvents.sort((a, b) => a.t - b.t)

        if (allEvents.length === 0) return ''

            // Group events that are simultaneous (within floating-point epsilon)
            const groups = groupByTime(allEvents)

            // Work out a step size that can represent every event boundary
            const stepSecs  = computeStepSecs(groups)
            const exportBPM = Math.round(Math.min(60 / stepSecs, 10000) * 1e6) / 1e6

            // Build flat token list
            const tokens        = [`!speed@${exportBPM}`]
            let   cursorStep    = 0      // integer step count at current position
            let   currentVolume = 100   // tracked so we only emit !volume on changes

            for (const group of groups) {
                if (group.type === 'cut') {
                    // Fill gap then emit cut
                    const targetStep = Math.round(group.t / stepSecs)
                    emitPauses(tokens, targetStep - cursorStep)
                    cursorStep = targetStep
                    tokens.push('!cut')
                    continue
                }

                const targetStep = Math.round(group.t / stepSecs)
                emitPauses(tokens, targetStep - cursorStep)
                cursorStep = targetStep

                // Gather all sounds in this time-group
                const allSounds = group.events.flatMap(ev => ev.sounds || [])
                if (allSounds.length === 0) continue

                    // Emit sounds, inserting !combine between adjacent entries.
                    // If a sound's effective volume differs from the current global volume,
                    // emit !volume before it (even in the middle of a chord).
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

                    cursorStep++
            }

            const raw = tokens.join('|')

            // Attempt period-based recompression for repeated patterns
            return tryRecompress(tokens).join('|') || raw
}

// Group events within 1 ns of each other into one time bucket
function groupByTime(events, eps = 1e-9) {
    const groups = []
    for (const ev of events) {
        const last = groups[groups.length - 1]
        if (last && Math.abs(ev.t - last.t) < eps) {
            if (ev.type === 'sound') last.events.push(ev)
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

// Float Euclidean GCD -- finds the largest value that divides both inputs
function floatGcd(a, b, eps = 1e-9) {
    while (b > eps) {
        const r = a % b
        a = b
        b = r
    }
    return a
}

// Compute the minimum step size (in seconds) that can represent all
// inter-event intervals. Returns a sensible fallback if there's only one group.
function computeStepSecs(groups) {
    const soundGroups = groups.filter(g => g.type === 'sound')
    if (soundGroups.length < 2) return 60 / 120   // default quarter at 120 BPM

        // Collect all intervals between consecutive sound events
        let step = null
        for (let i = 1; i < soundGroups.length; i++) {
            const interval = soundGroups[i].t - soundGroups[i - 1].t
            if (interval < 1e-9) continue
                step = step === null ? interval : floatGcd(step, interval)
                if (step < 60 / 10000) break   // can't go above 10,000 BPM anyway
        }

        // Also include the offset of the first event from t=0
        if (soundGroups[0].t > 1e-9 && step !== null) {
            step = floatGcd(step, soundGroups[0].t)
        }

        return Math.max(step ?? (60 / 120), 60 / 10000)
}

// Push the right number of _pause tokens into the array
function emitPauses(tokens, count) {
    if (count <= 0) return
        tokens.push(count > 1 ? `_pause=${count}` : '_pause')
}

// Try to detect whether the token sequence (minus the leading !speed) is a
// simple N-fold repeat of a shorter period, and wrap it with !looptarget /
// !loopmany if the saving is worthwhile.
function tryRecompress(tokens) {
    // Separate the leading !speed so we don't include it in the period check
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
                const K       = L / P           // total repetitions
                const savings = L - (P + 2)     // vs period + looptarget + loopmany
                if (savings >= 10) {
                    return [
                        ...tokens.slice(0, speedIdx),
                        '!looptarget',
                        ...body.slice(0, P),
                        `!loopmany@${K - 1}`,   // loopmany@N means N+1 plays total
                    ]
                }
                break   // found the minimum period but savings aren't worth it
            }
    }

    return tokens
}

// --- Shared helpers ---

function computeStepBPM(baseBPM, duration) {
    const raw = baseBPM * duration.denominator / duration.numerator
    return Math.round(raw * 1e6) / 1e6
}

function formatSound(sound) {
    let token = sound.id
    if (sound.pitch !== 0) token += `@${sound.pitch}`
        return token
}

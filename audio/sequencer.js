// Sequence scheduler. Builds a merged event schedule across all active
// tracks and queues audio 5 seconds ahead in a rolling window.
//
// Each track runs its own BPM/volume/transpose state independently.
// Events from all tracks are merged and sorted by absolute time.

import {
    prefetchSounds,
    playSound,
    cutAll,
    cutBefore,
    getCurrentTime,
    resumeContext,
} from './engine.js'
import { resolveAudioId } from '../app.js'

const QUEUE_AHEAD_SECS  = 5
const MAX_SCHEDULE_SECS = 60 * 10   // 10 minute safety cap for runaway loops

function beatLen(bpm)        { return 60 / bpm }
function clamp(v, lo, hi)    { return Math.max(lo, Math.min(hi, v)) }

function applyModifier(current, newVal, modifier) {
    switch (modifier) {
        case '+':      return current + newVal
        case 'x':      return current * newVal
        case 'divide': return newVal <= 0 ? current : current / newVal
        default:       return newVal
    }
}

// Clears loop-related state within the range (dst, src) exclusive --
// called when looping backward so the body replays correctly.
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

// Build a schedule for one track. Returns { events, soundIds }.
// Events are tagged with trackIndex so the editor can highlight the right lane.
function buildTrackSchedule(project, track, trackIndex) {
    const slots  = track.slots
    const events = []
    const soundIds = new Set()

    let bpm           = project.bpm
    let volume        = 100
    let transposition = 0
    let loopTarget    = 0
    let timer         = 0

    const remaining = new Map()
    const triggered = new Set()

    let index = 0

    while (index < slots.length) {
        if (timer > MAX_SCHEDULE_SECS) {
            console.warn(`[sequencer] Track ${trackIndex} truncated at 10 min safety limit`)
            break
        }

        const slot = slots[index]

        if (slot.isControl) {
            const name = slot.name
            const val  = slot.value ?? 0
            const mod  = slot.modifier

            switch (name) {
                case 'speed':
                    bpm = +clamp(applyModifier(bpm, val, mod), 5, 20000).toFixed(4)
                    break

                case 'volume':
                    volume = +clamp(applyModifier(volume, val, mod), 0, 400).toFixed(4)
                    break

                case 'transpose':
                    transposition = +clamp(applyModifier(transposition, val, mod), -60, 60).toFixed(4)
                    break

                case 'stop': {
                    const beats = remaining.has(index) ? remaining.get(index) : val
                    if (beats > 0) {
                        timer += beatLen(bpm) * Math.min(1, beats)
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

                case 'target':
                    break

                case 'cut':
                    events.push({ type: 'cut', time: timer })
                    break

                case 'startpos':
                    break

                    // divider, flash, pulse, bg -- no audio effect
            }

            index++
            continue
        }

        if (slot.isRest) {
            timer += beatLen(bpm) * slot.duration.toDecimal()
            index++
            continue
        }

        // Sound slot -- volume is track-level * per-sound override,
        // panning comes straight from the sound (already in -100..100 range,
        // engine's StereoPanner divides by 100 to get -1..1).
        for (const sound of slot.sounds) {
            const audioId = resolveAudioId(sound.id)
            soundIds.add(audioId)

            const perVol = sound.volume ?? 100
            events.push({
                type:       'sound',
                id:         audioId,
                time:       timer,
                pitch:      clamp((sound.pitch || 0) + transposition, -72, 72),
                        volume:     volume * clamp(perVol / 100, 0, 4),
                        pan:        sound.panning ?? 0,
                        slotIndex:  index,
                        trackIndex,
            })
        }

        timer += beatLen(bpm) * slot.duration.toDecimal()
        index++
    }

    events.sort((a, b) => a.time - b.time)
    return { events, soundIds }
}

// Merge schedules from all active tracks into one sorted event list.
export function buildSchedule(project) {
    const hasSolo  = project.tracks.some(t => t.solo)
    const allEvents  = []
    const allSoundIds = new Set()

    project.tracks.forEach((track, trackIndex) => {
        if (hasSolo ? !track.solo : track.muted) return
            const { events, soundIds } = buildTrackSchedule(project, track, trackIndex)
            for (const ev of events) allEvents.push(ev)
                for (const id of soundIds) allSoundIds.add(id)
    })

    allEvents.sort((a, b) => a.time - b.time)
    return { events: allEvents, soundIds: allSoundIds }
}

// -- Playback state --

let startTime   = 0
let schedule    = []
let nextToQueue = 0
let isPlaying   = false
let endTimer    = null
let queueTimer  = null
let pendingSlotPlayTimeouts = []  // Track all pending slotplay timeouts

export function isActive() { return isPlaying }

export async function play(project, { onStop } = {}) {
    stop()

    const { events, soundIds } = buildSchedule(project)
    schedule    = events
    nextToQueue = 0

    await prefetchSounds([...soundIds])
    await resumeContext()

    startTime = getCurrentTime()
    isPlaying = true

    queueWindow()

    const lastTime   = schedule.length ? schedule[schedule.length - 1].time : 0
    const msUntilEnd = (lastTime + 1.5) * 1000
    endTimer = setTimeout(() => {
        stop()
        onStop?.()
    }, msUntilEnd)
}

function queueWindow() {
    if (!isPlaying) return

        const now = getCurrentTime()

        while (nextToQueue < schedule.length) {
            const ev   = schedule[nextToQueue]
            const when = startTime + ev.time

            if (when > now + QUEUE_AHEAD_SECS) break

                if (ev.type === 'sound') {
                    playSound(ev.id, {
                        pitch:  ev.pitch,
                        volume: ev.volume,
                        pan:    ev.pan,
                        playAt: when,
                    })
                    const msUntilPlay   = Math.max(0, (when - now) * 1000)
                    const capturedIndex = ev.slotIndex
                    const capturedTrack = ev.trackIndex
                    const timeoutId = setTimeout(() => {
                        document.dispatchEvent(new CustomEvent('slotplay', {
                            detail: { index: capturedIndex, trackIndex: capturedTrack }
                        }))
                    }, msUntilPlay)
                    pendingSlotPlayTimeouts.push(timeoutId)
                } else if (ev.type === 'cut') {
                    const cutAt       = when
                    const msUntilCut  = Math.max(0, (cutAt - now) * 1000)
                    setTimeout(() => cutBefore(cutAt), msUntilCut)
                }

                nextToQueue++
        }

        if (nextToQueue < schedule.length) {
            queueTimer = setTimeout(queueWindow, 1000)
        }
}

export function stop() {
    isPlaying   = false
    nextToQueue = 0
    schedule    = []

    cutAll()

    if (endTimer   !== null) { clearTimeout(endTimer);   endTimer   = null }
    if (queueTimer !== null) { clearTimeout(queueTimer); queueTimer = null }

    // Clear all pending slotplay timeouts so no more markers are created
    for (const timeoutId of pendingSlotPlayTimeouts) {
        clearTimeout(timeoutId)
    }
    pendingSlotPlayTimeouts = []

    // Dispatch slotsclear to reset all played indicators
    document.dispatchEvent(new CustomEvent('slotsclear'))
}

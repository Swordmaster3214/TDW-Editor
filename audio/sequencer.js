// Sequence scheduler. Ports TDW's preloadSequence + playSequence logic to
// the Web Audio API -- no jQuery, no DOM, just timing math and audio calls.
//
// Key design notes lifted from TDW's source:
//   - A flat "order" array is built first (buildSchedule), then sounds are
//     queued 5 seconds ahead of playback time in a rolling window.
//   - BPM and volume changes mid-sequence are handled by tracking them as
//     state while walking the slot list, so each event gets the right values
//     baked in at schedule-build time.
//   - Loops work by resetting the walk index and keeping a "remaining" map
//     so we don't have to mutate the original project data.

import {
    prefetchSounds,
    playSound,
    cutAll,
    cutBefore,
    getCurrentTime,
    resumeContext,
} from './engine.js'
import { resolveAudioId } from '../app.js'

const QUEUE_AHEAD_SECS = 5
const MAX_SCHEDULE_SECS = 60 * 10   // 10 minute safety limit for runaway loops

function beatLen(bpm) {
    return 60 / bpm   // seconds per beat
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
}

// Mirrors TDW's modifyNumber -- applies set / add / multiply / divide
function applyModifier(current, newVal, modifier) {
    switch (modifier) {
        case '+':      return current + newVal
        case 'x':      return current * newVal
        case 'divide': return newVal <= 0 ? current : current / newVal
        default:       return newVal   // null = set
    }
}

// Walk the slot list and produce a flat list of timed events, similar to
// TDW's preloadSequence(). Returns { events, soundIds }.
//
// events is sorted by time. Each entry is either:
//   { type: 'sound', id, time, pitch, volume, pan, slotIndex }
//   { type: 'cut',   time }
export function buildSchedule(project) {
    const slots  = project.slots
    const events = []
    const soundIds = new Set()

    let bpm           = project.bpm
    let volume        = 100
    let transposition = 0
    let loopTarget    = 0
    let timer         = 0   // seconds

    // Loop/jump state -- avoids mutating project slots
    const remaining = new Map()   // slotIndex -> beats/loops left
    const triggered = new Set()   // slotIndices that have fired their one-shot (loop/looponce)

    // jump slots are tracked separately and NEVER cleared by loop resets.
    // Without this, looping back past a jump slot re-enables it, causing
    // infinite loops even when the sequence is only supposed to jump once.
    const jumpFired = new Set()

    let index = 0

    while (index < slots.length) {
        if (timer > MAX_SCHEDULE_SECS) {
            console.warn('[sequencer] Schedule truncated at 10 min safety limit')
            break
        }

        const slot = slots[index]

        // -- Control slots --
        if (slot.isControl) {
            const name = slot.name
            const val  = slot.value ?? 0
            const mod  = slot.modifier   // null | '+' | 'x' | 'divide'

            switch (name) {
                case 'speed': {
                    bpm = applyModifier(bpm, val, mod)
                    bpm = +clamp(bpm, 5, 20000).toFixed(4)
                    break
                }
                case 'volume': {
                    volume = applyModifier(volume, val, mod)
                    volume = +clamp(volume, 0, 600).toFixed(4)
                    break
                }
                case 'transpose': {
                    transposition = applyModifier(transposition, val, mod)
                    transposition = +clamp(transposition, -60, 60).toFixed(4)
                    break
                }
                case 'stop': {
                    const beats = remaining.has(index) ? remaining.get(index) : val
                    if (beats > 0) {
                        timer += beatLen(bpm) * Math.min(1, beats)
                        remaining.set(index, Math.max(0, beats - 1))
                        index--   // revisit this slot next iteration
                    } else {
                        remaining.delete(index)
                    }
                    break
                }
                case 'loopmany': {
                    const left = remaining.has(index) ? remaining.get(index) : val
                    if (left > 0) {
                        remaining.set(index, left - 1)
                        // Clear one-shot loop triggers after the new target position
                        for (const k of triggered) {
                            if (k > loopTarget) triggered.delete(k)
                        }
                        index = loopTarget - 1
                    } else {
                        remaining.delete(index)
                    }
                    break
                }
                case 'loop': {
                    if (!triggered.has(index)) {
                        triggered.add(index)
                        for (const k of triggered) {
                            if (k > loopTarget) triggered.delete(k)
                        }
                        index = loopTarget - 1
                    }
                    break
                }
                case 'looptarget': {
                    loopTarget = index
                    break
                }
                case 'jump': {
                    // jumpFired is never cleared -- each jump slot fires at most once
                    // regardless of how many times the sequence loops past it.
                    if (!jumpFired.has(index)) {
                        jumpFired.add(index)
                        const targetIdx = slots.findIndex((s, i) =>
                        s.isControl &&
                        s.name === 'target' &&
                        s.value == val &&
                        !triggered.has(i)
                        )
                        if (targetIdx >= 0) {
                            for (const k of triggered) {
                                if (k > targetIdx) triggered.delete(k)
                            }
                            index = targetIdx
                        }
                    }
                    break
                }
                case 'cut': {
                    events.push({ type: 'cut', time: timer })
                    break
                }
                // divider, flash, pulse, bg -- no audio effect
            }

            index++
            continue
        }

        // -- Rest slots --
        if (slot.isRest) {
            timer += beatLen(bpm) * slot.duration.toDecimal()
            index++
            continue
        }

        // -- Sound slots (possibly a chord) --
        for (const sound of slot.sounds) {
            const audioId = resolveAudioId(sound.id)
            soundIds.add(audioId)

            const perVol = sound.volume ?? 100

            events.push({
                type:      'sound',
                id:        audioId,
                time:      timer,
                pitch:     clamp((sound.pitch || 0) + transposition, -72, 72),
                        // Match TDW: global volume * (per-sound vol / 100), /200 in engine
                        volume:    volume * clamp(perVol / 100, 0, 4),
                        pan:       0,
                        slotIndex: index,   // used to fire the "played" visual update
            })
        }

        timer += beatLen(bpm) * slot.duration.toDecimal()
        index++
    }

    events.sort((a, b) => a.time - b.time)
    return { events, soundIds }
}

// -- Playback state --

let startTime    = 0
let schedule     = []
let nextToQueue  = 0
let isPlaying    = false
let endTimer     = null
let queueTimer   = null

export function isActive() { return isPlaying }

// Start playing a project. Resolves after sounds are prefetched and playback begins.
// onStop is called when the sequence ends naturally.
export async function play(project, { onStop } = {}) {
    stop()

    const { events, soundIds } = buildSchedule(project)
    schedule    = events
    nextToQueue = 0

    // Prefetch all needed sounds before we start the clock
    await prefetchSounds([...soundIds])
    await resumeContext()

    startTime = getCurrentTime()
    isPlaying = true

    queueWindow()

    // Schedule end-of-sequence callback based on last event time
    const lastTime = schedule.length ? schedule[schedule.length - 1].time : 0
    const msUntilEnd = (lastTime + 1.5) * 1000
    endTimer = setTimeout(() => {
        stop()
        onStop?.()
    }, msUntilEnd)
}

// Queue sounds within the lookahead window, rescheduling itself each second
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
                    // Fire the visual "played" indicator at actual playback time, not queue time
                    const msUntilPlay = Math.max(0, (when - now) * 1000)
                    const capturedIndex = ev.slotIndex
                    setTimeout(() => {
                        document.dispatchEvent(new CustomEvent('slotplay', { detail: { index: capturedIndex } }))
                    }, msUntilPlay)
                } else if (ev.type === 'cut') {
                    // Only cut sounds that started at or before this moment -- later-queued
                    // sounds must survive. cutAll() would kill them too, which caused the
                    // original bug where !cut silenced the note immediately following it.
                    const cutAt = when
                    const msUntilCut = Math.max(0, (cutAt - now) * 1000)
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

    // Tell the editor to clear any played-slot highlighting
    document.dispatchEvent(new CustomEvent('slotsclear'))
}

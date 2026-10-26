// Central state store. All mutations go through the functions here,
// which dispatch a 'statechange' event so UI components can re-render.

import { Project }     from './model/project.js'
import { Track }       from './model/track.js'
import { Slot }        from './model/slot.js'
import { Sound }       from './model/sound.js'
import { Fraction }    from './model/fraction.js'
import { ControlSlot, ACTIONS } from './model/controlslot.js'

export const state = {
    project:          new Project(),
    activeTrackIndex: 0,
    cursorPos:        0,       // insert point within the active track; 0 = before first slot
    selection:        null,    // { indices:Set, anchorGap, focusGap, start, end } or null
    anchorSlot:       null,    // slot last plain-clicked (valid while the cursor sits right after it)
    activeDur:        Fraction.QUARTER,
    soundList:        [],
    undoStack:        [],      // array of serialized tracks snapshots
    redoStack:        [],
}

// Sound ID lookup cache: Map<tdwId, sound> for O(1) lookups instead of O(n)
let soundIdCache = null

// Edits closer together than this share one undo step
let lastSnapshotAt = -Infinity
const UNDO_DEBOUNCE_MS = 200

// -- Active track helper --

export function activeTrack() {
    return state.project.tracks[state.activeTrackIndex]
    ?? state.project.tracks[0]
}

// -- Notifications --

function notify() {
    document.dispatchEvent(new CustomEvent('statechange'))
}

// -- Undo/redo --

function serializeTracks() {
    return JSON.stringify(state.project.tracks.map(t => t.toJSON()))
}

// Saves the state from before an edit. A quick burst of edits (like
// scrolling a pitch up several steps) only saves once, at the start of the
// burst, so a single Ctrl+Z undoes the whole burst. Pass force for edits
// that should always be their own undo step, like dropping dragged slots.
function snapshot({ force = false } = {}) {
    const now   = performance.now()
    const quiet = now - lastSnapshotAt > UNDO_DEBOUNCE_MS
    lastSnapshotAt = now
    if (!force && !quiet) return
    state.undoStack.push(serializeTracks())
    state.redoStack = []
    if (state.undoStack.length > 100) state.undoStack.shift()
}

function restoreTracks(raw) {
    state.project.tracks = raw.map(Track.fromJSON)
    state.activeTrackIndex = Math.min(state.activeTrackIndex, state.project.tracks.length - 1)
    const len = activeTrack().slots.length
    state.cursorPos = Math.min(state.cursorPos, len)
    state.selection = null
    state.anchorSlot = null
}

export function undo() {
    if (!state.undoStack.length) return
    state.redoStack.push(serializeTracks())
    restoreTracks(JSON.parse(state.undoStack.pop()))
    lastSnapshotAt = -Infinity
    notify()
}

export function redo() {
    if (!state.redoStack.length) return
    state.undoStack.push(serializeTracks())
    restoreTracks(JSON.parse(state.redoStack.pop()))
    lastSnapshotAt = -Infinity
    notify()
}

// -- Cursor --

export function setCursor(pos) {
    state.cursorPos = Math.max(0, Math.min(pos, activeTrack().slots.length))
    state.selection = null
    state.anchorSlot = null
    notify()
}

export function moveCursor(delta) {
    setCursor(state.cursorPos + delta)
}

// Plain click on a slot: cursor goes after it and it becomes the anchor
// for a later shift+click.
export function clickSlot(i) {
    state.cursorPos  = Math.max(0, Math.min(i + 1, activeTrack().slots.length))
    state.selection  = null
    state.anchorSlot = i
    notify()
}

// -- Selection --
//
// A selection is a set of slot indices on the active track. Shift-click,
// shift-arrows and the marquee always make a contiguous run, while
// ctrl-click can leave holes. anchorGap and focusGap are cursor positions
// (the spots between slots) and drive shift+arrow growth. start and end are
// just the lowest and highest selected index.

function makeSelection(indices, anchorGap, focusGap, anchorSlot = null) {
    if (!indices.size) return null
    let start = Infinity, end = -Infinity
    for (const i of indices) { if (i < start) start = i; if (i > end) end = i }
    return { indices, anchorGap, focusGap, anchorSlot: anchorSlot ?? start, start, end }
}

// The slot a plain click last landed after, as long as the cursor has not
// moved since. It acts as the starting point for shift+click and ctrl+click.
function clickedSlot() {
    const a = state.anchorSlot
    return a !== null && state.cursorPos === a + 1 ? a : null
}

function clampGap(g) {
    return Math.max(0, Math.min(g, activeTrack().slots.length))
}

export function selectedIndices() {
    return state.selection ? [...state.selection.indices].sort((a, b) => a - b) : []
}

export function isSlotSelected(i) {
    return !!state.selection?.indices.has(i)
}

export function setSelection(start, end) {
    if (start === null) {
        state.selection = null
    } else {
        const lo = Math.max(0, Math.min(start, end))
        const hi = Math.min(activeTrack().slots.length - 1, Math.max(start, end))
        const indices = new Set()
        for (let i = lo; i <= hi; i++) indices.add(i)
        state.selection = makeSelection(indices, lo, hi + 1)
    }
    notify()
}

export function extendSelection(delta) {
    const anchor = state.selection?.anchorGap ?? state.cursorPos
    const focus  = clampGap((state.selection?.focusGap ?? state.cursorPos) + delta)
    selectGapRange(anchor, focus)
}

// Select every slot between two gaps, like dragging a text selection.
// Pass base (a Set) to keep existing picks, which is what a ctrl+marquee does.
export function selectGapRange(anchorGap, focusGap, base = null) {
    const a = clampGap(anchorGap)
    const f = clampGap(focusGap)
    const indices = new Set(base ?? [])
    for (let i = Math.min(a, f); i < Math.max(a, f); i++) indices.add(i)
    // The slot next to where the drag began, on the side the drag went
    const anchorSlot = f >= a ? a : a - 1
    state.selection = makeSelection(indices, a, f, Math.max(0, anchorSlot))
    state.cursorPos = f
    notify()
}

// Shift+click: everything from the anchor slot through the clicked one.
// With additive (shift+ctrl) the range joins what is already selected.
export function selectSlotRange(i, { additive = false } = {}) {
    const len = activeTrack().slots.length
    if (!len) return
    const from = state.selection?.anchorSlot ?? clickedSlot() ?? state.cursorPos - 1
    const a = Math.max(0, Math.min(from, len - 1))
    const base = additive && state.selection ? state.selection.indices : null
    const indices = new Set(base ?? [])
    for (let k = Math.min(a, i); k <= Math.max(a, i); k++) indices.add(k)
    const anchorGap = i >= a ? a : a + 1
    const focusGap  = i >= a ? i + 1 : i
    state.selection  = makeSelection(indices, anchorGap, focusGap, a)
    state.anchorSlot = null
    state.cursorPos  = focusGap
    notify()
}

// Ctrl+click: add or remove just this slot.
export function toggleSlot(i) {
    const indices = new Set(state.selection?.indices ?? [])
    // First ctrl+click after a plain click: the clicked slot counts as picked
    const clicked = state.selection ? null : clickedSlot()
    if (clicked !== null && clicked !== i) indices.add(clicked)
    if (indices.has(i)) indices.delete(i)
    else indices.add(i)
    state.selection  = makeSelection(indices, i, i + 1, i)
    state.anchorSlot = null
    state.cursorPos  = i + 1
    notify()
}

export function selectAll() {
    const len = activeTrack().slots.length
    if (!len) return
    selectGapRange(0, len)
}

// -- Insert / delete --

export function insertSlot(slot) {
    snapshot()
    const slots = activeTrack().slots
    if (state.selection) {
        // Replace the whole selection with the new slot, even if it has holes
        const picked = selectedIndices()
        for (let k = picked.length - 1; k >= 0; k--) slots.splice(picked[k], 1)
        slots.splice(picked[0], 0, slot)
        state.cursorPos = picked[0] + 1
        state.selection = null
    } else {
        slots.splice(state.cursorPos, 0, slot)
        state.cursorPos++
    }
    notify()
}

export function insertSound(soundId) {
    if (soundId === '_pause') { insertRest(); return }
    insertSlot(new Slot({ sounds: [new Sound({ id: soundId, pitch: 0 })], duration: state.activeDur }))
}

export function insertRest() {
    insertSlot(new Slot({ sounds: [], duration: state.activeDur }))
}

export function addToChord(soundId) {
    if (state.cursorPos === 0) return
        snapshot()
        const target = activeTrack().slots[state.cursorPos - 1]
        if (!target || target.isRest || target.isControl) return
            target.sounds.push(new Sound({ id: soundId, pitch: 0 }))
            notify()
}

export function insertControl(name, value = null, modifier = null, value2 = null) {
    insertSlot(new ControlSlot({ name, value, modifier, value2 }))
}

export function deleteBeforeCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos === 0) return
            snapshot()
            activeTrack().slots.splice(state.cursorPos - 1, 1)
            state.cursorPos--
            notify()
}

export function deleteAfterCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos >= activeTrack().slots.length) return
            snapshot()
            activeTrack().slots.splice(state.cursorPos, 1)
            notify()
}

function deleteSelection() {
    if (!state.selection) return
    snapshot()
    const slots  = activeTrack().slots
    const picked = selectedIndices()
    for (let k = picked.length - 1; k >= 0; k--) slots.splice(picked[k], 1)
    state.cursorPos = picked[0]
    state.selection = null
    notify()
}

// -- Copy / paste --

let clipboard = []

export function copySelection() {
    if (!state.selection) return
    const slots = activeTrack().slots
    clipboard = selectedIndices().map(i => slots[i].clone())
}

export function pasteAtCursor() {
    if (!clipboard.length) return
        snapshot()
        const clones = clipboard.map(s => s.clone())
        activeTrack().slots.splice(state.cursorPos, 0, ...clones)
        state.cursorPos += clones.length
        state.selection  = null
        state.anchorSlot = null
        notify()
}

// -- Moving slots between positions and lanes --

// Move (or copy) slots from one track to a spot in another, or the same,
// track. gap is where the group lands, counted in the destination list
// after the moved slots have been taken out (when moving inside one track).
// The moved slots end up selected in the destination so the drag can be
// undone with another drag or a Ctrl+Z.
export function moveSlots(fromTrack, indices, toTrack, gap, { copy = false } = {}) {
    const tracks = state.project.tracks
    const src = tracks[fromTrack]?.slots
    const dst = tracks[toTrack]?.slots
    if (!src || !dst || !indices.length) return

    const picked = [...new Set(indices)].sort((a, b) => a - b)
    const sameLane = fromTrack === toTrack
    const contiguous = picked[picked.length - 1] - picked[0] === picked.length - 1

    // Dropping a plain move right back where it started changes nothing
    const noChange = sameLane && !copy && contiguous && gap === picked[0]
    if (!noChange) snapshot({ force: true })

    let moved = picked.map(i => copy ? src[i].clone() : src[i])
    if (!copy && !noChange) {
        for (let k = picked.length - 1; k >= 0; k--) src.splice(picked[k], 1)
    }
    let at = Math.max(0, Math.min(gap, dst.length))
    if (noChange) {
        at = picked[0]
    } else {
        dst.splice(at, 0, ...moved)
    }

    state.activeTrackIndex = toTrack
    const landed = new Set()
    for (let k = 0; k < moved.length; k++) landed.add(at + k)
    state.selection  = makeSelection(landed, at, at + moved.length, at)
    state.cursorPos  = at + moved.length
    state.anchorSlot = null
    notify()
}

// -- Pitch editing --

export function adjustPitch(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
        snapshot()
        sound.pitch = Math.max(-60, Math.min(60, sound.pitch + delta))
        notify()
}

// -- Control slot value editing --

export function adjustControlValue(slotIndex, delta) {
    const slot = activeTrack().slots[slotIndex]
    if (!slot || !slot.isControl) return

        snapshot()
        const action = ACTIONS.find(a => a.name === slot.name)
        if (!action || !action.hasValue || slot.value === null) return

            // Get the valid range for this control based on the current modifier
            const spec = slot.modifier === '+' ? action.add
            : slot.modifier === 'x' ? action.multiply
            : slot.modifier === 'divide' ? action.divide
            : action.set

            if (!spec) return

                const [min, max, step = 1] = spec
                const increment = delta > 0 ? step : -step
                slot.value = Math.max(min, Math.min(max, slot.value + increment))
                notify()
}

export function adjustControlValue2(slotIndex, delta) {
    const slot = activeTrack().slots[slotIndex]
    if (!slot || !slot.isControl || slot.value2 === null) return

        snapshot()
        const action = ACTIONS.find(a => a.name === slot.name)
        if (!action?.twoValues) return

            const [, spec2] = action.twoValues
            const [min, max, step = 1] = spec2
            const increment = delta > 0 ? step : -step
            slot.value2 = Math.max(min, Math.min(max, slot.value2 + increment))
            notify()
}

// -- Volume / Panning editing --

export function adjustVolume(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
        snapshot()
        if (sound.volume === null) sound.volume = 100
            sound.volume = Math.max(0, Math.min(400, sound.volume + delta))
            notify()
}

export function adjustPanning(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
        snapshot()
        sound.panning = Math.max(-100, Math.min(100, sound.panning + delta * 10))
        notify()
}

// -- Track management --

export function setActiveTrack(index) {
    if (index < 0 || index >= state.project.tracks.length) return
        state.activeTrackIndex = index
        state.cursorPos = 0
        state.selection = null
        notify()
}

export function addTrack() {
    snapshot()
    const n = state.project.tracks.length + 1
    state.project.tracks.push(new Track({ name: `Track ${n}` }))
    state.activeTrackIndex = state.project.tracks.length - 1
    state.cursorPos = 0
    state.selection = null
    notify()
}

export function removeTrack(index) {
    if (state.project.tracks.length <= 1) return  // always keep at least one track
        snapshot()
        state.project.tracks.splice(index, 1)
        state.activeTrackIndex = Math.min(state.activeTrackIndex, state.project.tracks.length - 1)
        state.cursorPos = Math.min(state.cursorPos, activeTrack().slots.length)
        state.selection = null
        notify()
}

export function setTrackMuted(index, value) {
    const track = state.project.tracks[index]
    if (!track) return
        snapshot()
        track.muted = value
        notify()
}

export function setTrackSolo(index, value) {
    const track = state.project.tracks[index]
    if (!track) return
        snapshot()
        track.solo = value
        notify()
}

export function renameTrack(index, name) {
    const track = state.project.tracks[index]
    if (!track) return
        track.name = name
        notify()
}

// -- Project settings --

export function setBPM(bpm) {
    state.project.bpm = Math.max(1, Math.min(10000, bpm))
    notify()
}

export function setTimeSignature(numerator, denominator) {
    state.project.timeSignature = { numerator, denominator }
    notify()
}

export function setActiveDuration(fraction) {
    state.activeDur = fraction
    notify()
}

// -- Sound list --

// Build the sound ID cache after loading sounds
function buildSoundIdCache() {
    soundIdCache = new Map()
    for (const s of state.soundList) {
        soundIdCache.set(s.tdwId, s)
        soundIdCache.set(s.id, s)
    }
}

// Resolve a tdwId (may be emoji) back to the plain id used for audio filenames.
// Now O(1) instead of O(n) thanks to the cache.
export function resolveAudioId(tdwId) {
    const found = soundIdCache?.get(tdwId)
    return found ? found.id : tdwId
}

export async function loadSounds() {
    try {
        const res  = await fetch('./sounds.json')
        const list = await res.json()
        list.forEach(s => {
            s.tdwId = s.emoji || s.id
            s.imageLink = (!s.emoji && s.id.match(/[a-z0-9]/i))
            ? `https://thirtydollar.website/icons/${s.img || s.id}.png`
            : `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${(s.emoji || s.id).codePointAt(0).toString(16)}.svg`
        })
        state.soundList = list
        buildSoundIdCache()
        notify()
    } catch (e) {
        console.error('Could not load sounds.json:', e)
    }
}

// -- File I/O --

export function newProject() {
    snapshot()
    state.project         = new Project()
    state.activeTrackIndex = 0
    state.cursorPos       = 0
    state.selection       = null
    notify()
}

export function saveProject() {
    const json = JSON.stringify(state.project.toJSON(), null, 2)
    downloadText(json, `${state.project.name || 'untitled'}.tde`, 'application/json')
}

export function loadProjectFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
        try {
            snapshot()
            state.project          = Project.fromJSON(JSON.parse(e.target.result))
            state.activeTrackIndex = 0
            state.cursorPos        = state.project.tracks[0].slots.length
            state.selection        = null
            notify()
        } catch (err) {
            alert(`Could not load file: ${err.message}`)
        }
    }
    reader.readAsText(file)
}

export function exportTDWFile() {
    import('./io/exporter.js').then(({ exportToTDW }) => {
        const seq = exportToTDW(state.project)
        downloadText(seq, `${state.project.name || 'untitled'}.🗿`, 'text/plain')
    })
}

export function importTDWFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
        import('./io/parser.js').then(({ importFromTDW }) => {
            snapshot()
            state.project          = importFromTDW(e.target.result)
            state.activeTrackIndex = 0
            state.cursorPos        = state.project.tracks[0].slots.length
            state.selection        = null
            notify()
        })
    }
    reader.readAsText(file)
}

function downloadText(text, filename, mime) {
    const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob([text], { type: mime })),
                            download: filename,
    })
    a.click()
    URL.revokeObjectURL(a.href)
}

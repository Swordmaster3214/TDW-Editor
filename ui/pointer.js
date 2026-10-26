// Mouse interaction for the sequence editor: clicking, shift/ctrl selecting,
// marquee selecting, and drag and drop of slots (within a lane or between lanes).
//
// The one rule that decides everything: where did the press land?
//   on a slot box        -> drag it (or the whole selection if it is part of one)
//   anywhere else in a lane (including the gaps between boxes) -> marquee select
// A press that never moves is just a click.
//
// Modifiers follow file manager habits:
//   click               put the cursor after the slot
//   shift+click         select the range from the last clicked slot
//   ctrl+click          add or remove just that slot
//   ctrl+shift+click    add a whole range to the current selection
//   ctrl+marquee        add to the current selection instead of replacing it
//   ctrl+drag           copy instead of move
//
// While dragging we never touch app state, so the editor does not re-render
// under the pointer. Everything is done with a ghost, a placeholder and a bit
// of FLIP animation, and the real change happens once on drop.

import * as App from '../app.js'
import { gapFromPoint, laneFromY, pointInRect, edgeScrollSpeed } from './hit.js'

const DRAG_THRESHOLD = 4   // px of movement before a press becomes a drag

let wrap  = null
let press = null   // the gesture in progress, or null
let raf   = null

export function init(container) {
    wrap = container
    container.addEventListener('pointerdown',   onPointerDown)
    container.addEventListener('pointermove',   onPointerMove)
    container.addEventListener('pointerup',     onPointerUp)
    container.addEventListener('pointercancel', cancelGesture)
    // Stop the browser from starting its own image drag
    container.addEventListener('dragstart', e => e.preventDefault())
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && press) cancelGesture()
    })
}

// -- Small DOM helpers (always re-queried, because the editor rebuilds its DOM) --

function laneEls() {
    return [...wrap.querySelectorAll('.track-lane')]
}

function laneEl(trackIndex) {
    return wrap.querySelector(`.track-lane[data-track="${trackIndex}"]`)
}

function seqOf(lane) {
    return lane.querySelector('.track-seq')
}

function slotEls(lane) {
    return [...seqOf(lane).children].filter(c => c.classList.contains('seq-slot'))
}

function rectOf(el) {
    return el.getBoundingClientRect()
}

function gapAt(lane, x, y) {
    return gapFromPoint(slotEls(lane).map(rectOf), x, y)
}

function reducedMotion() {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// -- Pointer events --

function onPointerDown(e) {
    if (press || e.button !== 0) return
    // Header controls and the add-track button handle themselves
    if (e.target.closest('input, button, select, .track-header')) return
    const lane = e.target.closest('.track-lane')
    if (!lane) return

    const trackIndex = +lane.dataset.track
    const slotEl     = e.target.closest('.seq-slot')
    const slotIndex  = slotEl ? +slotEl.dataset.index : null
    const touch      = e.pointerType === 'touch'

    if (!touch) e.preventDefault()
    wrap.focus()

    press = {
        id: e.pointerId,
        mode: 'pending',
        trackIndex,
        slotIndex,
        startX: e.clientX, startY: e.clientY,
        x: e.clientX,      y: e.clientY,
        shift: e.shiftKey,
        ctrl:  e.ctrlKey || e.metaKey,
        touch,
        deferToggleOff: false,
    }

    try { wrap.setPointerCapture(e.pointerId) } catch { /* not fatal */ }

    // Ctrl+press on a slot behaves like a file manager: an unselected one is
    // added right away, a selected one waits to see if you are about to drag.
    if (press.ctrl && !press.shift && slotIndex !== null) {
        if (trackIndex !== App.state.activeTrackIndex) App.setActiveTrack(trackIndex)
        if (App.isSlotSelected(slotIndex)) press.deferToggleOff = true
        else App.toggleSlot(slotIndex)
    }
}

function onPointerMove(e) {
    if (!press || e.pointerId !== press.id) return
    press.x    = e.clientX
    press.y    = e.clientY
    press.ctrl = e.ctrlKey || e.metaKey

    if (press.mode === 'pending') {
        const moved = Math.hypot(press.x - press.startX, press.y - press.startY)
        if (moved < DRAG_THRESHOLD) return
        // On touch screens a drag should scroll the page, not start a gesture
        if (press.touch) { press = null; return }
        if (press.slotIndex !== null) startDrag()
        else startMarquee()
    }

    refresh()
}

function onPointerUp(e) {
    if (!press || e.pointerId !== press.id) return
    try { wrap.releasePointerCapture(e.pointerId) } catch { /* already released */ }

    const p = press
    if (p.mode === 'pending') {
        press = null
        handleClick(p)
    } else if (p.mode === 'marquee') {
        endGesture()
    } else if (p.mode === 'drag') {
        dropDrag()
    }
}

function cancelGesture() {
    if (!press) return
    if (press.mode === 'drag') cleanupDrag()
    endGesture()
}

function endGesture() {
    stopEdgeScroll()
    wrap.classList.remove('is-dragging', 'is-selecting')
    press = null
}

function refresh() {
    if (!press) return
    if (press.mode === 'drag')    updateDrag()
    if (press.mode === 'marquee') updateMarquee()
}

// A press that never moved
function handleClick(p) {
    const active = App.state.activeTrackIndex

    if (p.slotIndex !== null) {
        if (p.ctrl && !p.shift) {
            if (p.deferToggleOff) App.toggleSlot(p.slotIndex)
            return
        }
        if (p.trackIndex !== active) App.setActiveTrack(p.trackIndex)
        if (p.shift) App.selectSlotRange(p.slotIndex, { additive: p.ctrl })
        else App.clickSlot(p.slotIndex)
        return
    }

    // Empty space: put the cursor in the nearest gap, like clicking in text
    if (p.ctrl && !p.shift) return
    const lane = laneEl(p.trackIndex)
    if (!lane) return
    const gap = gapAt(lane, p.startX, p.startY)
    if (p.trackIndex !== active) App.setActiveTrack(p.trackIndex)
    if (p.shift) {
        App.selectGapRange(App.state.selection?.anchorGap ?? App.state.cursorPos, gap)
    } else {
        App.setCursor(gap)
    }
}

// -- Marquee --

function startMarquee() {
    press.mode = 'marquee'
    if (press.trackIndex !== App.state.activeTrackIndex) App.setActiveTrack(press.trackIndex)

    const lane = laneEl(press.trackIndex)
    press.anchorGap = lane ? gapAt(lane, press.startX, press.startY) : 0
    press.base      = press.ctrl && App.state.selection ? new Set(App.state.selection.indices) : null
    press.lastGap   = null

    wrap.classList.add('is-selecting')
    startEdgeScroll()
    updateMarquee()
}

function updateMarquee() {
    const lane = laneEl(press.trackIndex)
    if (!lane) return
    const gap = gapAt(lane, press.x, press.y)
    // Only touch app state when the selection could actually change
    if (gap === press.lastGap) return
    press.lastGap = gap
    App.selectGapRange(press.anchorGap, gap, press.base)
}

// -- Drag and drop --

function startDrag() {
    const t = press.trackIndex
    const i = press.slotIndex

    // Dragging a box that is part of the selection takes the whole selection
    const inSelection = t === App.state.activeTrackIndex && App.isSlotSelected(i)
    press.group     = inSelection ? App.selectedIndices() : [i]
    press.fromTrack = t
    press.copy      = press.ctrl
    press.mode      = 'drag'

    const els = slotEls(laneEl(t))
    press.sources = press.group.map(k => els[k]).filter(Boolean)
    const grabbed = els[i] ?? press.sources[0]
    const r = rectOf(grabbed)
    press.grab = { x: press.startX - r.left, y: press.startY - r.top }

    buildGhost(grabbed)
    press.placeholder = makePlaceholder(press.group.length)
    press.targetLane  = null
    press.gap         = null

    wrap.classList.add('is-dragging')
    applySourceLook()
    startEdgeScroll()
    updateDrag()
}

function buildGhost(grabbed) {
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'

    // The box under the pointer sits on top, up to two more peek out behind it
    const ordered = [grabbed, ...press.sources.filter(el => el !== grabbed)].slice(0, 3)
    ordered.forEach((el, k) => {
        const r = rectOf(el)
        const clone = el.cloneNode(true)
        clone.classList.remove('selected', 'played', 'drag-source', 'drag-source-copy')
        clone.removeAttribute('data-index')
        clone.classList.add('drag-ghost-box')
        clone.style.width  = r.width + 'px'
        clone.style.height = r.height + 'px'
        clone.style.setProperty('--n', k)
        clone.style.zIndex = String(3 - k)
        ghost.appendChild(clone)
    })

    if (press.group.length > 1) {
        const badge = document.createElement('span')
        badge.className   = 'drag-ghost-count'
        badge.textContent = press.group.length
        ghost.appendChild(badge)
    }

    document.body.appendChild(ghost)
    press.ghost = ghost
    moveGhost()
}

function moveGhost() {
    const x = press.x - press.grab.x
    const y = press.y - press.grab.y
    press.ghost.style.transform = `translate(${x}px, ${y}px)`
}

function makePlaceholder(count) {
    const ph = document.createElement('span')
    ph.className = 'drop-placeholder'
    if (count > 1) {
        const n = document.createElement('span')
        n.className   = 'drop-placeholder-count'
        n.textContent = '\u00d7' + count
        ph.appendChild(n)
    }
    return ph
}

// Moving hides the originals, copying leaves them dimmed in place
function applySourceLook() {
    for (const el of press.sources) {
        el.classList.toggle('drag-source', !press.copy)
        el.classList.toggle('drag-source-copy', press.copy)
    }
}

function updateDrag() {
    moveGhost()

    // Holding or releasing ctrl mid-drag switches between move and copy
    let forceReplace = false
    if (press.ctrl !== press.copy) {
        press.copy = press.ctrl
        applySourceLook()
        forceReplace = true
    }

    const lanes = laneEls()
    if (!lanes.length) return
    const li   = laneFromY(lanes.map(rectOf), press.y)
    const lane = lanes[li]
    const ph   = press.placeholder

    // Pointer is already over the gap we made, so leave things alone. This
    // stops the placeholder from flickering back and forth at box edges.
    if (!forceReplace && ph.isConnected && ph.closest('.track-lane') === lane &&
        pointInRect(rectOf(ph), press.x, press.y)) {
        return
    }

    const candidates = slotEls(lane).filter(el => !el.classList.contains('drag-source'))
    const gap = gapFromPoint(candidates.map(rectOf), press.x, press.y)
    if (!forceReplace && ph.isConnected && li === press.targetLane && gap === press.gap) return

    placePlaceholder(lane, candidates, gap)
    press.targetLane = li
    press.gap        = gap
}

// Slides the placeholder into a new spot and animates the boxes that got
// pushed around (FLIP: measure first, move, measure again, then play the
// difference as a short animation).
function placePlaceholder(lane, candidates, gap) {
    const ph = press.placeholder
    const affected = new Set([lane])
    const oldLane = ph.closest?.('.track-lane')
    if (oldLane) affected.add(oldLane)

    const measure = () => {
        const map = new Map()
        for (const l of affected) {
            for (const el of slotEls(l)) {
                if (!el.classList.contains('drag-source')) map.set(el, rectOf(el))
            }
        }
        return map
    }

    const before = measure()
    seqOf(lane).insertBefore(ph, candidates[gap] ?? null)
    const after = measure()

    if (reducedMotion()) return
    for (const [el, b] of before) {
        const a = after.get(el)
        if (!a || typeof el.animate !== 'function') continue
        const dx = b.left - a.left
        const dy = b.top  - a.top
        if (!dx && !dy) continue
        el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' }
        )
    }
}

function dropDrag() {
    const p  = press
    const ph = p.placeholder
    const toLane = ph.isConnected ? ph.closest('.track-lane') : null
    if (!toLane || p.gap === null) { cancelGesture(); return }

    const toTrack = +toLane.dataset.track
    const gap     = p.gap
    const copy    = p.copy
    const target  = rectOf(ph)

    p.mode = 'dropping'
    stopEdgeScroll()

    let done = false
    const finish = () => {
        if (done) return
        done = true
        cleanupDrag()
        endGesture()
        App.moveSlots(p.fromTrack, p.group, toTrack, gap, { copy })
    }

    // The ghost glides into the gap before the real change lands
    if (typeof p.ghost.animate === 'function' && !reducedMotion()) {
        const from = p.ghost.style.transform
        const anim = p.ghost.animate(
            [{ transform: from }, { transform: `translate(${target.left}px, ${target.top}px)` }],
            { duration: 120, easing: 'ease-out', fill: 'forwards' }
        )
        anim.onfinish = finish
        anim.oncancel = finish
        // If the tab is hidden the animation may never report back
        setTimeout(finish, 300)
    } else {
        finish()
    }
}

function cleanupDrag() {
    if (!press) return
    press.ghost?.remove()
    press.placeholder?.remove()
    for (const el of press.sources ?? []) {
        el.classList.remove('drag-source', 'drag-source-copy')
    }
}

// -- Edge auto-scroll while dragging or marquee selecting near the top or bottom --

function startEdgeScroll() {
    stopEdgeScroll()
    const tick = () => {
        if (!press || (press.mode !== 'drag' && press.mode !== 'marquee')) { raf = null; return }
        const v = edgeScrollSpeed(wrap.getBoundingClientRect(), press.y)
        if (v) {
            wrap.scrollTop += v
            refresh()
        }
        raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
}

function stopEdgeScroll() {
    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
}

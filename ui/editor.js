// The main sequence editor. Renders slots as tokens with a movable cursor
// between them, supports click-to-place, keyboard navigation, and selection.

import * as App from '../app.js'
import { ACTION_BY_KEY } from '../model/controlslot.js'
import { handleActionClick } from './actions.js'

export function init(container) {
    container.setAttribute('tabindex', '0')
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('click',   onContainerClick)
    document.addEventListener('statechange', () => render(container))
    render(container)
}

// -- Rendering --

export function render(container) {
    const { project, cursorPos, selection } = App.state
    const slots = project.slots

    container.innerHTML = ''

    if (slots.length === 0) {
        // Show cursor alone in an empty sequence
        container.appendChild(makeCursorEl())
        const hint = document.createElement('span')
        hint.className = 'seq-hint'
        hint.textContent = 'Click a sound in the picker to insert, or press Space for a rest'
        container.appendChild(hint)
        return
    }

    // Cursor before slot 0
    if (cursorPos === 0) container.appendChild(makeCursorEl())

        slots.forEach((slot, i) => {
            const el = makeSlotEl(slot, i, selection)
            el.dataset.index = i

            el.addEventListener('click', e => {
                e.stopPropagation()
                if (e.shiftKey) {
                    App.extendSelection(i - (App.state.cursorPos - 1))
                } else {
                    App.setCursor(i + 1)
                }
                container.focus()
            })

            container.appendChild(el)

            // Cursor sits AFTER slot i (before slot i+1)
            if (cursorPos === i + 1) container.appendChild(makeCursorEl())
        })
}

function makeCursorEl() {
    const el = document.createElement('span')
    el.className = 'seq-cursor'
    el.setAttribute('aria-label', 'cursor')
    return el
}

function makeSlotEl(slot, index, selection) {
    const el = document.createElement('span')
    const isSelected = selection && index >= selection.start && index <= selection.end

    if (slot.isControl) {
        const isDivider = slot.name === 'divider'
        el.className = 'seq-slot seq-control'
        + (isDivider  ? ' seq-divider' : '')
        + (isSelected ? ' selected'    : '')
        el.title = slot.toTDWToken()

        if (isDivider) {
            // The divider is full-width so it breaks the flex row into a new line.
            const img = document.createElement('img')
            img.src = 'https://thirtydollar.website/assets/action_divider.png'
            img.alt = 'divider'
            img.className = 'seq-icon'
            img.onerror = () => { img.remove() }
            el.appendChild(img)
            return el
        }

        const img = document.createElement('img')
        img.src = `https://thirtydollar.website/assets/action_${slot.name}.png`
        img.alt = slot.name
        img.className = 'seq-icon'
        // Fall back to the token text if the icon URL 404s
        img.onerror = () => {
            img.remove()
            el.textContent = slot.toTDWToken()
        }
        el.appendChild(img)

        // Show the value portion (everything after !name) as a small badge
        const token = slot.toTDWToken()
        const valuePart = token.slice(slot.name.length + 1) // strip leading "!name"
        if (valuePart) {
            const badge = document.createElement('sub')
            badge.className = 'seq-dur'
            badge.textContent = valuePart
            el.appendChild(badge)
        }

        return el
    }

    if (slot.isRest) {
        el.className = 'seq-slot seq-rest' + (isSelected ? ' selected' : '')
        el.title = `Rest (${slot.duration})`
        el.textContent = '·'
        return el
    }

    el.className = 'seq-slot seq-sound' + (slot.sounds.length > 1 ? ' seq-chord' : '') + (isSelected ? ' selected' : '')
    el.title = slot.sounds.map(s => s.id + (s.pitch ? ` (${s.pitch > 0 ? '+' : ''}${s.pitch})` : '')).join(' + ')

    // Each sound gets its own wrapper so it can carry its own pitch badge
    // and respond to scroll-wheel pitch adjustment independently.
    slot.sounds.forEach((sound, si) => {
        const soundInfo = App.state.soundList.find(x => x.id === sound.id)

        const wrap = document.createElement('span')
        wrap.className = 'seq-sound-wrap'
        if (si > 0) wrap.style.marginLeft = '-10px'

            const img = document.createElement('img')
            img.src = soundInfo?.imageLink ?? `https://thirtydollar.website/icons/${sound.id}.png`
            img.alt = soundInfo?.name ?? sound.id
            img.className = 'seq-icon'
            wrap.appendChild(img)

            if (sound.pitch !== 0) {
                const badge = document.createElement('sup')
                badge.className = 'seq-pitch'
                badge.textContent = (sound.pitch > 0 ? '+' : '') + sound.pitch
                wrap.appendChild(badge)
            }

            // Scroll wheel on this icon adjusts only this sound's pitch.
            // stopPropagation keeps the event from bubbling to the slot or window.
            wrap.addEventListener('wheel', e => {
                e.preventDefault()
                e.stopPropagation()
                App.adjustPitch(index, si, e.deltaY < 0 ? 1 : -1)
            }, { passive: false })

            el.appendChild(wrap)
    })

    // Duration indicator for anything shorter than a quarter note
    if (slot.duration.denominator > 1 || slot.duration.numerator < 1) {
        const dur = document.createElement('sub')
        dur.className = 'seq-dur'
        dur.textContent = slot.duration.toString()
        el.appendChild(dur)
    }

    return el
}

// -- Keyboard handling --

function onKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey

    // Navigation
    if (e.key === 'ArrowLeft'  && !e.shiftKey) { e.preventDefault(); App.moveCursor(-1); return }
    if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); App.moveCursor(+1); return }
    if (e.key === 'ArrowLeft'  &&  e.shiftKey) { e.preventDefault(); App.extendSelection(-1); return }
    if (e.key === 'ArrowRight' &&  e.shiftKey) { e.preventDefault(); App.extendSelection(+1); return }
    if (e.key === 'Home') { e.preventDefault(); App.setCursor(0); return }
    if (e.key === 'End')  { e.preventDefault(); App.setCursor(App.state.project.slots.length); return }

    // Editing
    if (e.key === 'Backspace') { e.preventDefault(); App.deleteBeforeCursor(); return }
    if (e.key === 'Delete')    { e.preventDefault(); App.deleteAfterCursor();  return }
    if (e.key === ' ')         { e.preventDefault(); App.insertRest();          return }

    // Undo/redo
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); App.undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); App.redo(); return }

    // Copy/paste
    if (ctrl && e.key === 'c') { e.preventDefault(); App.copySelection(); return }
    if (ctrl && e.key === 'v') { e.preventDefault(); App.pasteAtCursor(); return }

    // Arrow up/down nudges pitch on the first sound of the slot before the cursor.
    // For chords, scroll over the individual icon to adjust other sounds.
    if (e.key === 'ArrowUp')   { e.preventDefault(); App.adjustPitch(App.state.cursorPos - 1, 0, +1); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); App.adjustPitch(App.state.cursorPos - 1, 0, -1); return }

    // Action shortcuts (single letter, no modifier keys held) -- only when
    // no input/select/textarea is focused so they don't eat typing elsewhere
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const action = ACTION_BY_KEY[e.key.toLowerCase()]
        if (action) {
            e.preventDefault()
            handleActionClick(action, document.querySelector(`.action-btn[data-name="${action.name}"]`))
        }
    }
}

// Clicking the container background moves cursor to end
function onContainerClick() {
    App.setCursor(App.state.project.slots.length)
    document.getElementById('seq').focus()
}

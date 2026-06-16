// The main sequence editor. Renders each track as a stacked lane with its
// own header (name, mute, solo, delete) and slot row. The cursor and
// keyboard shortcuts always operate on the active track.

import * as App from '../app.js'
import { resolveAudioId } from '../app.js'
import { ACTION_BY_KEY } from '../model/controlslot.js'
import { handleActionClick } from './actions.js'
import { previewSound } from '../audio/engine.js'

// playedSlots is now a Map<trackIndex, Set<slotIndex>> so we can highlight
// the right lane without a full re-render on every note.
const playedSlots = new Map()

// Cache the seq-wrap element to avoid repeated queries
let seqWrapElement = null

// Track the currently hovered sound element for hover-based editing
let hoveredSoundWrap = null
let hoveredControlWrap = null

export function init(container) {
    seqWrapElement = container
    container.setAttribute('tabindex', '0')
    container.addEventListener('keydown',     onKeyDown)
    container.addEventListener('click',       onContainerClick)
    container.addEventListener('contextmenu', e => e.preventDefault())
    document.addEventListener('statechange',  () => render(container))

    document.addEventListener('slotplay', e => {
        const { index, trackIndex } = e.detail
        if (!playedSlots.has(trackIndex)) playedSlots.set(trackIndex, new Set())
            const set = playedSlots.get(trackIndex)
            if (set.has(index)) return
                set.add(index)
                container
                .querySelector(`[data-track="${trackIndex}"] [data-index="${index}"]`)
                ?.classList.add('played')
    })

    document.addEventListener('slotsclear', () => {
        playedSlots.clear()
        container.querySelectorAll('.played').forEach(el => el.classList.remove('played'))
    })

    render(container)
}

// Switch the sidebar to the actions tab
function switchToActionsTab() {
    const sidebarTabs = document.getElementById('sidebar-tabs')
    if (!sidebarTabs) return

        const actionTabBtn = sidebarTabs.querySelector('[data-tab="actions-panel"]')
        if (!actionTabBtn) return

            // Remove active class from all tab buttons
            sidebarTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
            // Hide all tab panels
            document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none')

            // Activate the actions tab
            actionTabBtn.classList.add('active')
            const actionPanel = document.getElementById('actions-panel')
            if (actionPanel) actionPanel.style.display = 'flex'
}

// Helper to get track index and slot index from a hovered control wrap element
function getIndicesFromControlElement(el) {
    if (!el) return null

        const controlWrap = el.closest('.seq-control-wrap')
        if (!controlWrap) return null

            const slot = controlWrap.closest('[data-index]')
            if (!slot) return null

                const lane = slot.closest('[data-track]')
                if (!lane) return null

                    const trackIndex = parseInt(lane.dataset.track, 10)
                    const slotIndex = parseInt(slot.dataset.index, 10)

                    return { trackIndex, slotIndex }
}

// Helper to get track index, slot index, and sound index from a hovered sound wrap element
function getIndicesFromElement(el) {
    if (!el) return null

        const soundWrap = el.closest('.seq-sound-wrap')
        if (!soundWrap) return null

            const slot = soundWrap.closest('[data-index]')
            if (!slot) return null

                const lane = slot.closest('[data-track]')
                if (!lane) return null

                    const trackIndex = parseInt(lane.dataset.track, 10)
                    const slotIndex = parseInt(slot.dataset.index, 10)

                    // Count which sound this is within the slot (for chords)
                    const soundWraps = Array.from(slot.querySelectorAll('.seq-sound-wrap'))
                    const soundIndex = soundWraps.indexOf(soundWrap)

                    return { trackIndex, slotIndex, soundIndex }
}

// -- Rendering --

export function render(container) {
    const { project, activeTrackIndex, cursorPos, selection } = App.state

    container.innerHTML = ''

    for (let ti = 0; ti < project.tracks.length; ti++) {
        const track    = project.tracks[ti]
        const isActive = ti === activeTrackIndex
        const lane     = buildLane(track, ti, isActive, cursorPos, selection)
        container.appendChild(lane)
    }

    // Add-track button lives below all lanes
    const addBtn = document.createElement('button')
    addBtn.className   = 'add-track-btn'
    addBtn.textContent = '+ Add Track'
    addBtn.addEventListener('click', e => {
        e.stopPropagation()
        App.addTrack()
        // Focus after the render triggered by addTrack()
        requestAnimationFrame(() => container.focus())
    })
    container.appendChild(addBtn)
}

function buildLane(track, trackIndex, isActive, cursorPos, selection) {
    const lane = document.createElement('div')
    lane.className = 'track-lane' + (isActive ? ' active' : '')
    lane.dataset.track = trackIndex

    // -- Header --
    const header = document.createElement('div')
    header.className = 'track-header'

    const nameInput = document.createElement('input')
    nameInput.type      = 'text'
    nameInput.className = 'track-name-input'
    nameInput.value     = track.name
    nameInput.title     = 'Click to rename'
    nameInput.addEventListener('mousedown', e => {
        e.stopPropagation()
        // Only set active track if this is not already the active track
        if (trackIndex !== App.state.activeTrackIndex) {
            App.setActiveTrack(trackIndex)

            const newInput = seqWrapElement?.querySelector(`[data-track="${trackIndex}"] .track-name-input`)
            if (newInput) {
                newInput.focus()
                e.preventDefault()
            }
        }
    })
    nameInput.addEventListener('click', e => {
        e.stopPropagation()
    })
    nameInput.addEventListener('change', () => App.renameTrack(trackIndex, nameInput.value))
    nameInput.addEventListener('keydown', e => {
        // Don't let rename field eat the editor shortcuts
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur()
    })

    const muteBtn = document.createElement('button')
    muteBtn.className = 'track-btn track-mute' + (track.muted ? ' active' : '')
    muteBtn.textContent = 'M'
    muteBtn.title = 'Mute'
    muteBtn.addEventListener('click', e => {
        e.stopPropagation()
        App.setTrackMuted(trackIndex, !track.muted)
    })

    const soloBtn = document.createElement('button')
    soloBtn.className = 'track-btn track-solo' + (track.solo ? ' active' : '')
    soloBtn.textContent = 'S'
    soloBtn.title = 'Solo'
    soloBtn.addEventListener('click', e => {
        e.stopPropagation()
        App.setTrackSolo(trackIndex, !track.solo)
    })

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'track-btn track-delete'
    deleteBtn.textContent = '✕'
    deleteBtn.title = 'Remove track'
    deleteBtn.addEventListener('click', e => {
        e.stopPropagation()
        if (track.slots.length > 0 && !confirm(`Remove "${track.name}"? Its ${track.slots.length} slot(s) will be lost.`)) return
            App.removeTrack(trackIndex)
    })

    header.appendChild(nameInput)
    header.appendChild(muteBtn)
    header.appendChild(soloBtn)
    header.appendChild(deleteBtn)
    lane.appendChild(header)

    // -- Slot row --
    const seqEl = document.createElement('div')
    seqEl.className = 'track-seq'

    const played = playedSlots.get(trackIndex) ?? new Set()
    const slots  = track.slots

    if (isActive && slots.length === 0) {
        if (cursorPos === 0) seqEl.appendChild(makeCursorEl())
            const hint = document.createElement('span')
            hint.className   = 'seq-hint'
            hint.textContent = 'Click a sound in the picker to insert, or press Space for a rest'
            seqEl.appendChild(hint)
    } else {
        if (isActive && cursorPos === 0) seqEl.appendChild(makeCursorEl())

            slots.forEach((slot, i) => {
                const isSelected = isActive && selection && i >= selection.start && i <= selection.end
                const wasPlayed  = played.has(i)
                const el         = makeSlotEl(slot, i, isSelected, wasPlayed)
                el.dataset.index = i

                el.addEventListener('click', e => {
                    e.stopPropagation()
                    if (trackIndex !== App.state.activeTrackIndex) {
                        App.setActiveTrack(trackIndex)
                    }
                    if (e.shiftKey) {
                        App.extendSelection(i - (App.state.cursorPos - 1))
                    } else {
                        App.setCursor(i + 1)
                    }
                    seqWrapElement.focus()
                })

                el.addEventListener('contextmenu', e => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!slot.isControl && !slot.isRest && slot.sounds.length) {
                        for (const sound of slot.sounds) {
                            previewSound(resolveAudioId(sound.id), {
                                pitch:  sound.pitch,
                                volume: sound.volume ?? 100,
                                pan:    sound.panning,
                            })
                        }
                    }
                })

                seqEl.appendChild(el)
                if (isActive && cursorPos === i + 1) seqEl.appendChild(makeCursorEl())
            })
    }

    // Clicking empty space in the active lane moves cursor to end
    seqEl.addEventListener('click', () => {
        if (trackIndex !== App.state.activeTrackIndex) {
            App.setActiveTrack(trackIndex)
        } else {
            App.setCursor(App.activeTrack().slots.length)
        }
        seqWrapElement.focus()
    })

    lane.appendChild(seqEl)
    return lane
}

function makeCursorEl() {
    const el = document.createElement('span')
    el.className = 'seq-cursor'
    el.setAttribute('aria-label', 'cursor')
    return el
}

function makeSlotEl(slot, index, isSelected, wasPlayed) {
    const el = document.createElement('span')

    if (slot.isControl) {
        const isDivider = slot.name === 'divider'
        el.className = 'seq-slot seq-control'
        + (isDivider  ? ' seq-divider' : '')
        + (isSelected ? ' selected'    : '')
        + (wasPlayed  ? ' played'      : '')
        el.title = slot.toTDWToken()

        if (isDivider) {
            const img = document.createElement('img')
            img.src = 'https://thirtydollar.website/assets/action_divider.png'
            img.alt = 'divider'
            img.className = 'seq-icon'
            img.onerror = () => img.remove()
            el.appendChild(img)
            return el
        }

        // Wrap control content for editing
        const wrap = document.createElement('span')
        wrap.className = 'seq-control-wrap'

        const img = document.createElement('img')
        img.src = `https://thirtydollar.website/assets/action_${slot.name}.png`
        img.alt = slot.name
        img.className = 'seq-icon'
        img.onerror = () => {
            img.remove()
            wrap.textContent = slot.toTDWToken()
        }
        wrap.appendChild(img)

        const token     = slot.toTDWToken()
        const valuePart = token.slice(slot.name.length + 1)
        if (valuePart) {
            const badge = document.createElement('span')
            badge.className   = 'seq-main-val'
            badge.textContent = valuePart
            wrap.appendChild(badge)
        }

        // Track hover state for editing
        wrap.addEventListener('mouseenter', () => {
            hoveredControlWrap = wrap
        })
        wrap.addEventListener('mouseleave', () => {
            hoveredControlWrap = null
        })

        // Wheel event to adjust control values
        wrap.addEventListener('wheel', e => {
            e.preventDefault()
            e.stopPropagation()

            let editSlotIndex = index
            if (hoveredControlWrap) {
                const indices = getIndicesFromControlElement(hoveredControlWrap)
                if (indices && indices.trackIndex === App.state.activeTrackIndex) {
                    editSlotIndex = indices.slotIndex
                }
            }

            const editSlot = App.activeTrack().slots[editSlotIndex]
            if (!editSlot?.isControl || editSlot.value === null) return

                let step = 1
                if (e.shiftKey) step = 5
                    if (e.altKey) step = 1

                        const delta = e.deltaY < 0 ? step : -step

                        // Adjust primary value for most controls
                        if (e.ctrlKey || e.metaKey) {
                            // With Ctrl, adjust value2 if it exists
                            App.adjustControlValue2(editSlotIndex, delta)
                        } else {
                            // Default: adjust primary value
                            App.adjustControlValue(editSlotIndex, delta)
                        }
        }, { passive: false })

        el.appendChild(wrap)
        return el
    }

    if (slot.isRest) {
        el.className  = 'seq-slot seq-rest' + (isSelected ? ' selected' : '') + (wasPlayed ? ' played' : '')
        el.title      = `Rest (${slot.duration})`
        const pauseInfo = App.state.soundList.find(x => x.id === '_pause')
        if (pauseInfo?.imageLink) {
            const img = document.createElement('img')
            img.src = pauseInfo.imageLink
            img.alt = 'rest'
            img.className = 'seq-icon seq-rest-icon'
            el.appendChild(img)
        } else {
            el.textContent = '·'
        }
        return el
    }

    el.className = 'seq-slot seq-sound'
    + (slot.sounds.length > 1 ? ' seq-chord' : '')
    + (isSelected ? ' selected' : '')
    + (wasPlayed  ? ' played'   : '')
    el.title = slot.sounds
    .map(s => s.id + (s.pitch ? ` (${s.pitch > 0 ? '+' : ''}${s.pitch})` : ''))
    .join(' + ') + '\nRight-click to preview'

    slot.sounds.forEach((sound, si) => {
        const soundInfo = App.state.soundList.find(x => x.tdwId === sound.id || x.id === sound.id)

        const wrap = document.createElement('span')
        wrap.className = 'seq-sound-wrap'
        if (si > 0) wrap.style.marginLeft = '-10px'

            const img = document.createElement('img')
            img.src   = soundInfo?.imageLink ?? `https://thirtydollar.website/icons/${sound.id}.png`
            img.alt   = soundInfo?.name ?? sound.id
            img.className = 'seq-icon'
            img.loading = 'lazy'
            wrap.appendChild(img)

            // Panning Indicator Badge (Top Left)
            if (sound.panning !== undefined && sound.panning !== 0) {
                const panBadge = document.createElement('span')
                panBadge.className = 'seq-panning-badge'
                const displayPan = sound.panning / 10
                panBadge.textContent = displayPan < 0 ? `◀${Math.abs(displayPan)}` : `${displayPan}▶`
                wrap.appendChild(panBadge)
            }

            // Volume Indicator Badge (Top Right)
            if (sound.volume !== null && sound.volume !== 100) {
                const volBadge = document.createElement('span')
                volBadge.className = 'seq-volume-badge'
                volBadge.textContent = `${sound.volume}%`
                wrap.appendChild(volBadge)
            }

            // Pitch Indicator Badge (Bottom Center)
            if (sound.pitch !== 0) {
                const badge = document.createElement('span')
                badge.className   = 'seq-main-val'
                badge.textContent = (sound.pitch > 0 ? '+' : '') + sound.pitch
                wrap.appendChild(badge)
            }

            // Track hover state for editing
            wrap.addEventListener('mouseenter', () => {
                hoveredSoundWrap = wrap
            })
            wrap.addEventListener('mouseleave', () => {
                hoveredSoundWrap = null
            })

            wrap.addEventListener('wheel', e => {
                e.preventDefault()
                e.stopPropagation()
                const isCtrl = e.ctrlKey || e.metaKey

                // Use hovered element if available, otherwise fall back to cursor position
                let editSlotIndex = index
                let editSoundIndex = si

                if (hoveredSoundWrap) {
                    const indices = getIndicesFromElement(hoveredSoundWrap)
                    if (indices) {
                        editSlotIndex = indices.slotIndex
                        editSoundIndex = indices.soundIndex
                    }
                }

                if (isCtrl) {
                    // Adjust Volume Override
                    let step = 2
                    if (e.shiftKey) step = 10
                        if (e.altKey) step = 1
                            const delta = e.deltaY < 0 ? step : -step
                            App.adjustVolume(editSlotIndex, editSoundIndex, delta)
                            const editSound = App.state.project.tracks[App.state.activeTrackIndex].slots[editSlotIndex]?.sounds[editSoundIndex]
                            if (editSound) {
                                previewSound(resolveAudioId(editSound.id), {
                                    pitch:  editSound.pitch,
                                    volume: editSound.volume ?? 100,
                                    pan:    editSound.panning,
                                })
                            }
                } else {
                    // Adjust Pitch Override
                    let step = 1
                    if (e.shiftKey) step = 12
                        if (e.altKey) step = 1
                            const delta = e.deltaY < 0 ? step : -step
                            App.adjustPitch(editSlotIndex, editSoundIndex, delta)
                            const editSound = App.state.project.tracks[App.state.activeTrackIndex].slots[editSlotIndex]?.sounds[editSoundIndex]
                            if (editSound) {
                                previewSound(resolveAudioId(editSound.id), {
                                    pitch:  editSound.pitch,
                                    volume: editSound.volume ?? 100,
                                    pan:    editSound.panning,
                                })
                            }
                }
            }, { passive: false })

            el.appendChild(wrap)
    })

    if (slot.duration.denominator > 1 || slot.duration.numerator < 1) {
        const dur = document.createElement('sub')
        dur.className   = 'seq-dur'
        dur.textContent = slot.duration.toString()
        el.appendChild(dur)
    }

    return el
}

// -- Keyboard handling --

function onKeyDown(e) {
    if (e.target.tagName === 'INPUT') return

        const ctrl = e.ctrlKey || e.metaKey

        // Ctrl + X: Create Stop Action
        if (ctrl && e.key.toLowerCase() === 'x') {
            e.preventDefault()
            App.insertControl('stop')
            return
        }

        // Ctrl + Left/Right Arrow Keys: Adjust Panning (or control value2 if hovering control)
        if (ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()

            // Check if hovering a control
            if (hoveredControlWrap) {
                const indices = getIndicesFromControlElement(hoveredControlWrap)
                if (indices && indices.trackIndex === App.state.activeTrackIndex) {
                    const editSlot = App.activeTrack().slots[indices.slotIndex]
                    if (editSlot?.isControl && editSlot.value2 !== null) {
                        // Adjust value2 for two-value controls
                        const delta = e.key === 'ArrowRight' ? 1 : -1
                        App.adjustControlValue2(indices.slotIndex, delta)
                        return
                    }
                }
            }

            // Otherwise, adjust panning on sounds
            let step = 1
            if (e.shiftKey) step = 3
                if (e.altKey) step = 1
                    const delta = e.key === 'ArrowRight' ? step : -step

                    let editSlotIndex = App.state.cursorPos - 1
                    let editSoundIndex = 0

                    // Use hovered element if available
                    if (hoveredSoundWrap) {
                        const indices = getIndicesFromElement(hoveredSoundWrap)
                        if (indices && indices.trackIndex === App.state.activeTrackIndex) {
                            editSlotIndex = indices.slotIndex
                            editSoundIndex = indices.soundIndex
                        }
                    }

                    App.adjustPanning(editSlotIndex, editSoundIndex, delta)
                    const panSlot = App.activeTrack().slots[editSlotIndex]
                    if (panSlot && !panSlot.isRest && !panSlot.isControl && panSlot.sounds[editSoundIndex]) {
                        const s = panSlot.sounds[editSoundIndex]
                        previewSound(resolveAudioId(s.id), {
                            pitch:  s.pitch,
                            volume: s.volume ?? 100,
                            pan:    s.panning,
                        })
                    }
                    return
        }

        if (e.key === 'ArrowLeft'  && !e.shiftKey) { e.preventDefault(); App.moveCursor(-1); return }
        if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); App.moveCursor(+1); return }
        if (e.key === 'ArrowLeft'  &&  e.shiftKey) { e.preventDefault(); App.extendSelection(-1); return }
        if (e.key === 'ArrowRight' &&  e.shiftKey) { e.preventDefault(); App.extendSelection(+1); return }
        if (e.key === 'Home') { e.preventDefault(); App.setCursor(0); return }
        if (e.key === 'End')  { e.preventDefault(); App.setCursor(App.activeTrack().slots.length); return }

        if (e.key === 'Backspace') { e.preventDefault(); App.deleteBeforeCursor(); return }
        if (e.key === 'Delete')    { e.preventDefault(); App.deleteAfterCursor();  return }
        if (e.key === ' ')         { e.preventDefault(); App.insertRest();          return }

        if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); App.undo(); return }
        if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); App.redo(); return }

        if (ctrl && e.key === 'c') { e.preventDefault(); App.copySelection(); return }
        if (ctrl && e.key === 'v') { e.preventDefault(); App.pasteAtCursor(); return }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const delta   = e.key === 'ArrowUp' ? 1 : -1

            // Check if hovering a control for primary value adjustment
            if (hoveredControlWrap) {
                const indices = getIndicesFromControlElement(hoveredControlWrap)
                if (indices && indices.trackIndex === App.state.activeTrackIndex) {
                    const editSlot = App.activeTrack().slots[indices.slotIndex]
                    if (editSlot?.isControl && editSlot.value !== null) {
                        // Adjust primary value
                        App.adjustControlValue(indices.slotIndex, delta)
                        return
                    }
                }
            }

            // Otherwise, adjust pitch on sounds
            let editSlotIndex = App.state.cursorPos - 1
            let editSoundIndex = 0

            // Use hovered element if available
            if (hoveredSoundWrap) {
                const indices = getIndicesFromElement(hoveredSoundWrap)
                if (indices && indices.trackIndex === App.state.activeTrackIndex) {
                    editSlotIndex = indices.slotIndex
                    editSoundIndex = indices.soundIndex
                }
            }

            App.adjustPitch(editSlotIndex, editSoundIndex, delta)
            const slot = App.activeTrack().slots[editSlotIndex]
            if (slot && !slot.isRest && !slot.isControl && slot.sounds[editSoundIndex]) {
                const s = slot.sounds[editSoundIndex]
                previewSound(resolveAudioId(s.id), {
                    pitch:  s.pitch,
                    volume: s.volume ?? 100,
                    pan:    s.panning,
                })
            }
            return
        }

        // Action shortcuts (single letter, no modifier keys)
        if (!ctrl && !e.metaKey && !e.altKey && e.key.length === 1) {
            const action = ACTION_BY_KEY[e.key.toLowerCase()]
            if (action) {
                e.preventDefault()

                // Switch to actions tab when an action shortcut is used
                switchToActionsTab()

                    handleActionClick(action, document.querySelector(`.action-btn[data-name="${action.name}"]`))
            }
        }
}

function onContainerClick() {
    seqWrapElement.focus()
}

// Sound picker sidebar. Groups sounds by TDW's group field and supports
// searching by name, ID, tags (e.g. "percussion"), and source (e.g. "Rhythm Heaven").
// Click = insert at cursor. Ctrl+click = add to chord. Right-click = preview.

import * as App from '../app.js'
import { previewSound } from '../audio/engine.js'

export function init(container) {
    document.addEventListener('statechange', () => {
        if (!App.state.soundList.length || container.dataset.loaded === 'true') return
            container.dataset.loaded = 'true'
            render(container)
    })
}

function render(container) {
    container.innerHTML = ''

    const searchWrap = document.createElement('div')
    searchWrap.className = 'picker-search-wrap'

    const search = document.createElement('input')
    search.type        = 'text'
    search.placeholder = 'Search name, tag, source...'
    search.className   = 'picker-search'

    const hint = document.createElement('div')
    hint.className   = 'picker-search-hint'
    hint.textContent = 'Ctrl+click to add to chord · Right-click to preview'

    searchWrap.appendChild(search)
    searchWrap.appendChild(hint)
    container.appendChild(searchWrap)

    const listEl = document.createElement('div')
    listEl.className = 'picker-list'
    buildSoundList(App.state.soundList, listEl)
    container.appendChild(listEl)

    search.addEventListener('input', () => filterSounds(search.value.trim().toLowerCase(), listEl))
}

function buildSoundList(sounds, listEl) {
    const groups = {}
    for (const s of sounds) {
        if (s.group) {
            if (!groups[s.group]) groups[s.group] = []
                groups[s.group].push(s)
        } else if (s.tags && s.tags.length) {
            for (const tag of s.tags) {
                const g = tag.charAt(0).toUpperCase() + tag.slice(1)
                if (!groups[g]) groups[g] = []
                    groups[g].push(s)
            }
        } else {
            if (!groups['Other']) groups['Other'] = []
                groups['Other'].push(s)
        }
    }

    for (const [groupName, items] of Object.entries(groups)) {
        const header = document.createElement('div')
        header.className = 'picker-group-header'
        header.textContent = groupName
        listEl.appendChild(header)

        for (const s of items) {
            listEl.appendChild(makeSoundEl(s))
        }
    }
}

function makeSoundEl(sound) {
    const el = document.createElement('button')
    el.className = 'picker-sound'

    el.dataset.id     = sound.id
    el.dataset.name   = (sound.name   || sound.id).toLowerCase()
    el.dataset.tags   = (sound.tags   || []).join(' ').toLowerCase()
    el.dataset.source = (sound.source || '').toLowerCase()

    const tagStr = (sound.tags || []).join(', ')
    el.title = [
        sound.name,
        sound.source ? `Source: ${sound.source}` : '',
        tagStr       ? `Tags: ${tagStr}` : '',
        'Right-click to preview · Ctrl+click to add to chord',
    ].filter(Boolean).join('\n')

    const img = document.createElement('img')
    img.src       = sound.imageLink
    img.alt       = sound.name || sound.id
    img.className = 'picker-icon'
    img.loading   = 'lazy'

    const info = document.createElement('div')
    info.className = 'picker-info'

    const name = document.createElement('span')
    name.className   = 'picker-label'
    name.textContent = sound.name || sound.id

    const meta = document.createElement('span')
    meta.className   = 'picker-meta'
    meta.textContent = sound.source || ''

    info.appendChild(name)
    if (sound.source) info.appendChild(meta)

        el.appendChild(img)
        el.appendChild(info)

        el.addEventListener('click', e => {
            if (e.ctrlKey || e.metaKey) {
                App.addToChord(sound.id)
            } else {
                App.insertSound(sound.id)
                // Play a quick preview so you hear what you just inserted
                previewSound(sound.id)
            }
            document.getElementById('seq').focus()
        })

        el.addEventListener('contextmenu', e => {
            e.preventDefault()
            previewSound(sound.id)
        })

        return el
}

function filterSounds(query, listEl) {
    if (!query) {
        listEl.querySelectorAll('.picker-sound, .picker-group-header')
        .forEach(el => el.style.display = '')
        return
    }

    const terms = query.split(/\s+/).filter(Boolean)
    const groupVisible = new Map()

    let currentHeader = null
    for (const el of listEl.children) {
        if (el.classList.contains('picker-group-header')) {
            currentHeader = el
            groupVisible.set(el, false)
        } else if (el.classList.contains('picker-sound')) {
            const matches = terms.every(term =>
            el.dataset.name.includes(term)   ||
            el.dataset.tags.includes(term)   ||
            el.dataset.source.includes(term) ||
            el.dataset.id.includes(term)
            )
            el.style.display = matches ? '' : 'none'
            if (matches && currentHeader) groupVisible.set(currentHeader, true)
        }
    }

    for (const [header, visible] of groupVisible) {
        header.style.display = visible ? '' : 'none'
    }
}

// Actions panel -- inserts TDW control items (!speed, !volume, etc.)
// at the cursor position. Actions with values show an inline config
// panel before inserting. Keyboard shortcuts are handled in editor.js.

import * as App from '../app.js'
import { ACTIONS } from '../model/controlslot.js'

const GROUPS = [
    ACTIONS.slice(0,  4),
    ACTIONS.slice(4,  8),
    ACTIONS.slice(8,  12),
    ACTIONS.slice(12, 16),
]

let activeAction = null
let configPanel  = null

export function init(container) {
    buildPanel(container)
}

function buildPanel(container) {
    container.innerHTML = ''

    const grid = document.createElement('div')
    grid.className = 'actions-grid'

    GROUPS.forEach((group, gi) => {
        group.forEach(action => grid.appendChild(makeActionBtn(action)))
        if (gi < GROUPS.length - 1) {
            const div = document.createElement('div')
            div.className = 'actions-divider'
            grid.appendChild(div)
        }
    })

    container.appendChild(grid)

    configPanel = document.createElement('div')
    configPanel.className = 'action-config'
    configPanel.style.display = 'none'
    container.appendChild(configPanel)
}

function makeActionBtn(action) {
    const btn = document.createElement('button')
    btn.className = 'action-btn'
    btn.title = `${action.action} (${action.shortcut.toUpperCase()})`
    btn.dataset.name = action.name

    const img = document.createElement('img')
    img.src   = `https://thirtydollar.website/assets/action_${action.name}.png`
    img.alt   = action.action
    img.className = 'action-icon'

    const label = document.createElement('span')
    label.className   = 'action-label-fallback'
    label.textContent = action.action.split(' ').slice(-1)[0]
    label.style.display = 'none'
    img.onerror = () => { img.style.display = 'none'; label.style.display = 'block' }

    const shortcut = document.createElement('span')
    shortcut.className   = 'action-shortcut'
    shortcut.textContent = action.shortcut.toUpperCase()

    btn.appendChild(img)
    btn.appendChild(label)
    btn.appendChild(shortcut)
    btn.addEventListener('click', () => handleActionClick(action, btn))
    return btn
}

export function handleActionClick(action, btnEl) {
    if (!action.hasValue) {
        App.insertControl(action.name)
        document.getElementById('seq-wrap').focus()
        return
    }

    if (activeAction === action) {
        closeConfig()
        return
    }

    document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'))
    btnEl?.classList.add('active')
    activeAction = action
    showConfig(action)
}

function closeConfig() {
    configPanel.style.display = 'none'
    configPanel.innerHTML = ''
    activeAction = null
    document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'))
}

function showConfig(action) {
    configPanel.innerHTML = ''
    configPanel.style.display = 'block'

    const title = document.createElement('div')
    title.className   = 'config-title'
    title.textContent = action.action
    configPanel.appendChild(title)

    if (action.twoValues) {
        showTwoValueConfig(action)
        return
    }

    let selectedModifier = null
    const modifiers = getModifiers(action)

    if (modifiers.length > 1) {
        const modRow = document.createElement('div')
        modRow.className = 'config-row'
        modifiers.forEach(({ label, key }) => {
            const mb = document.createElement('button')
            mb.className = 'mod-btn' + (key === null ? ' active' : '')
            mb.textContent = label
            mb.addEventListener('click', () => {
                selectedModifier = key
                modRow.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'))
                mb.classList.add('active')
                updateValueRange(action, key, valueInput)
            })
            modRow.appendChild(mb)
        })
        configPanel.appendChild(modRow)
    }

    const valueRow  = document.createElement('div')
    valueRow.className = 'config-row'

    const valueInput = document.createElement('input')
    valueInput.type      = 'number'
    valueInput.className = 'config-value'
    valueInput.value     = Array.isArray(action.default) ? action.default[0] : (action.default ?? 1)
    applyRange(valueInput, action.set)

    const unitLabel = document.createElement('span')
    unitLabel.className   = 'config-unit'
    unitLabel.textContent = action.set?.[3] ?? ''

    valueRow.appendChild(valueInput)
    valueRow.appendChild(unitLabel)
    configPanel.appendChild(valueRow)

    configPanel.appendChild(makeInsertBtn(() => {
        const val = action.isTarget
        ? parseInt(valueInput.value, 10)
        : parseFloat(valueInput.value)
        App.insertControl(action.name, val, selectedModifier)
        closeConfig()
        document.getElementById('seq-wrap').focus()
    }))
}

function showTwoValueConfig(action) {
    const [spec1, spec2] = action.twoValues
    const [def1, def2]   = action.default

    const row1 = document.createElement('div')
    row1.className = 'config-row'
    let input1

    if (spec1[0] === 'color') {
        input1 = document.createElement('input')
        input1.type      = 'text'
        input1.className = 'config-value'
        input1.value     = def1
        input1.placeholder = 'Hex or X (random)'
        input1.maxLength   = 7

        const colorPicker = document.createElement('input')
        colorPicker.type  = 'color'
        colorPicker.className = 'config-color'
        colorPicker.value = '#000000'
        colorPicker.addEventListener('input', () => {
            input1.value = colorPicker.value.replace('#', '')
        })
        input1.addEventListener('input', () => {
            if (/^[0-9a-fA-F]{6}$/.test(input1.value)) {
                colorPicker.value = '#' + input1.value
            }
        })
        row1.appendChild(colorPicker)
    } else {
        input1 = document.createElement('input')
        input1.type      = 'number'
        input1.className = 'config-value'
        input1.value     = def1
        applyRange(input1, spec1)
    }

    const label1 = document.createElement('span')
    label1.className   = 'config-unit'
    label1.textContent = spec1[0] === 'color' ? 'Color' : 'Duration'
    row1.appendChild(input1)
    row1.appendChild(label1)
    configPanel.appendChild(row1)

    const row2 = document.createElement('div')
    row2.className = 'config-row'
    const input2 = document.createElement('input')
    input2.type      = 'number'
    input2.className = 'config-value'
    input2.value     = def2
    applyRange(input2, spec2)
    const label2 = document.createElement('span')
    label2.className   = 'config-unit'
    label2.textContent = spec1[0] === 'color' ? 'Opacity' : 'Strength'
    row2.appendChild(input2)
    row2.appendChild(label2)
    configPanel.appendChild(row2)

    configPanel.appendChild(makeInsertBtn(() => {
        const v1 = spec1[0] === 'color' ? input1.value : parseFloat(input1.value)
        const v2 = parseFloat(input2.value)
        App.insertControl(action.name, v1, null, v2)
        closeConfig()
        document.getElementById('seq-wrap').focus()
    }))
}

function getModifiers(action) {
    const mods = [{ label: 'Set', key: null }]
    if (action.add)      mods.push({ label: '+  Add',      key: '+' })
        if (action.multiply) mods.push({ label: '×  Multiply', key: 'x' })
            if (action.divide)   mods.push({ label: '÷  Divide',   key: 'divide' })
                return mods
}

function updateValueRange(action, modifierKey, input) {
    const rangeSpec = modifierKey === '+'      ? action.add
    : modifierKey === 'x'      ? action.multiply
    : modifierKey === 'divide' ? action.divide
    : action.set
    applyRange(input, rangeSpec)
}

function applyRange(input, spec) {
    if (!spec) return
        input.min = spec[0]
        input.max = spec[1]
        if (spec[2]) input.step = spec[2]
}

function makeInsertBtn(onClick) {
    const btn = document.createElement('button')
    btn.className   = 'config-insert primary'
    btn.textContent = 'Insert'
    btn.addEventListener('click', onClick)
    return btn
}

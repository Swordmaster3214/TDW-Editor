// Plain geometry for the pointer code. Nothing here touches the DOM, so
// the same functions can be tested in Node with made-up rectangles.
// A rect is { left, top, right, bottom } in any one consistent coordinate space.

export function pointInRect(r, x, y) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// Which gap (a spot between slots, 0 through rects.length) is nearest to
// the point? Works like a text caret: find the closest slot, then pick the
// side of it the point is on. Empty space after the last slot of a wrapped
// row lands after that slot.
export function gapFromPoint(rects, x, y) {
    if (!rects.length) return 0

    // Above the first row or below the last one, like a text editor: go to
    // the very start or the very end
    let top = Infinity, bottom = -Infinity
    for (const r of rects) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom) }
    if (y > bottom) return rects.length
    if (y < top) return 0

    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < rects.length; i++) {
        const r  = rects[i]
        const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0)
        const dy = y < r.top  ? r.top - y  : (y > r.bottom ? y - r.bottom : 0)
        const d  = dx * dx + dy * dy
        // Strict less-than keeps ties on the earlier slot
        if (d < bestDist) { bestDist = d; best = i }
    }

    const r = rects[best]
    return x < (r.left + r.right) / 2 ? best : best + 1
}

// Which lane is the pointer in? Uses height only, so dragging sideways past
// the edge of a lane still counts. Outside every lane, the closest one wins.
export function laneFromY(rects, y) {
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i]
        const d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0)
        if (d < bestDist) { bestDist = d; best = i }
    }
    return best
}

// How fast to auto-scroll while the pointer is held near the top or bottom
// edge of the scroll area. Negative scrolls up, positive scrolls down.
export function edgeScrollSpeed(rect, y, zone = 48, maxSpeed = 18) {
    if (y < rect.top + zone) {
        const t = Math.min(1, (rect.top + zone - y) / zone)
        return -Math.ceil(t * maxSpeed)
    }
    if (y > rect.bottom - zone) {
        const t = Math.min(1, (y - (rect.bottom - zone)) / zone)
        return Math.ceil(t * maxSpeed)
    }
    return 0
}

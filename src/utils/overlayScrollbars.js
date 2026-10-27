// Overlay scrollbars. Native scrollbars are hidden everywhere (see index.css), so they
// never take layout space, and a thin thumb is drawn in a fixed layer above the page
// instead. A scroller's thumbs show while the pointer is over it (or any scroller
// inside it), while it is being scrolled, and while a thumb is being dragged. Scrolling
// itself stays native (wheel, touch, keyboard) — only the bar is drawn here.
//
// Opt a scroller out with data-overlay-scroll="off".

const THUMB_SIZE = 6
const EDGE = 3
const MIN_THUMB = 28
const HIDE_AFTER_SCROLL_MS = 900

export function installOverlayScrollbars() {
  if (typeof document === 'undefined' || window.__overlayScrollbarsInstalled) return
  window.__overlayScrollbarsInstalled = true

  const layer = document.createElement('div')
  layer.className = 'os-layer'
  document.body.appendChild(layer)

  const bars = new Map() // scroller -> { x, y, timer, visible }
  let hovered = new Set()
  let dragging = null

  function isRoot(el) {
    return el === document.scrollingElement
  }

  function scrolls(el, axis) {
    const prop = axis === 'y' ? 'overflowY' : 'overflowX'
    let overflow
    if (isRoot(el)) {
      overflow = getComputedStyle(document.documentElement)[prop]
      if (overflow === 'visible') overflow = getComputedStyle(document.body)[prop]
      if (overflow === 'visible') overflow = 'auto'
    } else {
      if (el.dataset.overlayScroll === 'off') return false
      overflow = getComputedStyle(el)[prop]
    }
    if (overflow !== 'auto' && overflow !== 'scroll') return false
    return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
  }

  function geometry(scroller, axis) {
    const root = isRoot(scroller)
    const box = root ? { left: 0, top: 0 } : scroller.getBoundingClientRect()
    const left = box.left + (root ? 0 : scroller.clientLeft)
    const top = box.top + (root ? 0 : scroller.clientTop)
    const vertical = axis === 'y'
    const view = vertical ? scroller.clientHeight : scroller.clientWidth
    const content = vertical ? scroller.scrollHeight : scroller.scrollWidth
    // Leave room for the other axis's thumb so the two never overlap in the corner.
    const cornerGap = scrolls(scroller, vertical ? 'x' : 'y') ? THUMB_SIZE + EDGE : 0
    const track = view - EDGE * 2 - cornerGap
    const len = Math.min(track, Math.max(MIN_THUMB, (track * view) / content))
    const range = content - view
    const scrolled = vertical ? scroller.scrollTop : scroller.scrollLeft
    const offset = range > 0 ? (scrolled / range) * (track - len) : 0
    return { left, top, width: scroller.clientWidth, height: scroller.clientHeight, track, len, range, offset }
  }

  function layout(scroller, bar) {
    for (const axis of ['x', 'y']) {
      const thumb = bar[axis]
      if (!scrolls(scroller, axis)) {
        thumb.style.display = 'none'
        continue
      }
      const g = geometry(scroller, axis)
      thumb.style.display = 'block'
      if (axis === 'y') {
        // A scroller inside a padded page can ask for its bar at the window's right
        // edge (data-overlay-scroll-align="window") instead of its own.
        const rightEdge = scroller.dataset.overlayScrollAlign === 'window' ? document.documentElement.clientWidth : g.left + g.width
        thumb.style.left = `${rightEdge - THUMB_SIZE - EDGE}px`
        thumb.style.top = `${g.top + EDGE + g.offset}px`
        thumb.style.width = `${THUMB_SIZE}px`
        thumb.style.height = `${g.len}px`
      } else {
        thumb.style.left = `${g.left + EDGE + g.offset}px`
        thumb.style.top = `${g.top + g.height - THUMB_SIZE - EDGE}px`
        thumb.style.width = `${g.len}px`
        thumb.style.height = `${THUMB_SIZE}px`
      }
    }
  }

  function makeThumb(scroller, axis) {
    const thumb = document.createElement('div')
    thumb.className = `os-thumb os-thumb-${axis}`
    thumb.addEventListener('pointerdown', (event) => startDrag(event, scroller, axis, thumb))
    layer.appendChild(thumb)
    return thumb
  }

  function barFor(scroller) {
    let bar = bars.get(scroller)
    if (!bar) {
      bar = { x: makeThumb(scroller, 'x'), y: makeThumb(scroller, 'y'), timer: 0, visible: false }
      bars.set(scroller, bar)
    }
    return bar
  }

  function setVisible(bar, visible) {
    bar.visible = visible
    bar.x.classList.toggle('is-visible', visible)
    bar.y.classList.toggle('is-visible', visible)
  }

  function show(scroller) {
    const bar = barFor(scroller)
    clearTimeout(bar.timer)
    layout(scroller, bar)
    setVisible(bar, true)
  }

  function hide(scroller) {
    const bar = bars.get(scroller)
    if (!bar) return
    clearTimeout(bar.timer)
    setVisible(bar, false)
  }

  function scheduleHide(scroller) {
    const bar = bars.get(scroller)
    if (!bar) return
    clearTimeout(bar.timer)
    bar.timer = setTimeout(() => {
      if (!hovered.has(scroller) && dragging?.scroller !== scroller) hide(scroller)
    }, HIDE_AFTER_SCROLL_MS)
  }

  // Scrollers that were removed from the page (a closed modal, a view that unmounted)
  // would otherwise leave their thumbs behind.
  function sweep() {
    for (const [scroller, bar] of bars) {
      if (scroller.isConnected) continue
      clearTimeout(bar.timer)
      bar.x.remove()
      bar.y.remove()
      bars.delete(scroller)
      hovered.delete(scroller)
    }
  }

  function refresh() {
    sweep()
    for (const [scroller, bar] of bars) if (bar.visible) layout(scroller, bar)
  }

  function scrollerChain(target) {
    const chain = []
    for (let node = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node.nodeType === 1 && (scrolls(node, 'x') || scrolls(node, 'y'))) chain.push(node)
    }
    const root = document.scrollingElement
    if (root && (scrolls(root, 'x') || scrolls(root, 'y'))) chain.push(root)
    return chain
  }

  function onPointerOver(event) {
    if (dragging || !(event.target instanceof Element) || layer.contains(event.target)) return
    const chain = new Set(scrollerChain(event.target))
    for (const scroller of hovered) if (!chain.has(scroller)) hide(scroller)
    hovered = chain
    for (const scroller of chain) show(scroller)
  }

  function onPointerLeaveWindow() {
    if (dragging) return
    for (const scroller of hovered) hide(scroller)
    hovered = new Set()
  }

  function onScroll(event) {
    const scroller = event.target === document ? document.scrollingElement : event.target
    if (!(scroller instanceof Element) || (!scrolls(scroller, 'x') && !scrolls(scroller, 'y'))) return
    show(scroller)
    if (!hovered.has(scroller)) scheduleHide(scroller)
  }

  function startDrag(event, scroller, axis, thumb) {
    event.preventDefault()
    thumb.setPointerCapture(event.pointerId)
    thumb.classList.add('is-dragging')
    document.body.style.userSelect = 'none'
    dragging = {
      scroller,
      axis,
      thumb,
      startPointer: axis === 'y' ? event.clientY : event.clientX,
      startScroll: axis === 'y' ? scroller.scrollTop : scroller.scrollLeft,
    }
    thumb.addEventListener('pointermove', onDragMove)
    thumb.addEventListener('pointerup', endDrag)
    thumb.addEventListener('pointercancel', endDrag)
  }

  function onDragMove(event) {
    if (!dragging) return
    const { scroller, axis, startPointer, startScroll } = dragging
    const g = geometry(scroller, axis)
    const movable = g.track - g.len
    if (movable <= 0) return
    const delta = (axis === 'y' ? event.clientY : event.clientX) - startPointer
    const next = startScroll + (delta / movable) * g.range
    if (axis === 'y') scroller.scrollTop = next
    else scroller.scrollLeft = next
  }

  function endDrag() {
    if (!dragging) return
    const { scroller, thumb } = dragging
    thumb.classList.remove('is-dragging')
    thumb.removeEventListener('pointermove', onDragMove)
    thumb.removeEventListener('pointerup', endDrag)
    thumb.removeEventListener('pointercancel', endDrag)
    document.body.style.userSelect = ''
    dragging = null
    scheduleHide(scroller)
  }

  let refreshQueued = false
  function queueRefresh() {
    if (refreshQueued) return
    refreshQueued = true
    requestAnimationFrame(() => {
      refreshQueued = false
      refresh()
    })
  }

  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('scroll', onScroll, true)
  document.documentElement.addEventListener('pointerleave', onPointerLeaveWindow)
  window.addEventListener('resize', queueRefresh)
  // Content changing size under a visible thumb (rows loading in, a panel opening)
  // and removed scrollers are both picked up here.
  new MutationObserver(queueRefresh).observe(document.body, { childList: true, subtree: true })
}

// While a modal, pop-up or (on small screens) bottom sheet / slide-in sidebar is open, the page
// behind it must not scroll. One global lock covers every one of them, so individual modals
// don't each need to remember to do it:
//
//  - the document stops scrolling (html.scroll-locked, see index.css), and
//  - wheel and touch scrolling is cancelled anywhere that isn't a scrollable region inside the
//    open layer — which also stops it reaching a scrolling parent the layer happens to be
//    rendered inside (some modals sit inside the dashboard's own scroll area). A modal's own
//    scrolling content still works.
const ALWAYS_LAYERS = ['.modal-overlay', '.celebration-overlay', '.announcement-alert-overlay']
// Only layers on small screens: on desktop these are ordinary inline panels, not overlays.
const SMALL_SCREEN_LAYERS = [
  '.tab-sidebar-backdrop',
  '.tab-sidebar.is-sidebar-open',
  '.tab-sidebar.drawer-open .tab-detail-drawer',
  '.attendance-layout.drawer-open .attendance-drawer',
]
const SMALL_SCREEN_QUERY = '(max-width: 900px)'

function layerSelector() {
  const layers = window.matchMedia(SMALL_SCREEN_QUERY).matches ? [...ALWAYS_LAYERS, ...SMALL_SCREEN_LAYERS] : ALWAYS_LAYERS
  return layers.join(',')
}

// Whether something between the event target and the open layer can still scroll in the
// direction of travel (deltaY > 0 is down).
function canScrollInside(target, layer, deltaY) {
  for (let element = target; element; element = element.parentElement) {
    const { overflowY } = window.getComputedStyle(element)
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 1) {
      const room = deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1
      if (room) return true
    }
    if (element === layer) break
  }
  return false
}

export function installScrollLock() {
  let frame = 0
  let touchStartY = 0

  function sync() {
    frame = 0
    document.documentElement.classList.toggle('scroll-locked', Boolean(document.querySelector(layerSelector())))
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync)
  }

  function block(event, target, deltaY) {
    const selector = layerSelector()
    if (!document.querySelector(selector)) return
    const layer = target instanceof Element ? target.closest(selector) : null
    if (layer && canScrollInside(target, layer, deltaY)) return
    if (event.cancelable) event.preventDefault()
  }

  document.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) block(event, event.target, event.deltaY)
  }, { passive: false })
  document.addEventListener('touchstart', (event) => { touchStartY = event.touches[0].clientY }, { passive: true })
  document.addEventListener('touchmove', (event) => {
    block(event, event.target, touchStartY - event.touches[0].clientY)
  }, { passive: false })

  // Layers open and close by being added/removed or by a class flipping (a sheet's drawer-open).
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  window.matchMedia(SMALL_SCREEN_QUERY).addEventListener('change', schedule)
  schedule()
}

// ---------------------------------------------------------------------------------------------
// The dashboard is a fixed-height screen whose middle (.dashboard-main) scrolls on its own, so
// the page itself has nothing to scroll — and the mouse wheel did nothing unless the pointer was
// over that middle section: not over the toolbar above it, the gaps between panels, the margins,
// or the tab strip over the whole dashboard. This sends a wheel turn made anywhere else to it.
//
// It only steps in when nothing else would use the turn: not over something scrollable that can
// still move that way (a list, a modal's text), not when the page itself can scroll (phones and
// short windows, where the dashboard is an ordinary page), and not while a modal is open.
const FALLBACK_SCROLLER = '.dashboard-main'

function visibleDashboardScroller() {
  return [...document.querySelectorAll(FALLBACK_SCROLLER)].find((element) => element.getClientRects().length > 0 && element.scrollHeight > element.clientHeight + 1) || null
}

function somethingElseCanScroll(target, deltaY, scroller) {
  for (let element = target; element && element !== document.documentElement; element = element.parentElement) {
    if (element === scroller) return true // already over it: the browser scrolls it natively
    const { overflowY } = window.getComputedStyle(element)
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 1) {
      const room = deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1
      if (room) return true
    }
  }
  return false
}

export function installWheelForwarding() {
  document.addEventListener('wheel', (event) => {
    if (event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
    const scroller = visibleDashboardScroller()
    if (!scroller) return
    // The page itself scrolls (small screens), so the wheel already does the right thing.
    const page = document.scrollingElement
    if (page && page.scrollHeight > page.clientHeight + 1 && window.getComputedStyle(document.documentElement).overflowY !== 'hidden') return
    if (somethingElseCanScroll(event.target, event.deltaY, scroller)) return
    // Lines and pages (some mice) are converted to pixels.
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * scroller.clientHeight : event.deltaY
    scroller.scrollBy({ top: pixels })
  }, { passive: true })
}

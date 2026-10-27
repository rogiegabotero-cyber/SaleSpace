// "Take me to that, and show me where it is" — used when a notification is clicked.
//
// Elements that can be pointed at carry data-focus-id="announcement:<id>" / "note:<id>".
// goToFocus() records which one, routes to the employee workspace dashboard where they live
// (from any panel), and the workspace then scrolls to it and pulses it. The target is passed
// through sessionStorage so it survives the page load when the click came from another panel
// (the Admin panel is a separate page).
const STORAGE_KEY = 'focusTarget'
const EVENT_NAME = 'focus-target'
const INDICATOR_CLASS = 'focus-indicator'
const INDICATOR_PADDING = 5
const HIGHLIGHT_MS = 4500
// The target may not be on screen yet (data still loading, view still switching), so it is
// looked for repeatedly for a while before giving up.
const POLL_MS = 200
const MAX_POLLS = 50

const WORKSPACE_DASHBOARD_HASH = '#Dashboard/Workspace'

export function goToFocus(focusId) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, focusId)
  } catch {
    // Without storage the page still opens; it just can't highlight across a page load.
  }
  window.dispatchEvent(new Event(EVENT_NAME))
  if (window.location.pathname === '/') {
    // Already in the workspace: switching the hash switches the page without a reload.
    if (window.location.hash !== WORKSPACE_DASHBOARD_HASH) window.location.hash = WORKSPACE_DASHBOARD_HASH
  } else {
    window.location.assign(`/${WORKSPACE_DASHBOARD_HASH}`)
  }
}

// The "it's this one" marker is a separate outline fixed to the screen and drawn above everything,
// placed over the target on every frame (so it follows while the page scrolls to it). Putting the
// outline on the element itself got it clipped by whatever scrolls or hides overflow around it —
// a scrolling announcement list cut it off.
function showIndicator(element) {
  document.querySelector(`.${INDICATOR_CLASS}`)?.remove()
  const indicator = document.createElement('div')
  indicator.className = INDICATOR_CLASS
  indicator.setAttribute('aria-hidden', 'true')
  document.body.appendChild(indicator)
  const startedAt = performance.now()
  let frame = 0
  function place() {
    const box = element.getBoundingClientRect()
    indicator.style.left = `${box.left - INDICATOR_PADDING}px`
    indicator.style.top = `${box.top - INDICATOR_PADDING}px`
    indicator.style.width = `${box.width + INDICATOR_PADDING * 2}px`
    indicator.style.height = `${box.height + INDICATOR_PADDING * 2}px`
    if (performance.now() - startedAt < HIGHLIGHT_MS) frame = requestAnimationFrame(place)
    else indicator.remove()
  }
  place()
  // A newer indicator (another notification clicked) replaces this one; stop following the old.
  new MutationObserver((_, observer) => {
    if (!indicator.isConnected) { cancelAnimationFrame(frame); observer.disconnect() }
  }).observe(document.body, { childList: true })
}

function highlightWhenReady(focusId) {
  let polls = 0
  const timer = setInterval(() => {
    const element = document.querySelector(`[data-focus-id="${CSS.escape(focusId)}"]`)
    // getClientRects is empty while the element (or a parent) is display: none.
    if (element && element.getClientRects().length > 0) {
      clearInterval(timer)
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      showIndicator(element)
    } else if (++polls >= MAX_POLLS) {
      clearInterval(timer)
    }
  }, POLL_MS)
  return () => clearInterval(timer)
}

// Mount once in the workspace: acts on a target waiting from before this page loaded, and on
// ones requested while it is open. Returns the cleanup.
export function listenForFocus() {
  let stopPolling = () => {}
  function run() {
    let focusId
    try {
      focusId = window.sessionStorage.getItem(STORAGE_KEY)
      if (focusId) window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      return
    }
    if (!focusId) return
    stopPolling()
    stopPolling = highlightWhenReady(focusId)
  }
  run()
  window.addEventListener(EVENT_NAME, run)
  return () => {
    window.removeEventListener(EVENT_NAME, run)
    stopPolling()
  }
}

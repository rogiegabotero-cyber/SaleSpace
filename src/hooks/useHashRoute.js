import { useCallback, useEffect, useState } from 'react'

// Keeps "which page am I on" in the address bar's #hash (e.g. /admin#Employees), so a
// refresh stays on the same page and the browser's back / forward buttons move between the
// pages visited. The panels pick their page from React state, which a reload would reset.
//
// `pages` are the valid page names (the first is the default). `views` optionally lists the
// sub-views of the Dashboard page (e.g. Workspace / Work Overview), kept as #Dashboard/View.
// A hash that isn't one of them — a stale link, a page this user can't see — falls back to
// the default instead of showing nothing.
export function useHashRoute({ pages, views = null }) {
  const parse = useCallback(() => {
    const [rawPage, rawView] = window.location.hash.replace(/^#/, '').split('/').map((part) => {
      try { return decodeURIComponent(part) } catch { return '' }
    })
    const page = pages.includes(rawPage) ? rawPage : pages[0]
    const view = views ? (page === pages[0] && views.includes(rawView) ? rawView : views[0]) : null
    return { page, view }
  }, [pages, views])

  const [route, setRoute] = useState(parse)

  // Back / forward (and hand-edited hashes) change the route from outside React.
  useEffect(() => {
    const onHashChange = () => {
      const next = parse()
      setRoute((current) => (current.page === next.page && current.view === next.view ? current : next))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [parse])

  const go = useCallback((next) => {
    // Only the default (first) page has sub-views.
    const hash = `#${[next.page, next.page === pages[0] ? next.view : null].filter(Boolean).map(encodeURIComponent).join('/')}`
    if (window.location.hash !== hash) window.location.hash = hash
    setRoute(next)
  }, [pages])

  const setPage = useCallback((page) => go({ ...route, page }), [go, route])
  const setView = useCallback((view) => go({ ...route, view }), [go, route])

  return { page: route.page, view: route.view, setPage, setView }
}

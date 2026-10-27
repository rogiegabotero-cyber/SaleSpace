import { useEffect, useState } from 'react'

// Tracks a CSS media query so layout that can't be expressed in CSS alone (which markup
// to render, whether a control applies) follows the window as it is resized.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = (event) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

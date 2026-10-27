import { useEffect } from 'react'

const APP_NAME = 'Salespace'

// Keeps the browser tab title in step with whichever page is on screen, e.g.
// "Attendance Log | Salespace". Pass nothing to fall back to just the app name.
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ${APP_NAME}` : APP_NAME
  }, [title])
}

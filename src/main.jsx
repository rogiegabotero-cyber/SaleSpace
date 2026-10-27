import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
// After App so its rules come last and override the desktop styles.
import './responsive.css'
import { installOverlayScrollbars } from './utils/overlayScrollbars'
import { installScrollLock, installWheelForwarding } from './utils/scrollLock'

installOverlayScrollbars()
installScrollLock()
installWheelForwarding()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

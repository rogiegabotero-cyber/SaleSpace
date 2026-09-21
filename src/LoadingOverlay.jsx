import './App.css'

export default function LoadingOverlay() {
  return <div className="loading-overlay" role="status" aria-live="polite" aria-label="Loading">
    <span className="loading-spinner" />
  </div>
}

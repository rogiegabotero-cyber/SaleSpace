export default function ConfirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', busy, error, onConfirm, onCancel }) {
  return <div className="modal-overlay" role="presentation" onClick={onCancel}>
    <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <h3>{title}</h3>
      <p>{message}</p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">{onCancel && <button type="button" className="admin-link" onClick={onCancel}>{cancelLabel}</button>}<button type="button" className="admin-primary" onClick={onConfirm} disabled={busy}>{busy ? 'Saving...' : confirmLabel}</button></div>
    </div>
  </div>
}

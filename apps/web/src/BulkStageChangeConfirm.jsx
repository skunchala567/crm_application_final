import { X } from 'lucide-react';
import './BulkStageChangeConfirm.css';

export function BulkStageChangeConfirm({ count, onCancel, onContinue, loading = false }) {
  return (
    <>
      <div className="confirm-backdrop" onClick={onCancel} />
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header>
          <h2 id="confirm-title">Bulk Lead / Application Stage Change</h2>
          <button className="icon-btn" onClick={onCancel} disabled={loading}>
            <X />
          </button>
        </header>
        <div className="confirm-body">
          <p>Do you want to change the stage?</p>
          <p className="secondary-text">Are you sure you want to change the stage of {count} selected lead{count === 1 ? '' : 's'}?</p>
        </div>
        <footer>
          <button className="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="primary" onClick={onContinue} disabled={loading}>
            {loading ? 'Processing...' : 'Continue'}
          </button>
        </footer>
      </div>
    </>
  );
}

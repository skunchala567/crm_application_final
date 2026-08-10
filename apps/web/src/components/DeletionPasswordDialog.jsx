import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { setDeletionPasswordPrompt } from '../api';
import '../BulkStageChangeConfirm.css';

/**
 * Asks for the deletion password when the API answers a DELETE with a 428
 * challenge. Mounted once, for the whole app: `api.js` cannot render, so it
 * hands the question here and waits on the promise this resolves.
 *
 * Resolves with the password, or null when the user backs out -- the same
 * contract `window.prompt` had, so the caller's cancel path is unchanged.
 */
export default function DeletionPasswordDialog() {
  const [request, setRequest] = useState(null);
  const [password, setPassword] = useState('');
  const inputRef = useRef(null);

  useEffect(() => setDeletionPasswordPrompt(
    message => new Promise(resolve => {
      setPassword('');
      setRequest({ message, resolve });
    })
  ), []);

  const settle = useCallback(value => {
    setRequest(current => {
      current?.resolve(value);
      return null;
    });
    setPassword('');
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    inputRef.current?.focus();
    const escape = event => { if (event.key === 'Escape') settle(null); };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [request, settle]);

  if (!request) return null;

  return (
    <>
      <div className="confirm-backdrop" onClick={() => settle(null)} />
      <form
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deletion-password-title"
        onSubmit={event => { event.preventDefault(); settle(password); }}
      >
        <header>
          <h2 id="deletion-password-title">Confirm deletion</h2>
          <button type="button" className="icon-btn" onClick={() => settle(null)} aria-label="Cancel deletion">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{request.message}</p>
          <label className="deletion-password-field">
            <KeyRound size={15} />
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Deletion password"
              aria-label="Deletion password"
              autoComplete="off"
            />
          </label>
        </div>
        <footer>
          <button type="button" className="secondary" onClick={() => settle(null)}>Cancel</button>
          <button type="submit" className="primary" disabled={!password}>Confirm deletion</button>
        </footer>
      </form>
    </>
  );
}

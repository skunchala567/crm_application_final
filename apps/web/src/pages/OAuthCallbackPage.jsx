import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle, Loader } from 'lucide-react';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing'); // 'processing', 'success', 'error'
  const [message, setMessage] = useState('Processing OAuth authorization...');

  useEffect(() => {
    const processCallback = async () => {
      try {
        const oauth = searchParams.get('oauth');
        const integrationId = searchParams.get('integrationId');
        const error = searchParams.get('error');

        if (error) {
          setStatus('error');
          setMessage(`Authorization failed: ${decodeURIComponent(error)}`);
          return;
        }

        if (oauth === 'success' && integrationId) {
          setStatus('success');
          setMessage('Authorization successful! Redirecting...');

          // Redirect to integrations page after 1.5 seconds
          setTimeout(() => {
            navigate('/integrations');
          }, 1500);
        } else {
          setStatus('error');
          setMessage('Invalid OAuth response. Please try again.');
        }
      } catch (err) {
        setStatus('error');
        setMessage(`Error processing OAuth: ${err.message}`);
      }
    };

    processCallback();
  }, [searchParams, navigate]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {status === 'processing' && (
          <>
            <Loader size={48} style={{ ...styles.icon, animation: 'spin 1s linear infinite' }} />
            <h1 style={styles.title}>Authorizing...</h1>
            <p style={styles.message}>{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle size={48} style={{ ...styles.icon, color: '#28a745' }} />
            <h1 style={styles.title}>Success!</h1>
            <p style={styles.message}>{message}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle size={48} style={{ ...styles.icon, color: '#dc3545' }} />
            <h1 style={styles.title}>Authorization Failed</h1>
            <p style={styles.message}>{message}</p>
            <button
              style={styles.button}
              onClick={() => navigate('/integrations')}
            >
              Back to Integrations
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: '12px',
    padding: '3rem',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
    textAlign: 'center',
    maxWidth: '500px',
    width: '90%',
  },
  icon: {
    margin: '0 auto 1.5rem',
    display: 'block',
    color: 'var(--brand-500)',
  },
  title: {
    margin: '0 0 1rem 0',
    fontSize: '1.8rem',
    fontWeight: 600,
    color: 'var(--ink-900)',
  },
  message: {
    margin: '0 0 2rem 0',
    fontSize: '1rem',
    color: 'var(--ink-500)',
    lineHeight: 1.5,
  },
  button: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 500,
    color: 'white',
    background: 'var(--brand-500)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

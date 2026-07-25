import { useState, useCallback } from 'react';
import { api } from '../api';

export function useTemplateSync(integrationId) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const sync = useCallback(async () => {
    if (!integrationId) {
      setSyncError('No integration ID provided');
      return null;
    }

    try {
      setSyncing(true);
      setSyncError(null);

      const response = await api.post(`/whatsapp/integrations/${integrationId}/sync`);

      setLastSync(new Date());

      return {
        success: true,
        count: response.data?.data?.count || 0,
        message: response.data?.message || 'Sync complete'
      };
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      setSyncError(errorMsg);
      return {
        success: false,
        message: errorMsg
      };
    } finally {
      setSyncing(false);
    }
  }, [integrationId]);

  return {
    sync,
    syncing,
    lastSync,
    syncError,
    clearError: () => setSyncError(null)
  };
}

export default useTemplateSync;

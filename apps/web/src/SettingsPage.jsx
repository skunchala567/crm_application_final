import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Building2, Settings, Users, MessageCircle } from 'lucide-react';
import UserManagementPage from './UserManagementPage.jsx';
import WhatsAppTemplatesSettings from './WhatsAppTemplatesSettings.jsx';
import IntegrationHubPage from './pages/IntegrationHubPage.jsx';
import GoogleSheetsSettings from './pages/GoogleSheetsSettings.jsx';
import BusinessUnitsPage from './BusinessUnitsPage.jsx';
import Toast from './Toast.jsx';

const settingsTabs = [
  { id: 'users', path: '/settings/users', label: 'User Management', icon: Users, component: UserManagementPage },
  { id: 'business-units', path: '/settings/business-units', label: 'Business Units', icon: Building2, component: BusinessUnitsPage },
  { id: 'integrations', path: '/settings/integrations', label: 'Integrations', icon: Settings, component: IntegrationHubPage },
  { id: 'google-sheets', path: '/settings/google-sheets', label: 'Google Sheets', icon: Settings, component: GoogleSheetsSettings },
  { id: 'whatsapp-templates', path: '/settings/whatsapp-templates', label: 'WhatsApp', icon: MessageCircle, component: WhatsAppTemplatesSettings },
];

export default function SettingsPage(){
  const location = useLocation();
  const [message, setMessage] = useState(null);

  // Derive active tab from current URL pathname, not from state
  const getActiveTabFromPath = () => {
    // Map pathname to tab ID
    const pathToTabMap = {
      '/settings/users': 'users',
      '/settings/business-units': 'business-units',
      '/settings/integrations': 'integrations',
      '/settings/google-sheets': 'google-sheets',
      '/settings/whatsapp-templates': 'whatsapp-templates',
      '/settings': 'users', // default
    };

    return pathToTabMap[location.pathname] || 'users';
  };

  const activeTabId = getActiveTabFromPath();
  const activeTabConfig = settingsTabs.find(tab => tab.id === activeTabId);
  const ActiveComponent = activeTabConfig?.component;

  return (
    <div className="settings-page-content">
      <Toast message={message} onClose={() => setMessage(null)} />
      {ActiveComponent && <ActiveComponent key={activeTabId} onMessage={setMessage} />}
    </div>
  );
}

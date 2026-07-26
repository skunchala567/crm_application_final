import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Settings, Users, ClipboardList, X, MessageCircle } from 'lucide-react';
import UserManagementPage from './UserManagementPage.jsx';
import LeadConfiguration from './LeadConfiguration.jsx';
import AcademicConfigurationPage from './AcademicConfigurationPage.jsx';
import WhatsAppTemplatesSettings from './WhatsAppTemplatesSettings.jsx';
import IntegrationHubPage from './pages/IntegrationHubPage.jsx';
import GoogleSheetsSettings from './pages/GoogleSheetsSettings.jsx';

const settingsTabs = [
  { id: 'users', path: '/settings/users', label: 'User Management', icon: Users, component: UserManagementPage },
  { id: 'config', path: '/settings/lead-config', label: 'Lead Configuration', icon: ClipboardList, component: LeadConfiguration },
  { id: 'academic', path: '/settings/academic-config', label: 'Academic Configuration', icon: ClipboardList, component: AcademicConfigurationPage },
  { id: 'integrations', path: '/settings/integrations', label: 'Integrations', icon: Settings, component: IntegrationHubPage },
  { id: 'google-sheets', path: '/settings/google-sheets', label: 'Google Sheets', icon: Settings, component: GoogleSheetsSettings },
  { id: 'whatsapp-templates', path: '/settings/whatsapp-templates', label: 'WhatsApp Templates', icon: MessageCircle, component: WhatsAppTemplatesSettings },
];

export default function SettingsPage(){
  const location = useLocation();
  const [message, setMessage] = useState(null);

  // Derive active tab from current URL pathname, not from state
  const getActiveTabFromPath = () => {
    // Map pathname to tab ID
    const pathToTabMap = {
      '/settings/users': 'users',
      '/settings/lead-config': 'config',
      '/settings/academic-config': 'academic',
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
    <>
      {message && (
        <div className={`notice ${message.type}`} style={{ margin: '20px 30px 16px' }}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {ActiveComponent && <ActiveComponent key={activeTabId} onMessage={setMessage} />}
    </>
  );
}

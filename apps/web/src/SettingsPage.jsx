import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Settings, Users, ClipboardList, X, BookOpen, Calendar, MessageCircle } from 'lucide-react';
import UserManagementPage from './UserManagementPage.jsx';
import LeadConfiguration from './LeadConfiguration.jsx';
import AdmissionClassConfiguration from './AdmissionClassConfiguration.jsx';
import AcademicYearsConfiguration from './AcademicYearsConfiguration.jsx';
import WhatsAppTemplatesSettings from './WhatsAppTemplatesSettings.jsx';
import IntegrationHubPage from './pages/IntegrationHubPage.jsx';

const settingsTabs = [
  { id: 'users', path: '/settings/users', label: 'User Management', icon: Users, component: UserManagementPage },
  { id: 'config', path: '/settings/lead-config', label: 'Lead Configuration', icon: ClipboardList, component: LeadConfiguration },
  { id: 'academic-years', path: '/settings/academic-years', label: 'Academic Years', icon: Calendar, component: AcademicYearsConfiguration },
  { id: 'admission', path: '/settings/admission-classes', label: 'Admission Classes', icon: BookOpen, component: AdmissionClassConfiguration },
  { id: 'integrations', path: '/settings/integrations', label: 'Integrations', icon: Settings, component: IntegrationHubPage },
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
      '/settings/academic-years': 'academic-years',
      '/settings/admission-classes': 'admission',
      '/settings/integrations': 'integrations',
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

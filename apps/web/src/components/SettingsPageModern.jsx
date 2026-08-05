import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Building2, Settings, Users, MessageCircle, PhoneCall, MapPin, Zap, Facebook } from 'lucide-react';
import UserManagementPage from '../UserManagementPage.jsx';
import WhatsAppTemplatesSettings from '../WhatsAppTemplatesSettings.jsx';
import IntegrationHubPage from '../pages/IntegrationHubPage.jsx';
import GoogleSheetsSettings from '../pages/GoogleSheetsSettings.jsx';
import MetaLeadAdsSettings from '../pages/MetaLeadAdsSettings.jsx';
import BusinessUnitsPage from '../BusinessUnitsPage.jsx';
import Toast from '../Toast.jsx';
import CallerDeskSettings from '../pages/CallerDeskSettings.jsx';
import SmartfloSettings from '../pages/SmartfloSettings.jsx';
import BranchSettingsPage from '../pages/BranchSettingsPage.jsx';
import PaymentFormsPage from '../pages/PaymentFormsPage.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui';
import PageContainer from './PageContainer';

const settingsTabs = [
  {
    id: 'users',
    path: '/settings/users',
    label: 'User Management',
    icon: Users,
    component: UserManagementPage,
  },
  {
    id: 'business-units',
    path: '/settings/business-units',
    label: 'Business Units',
    icon: Building2,
    component: BusinessUnitsPage,
  },
  {
    id: 'branches',
    path: '/settings/branches',
    label: 'Branch Settings',
    icon: MapPin,
    component: BranchSettingsPage,
  },
  {
    id: 'payment-forms',
    path: '/settings/payment-forms',
    label: 'Payment Forms',
    icon: Zap,
    component: PaymentFormsPage,
  },
  {
    id: 'integrations',
    path: '/settings/integrations',
    label: 'Integrations',
    icon: Settings,
    component: IntegrationHubPage,
  },
  {
    id: 'google-sheets',
    path: '/settings/google-sheets',
    label: 'Google Sheets',
    icon: Settings,
    component: GoogleSheetsSettings,
  },
  {
    id: 'meta-lead-ads',
    path: '/settings/meta-lead-ads',
    label: 'Meta Lead Ads',
    icon: Facebook,
    component: MetaLeadAdsSettings,
  },
  {
    id: 'whatsapp-templates',
    path: '/settings/whatsapp-templates',
    label: 'WhatsApp',
    icon: MessageCircle,
    component: WhatsAppTemplatesSettings,
  },
  {
    id: 'callerdesk',
    path: '/settings/callerdesk',
    label: 'Calling',
    icon: PhoneCall,
    component: CallerDeskSettings,
  },
  {
    id: 'smartflo',
    path: '/settings/smartflo',
    label: 'Smartflo',
    icon: PhoneCall,
    component: SmartfloSettings,
  },
];

// Derived from settingsTabs rather than a parallel hardcoded map, so adding a
// tab can never leave the route silently falling back to User Management.
const getActiveTabFromPath = (pathname) => {
  const match = settingsTabs.find((tab) => tab.path === pathname);
  return match ? match.id : 'users';
};

export default function SettingsPageModern() {
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState(null);

  const activeTabId = getActiveTabFromPath(location.pathname);
  const activeTabConfig = settingsTabs.find((tab) => tab.id === activeTabId);
  const ActiveComponent = activeTabConfig?.component;

  const handleTabChange = (tabId) => {
    const tab = settingsTabs.find((t) => t.id === tabId);
    if (tab) {
      navigate(tab.path);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Toast message={message} onClose={() => setMessage(null)} />

      {/* Page Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <PageContainer className="py-6">
          <h1 className="text-3xl font-bold text-foreground font-display">Settings</h1>
          <p className="text-secondary-600 mt-2">Manage your CRM configuration and integrations</p>
        </PageContainer>
      </div>

      {/* Settings Tabs and Content */}
      <PageContainer className="py-8">
        <Tabs value={activeTabId} onValueChange={handleTabChange} className="w-full">
          {/* Tabs list - wraps onto multiple rows instead of scrolling
              horizontally, so every tab stays reachable without dragging. */}
          <div className="mb-8">
            <TabsList className="flex flex-wrap w-full h-auto justify-start gap-1">
              {settingsTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.id} value={tab.id} className="whitespace-nowrap">
                    <Icon size={16} className="mr-2" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {/* Only the active panel is mounted; activeTabId always matches. */}
          <TabsContent value={activeTabId} className="mt-0">
            {ActiveComponent && <ActiveComponent onMessage={setMessage} />}
          </TabsContent>
        </Tabs>
      </PageContainer>
    </div>
  );
}

import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Building2, CreditCard, Settings, Users, MessageCircle, PhoneCall, MapPin, Zap, Facebook, Mail, Server } from 'lucide-react';
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
import PaymentsSettings from '../pages/PaymentsSettings.jsx';
import EmailConfigurationSettings from '../pages/EmailConfigurationSettings.jsx';
import EmailTemplatesSettings from '../pages/EmailTemplatesSettings.jsx';
import MessageTemplatesSettings from '../pages/MessageTemplatesSettings.jsx';
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
    id: 'payments',
    path: '/settings/payments',
    label: 'Payments',
    icon: CreditCard,
    component: PaymentsSettings,
  },
  /* The old paths still resolve so existing links keep working; the sidebar
     lists only the combined Payments entry. */
  {
    id: 'payment-forms',
    path: '/settings/payment-forms',
    label: 'Payment Forms',
    icon: Zap,
    component: PaymentsSettings,
  },
  {
    id: 'payment-collections',
    path: '/settings/payment-collections',
    label: 'Payment Collections',
    icon: CreditCard,
    component: PaymentsSettings,
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
    id: 'message-templates',
    path: '/settings/templates',
    label: 'Templates',
    icon: MessageCircle,
    component: MessageTemplatesSettings,
  },
  /*
   * The old per-channel routes still resolve, so existing links and the
   * WhatsApp screen's own deep links keep working. The sidebar lists only the
   * combined Templates entry, so these no longer appear twice in the menu.
   */
  {
    id: 'whatsapp-templates',
    path: '/settings/whatsapp-templates',
    label: 'WhatsApp',
    icon: MessageCircle,
    component: WhatsAppTemplatesSettings,
  },
  {
    id: 'email-templates',
    path: '/settings/email-templates',
    label: 'Email Templates',
    icon: Mail,
    component: EmailTemplatesSettings,
  },
  {
    id: 'email-configuration',
    path: '/settings/email-configuration',
    label: 'Email Configuration',
    icon: Server,
    component: EmailConfigurationSettings,
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
  const [message, setMessage] = useState(null);

  const activeTabId = getActiveTabFromPath(location.pathname);
  const activeTabConfig = settingsTabs.find((tab) => tab.id === activeTabId);
  const ActiveComponent = activeTabConfig?.component;

  return (
    <div className="min-h-screen bg-background">
      <Toast message={message} onClose={() => setMessage(null)} />

      {/* Content starts directly below the universal bar. Which settings
          section is open is shown by the sidebar submenu and the topbar
          breadcrumbs, so no header band is repeated here.

          No padding of its own: every settings screen brings its own, and
          the two were stacking into ~70px of blank band under the topbar --
          twice what the other screens have. The `py-6` that used to be
          passed here never applied above 768px anyway, because
          PageContainer's own `md:py-9` is a media-query variant and wins
          over an unprefixed class whatever the merge order. */}
      <PageContainer variant="full">
        {ActiveComponent && <ActiveComponent onMessage={setMessage} />}
      </PageContainer>
    </div>
  );
}

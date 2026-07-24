import { useState } from 'react';
import IntegrationHubRedesigned from './IntegrationHubRedesigned';
import IntegrationDetailsPage from './IntegrationDetailsPage';
import WhatsAppWorkspace from './WhatsAppWorkspace';
import TemplateManagementPage from './TemplateManagementPage';

export default function IntegrationHub() {
  const [view, setView] = useState('hub'); // 'hub' | 'details' | 'workspace' | 'templates'
  const [selectedIntegration, setSelectedIntegration] = useState(null);

  const handleSelectIntegration = (integration) => {
    setSelectedIntegration(integration);
    setView('details');
  };

  const handleOpenWhatsAppWorkspace = () => {
    setView('workspace');
  };

  const handleOpenTemplates = () => {
    setView('templates');
  };

  const handleBack = () => {
    setView('hub');
    setSelectedIntegration(null);
  };

  if (view === 'details' && selectedIntegration) {
    return <IntegrationDetailsPage integrationId={selectedIntegration.id} onBack={handleBack} />;
  }

  if (view === 'workspace') {
    return <WhatsAppWorkspace onBack={handleBack} />;
  }

  if (view === 'templates') {
    return <TemplateManagementPage onBack={handleBack} />;
  }

  return (
    <IntegrationHubRedesigned
      onSelectIntegration={handleSelectIntegration}
      onOpenWorkspace={handleOpenWhatsAppWorkspace}
      onOpenTemplates={handleOpenTemplates}
    />
  );
}

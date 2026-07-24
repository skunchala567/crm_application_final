import { useState } from 'react';
import { Settings, Users, ClipboardList, X, BookOpen, Calendar } from 'lucide-react';
import UserManagementPage from './UserManagementPage.jsx';
import LeadConfiguration from './LeadConfiguration.jsx';
import AdmissionClassConfiguration from './AdmissionClassConfiguration.jsx';
import AcademicYearsConfiguration from './AcademicYearsConfiguration.jsx';

const settingsTabs = [
  { id: 'users', label: 'User Management', icon: Users, component: UserManagementPage },
  { id: 'config', label: 'Lead Configuration', icon: ClipboardList, component: LeadConfiguration },
  { id: 'academic-years', label: 'Academic Years', icon: Calendar, component: AcademicYearsConfiguration },
  { id: 'admission', label: 'Admission Classes', icon: BookOpen, component: AdmissionClassConfiguration },
];

export default function SettingsPage(){
  const [activeTab, setActiveTab] = useState('users');
  const [message, setMessage] = useState(null);

  const activeTabConfig = settingsTabs.find(tab => tab.id === activeTab);
  const ActiveComponent = activeTabConfig?.component;

  return (
    <div className="settings-page-container">
      <aside className="settings-sidebar">
        <div className="settings-header">
          <Settings size={20} />
          <h2>Settings</h2>
        </div>
        <nav className="settings-nav">
          {settingsTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-main">
        {message && (
          <div className={`notice ${message.type}`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {ActiveComponent && <ActiveComponent onMessage={setMessage} />}
      </main>

      <style>{`
        .settings-page-container {
          display: grid;
          grid-template-columns: 250px 1fr;
          min-height: calc(100vh - 68px);
          background: var(--canvas);
        }

        .settings-sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding: 20px;
          position: sticky;
          top: 68px;
          height: calc(100vh - 68px);
          overflow-y: auto;
        }

        .settings-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 18px;
        }

        .settings-header h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 600;
          color: var(--ink);
        }

        .settings-header svg {
          color: var(--primary);
          flex: none;
          width: 18px;
          height: 18px;
          min-width: 18px;
          max-width: 18px;
          margin: 0;
          padding: 0;
          stroke-width: 2;
        }

        .settings-nav {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .settings-nav-item {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          height: 48px;
          min-height: 48px;
          gap: 12px;
          padding: 0 18px;
          border: 0;
          border-left: 4px solid transparent;
          background: transparent;
          color: #55576d;
          border-radius: 10px;
          cursor: pointer;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.2;
          transition: all 0.2s ease;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .settings-nav-item span {
          display: flex;
          align-items: center;
          line-height: 1;
        }

        .settings-nav-item:hover {
          background: #f8fafc;
          color: #2f3a5f;
          border-left-color: transparent;
        }

        .settings-nav-item.active {
          background: #eef2ff;
          color: var(--primary);
          font-weight: 600;
          border-left-color: var(--primary);
        }

        .settings-nav-item svg {
          width: 18px;
          min-width: 18px;
          max-width: 18px;
          height: 18px;
          flex-shrink: 0;
          flex-grow: 0;
          stroke-width: 2;
          margin: 0;
          padding: 0;
          display: block;
          vertical-align: middle;
          line-height: 1;
        }

        .settings-main {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          background: var(--canvas);
        }

        .settings-main .notice {
          margin: 20px 30px 16px;
        }

        .settings-main > main {
          flex: 1;
        }

        @media (max-width: 1024px) {
          .settings-page-container {
            grid-template-columns: 220px 1fr;
          }

          .settings-nav-item {
            font-size: 14px;
            padding: 0 14px;
            height: 44px;
            min-height: 44px;
          }

          .settings-nav-item svg {
            width: 16px;
            min-width: 16px;
            max-width: 16px;
            height: 16px;
            margin: 0;
            padding: 0;
          }

          .settings-header h2 {
            font-size: 18px;
          }
        }

        @media (max-width: 760px) {
          .settings-page-container {
            grid-template-columns: 1fr;
          }

          .settings-sidebar {
            border-right: 0;
            border-bottom: 1px solid var(--border);
            position: relative;
            top: 0;
            height: auto;
            padding: 14px 0;
          }

          .settings-nav {
            flex-direction: row;
            overflow-x: auto;
            padding: 0 10px;
            gap: 6px;
          }

          .settings-nav-item {
            flex: none;
            min-width: 0;
            font-size: 11px;
            padding: 8px 10px;
          }

          .settings-nav-item span {
            display: inline;
            white-space: nowrap;
          }

          .settings-header {
            padding: 0 18px 14px;
            margin-bottom: 0;
            display: none;
          }

          .settings-main .notice {
            margin: 14px 14px 12px;
          }
        }
      `}</style>
    </div>
  );
}

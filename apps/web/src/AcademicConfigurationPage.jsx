import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarRange } from 'lucide-react';
import AcademicYearsConfiguration from './AcademicYearsConfiguration.jsx';
import AdmissionClassConfiguration from './AdmissionClassConfiguration.jsx';

const sections = [
  { id: 'years', label: 'Academic Years', icon: CalendarRange },
  { id: 'classes', label: 'Admission Classes', icon: BookOpen },
];

export default function AcademicConfigurationPage({ onMessage, initialSection = 'years', embedded = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const [activeSection, setActiveSection] = useState(
    requestedSection === 'classes' ? 'classes' : initialSection
  );
  const ActiveComponent = activeSection === 'classes'
    ? AdmissionClassConfiguration
    : AcademicYearsConfiguration;

  const content = <>
    {!embedded && <div className="lead-config-head">
      <div>
        <span className="eyebrow">Admissions master data</span>
        <h2>Academic configuration</h2>
        <p>Manage academic years and the classes available for each admissions setup.</p>
      </div>
      <CalendarRange />
    </div>}

    <div className="config-tabs academic-config-tabs" role="tablist" aria-label="Academic configuration sections">
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeSection === id}
          className={activeSection === id ? 'active' : ''}
          onClick={() => {
            setActiveSection(id);
            const next = new URLSearchParams(searchParams);
            if (id === 'classes') next.set('section', 'classes');
            else next.delete('section');
            setSearchParams(next);
          }}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>

    <div className="academic-tab-content" role="tabpanel">
      <ActiveComponent key={activeSection} onMessage={onMessage} />
    </div>
  </>;

  if (embedded) return <section className="academic-config-panel embedded">{content}</section>;
  return (
    <main className="page settings-config-page academic-config-page">
      <section className="panel academic-config-panel">{content}</section>
    </main>
  );
}

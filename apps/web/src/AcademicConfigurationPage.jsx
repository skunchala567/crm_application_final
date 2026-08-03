import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarRange, Layers3, Tags } from 'lucide-react';
import AcademicYearsConfiguration from './AcademicYearsConfiguration.jsx';
import AdmissionClassConfiguration from './AdmissionClassConfiguration.jsx';
import AcademicMasterDataConfiguration from './AcademicMasterDataConfiguration.jsx';

const sections = [
  { id: 'years', label: 'Academic Years', icon: CalendarRange },
  { id: 'curricula', label: 'Curriculum', icon: Layers3 },
  { id: 'admissionTypes', label: 'Admission Types', icon: Tags },
  { id: 'classes', label: 'Admission Classes', icon: BookOpen },
];

export default function AcademicConfigurationPage({ onMessage, initialSection = 'years', embedded = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const initialActiveSection = sections.some(section => section.id === requestedSection)
    ? requestedSection
    : initialSection;
  const [activeSection, setActiveSection] = useState(initialActiveSection);
  const ActiveComponent = activeSection === 'classes'
    ? AdmissionClassConfiguration
    : activeSection === 'curricula' || activeSection === 'admissionTypes'
      ? AcademicMasterDataConfiguration
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
            if (id !== 'years') next.set('section', id);
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
      <ActiveComponent key={activeSection} type={activeSection} onMessage={onMessage} />
    </div>
  </>;

  if (embedded) return <section className="academic-config-panel embedded">{content}</section>;
  return (
    <main className="page settings-config-page academic-config-page">
      <section className="panel academic-config-panel">{content}</section>
    </main>
  );
}

import React, { useMemo, useState } from 'react';
import { hrTemplates, requestTypeLabels } from './hrMockData';

const HrTemplatesTab: React.FC = () => {
  const [selectedTemplateId, setSelectedTemplateId] = useState(hrTemplates[0]?.id ?? '');

  const selectedTemplate = useMemo(
    () => hrTemplates.find((template) => template.id === selectedTemplateId) ?? hrTemplates[0],
    [selectedTemplateId],
  );

  if (!selectedTemplate) {
    return null;
  }

  return (
    <div className="hr-template-layout">
      <div className="hr-template-list" aria-label="Шаблоны документов">
        {hrTemplates.map((template) => (
          <button
            className={`hr-template-item ${template.id === selectedTemplate.id ? 'hr-template-item--active' : ''}`}
            key={template.id}
            type="button"
            aria-pressed={template.id === selectedTemplate.id}
            onClick={() => setSelectedTemplateId(template.id)}
          >
            <strong>{template.title}</strong>
            <span className="hr-badge">{requestTypeLabels[template.type]}</span>
            <time dateTime={template.updatedAt}>{template.updatedAt}</time>
          </button>
        ))}
      </div>

      <article className="hr-template-preview">
        <span className="hr-badge">{requestTypeLabels[selectedTemplate.type]}</span>
        <h3>{selectedTemplate.title}</h3>
        <p>{selectedTemplate.preview}</p>
        <div className="hr-template-preview__variables" aria-label="Переменные шаблона">
          {selectedTemplate.variables.map((variable) => (
            <span className="hr-badge" key={variable}>{variable}</span>
          ))}
        </div>
        <div className="hr-template-preview__actions">
          <button className="button" type="button">Использовать</button>
          <button className="button secondary" type="button">Дублировать</button>
        </div>
      </article>
    </div>
  );
};

export default HrTemplatesTab;

const FORMAT_CHECKS = [
  { id: 'text_body', label: 'Text body variables', test: (row) => Boolean(row.meta_template_name) },
  { id: 'header_text', label: 'Text header', test: (row) => hasComponent(row, 'HEADER', 'TEXT') },
  { id: 'header_image', label: 'Image header', test: (row) => hasComponent(row, 'HEADER', 'IMAGE') },
  { id: 'header_video', label: 'Video header', test: (row) => hasComponent(row, 'HEADER', 'VIDEO') },
  { id: 'header_document', label: 'Document header', test: (row) => hasComponent(row, 'HEADER', 'DOCUMENT') },
  { id: 'url_buttons', label: 'URL buttons', test: (row) => hasButton(row, 'URL') },
  { id: 'quick_reply', label: 'Quick reply buttons', test: (row) => hasButton(row, 'QUICK_REPLY') },
  { id: 'catalog', label: 'Catalog / product', test: (row) => hasButton(row, 'CATALOG') || hasComponent(row, 'CAROUSEL') },
  { id: 'carousel', label: 'Carousel cards', test: (row) => hasComponent(row, 'CAROUSEL') },
  { id: 'authentication', label: 'Authentication OTP', test: (row) => String(row.category || '').toUpperCase() === 'AUTHENTICATION' },
  { id: 'marketing', label: 'Marketing category', test: (row) => String(row.category || '').toUpperCase() === 'MARKETING' }
];

function components(row) {
  const schema = row.component_schema || row.components || {};
  return Array.isArray(schema.components) ? schema.components : Array.isArray(schema) ? schema : [];
}

function hasComponent(row, type, format = '') {
  return components(row).some((item) => {
    const componentType = String(item.type || '').toUpperCase();
    if (componentType !== String(type).toUpperCase()) return false;
    if (!format) return true;
    return String(item.format || '').toUpperCase() === String(format).toUpperCase();
  });
}

function hasButton(row, type) {
  return components(row).some((item) => {
    if (String(item.type || '').toUpperCase() !== 'BUTTONS') return false;
    return (item.buttons || []).some((button) => String(button.type || button.sub_type || '').toUpperCase() === String(type).toUpperCase());
  });
}

export function buildTemplateFormatMatrix(templates = []) {
  const approved = templates.filter((row) => String(row.status || '').toLowerCase() === 'approved');
  const formats = FORMAT_CHECKS.map((check) => {
    const matching = approved.filter((row) => check.test(row));
    return {
      id: check.id,
      label: check.label,
      approvedCount: matching.length,
      sampleTemplateIds: matching.slice(0, 5).map((row) => row.id)
    };
  });
  return {
    totalTemplates: templates.length,
    approvedTemplates: approved.length,
    formats,
    generatedAt: new Date().toISOString()
  };
}

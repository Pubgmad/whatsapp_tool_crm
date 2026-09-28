'use client';

export default function TemplateParameterFields({ template, value, onChange }) {
  const format = String(template?.componentSchema?.headerFormat || 'NONE').toLowerCase();
  const buttons = template?.componentSchema?.buttons || template?.buttons || [];
  const updateButton = (index, type, text) => {
    const remaining = (value.buttons || []).filter((button) => button.index !== index);
    onChange({ ...value, buttons: text ? [...remaining, { index, type, value: text }] : remaining });
  };
  return <>
    {['image', 'video', 'document'].includes(format) && <label>{format === 'document' ? 'Document URL' : format === 'video' ? 'Video URL' : 'Image URL'}<input type='url' required value={value.header?.link || ''} onChange={(event) => onChange({ ...value, header: { type: format, link: event.target.value } })} /></label>}
    {buttons.map((button, index) => {
      const type = String(button.type || '').toLowerCase();
      if (type !== 'copy_code' && !(type === 'url' && /{{\s*\d+\s*}}/.test(button.value || button.url || ''))) return null;
      return <label key={index}>{button.text || `Button ${index + 1}`}<input required value={(value.buttons || []).find((item) => item.index === index)?.value || ''} onChange={(event) => updateButton(index, type, event.target.value)} /></label>;
    })}
  </>;
}

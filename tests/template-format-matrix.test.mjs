import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTemplateFormatMatrix } from '../lib/template-format-matrix.js';

test('buildTemplateFormatMatrix summarizes approved template capabilities', () => {
  const matrix = buildTemplateFormatMatrix([
    {
      id: 't1',
      status: 'Approved',
      category: 'MARKETING',
      meta_template_name: 'promo',
      component_schema: {
        components: [
          { type: 'HEADER', format: 'IMAGE' },
          { type: 'BODY' },
          { type: 'BUTTONS', buttons: [{ type: 'URL' }] }
        ]
      }
    }
  ]);
  assert.equal(matrix.approvedTemplates, 1);
  assert.ok(matrix.formats.find((item) => item.id === 'header_image').approvedCount === 1);
  assert.ok(matrix.formats.find((item) => item.id === 'url_buttons').approvedCount === 1);
});

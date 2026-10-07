import fs from 'node:fs';

const src = fs.readFileSync('lib/actions.js', 'utf8');
const lines = src.split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const mappersBody = `${slice(1664, 1704)}\n\n${slice(1705, 1914)}`;

const mappersHeader = `import { toIso } from '../db.js';
import { publicMetaHealth } from '../meta-health.js';
import { okToReply } from '../reply-window.js';

`;

const mappersOut = mappersBody
  .replace(/^function /gm, (match, offset, str) => (str.slice(offset).startsWith('export function') ? match : 'export function '))
  .replace(/export function function /g, 'export function ');
fs.writeFileSync('lib/workspace-mappers.js', mappersHeader + mappersOut);

const stateBody = slice(1124, 1149) + '\n' + slice(1170, 1460)
  .replace('const WORKSPACE_VIEWS', 'export const WORKSPACE_VIEWS')
  .replace('function stateOptions', 'export function stateOptions')
  .replace('function pageMeta', 'function pageMeta')
  .replace('async function loadState', 'export async function loadState');

const stateHeader = `import { query, toIso } from './db.js';
import { subscriptionUsage } from './limits.js';
import { getPublicPlatformConfig } from './platform.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { listAudienceSegments } from './segments.js';
import { getWhatsAppOperationsState } from './whatsapp-operations.js';
import { listAutomationFlows } from './automation.js';
import { campaignReportStatus } from './campaign-controls.js';
import {
  mapCampaign,
  mapContact,
  mapConversation,
  mapMessage,
  mapRecipient,
  mapSetup,
  mapTemplate,
  campaignStats,
  clean
} from './workspace-mappers.js';
import { okToReply } from './reply-window.js';

`;

fs.writeFileSync('lib/workspace-state.js', stateHeader + stateBody);

const queueBody = slice(628, 867).replace('export async function runCampaignQueue', 'export async function runCampaignQueue');

const queueHeader = `import { validateTemplateParameters } from './template-send-components.js';
import { resolveTrackedParameters } from './click-tracking.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { campaignDispatchState, updateCampaignCompletion } from './campaign-queue-safety.js';
import { reserveCampaignDelivery } from './campaign-controls.js';
import { metaReady, sendMarketingTemplateMessage, sendTemplateMessage, templateApiName } from './meta.js';
import { assertMessageCapacity } from './limits.js';
import { AppError, id, query, transaction } from './db.js';
import { clean } from './workspace-mappers.js';

`;

fs.writeFileSync('lib/campaign-queue-runner.js', queueHeader + queueBody);

let next = src;
// Remove workspace state block
next = next.replace(slice(1124, 1460) + '\n', '');
// Remove campaign queue block (keep processCampaignQueue exports that call runCampaignQueue)
next = next.replace(slice(628, 719) + '\n', '');
next = next.replace(slice(721, 867) + '\n', '');

// Remove mapper block at end (keep templateVariables exports area - check)
const mapperEnd = slice(1664, 1914);
next = next.replace(mapperEnd + '\n', '');

// Add imports after existing imports block (after line 32)
const importBlock = `import { loadState, stateOptions, WORKSPACE_VIEWS } from './workspace-state.js';
import { runCampaignQueue } from './campaign-queue-runner.js';
import {
  clean,
  cleanPhone,
  mapTemplate,
  mapContact,
  mapCampaign,
  mapRecipient,
  mapMessage,
  mapSetup,
  campaignStats,
  renderTemplate,
  templateVariables,
  normalizeTags,
  normalizeAttributes,
  parseCsvRows,
  csvCell,
  permissionFromCell,
  isHeaderRow,
  normalizeTemplateStatus,
  templateComponentsFromMeta,
  normalizeTemplateButtons
} from './workspace-mappers.js';
`;

if (!next.includes('workspace-state.js')) {
  next = next.replace(
    "import { pushOutboundCrmContact } from './crm-contact-export.js';",
    `import { pushOutboundCrmContact } from './crm-contact-export.js';\n${importBlock}`
  );
}

// Re-export for API routes
if (!next.includes('export { mapTemplate')) {
  next += `\nexport { mapTemplate, campaignStats, templateVariables, renderTemplate } from './workspace-mappers.js';\n`;
}

// parseCsvRows etc need to be in mappers - add to mappers file
const csvHelpers = slice(1824, 1883);
fs.appendFileSync('lib/workspace-mappers.js', '\n' + csvHelpers.replace(/^function /gm, 'export function '));

fs.writeFileSync('lib/actions.js', next);
console.log('split complete');

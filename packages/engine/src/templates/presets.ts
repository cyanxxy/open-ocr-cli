import type { ExtractionPreset, ExtractionRule } from '../gemini/types';

export const EXTRACTION_PRESETS: ExtractionPreset[] = [
  {
    id: 'invoice',
    label: 'Invoice',
    description: 'Extract billing details and line items.',
    outputShape: 'table',
    tableColumns: ['description', 'quantity', 'unit_price', 'line_total'],
    rules: [
      { id: 'invoice_number', field: 'invoice_number', description: 'Unique invoice identifier.', type: 'text', required: true, example: 'INV-2026-0142' },
      { id: 'invoice_date', field: 'invoice_date', description: 'Invoice issue date.', type: 'date', required: true, example: '2026-02-18' },
      { id: 'due_date', field: 'due_date', description: 'Payment due date if present.', type: 'date', example: '2026-03-20' },
      { id: 'vendor_name', field: 'vendor_name', description: 'Vendor or supplier name.', type: 'text', required: true, example: 'Northwind Supply Co.' },
      { id: 'customer_name', field: 'customer_name', description: 'Customer or billed company name.', type: 'text', example: 'Acme Logistics' },
      // audit T-03: currency identifier (USD/EUR/£) is text, not a monetary amount.
      // The numeric 'currency' type is reserved for subtotal/tax/total below.
      { id: 'currency', field: 'currency', description: 'Currency code or symbol used in totals.', type: 'text', example: 'USD' },
      { id: 'subtotal', field: 'subtotal', description: 'Subtotal before tax or fees.', type: 'currency', example: '1250.00' },
      { id: 'tax', field: 'tax', description: 'Tax amount.', type: 'currency', example: '112.50' },
      { id: 'total', field: 'total', description: 'Grand total due.', type: 'currency', required: true, example: '1362.50' },
    ],
  },
  {
    id: 'receipt',
    label: 'Receipt',
    description: 'Extract merchant details, totals, and purchased items.',
    outputShape: 'table',
    tableColumns: ['item', 'quantity', 'price'],
    rules: [
      { id: 'merchant_name', field: 'merchant_name', description: 'Primary merchant or store name.', type: 'text', required: true, example: 'Market Street Grocer' },
      { id: 'transaction_date', field: 'transaction_date', description: 'Receipt purchase date.', type: 'date', required: true, example: '2026-01-12' },
      { id: 'transaction_time', field: 'transaction_time', description: 'Receipt purchase time if shown.', type: 'text', example: '14:22' },
      { id: 'receipt_number', field: 'receipt_number', description: 'Receipt or transaction identifier.', type: 'text', example: 'R-44219' },
      { id: 'payment_method', field: 'payment_method', description: 'Payment method or card type.', type: 'text', example: 'Visa' },
      { id: 'subtotal', field: 'subtotal', description: 'Subtotal before tax.', type: 'currency', example: '24.89' },
      { id: 'tax', field: 'tax', description: 'Tax amount.', type: 'currency', example: '2.11' },
      { id: 'total', field: 'total', description: 'Final amount paid.', type: 'currency', required: true, example: '27.00' },
    ],
  },
  {
    id: 'resume',
    label: 'Resume',
    description: 'Extract contact details, skills, experience, and education.',
    outputShape: 'record',
    rules: [
      { id: 'full_name', field: 'full_name', description: 'Candidate full name.', type: 'text', required: true, example: 'Jordan Lee' },
      { id: 'email', field: 'email', description: 'Primary email address.', type: 'email', required: true, example: 'jordan@example.com' },
      { id: 'phone', field: 'phone', description: 'Primary phone number.', type: 'phone', example: '+31 6 12345678' },
      { id: 'location', field: 'location', description: 'Current city or location.', type: 'text', example: 'Amsterdam, NL' },
      { id: 'headline', field: 'headline', description: 'Professional headline or target role.', type: 'text', example: 'Senior Product Designer' },
      { id: 'skills', field: 'skills', description: 'Top technical or domain skills.', type: 'list', example: 'Figma, Design Systems, Research' },
      { id: 'experience_highlights', field: 'experience_highlights', description: 'Concise highlights from recent experience.', type: 'list', example: 'Led redesign, improved conversion' },
      { id: 'education', field: 'education', description: 'Primary education credential.', type: 'text', example: 'BSc Industrial Design' },
    ],
  },
  {
    id: 'business-card',
    label: 'Business Card',
    description: 'Extract names, roles, companies, and contact details.',
    outputShape: 'record',
    rules: [
      { id: 'full_name', field: 'full_name', description: 'Contact full name.', type: 'text', required: true, example: 'Nina Patel' },
      { id: 'job_title', field: 'job_title', description: 'Role or job title.', type: 'text', example: 'Account Executive' },
      { id: 'company', field: 'company', description: 'Company or organization name.', type: 'text', required: true, example: 'Orbit Partners' },
      { id: 'email', field: 'email', description: 'Business email address.', type: 'email', example: 'nina@orbitpartners.com' },
      { id: 'phone', field: 'phone', description: 'Primary phone number.', type: 'phone', example: '+1 (555) 123-9876' },
      { id: 'website', field: 'website', description: 'Company or personal website.', type: 'url', example: 'https://orbitpartners.com' },
      { id: 'address', field: 'address', description: 'Postal or office address.', type: 'text', example: '12 Harbor Ave, Boston, MA' },
    ],
  },
];

const presetMap = new Map(EXTRACTION_PRESETS.map((preset) => [preset.id, preset]));

export function getExtractionPreset(presetId: string): ExtractionPreset {
  const preset = presetMap.get(presetId);
  if (!preset) {
    throw new Error(`Unknown extraction preset: ${presetId}`);
  }
  return preset;
}

/**
 * Return the shipped extraction presets as a readonly snapshot. We deep-clone
 * (preset + nested rules/columns) and freeze so callers cannot mutate the live
 * module-level array or share aliased preset objects. See audit T-07.
 */
export function listExtractionPresets(): readonly ExtractionPreset[] {
  return Object.freeze(
    EXTRACTION_PRESETS.map((preset) =>
      Object.freeze({
        ...preset,
        rules: Object.freeze(preset.rules.map((rule) => Object.freeze({ ...rule }))) as ExtractionRule[],
        tableColumns: preset.tableColumns
          ? (Object.freeze([...preset.tableColumns]) as string[])
          : undefined,
      }),
    ),
  );
}

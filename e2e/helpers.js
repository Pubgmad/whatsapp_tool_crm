/** Post-login marketing home exposes multiple identical CTAs; target the hero banner. */
export function postLoginConnectWhatsApp(page) {
  return page.getByRole('banner').getByRole('link', { name: 'Connect WhatsApp' });
}

/** Post-login marketing header primary action (workspace entry — not Meta connect). */
export function postLoginConnectWhatsApp(page) {
  return page.getByRole('banner').getByRole('link', { name: /Open workspace|Get started/i });
}

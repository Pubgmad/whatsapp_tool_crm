-- Fix Meta error 2388293: library bodies had too many variables for their length.
UPDATE template_library_items SET body = v.body, updated_at = NOW()
FROM (VALUES
  ('welcome_offer', 'Hi {{1}}, welcome to {{2}}! As a thank-you for joining us, enjoy {{3}} off your first order when you use code {{4}} at checkout. Reply if you need help finding a product.'),
  ('abandoned_cart', 'Hi {{1}}, you still have {{2}} waiting in your cart. Complete checkout soon so your items stay reserved before they sell out.'),
  ('flash_sale', 'Hi there — our {{1}} sale is live now. Save up to {{2}} on selected items until {{3}}. Tap below to browse deals before the offer ends.'),
  ('appointment_confirm', 'Hi {{1}}, thank you for booking with us. Your appointment on {{2}} at {{3}} is confirmed. Please arrive a few minutes early at {{4}}. Reply to this chat if you need to reschedule or cancel.'),
  ('appointment_reminder', 'Hi {{1}}, this is a friendly reminder that your appointment is tomorrow at {{2}}. Please reply YES to confirm you are still coming, or ask us to reschedule.'),
  ('order_shipped', 'Hi {{1}}, good news — order {{2}} has shipped. You can follow delivery progress using tracking code {{3}}. Reply here if you need help with your shipment.'),
  ('order_delivered', 'Hi {{1}}, order {{2}} was marked as delivered. We hope everything arrived safely — how was your experience with this order?'),
  ('payment_due', 'Hi {{1}}, this is a reminder that payment of {{2}} for invoice {{3}} is due on {{4}}. Please complete payment on time to avoid late fees, or reply if you need help.'),
  ('support_followup', 'Hi {{1}}, we are checking in on support ticket {{2}}. Has everything been resolved on your side, or do you still need help from our team?'),
  ('lead_nurture', 'Hi {{1}}, thanks for your interest in {{2}}. Would you like a quick walkthrough with our team this week so we can answer your questions?'),
  ('event_invite', 'Hi {{1}}, you are invited to join {{2}} on {{3}}. Seats are limited, so please confirm soon if you would like to attend.'),
  ('feedback_request', 'Hi {{1}}, thank you for choosing us recently. How did we do overall? Please reply with a score from 1 to 5 so we can improve.'),
  ('reengagement', 'Hi {{1}}, we miss seeing you at {{2}}. Here is {{3}} off your next visit when you come back — we would love to welcome you again.'),
  ('shipping_delay', 'Hi {{1}}, we are sorry — order {{2}} is delayed. The new estimated arrival is {{3}}. Please reply if you need support while you wait.')
) AS v(slug, body)
WHERE template_library_items.slug = v.slug;

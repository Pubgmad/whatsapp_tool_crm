-- Fix Meta error 2388293: fewer variables + longer fixed text (stricter than prior pass).
UPDATE template_library_items SET body = v.body, updated_at = NOW()
FROM (VALUES
  ('welcome_offer', 'Hi {{1}}, welcome to {{2}}! Thank you for joining our community. Enjoy a first-order discount when you use code {{3}} at checkout. Reply to this chat if you need help finding a product or applying the offer.'),
  ('abandoned_cart', 'Hi {{1}}, you still have items waiting in your cart, including {{2}}. Complete checkout soon so your selection stays reserved before popular products sell out. Reply if you have any questions about sizing or shipping.'),
  ('flash_sale', 'Hi there — our {{1}} sale is live now. Save up to {{2}} on selected items until {{3}}. Tap below to browse deals before the limited-time offer ends, and reply if you need product recommendations.'),
  ('appointment_confirm', 'Hi {{1}}, thank you for booking with us. Your appointment is confirmed for {{2}}. Please arrive a few minutes early at {{3}}. If you need to reschedule or cancel, reply to this chat and our team will help you.'),
  ('appointment_reminder', 'Hi {{1}}, this is a friendly reminder that your appointment is tomorrow at {{2}}. Please reply YES to confirm you are still coming, or tell us if you need to reschedule so we can update your booking.'),
  ('order_shipped', 'Hi {{1}}, good news — your order {{2}} has shipped. You can follow delivery progress with tracking code {{3}}. Reply here if the package is delayed or you need help with your shipment.'),
  ('order_delivered', 'Hi {{1}}, your order {{2}} was marked as delivered. We hope everything arrived safely. How was your experience with this order? Reply with any feedback or support questions.'),
  ('payment_due', 'Hi {{1}}, this is a reminder that payment of {{2}} for invoice {{3}} is due soon. Please complete payment on time to avoid late fees, or reply to this chat if you need help with billing.'),
  ('support_followup', 'Hi {{1}}, we are checking in on support ticket {{2}}. Has everything been resolved on your side, or do you still need help from our team? Reply with an update and we will continue assisting you.'),
  ('lead_nurture', 'Hi {{1}}, thanks for your interest in {{2}}. Would you like a quick walkthrough with our team this week so we can answer your questions? Reply with a time that works for you.'),
  ('event_invite', 'Hi {{1}}, you are invited to join {{2}} on {{3}}. Seats are limited, so please confirm soon if you would like to attend. Reply to this message and we will reserve your place.'),
  ('feedback_request', 'Hi {{1}}, thank you for choosing us recently. How did we do overall? Please reply with a score from 1 to 5 so we can keep improving our service for customers like you.'),
  ('reengagement', 'Hi {{1}}, we miss seeing you at {{2}}. Here is a welcome-back offer of {{3}} off your next visit. We would love to welcome you again — reply if you want help redeeming the offer.'),
  ('shipping_delay', 'Hi {{1}}, we are sorry — order {{2}} is delayed. The new estimated arrival is {{3}}. Please reply if you need support while you wait, and thank you for your patience.')
) AS v(slug, body)
WHERE template_library_items.slug = v.slug;

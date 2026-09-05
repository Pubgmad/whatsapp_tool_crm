WhatsApp Marketing Tool - V1
Beginner Functional Plan for Fresh Coders
Goal
Build a simple standalone tool that lets each buyer connect their own WhatsApp Business account 
and phone number, run marketing campaigns, receive customer messages, and reply from inside the 
tool.
1. What are we building?
The business should be able to: connect its WhatsApp number -> add customers -> create 
marketing messages -> send campaigns -> see delivery results -> receive customer replies -> reply 
from our tool.
2. Main Screens We Need
- WhatsApp Setup
- Contacts
- Templates
- Campaigns
- Campaign Results
- Inbox
- Unsubscribe Management
3. WhatsApp Setup
This screen connects the buyer's own WhatsApp Business account to our tool.
-
-
-
-
-
-
Meta Business Portfolio: Represents the buyer's company on Meta.
WhatsApp Business Account: The buyer's company WhatsApp setup.
Business phone number: The WhatsApp number customers will see.
Phone Number ID: Meta's internal identifier for that phone number.
WhatsApp Business Account ID: Meta's internal identifier for the WhatsApp account.
Access Token: A secret key that allows our software to communicate with Meta.
Example setup status
WhatsApp Number: +91 98765 43210
Business: Customer Business
Status: Connected
4. Contacts
The buyer adds customers who may receive messages.
Name
Phone
John
+91 98...
Marketing Permission
Yes
Ahmed
+91 97...
Yes
Rahul
+91 96...
No
- Add customers manually.
- Upload customers from a spreadsheet.
- Remove customers.
- Mark customers as unsubscribed.
Important rule
Only send marketing messages to customers who have agreed to receive them.
5. Message Templates
Marketing messages started by the business must use an approved message template.
Example template - Weekend Sale
Hi {{name}},
We have a 20% discount this weekend.
Visit our store today.
Template flow:
Create in our tool
Send to Meta
Pending review
Approved / Rejected
Create in our tool  ->  Send to Meta  ->  Pending review  ->  Approved / Rejected
Rule
Only templates marked Approved should be available when creating a marketing campaign.
6. Campaigns
This is the main marketing feature. The buyer clicks Create Campaign and follows these steps:
1. Give the campaign a name - Example: Diwali Sale 2026
2. Select customers - Example: 2,450 customers selected
3. Select an approved template - Example: Diwali Discount
4. Fill changing values - Example: {{name}} and {{discount}}
5. Preview the final message - Check exactly what customers will receive
6. Send the campaign - Our tool asks Meta to send the messages from the buyer's WhatsApp 
number
Variable example
Template: Hi {{name}}, get {{discount}} off today.
For John: Hi John, get 20% off today.
7. Campaign Results
After sending, show clear results for the campaign.
Result
Example Count
Total
2,450
Sent
2,430
Delivered
2,380
Read
1,920
Failed
20
Beginner mental model
Our tool sends the message -> Meta delivers it -> Meta tells our tool what happened -> our campaign 
screen updates.
8. Inbox
The inbox should feel similar to WhatsApp Web: conversations on the left, selected conversation on 
the right.
Example conversation
John: Is this offer available tomorrow?
Business: Yes, it is available until Sunday.
John: Great, thanks.
- Show incoming customer messages.
- Open the full conversation.
- Allow the buyer to type and send a reply when normal replies are allowed.
- Keep the conversation history visible.
9. Replying to Customers
When a customer messages the business, a 24-hour normal reply period begins from the customer's 
latest message.
Within 24 hours
The business can reply using normal messages. No approved template is required.
After 24 hours
Normal replies should be blocked. Show a message such as: "Normal reply period expired. Select an 
approved template to contact this customer."
10. Unsubscribe Management
If a customer asks to stop receiving marketing messages, the business must stop sending marketing 
campaigns to that customer.
Example
Customer sends: STOP
Our tool changes: Marketing Permission = No
Result: Never include that customer in future marketing campaigns.
11. What Happens Behind the Scenes
Fresh coders only need to remember these three simple flows:
Sending a message
Our Tool
Meta
WhatsApp
Our Tool  ->  Meta  ->  WhatsApp  ->  Customer
Receiving a message
Customer
Customer
WhatsApp
Meta
Our Tool
Customer  ->  WhatsApp  ->  Meta  ->  Our Tool  ->  Inbox
Inbox
Delivery updates
Sent
Read
Meta
Delivered
Campaign Screen
Meta  ->  Sent  ->  Delivered  ->  Read  ->  Campaign Screen
12. V1 Modules
Keep V1 focused on exactly these modules:
- WhatsApp Setup
- Contacts
- Templates
- Campaigns
- Campaign Results
- Inbox
- Reply to Customer
- Unsubscribe Management
V1 scope
This is enough for a real standalone WhatsApp marketing and customer messaging tool. Do not add 
software-as-a-service features yet.
13. One Decision Before the Actual Build
Because each buyer will use their own Meta account and WhatsApp number, choose one onboarding 
method:
Option A - Manual Setup
Option B - Self-Service Connection
You or your developer helps each buyer 
connect their Meta account when installing 
the standalone software.
The buyer clicks Connect WhatsApp, signs into 
Meta, selects their business and phone 
number, and our software connects it.
Next step
Choose Option A or Option B before defining the module-by-module build order for the fresh coders.
Reference
Functional rules in this plan are based on Meta's official WhatsApp Business Platform documentation and WhatsApp 
Business Messaging Policy.

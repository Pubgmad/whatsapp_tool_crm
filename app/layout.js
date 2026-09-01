import "./globals.css";

export const metadata = {
  title: "WhatsApp Growth Desk",
  description: "Production-ready WhatsApp CRM for campaigns, inbox, suppression, and Meta Cloud API workflows"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

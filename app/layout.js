import "./globals.css";

export const metadata = {
  title: "WhatsApp Growth Desk",
  description: "Dynamic WhatsApp marketing campaign and inbox prototype"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

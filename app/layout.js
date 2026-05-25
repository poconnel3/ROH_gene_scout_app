import "./globals.css";

export const metadata = {
  title: "ROH-to-OMIM Recessive Gene Finder",
  description: "Extract hg19 ROH intervals from pasted CMA report text and find recessive disease genes with OMIM identifiers, including chrX."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

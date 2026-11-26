import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { paperSizeFromPoints } from '@/lib/document-paper-size';

export const physicalPdfPaperSizes = async (bytes: Buffer): Promise<Array<string | null>> => {
  const sizes: Array<string | null> = [];
  try {
    // This PDF.js version expects typed-array copy semantics; Buffer.slice()
    // creates a shared view and can produce spurious cross-reference errors.
    const result = await pdfParse(new Uint8Array(bytes), { pagerender: async (page: { userUnit?: number; getViewport: (scale: number) => { width: number; height: number } }) => {
      const viewport = page.getViewport(1);
      sizes.push(paperSizeFromPoints(viewport.width * (page.userUnit ?? 1), viewport.height * (page.userUnit ?? 1)));
      return '';
    } });
    return sizes.length === result.numpages ? sizes : [];
  } catch { return []; }
};

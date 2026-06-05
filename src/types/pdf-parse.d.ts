declare module 'pdf-parse' {
  type PdfParseOptions = {
    max?: number;
  };

  type PdfParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  };

  export default function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
}

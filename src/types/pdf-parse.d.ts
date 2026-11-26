declare module 'pdf-parse' {
  type PdfParseOptions = {
    max?: number;
    pagerender?: (page: { userUnit?: number; getViewport(scale: number): { width: number; height: number } }) => Promise<string>;
  };

  type PdfParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  };

  export default function pdfParse(dataBuffer: Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  type PdfParseOptions = {
    max?: number;
    pagerender?: (page: { userUnit?: number; getViewport(scale: number): { width: number; height: number } }) => Promise<string>;
  };

  type PdfParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  };

  export default function pdfParse(dataBuffer: Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
}

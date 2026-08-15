export type XeroTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type XeroTenant = {
  id: string;
  authEventId?: string;
  tenantId: string;
  tenantType?: string;
  tenantName: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
};

export type XeroContact = {
  ContactID?: string;
  ContactStatus?: string;
  Name?: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  AccountNumber?: string;
  IsCustomer?: boolean;
  UpdatedDateUTC?: string;
};

export type XeroInvoice = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Reference?: string;
  Type?: string;
  Status?: string;
  CurrencyCode?: string;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  SubTotal?: number | string;
  TotalTax?: number | string;
  Total?: number | string;
  AmountPaid?: number | string;
  AmountDue?: number | string;
  UpdatedDateUTC?: string;
  Contact?: { ContactID?: string; Name?: string };
};

export type XeroPayment = {
  PaymentID?: string;
  Date?: string;
  Amount?: number | string;
  Status?: string;
  PaymentType?: string;
  UpdatedDateUTC?: string;
  Invoice?: { InvoiceID?: string; Type?: string; CurrencyCode?: string } | [];
};

export type XeroReportCell = { Value?: string; Attributes?: Array<{ Id?: string; Value?: string }> };
export type XeroReportRow = { RowType?: string; Title?: string; Cells?: XeroReportCell[]; Rows?: XeroReportRow[] };
export type XeroReport = {
  ReportID?: string;
  ReportName?: string;
  ReportType?: string;
  ReportTitles?: string[];
  ReportDate?: string;
  UpdatedDateUTC?: string;
  Rows?: XeroReportRow[];
};

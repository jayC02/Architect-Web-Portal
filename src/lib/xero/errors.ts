import { HttpError } from '@/lib/utils/http';

export class XeroNotConnected extends HttpError {
  constructor() { super(409, 'Connect Xero before using finance data.'); }
}

export class XeroReconnectRequired extends HttpError {
  constructor() { super(409, 'Xero needs to be reconnected.'); }
}

export class XeroOAuthStateInvalid extends HttpError {
  constructor() { super(400, 'The Xero connection request is invalid or has expired.'); }
}

export class XeroTenantConflict extends HttpError {
  constructor() { super(409, 'The selected Xero organisation is not available for this connection.'); }
}

export class XeroSyncInProgress extends HttpError {
  constructor() { super(409, 'A Xero sync is already in progress.'); }
}

export class XeroRateLimited extends HttpError {
  constructor(public readonly retryAfterSeconds?: number) {
    super(429, retryAfterSeconds
      ? `Xero is temporarily rate limited. Try again in ${retryAfterSeconds} seconds.`
      : 'Xero is temporarily rate limited. Please try again shortly.');
  }
}

export class XeroSyncFailed extends HttpError {
  constructor(message = 'Xero sync failed. Previously synced finance data has been preserved.') {
    super(502, message);
  }
}

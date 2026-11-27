import { defineMiddleware } from 'astro:middleware';
import { getSessionAuth } from '@/lib/auth/session';
import { classifyPath, isApiPath } from '@/lib/server/access-paths';
import { jsonResponse } from '@/lib/utils/http';
import { resolveEntitlement, SUBSCRIPTION_REQUIRED_CODE } from '@/server/billing/entitlement';

// Server-side gate for every page and API route. A signed-in user only reaches
// the product while their organisation is paid up, trialing or comped.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();
  const { pathname, search } = context.url;
  const access = classifyPath(pathname);
  if (access === 'public' || access === 'self') return next();

  const auth = await getSessionAuth(context);
  if (!auth) {
    if (isApiPath(pathname)) return jsonResponse(401, { error: 'Authentication required.', details: null });
    return context.redirect(`/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`);
  }

  const entitlement = resolveEntitlement(auth.organisation.subscription);
  context.locals.entitlement = entitlement;
  if (access === 'session' || entitlement.allowed) return next();

  if (isApiPath(pathname)) {
    return jsonResponse(402, { error: entitlement.reason, details: { code: SUBSCRIPTION_REQUIRED_CODE } });
  }
  return context.redirect('/billing');
});

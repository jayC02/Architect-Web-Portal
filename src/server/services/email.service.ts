import { absoluteUrl } from '@/lib/config';

const getEmailConfig = () => ({
  apiKey: import.meta.env?.RESEND_API_KEY || process.env.RESEND_API_KEY,
  from:
    import.meta.env?.AUTH_EMAIL_FROM ||
    process.env.AUTH_EMAIL_FROM ||
    'ArchitectPro <no-reply@architectpro.co.uk>',
});

export const sendPasswordResetEmail = async (to: string, token: string) => {
  const { apiKey, from } = getEmailConfig();
  if (!apiKey) throw new Error('Password reset email delivery is not configured.');

  const configuredBase =
    import.meta.env?.APP_BASE_URL || process.env.APP_BASE_URL || undefined;
  const resetUrl = configuredBase
    ? new URL(`/reset-password?token=${encodeURIComponent(token)}`, configuredBase).toString()
    : absoluteUrl(`/reset-password?token=${encodeURIComponent(token)}`);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Reset your ArchitectPro password',
      text: `Use this secure link to reset your ArchitectPro password: ${resetUrl}\n\nThis link expires in 45 minutes. If you did not request it, you can ignore this email.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f211d;max-width:560px;margin:0 auto">
          <h1 style="font-size:24px;margin:0 0 16px">Reset your password</h1>
          <p>Use the secure button below to choose a new ArchitectPro password.</p>
          <p style="margin:28px 0">
            <a href="${resetUrl}" style="display:inline-block;background:#1f211d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Reset password</a>
          </p>
          <p style="color:#6f6b63;font-size:14px">This link expires in 45 minutes. If you did not request it, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) throw new Error('Password reset email delivery failed.');
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

const sendEmail = async (to: string[], subject: string, text: string, html: string) => {
  const { apiKey, from } = getEmailConfig();
  if (!apiKey || !to.length) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!response.ok) throw new Error('Email delivery failed.');
  return true;
};

// Best-effort: tells platform admins a demo request is waiting for review.
export const sendAccessRequestNotification = async (
  to: string[],
  request: { name: string; email: string; practiceName: string; plan?: string | null; message?: string | null },
) => {
  const reviewUrl = absoluteUrl('/admin/access');
  const summary = `${request.name} (${request.email}) from ${request.practiceName} requested a demo${request.plan ? ` of the ${request.plan} plan` : ''}.`;
  return sendEmail(
    to,
    `Demo request: ${request.practiceName}`,
    `${summary}\n\n${request.message ?? ''}\n\nReview it: ${reviewUrl}`,
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f211d;max-width:560px">
      <p>${escapeHtml(summary)}</p>
      ${request.message ? `<blockquote style="border-left:3px solid #ddd;margin:0;padding-left:12px;color:#555">${escapeHtml(request.message)}</blockquote>` : ''}
      <p><a href="${reviewUrl}">Review access requests</a></p>
    </div>`,
  );
};

// An invitation to join a practice's workspace.
export const sendTeamInviteEmail = async (to: string, input: { practiceName: string; invitedBy: string; inviteUrl: string }) => sendEmail(
  [to],
  `${input.invitedBy} invited you to ${input.practiceName} on Architect Pro`,
  `${input.invitedBy} has invited you to join ${input.practiceName} on Architect Pro.

Create your account with this link:
${input.inviteUrl}

The link is for ${to} only and expires in 14 days.`,
  `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f211d;max-width:560px;margin:0 auto">
    <h1 style="font-size:22px;margin:0 0 16px">Join ${escapeHtml(input.practiceName)} on Architect Pro</h1>
    <p>${escapeHtml(input.invitedBy)} has invited you to their practice's workspace.</p>
    <p style="margin:28px 0"><a href="${input.inviteUrl}" style="display:inline-block;background:#1f211d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Create your account</a></p>
    <p style="color:#6f6b63;font-size:14px">This link is for ${escapeHtml(to)} only and expires in 14 days.</p>
  </div>`,
);

// Sent once, when a workspace's payment first fails, to its owners and admins.
export const sendPaymentFailedEmail = async (
  to: string[],
  input: { practiceName: string; accessUntil: Date | null },
) => {
  const billingUrl = absoluteUrl('/billing');
  const until = input.accessUntil
    ? input.accessUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const keep = until ? `Your workspace stays open until ${until}.` : 'Your workspace stays open for now.';
  return sendEmail(
    to,
    'Payment failed for your Architect Pro subscription',
    `We couldn't take payment for ${input.practiceName}'s Architect Pro subscription.

${keep} Update your card before then to keep access for your team and your Agent computers:
${billingUrl}`,
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f211d;max-width:560px;margin:0 auto">
      <h1 style="font-size:22px;margin:0 0 16px">Your payment didn't go through</h1>
      <p>We couldn't take payment for ${escapeHtml(input.practiceName)}'s Architect Pro subscription.</p>
      <p>${escapeHtml(keep)} Update your card before then to keep access for your team and your Agent computers.</p>
      <p style="margin:28px 0"><a href="${billingUrl}" style="display:inline-block;background:#1f211d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Update payment details</a></p>
    </div>`,
  );
};

export const sendAccessInviteEmail = async (to: string, name: string, inviteUrl: string) => sendEmail(
  [to],
  'Your Architect Pro demo is approved',
  `Hi ${name},\n\nYour Architect Pro demo has been approved. Create your workspace with this link to start a 14-day free trial:\n${inviteUrl}\n\nThe link is for ${to} only and expires in 14 days.`,
  `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f211d;max-width:560px;margin:0 auto">
    <h1 style="font-size:24px;margin:0 0 16px">Your demo is approved</h1>
    <p>Hi ${escapeHtml(name)}, create your Architect Pro workspace to start a 14-day free trial.</p>
    <p style="margin:28px 0"><a href="${inviteUrl}" style="display:inline-block;background:#1f211d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Create your workspace</a></p>
    <p style="color:#6f6b63;font-size:14px">This link is for ${escapeHtml(to)} only and expires in 14 days.</p>
  </div>`,
);

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

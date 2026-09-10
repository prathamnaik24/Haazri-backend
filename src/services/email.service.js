/**
 * EmailService — optional Resend integration
 *
 * Rules:
 *  • Only attempts to send if BOTH RESEND_API_KEY and RESEND_FROM_EMAIL are set.
 *  • On success → returns { sent: true }
 *  • When email is disabled or Resend throws → logs server-side, returns { sent: false, reason }
 *  • NEVER throws — callers receive a fallback link regardless.
 */

const RESEND_API_KEY   = process.env.RESEND_API_KEY?.trim();
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || process.env.EMAIL_FROM?.trim();

const emailEnabled = !!(RESEND_API_KEY && RESEND_FROM_EMAIL);

/**
 * Send an activation / onboarding email to an employee.
 *
 * @param {{ to: string, name: string, activationLink: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendActivationEmail({ to, name, activationLink }) {
  if (!emailEnabled) {
    return { sent: false, reason: 'Email is disabled (RESEND_API_KEY or RESEND_FROM_EMAIL not set)' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject: 'You have been invited to Haazri — set your password',
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
            <h2 style="color: #1677B8;">Welcome to Haazri 👋</h2>
            <p>Hi ${name},</p>
            <p>Your account has been created. Click the button below to set your password and activate your account.</p>
            <p style="margin: 28px 0;">
              <a href="${activationLink}"
                 style="background:#1677B8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
                Activate Account
              </a>
            </p>
            <p style="color:#6b7280;font-size:13px;">
              This link expires in 24 hours. If you didn't expect this email, you can ignore it.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
            <p style="color:#9ca3af;font-size:12px;">Haazri — Employee Management Platform</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[EmailService] Resend API error:', response.status, body);
      return { sent: false, reason: `Resend API returned ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Unexpected error sending activation email:', err.message);
    return { sent: false, reason: err.message };
  }
}

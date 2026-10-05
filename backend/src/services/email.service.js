const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sellsphere_super_secret_jwt_key_2026';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

// ── Nodemailer Transporter ───────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
      tls: {
        rejectUnauthorized: false,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }
  return transporter;
}

// ── Verification Token Generator ─────────────────────────────────────────────

/**
 * Generate a secure verification token and a 6-digit OTP
 */
function generateVerificationToken(user, storeName = '') {
  // 6-digit numerical OTP code
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  // JWT Token with 24 hours expiry
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      otp: otpCode,
      purpose: 'email-verification',
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  return { token, otpCode };
}

/**
 * Verify token
 */
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'email-verification') {
      return { valid: false, error: 'Invalid token purpose' };
    }
    return { valid: true, data: decoded };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ── Ultra-Premium HTML Email Template ────────────────────────────────────────

function buildVerificationEmailHtml({ name, email, storeName, verifyUrl, otpCode }) {
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Verify Your Email - DB Tech Nexus</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; padding: 12px !important; }
      .otp-box { font-size: 26px !important; letter-spacing: 6px !important; }
      .btn-verify { width: 100% !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f1f5f9;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b0f19; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Wrapper -->
        <table role="presentation" class="email-container" width="580" cellspacing="0" cellpadding="0" border="0" style="background: linear-gradient(145deg, #131b2e 0%, #0f172a 100%); border-radius: 20px; border: 1px solid rgba(99, 102, 241, 0.25); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.65), 0 0 40px rgba(99, 102, 241, 0.15); overflow: hidden;">

          <!-- Top Ambient Gradient Accent Line -->
          <tr>
            <td height="5" style="background: linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #06b6d4 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Header Section with Logo -->
          <tr>
            <td align="center" style="padding: 40px 36px 20px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <!-- Brand Icon Badge -->
                    <div style="width: 58px; height: 58px; border-radius: 16px; background: linear-gradient(135deg, #6366f1, #a855f7); display: inline-block; line-height: 58px; text-align: center; box-shadow: 0 8px 24px rgba(99, 102, 241, 0.45);">
                      <span style="font-size: 28px; line-height: 58px;">✨</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 14px;">
                    <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                      DB Tech <span style="color: #818cf8;">Nexus</span>
                    </span>
                    <br>
                    <span style="font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.12em; text-transform: uppercase;">
                      Multi-Tenant E-Commerce SaaS Engine
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Welcome & Hero Headline -->
          <tr>
            <td style="padding: 10px 40px 0;">
              <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 14px; padding: 22px; text-align: center;">
                <span style="display: inline-block; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 999px; padding: 4px 14px; font-size: 12px; font-weight: 700; color: #34d399; margin-bottom: 12px;">
                  ● Account Created Successfully
                </span>
                <h1 style="margin: 6px 0 10px; font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.3;">
                  Verify Your Email Address
                </h1>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                  Hello <strong style="color: #ffffff;">${name || 'Partner'}</strong>, welcome!
                  ${storeName ? `<br>Your store workspace <strong style="color: #a5b4fc;">"${storeName}"</strong> is almost ready to scale.` : ''}
                </p>
              </div>
            </td>
          </tr>

          <!-- Primary Verification Action Button -->
          <tr>
            <td align="center" style="padding: 28px 40px 10px;">
              <p style="margin: 0 0 16px; font-size: 13px; color: #94a3b8; text-align: center;">
                Click the button below to confirm your email and activate your SaaS tenant:
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 12px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);">
                    <a href="${verifyUrl}" target="_blank" class="btn-verify" style="display: inline-block; padding: 16px 42px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 12px; letter-spacing: 0.02em;">
                      ✓ Verify Email & Open Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 24px 40px 10px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-top: 1px dashed rgba(148, 163, 184, 0.2);">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Alternative 6-Digit OTP Box -->
          <tr>
            <td align="center" style="padding: 10px 40px 24px;">
              <p style="margin: 0 0 10px; font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em;">
                Or Enter This 6-Digit Verification Code
              </p>
              <div class="otp-box" style="display: inline-block; background: #070b14; border: 2px solid rgba(99, 102, 241, 0.4); border-radius: 12px; padding: 14px 28px; font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);">
                ${otpCode}
              </div>
              <p style="margin: 10px 0 0; font-size: 12px; color: #64748b;">
                ⏱ Code and link expire in <strong style="color: #cbd5e1;">24 hours</strong>.
              </p>
            </td>
          </tr>

          <!-- Link fallback note -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.12); border-radius: 10px; padding: 14px; font-size: 11px; color: #64748b; line-height: 1.6; word-break: break-all;">
                <strong style="color: #94a3b8;">Having trouble with the button?</strong> Copy and paste this URL into your browser:<br>
                <a href="${verifyUrl}" style="color: #818cf8; text-decoration: underline;">${verifyUrl}</a>
              </div>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 10px; padding: 12px;">
                <tr>
                  <td width="30" valign="top" style="font-size: 18px; line-height: 1.2;">🛡️</td>
                  <td style="font-size: 11.5px; color: #fde68a; line-height: 1.5;">
                    If you did not create an account on <strong>DB Tech Nexus</strong>, you can safely ignore this email. No changes will take place.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #070b14; padding: 24px 40px; border-top: 1px solid rgba(148, 163, 184, 0.1); text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #94a3b8;">
                DB Tech Nexus &bull; Intelligent E-Commerce SaaS Architecture
              </p>
              <p style="margin: 0 0 10px; font-size: 11px; color: #475569;">
                Automated Multi-Courier RTO Engine &bull; AI Catalog Attribution &bull; High-Concurrency Infrastructure
              </p>
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                Questions? Contact us at <a href="mailto:support@thesellsphere.com" style="color: #818cf8; text-decoration: none;">support@thesellsphere.com</a>
              </p>
              <p style="margin: 12px 0 0; font-size: 10px; color: #334155;">
                &copy; ${currentYear} DB Tech Technologies Inc. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
  `;
}

// ── Public Send Function ────────────────────────────────────────────────────

/**
 * Send Verification Email with Link & OTP
 */
async function sendVerificationEmail({ name, email, storeName, token, otpCode }) {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

  const htmlContent = buildVerificationEmailHtml({
    name,
    email,
    storeName,
    verifyUrl,
    otpCode,
  });

  const mailOptions = {
    from: `"${process.env.SMTP_FROM_NAME || 'DB Tech Nexus'}" <${process.env.SMTP_FROM_EMAIL || 'support@thesellsphere.com'}>`,
    to: email,
    subject: `🔐 Verify your account - ${name || 'Welcome'}`,
    text: `Welcome to DB Tech Nexus!\n\nPlease verify your email address by opening the following link:\n${verifyUrl}\n\nOr enter this 6-digit OTP code: ${otpCode}\n\nThis verification link and OTP will expire in 24 hours.\n\nSupport: support@thesellsphere.com`,
    html: htmlContent,
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log(`✉️  Verification Email sent to ${email} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌  Failed to send verification email to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendVerificationEmail,
  generateVerificationToken,
  verifyToken,
};

const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure Gmail SMTP transporter using environment variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify connection configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('[EMAIL SERVICE] Transporter connection error:', error.message);
  } else {
    console.log('[EMAIL SERVICE] Transporter connected successfully and ready to send emails.');
  }
});

/**
 * Sends a clean, professional verification OTP email to a user.
 * @param {string} email - Recipient email address
 * @param {string|number} otp - 6-digit OTP code
 * @returns {Promise<object>} - Nodemailer sendMail receipt
 */
async function sendOTP(email, otp) {
  if (!email || !otp) {
    throw new Error('Recipient email and OTP code are required.');
  }

  const mailOptions = {
    from: `"DevDuel" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Your DevDuel Verification Code: ${otp}`,
    text: `Your DevDuel verification code is: ${otp}. This code is valid for 10 minutes. If you did not request this code, please ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DevDuel Verification Code</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background-color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #18181b;
          }
          .wrapper {
            width: 100%;
            background-color: #f8fafc;
            padding: 40px 0;
          }
          .container {
            max-width: 500px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
          }
          .header {
            background-color: #09090b;
            padding: 28px 24px;
            text-align: center;
          }
          .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: -0.5px;
          }
          .header p {
            color: #a1a1aa;
            margin: 6px 0 0 0;
            font-size: 13px;
          }
          .body {
            padding: 36px 32px;
            text-align: center;
          }
          .title {
            font-size: 18px;
            font-weight: 700;
            color: #09090b;
            margin: 0 0 12px 0;
          }
          .description {
            font-size: 14px;
            color: #52525b;
            line-height: 1.6;
            margin: 0 0 28px 0;
          }
          .otp-box {
            background-color: #f4f4f5;
            border: 1px solid #e4e4e7;
            border-radius: 12px;
            padding: 18px 28px;
            display: inline-block;
            margin: 0 auto 28px auto;
          }
          .otp-code {
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            font-size: 32px;
            font-weight: 800;
            letter-spacing: 8px;
            color: #4f46e5;
            margin: 0;
          }
          .expiry-notice {
            font-size: 12px;
            color: #71717a;
            line-height: 1.5;
            margin: 0 0 16px 0;
          }
          .footer {
            border-top: 1px solid #f1f5f9;
            padding: 20px 32px;
            background-color: #fafafa;
            font-size: 12px;
            color: #a1a1aa;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <h1>⚔️ DevDuel</h1>
              <p>Real-Time 1v1 Competitive Programming</p>
            </div>
            <div class="body">
              <h2 class="title">Verification Code</h2>
              <p class="description">
                Use the one-time verification code below to confirm your email address and authenticate your account.
              </p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <p class="expiry-notice">
                This verification code will expire in <strong>10 minutes</strong>.<br>
                If you did not request this verification code, you can safely disregard this email.
              </p>
            </div>
            <div class="footer">
              &copy; ${new Date().getFullYear()} DevDuel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

module.exports = {
  transporter,
  sendOTP
};

const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { run, all } = require('../db');

let transporter = null;

async function getTransporter() {
  if (!transporter) {
    if (process.env.SMTP_HOST) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Create Ethereal test account automatically
      try {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
      } catch (err) {
        console.warn('Could not create Ethereal SMTP test account, falling back to outbox DB only:', err.message);
      }
    }
  }
  return transporter;
}

// Generate base64 QR Code
async function generateQRCode(text) {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'H',
      width: 300,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('QR Generation Error:', err);
    throw err;
  }
}

// Send Ticket Email
async function sendTicketEmail(toEmail, bookingRef, eventTitle, showTime, seatLabel, category, price) {
  const qrCodeDataUrl = await generateQRCode(bookingRef);

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <div style="background: linear-gradient(135deg, #6366f1, #a855f7); padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px; color: #ffffff; text-transform: uppercase; letter-spacing: 1px;">Booking Confirmed!</h1>
        <p style="margin: 4px 0 0 0; color: #e0e7ff; font-size: 14px;">Ticket Ref: <strong>${bookingRef}</strong></p>
      </div>
      
      <div style="padding: 24px;">
        <h2 style="color: #38bdf8; margin-top: 0;">${eventTitle}</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; color: #cbd5e1;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #1e293b;"><strong>Date & Time:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #1e293b; text-align: right;">${new Date(showTime).toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #1e293b;"><strong>Seat:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #1e293b; text-align: right; color: #a855f7; font-weight: bold;">${seatLabel} (${category})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;"><strong>Price Paid:</strong></td>
            <td style="padding: 8px 0; text-align: right; color: #4ade80; font-weight: bold;">$${price.toFixed(2)}</td>
          </tr>
        </table>

        <div style="text-align: center; background: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <img src="${qrCodeDataUrl}" alt="QR Ticket Code" style="width: 180px; height: 180px;" />
          <p style="color: #0f172a; font-size: 12px; margin: 8px 0 0 0; font-weight: 600;">Scan at entrance for venue entry</p>
        </div>
      </div>
      <div style="background: #1e293b; padding: 12px; text-align: center; color: #64748b; font-size: 12px;">
        Thank you for booking with TicketBox Platform.
      </div>
    </div>
  `;

  // 1. Record in outbox_emails for in-app viewer
  await run(`INSERT INTO outbox_emails (recipient, subject, body_html, qr_code) VALUES (?, ?, ?, ?)`,
    [toEmail, `Your Ticket: ${eventTitle} (${bookingRef})`, html, qrCodeDataUrl]);

  // 2. Try actual SMTP send if transport available
  try {
    const tp = await getTransporter();
    if (tp) {
      const info = await tp.sendMail({
        from: '"TicketBox" <noreply@ticketbox.com>',
        to: toEmail,
        subject: `Your Ticket: ${eventTitle} (${bookingRef})`,
        html,
      });
      if (nodemailer.getTestMessageUrl(info)) {
        console.log('Ethereal Email Preview URL:', nodemailer.getTestMessageUrl(info));
      }
    }
  } catch (err) {
    console.warn('SMTP Send Warning:', err.message);
  }

  return qrCodeDataUrl;
}

// Send Waitlist Offer Email
async function sendWaitlistOfferEmail(toEmail, offerToken, eventTitle, showTime, seatLabel, category, price, expiresAt) {
  const expiryFormatted = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px; color: #ffffff; text-transform: uppercase;">Great News! A Seat is Available</h1>
        <p style="margin: 4px 0 0 0; color: #fef3c7; font-size: 14px;">Time-Limited Seat Offer</p>
      </div>
      
      <div style="padding: 24px;">
        <p>A seat has become available from the waitlist for <strong>${eventTitle}</strong>!</p>
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Seat:</strong> <span style="color: #38bdf8;">${seatLabel} (${category})</span></p>
          <p style="margin: 4px 0;"><strong>Price:</strong> <span style="color: #4ade80;">$${price.toFixed(2)}</span></p>
          <p style="margin: 4px 0;"><strong>Offer Expires At:</strong> <span style="color: #f43f5e; font-weight: bold;">${expiryFormatted}</span></p>
        </div>
        
        <p>You have a limited window to claim this seat before it is offered to the next customer on the waitlist.</p>
        
        <div style="text-align: center; margin: 24px 0;">
          <a href="#" style="background: linear-gradient(135deg, #6366f1, #a855f7); color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Claim Seat Now</a>
        </div>
        <p style="font-size: 11px; color: #94a3b8; text-align: center;">Offer Token: ${offerToken}</p>
      </div>
    </div>
  `;

  await run(`INSERT INTO outbox_emails (recipient, subject, body_html, qr_code) VALUES (?, ?, ?, NULL)`,
    [toEmail, `ACTION REQUIRED: Seat Available for ${eventTitle}`, html]);

  try {
    const tp = await getTransporter();
    if (tp) {
      await tp.sendMail({
        from: '"TicketBox Waitlist" <waitlist@ticketbox.com>',
        to: toEmail,
        subject: `ACTION REQUIRED: Seat Available for ${eventTitle}`,
        html,
      });
    }
  } catch (err) {
    console.warn('Waitlist SMTP Send Warning:', err.message);
  }
}

async function getOutboxEmails() {
  return await all(`SELECT * FROM outbox_emails ORDER BY id DESC LIMIT 20`);
}

module.exports = {
  sendTicketEmail,
  sendWaitlistOfferEmail,
  getOutboxEmails,
};

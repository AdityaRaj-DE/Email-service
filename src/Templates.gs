/**
 * Templates.gs - Strict allowlist of email templates with automatic HTML escaping.
 * Public requests can never supply arbitrary HTML or manipulate recipient headers.
 */

var Templates = (function() {
  /**
   * Render a contact form email safely.
   */
  function renderContactEmail(job) {
    var safeName = Security.escapeHtml(job.sender_name);
    var safeEmail = Security.escapeHtml(job.sender_email);
    var safeSubject = Security.escapeHtml(job.subject);
    var safeProject = Security.escapeHtml(job.project_id);
    var safeJobId = Security.escapeHtml(job.job_id);
    var safeCreatedAt = Security.escapeHtml(job.created_at);

    // Escape message content and convert line breaks to <br/>
    var rawMessage = job.message || '';
    var escapedMessage = Security.escapeHtml(rawMessage).replace(/\r\n|\r|\n/g, '<br/>');

    var emailSubject = '[' + safeProject + '] Contact Form: ' + Security.sanitizeHeader(job.subject);

    var textBody = [
      'New Contact Form Submission',
      '==========================',
      'Project: ' + job.project_id,
      'From: ' + job.sender_name + ' <' + job.sender_email + '>',
      'Subject: ' + job.subject,
      'Date (UTC): ' + job.created_at,
      'Job ID: ' + job.job_id,
      '',
      'Message:',
      job.message,
      '',
      '--------------------------',
      'Sent via Centralized Apps Script Email Service'
    ].join('\n');

    var htmlBody = [
      '<!DOCTYPE html>',
      '<html>',
      '<head><meta charset="utf-8"></head>',
      '<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 20px; background-color: #f8fafc;">',
      '<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">',
      '  <div style="background: #2563eb; color: #ffffff; padding: 16px 20px;">',
      '    <h2 style="margin: 0; font-size: 18px; font-weight: 600;">[' + safeProject + '] New Contact Message</h2>',
      '  </div>',
      '  <div style="padding: 20px;">',
      '    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">',
      '      <tr><td style="padding: 6px 0; color: #64748b; width: 80px;">From:</td><td style="padding: 6px 0; font-weight: 600; color: #0f172a;">' + safeName + ' &lt;' + safeEmail + '&gt;</td></tr>',
      '      <tr><td style="padding: 6px 0; color: #64748b;">Subject:</td><td style="padding: 6px 0; font-weight: 600; color: #0f172a;">' + safeSubject + '</td></tr>',
      '      <tr><td style="padding: 6px 0; color: #64748b;">Project:</td><td style="padding: 6px 0; color: #0f172a;">' + safeProject + '</td></tr>',
      '      <tr><td style="padding: 6px 0; color: #64748b;">Received:</td><td style="padding: 6px 0; color: #0f172a;">' + safeCreatedAt + '</td></tr>',
      '    </table>',
      '    <div style="background: #f1f5f9; padding: 16px; border-radius: 6px; border-left: 4px solid #2563eb; font-size: 14px; white-space: pre-wrap; word-break: break-word;">' + escapedMessage + '</div>',
      '  </div>',
      '  <div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">',
      '    Job ID: ' + safeJobId + ' | Centralized Email Service',
      '  </div>',
      '</div>',
      '</body>',
      '</html>'
    ].join('\n');

    return {
      subject: emailSubject,
      textBody: textBody,
      htmlBody: htmlBody,
      replyTo: job.sender_email
    };
  }

  /**
   * Render a notification email safely.
   */
  function renderNotificationEmail(job) {
    var safeSubject = Security.escapeHtml(job.subject);
    var safeProject = Security.escapeHtml(job.project_id);
    var safeJobId = Security.escapeHtml(job.job_id);
    var safeCreatedAt = Security.escapeHtml(job.created_at);
    var rawMessage = job.message || '';
    var escapedMessage = Security.escapeHtml(rawMessage).replace(/\r\n|\r|\n/g, '<br/>');

    var emailSubject = '[' + safeProject + ' Notification] ' + Security.sanitizeHeader(job.subject);

    var textBody = [
      'Notification: ' + job.subject,
      '==========================',
      'Project: ' + job.project_id,
      'Date (UTC): ' + job.created_at,
      'Job ID: ' + job.job_id,
      '',
      'Message:',
      job.message,
      '',
      '--------------------------',
      'Sent via Centralized Apps Script Email Service'
    ].join('\n');

    var htmlBody = [
      '<!DOCTYPE html>',
      '<html>',
      '<head><meta charset="utf-8"></head>',
      '<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; padding: 20px; background-color: #f8fafc;">',
      '<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">',
      '  <div style="background: #0f172a; color: #ffffff; padding: 16px 20px;">',
      '    <h2 style="margin: 0; font-size: 18px;">[' + safeProject + '] Notification</h2>',
      '  </div>',
      '  <div style="padding: 20px;">',
      '    <p style="font-size: 14px; font-weight: bold; margin-top: 0;">' + safeSubject + '</p>',
      '    <div style="background: #f1f5f9; padding: 16px; border-radius: 6px; font-size: 14px; white-space: pre-wrap; word-break: break-word;">' + escapedMessage + '</div>',
      '  </div>',
      '  <div style="padding: 10px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">',
      '    Job ID: ' + safeJobId + ' | Received: ' + safeCreatedAt,
      '  </div>',
      '</div>',
      '</body>',
      '</html>'
    ].join('\n');

    return {
      subject: emailSubject,
      textBody: textBody,
      htmlBody: htmlBody,
      replyTo: job.sender_email || undefined
    };
  }

  /**
   * Template selector based on job message type.
   */
  function render(job) {
    if (job.type === 'contact' || !job.type) {
      return renderContactEmail(job);
    } else if (job.type === 'notification' || job.type === 'alert') {
      return renderNotificationEmail(job);
    }
    throw new Error('Unsupported template type: ' + job.type);
  }

  return {
    render: render,
    renderContactEmail: renderContactEmail,
    renderNotificationEmail: renderNotificationEmail
  };
})();


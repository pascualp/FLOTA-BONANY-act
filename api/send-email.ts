import { google } from 'googleapis';

// Envía el «Reporte de alertas» por Gmail con el token de Google de quien pulsa el botón.
// Es una función de Vercel (/api/send-email). En AI Studio la usa también server.ts (Express), así hay una sola copia.
// La firma (req, res) vale para las dos: Express y Vercel traen req.body ya leído y res.status().json().
export default async function sendEmail(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const authHeader: string = req.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta la autorización de Google' });
  }

  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Faltan datos del correo (to, subject, html)' });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: authHeader.slice('Bearer '.length) });
    const gmail = google.gmail({ version: 'v1', auth });

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const message = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      html,
    ].join('\n');

    const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error enviando el correo:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo enviar el correo' });
  }
}

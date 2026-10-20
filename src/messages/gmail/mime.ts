import MailComposer from 'nodemailer/lib/mail-composer';

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: { name: string; address: string };
  /** Destinatario; puede venir como `Nombre <email>`. */
  to: string;
  subject: string;
  html: string;
  /** Versión en texto plano (mejora la entrega y es lo que ven clientes sin HTML). */
  text: string;
  /** Message-ID del mensaje al que se responde (para que Gmail arme el hilo). */
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
}

/**
 * Arma el mensaje RFC 822 completo (encabezados codificados, multipart con texto,
 * HTML y adjuntos). Se usa el generador de MIME de nodemailer, que resuelve bien
 * la codificación de tildes y adjuntos; el envío en sí lo hace la Gmail API.
 */
export function buildRawMessage(message: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: (message.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, raw) => (err ? reject(err) : resolve(raw)));
  });
}

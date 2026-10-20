import MailComposer from 'nodemailer/lib/mail-composer';

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: { name: string; address: string };
  /** Destinatarios; cada uno puede venir como `Nombre <email>`. */
  to: string | string[];
  cc?: string[];
  /**
   * Copia oculta. Va en el mensaje que se le pasa a la Gmail API (que la usa
   * para entregar y la saca antes de mandarlo): sin el header `Bcc`, Gmail no
   * les entrega a esas direcciones.
   */
  bcc?: string[];
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
    to: Array.isArray(message.to) && message.to.length === 0 ? undefined : message.to,
    cc: message.cc?.length ? message.cc : undefined,
    bcc: message.bcc?.length ? message.bcc : undefined,
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
  const node = composer.compile();
  // Por defecto nodemailer omite el header Bcc (lo usa solo el transporte SMTP).
  // Acá el "transporte" es la Gmail API, que lo necesita en el mensaje.
  Object.assign(node, { keepBcc: true });
  return new Promise((resolve, reject) => {
    node.build((err, raw) => (err ? reject(err) : resolve(raw)));
  });
}

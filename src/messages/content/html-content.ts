import { convert } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';

/** Valores CSS permitidos en `style` (formato básico, sin posicionamiento ni URLs). */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const SAFE_LENGTH = /^[\d.]+(px|pt|em|rem|%)?$/i;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'span',
    'font',
    'center',
    'u',
    's',
    'del',
    'ins',
    'sub',
    'sup',
  ]),
  allowedAttributes: {
    a: ['href', 'name', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    font: ['color'],
    td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
    th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
    table: ['width', 'cellpadding', 'cellspacing', 'border'],
    '*': ['style', 'align', 'dir'],
  },
  allowedStyles: {
    '*': {
      color: [SAFE_COLOR],
      'background-color': [SAFE_COLOR],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/],
      'font-style': [/^(normal|italic)$/],
      'text-decoration': [/^[a-z\s-]+$/],
      'font-size': [SAFE_LENGTH],
    },
  },
  // `javascript:` y compañía quedan afuera; las imágenes además aceptan data: y cid:.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  allowProtocolRelative: false,
  // Los links abren afuera y sin darle acceso a la página de origen.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
  // Se descarta el contenido de estas etiquetas, no solo la etiqueta.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head'],
};

/**
 * Deja solo HTML de formato: sin scripts, iframes, formularios, handlers `on*`,
 * `javascript:` ni CSS de posicionamiento. Se aplica a todo HTML que el frontend
 * renderiza (detalle de Enviados) y a lo que se envía desde Redactar/Responder.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** HTML → texto legible (párrafos y listas como saltos de línea, sin imágenes). */
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Texto plano → HTML seguro (escapado, un párrafo por bloque). */
export function plainTextToHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  return escaped
    .split(/\r?\n\r?\n/)
    .map((block) => `<p>${block.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

/** Primeros caracteres del texto, en una línea (para `snippet`). */
export function toSnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

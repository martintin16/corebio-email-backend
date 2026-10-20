import { htmlToPlainText, plainTextToHtml, sanitizeEmailHtml, toSnippet } from './html-content';

describe('sanitizeEmailHtml', () => {
  it('saca scripts y su contenido', () => {
    expect(sanitizeEmailHtml('<p>hola</p><script>alert(1)</script>')).toBe('<p>hola</p>');
  });

  it('saca handlers on* y links javascript:', () => {
    const out = sanitizeEmailHtml(
      '<a href="javascript:alert(1)" onclick="x()">a</a><img src="x" onerror="y()">',
    );
    expect(out).not.toMatch(/onclick|onerror|javascript:/i);
  });

  it('saca iframes, formularios y <style>', () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://x"></iframe><form><input></form><style>body{}</style><p>ok</p>',
    );
    expect(out).toBe('<p>ok</p>');
  });

  it('mantiene el formato básico y fuerza target/rel en los links', () => {
    const out = sanitizeEmailHtml(
      '<p><b>Hola</b> <i>che</i></p><ul><li>uno</li></ul><a href="https://corebio.org">sitio</a>',
    );
    expect(out).toContain('<b>Hola</b>');
    expect(out).toContain('<li>uno</li>');
    expect(out).toContain('href="https://corebio.org"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('filtra CSS peligroso pero deja alineación y color', () => {
    const out = sanitizeEmailHtml(
      '<p style="text-align:center;color:#333;position:fixed;background-image:url(x)">t</p>',
    );
    expect(out).toContain('text-align:center');
    expect(out).toContain('color:#333');
    expect(out).not.toMatch(/position|url\(/);
  });
});

describe('htmlToPlainText', () => {
  it('convierte párrafos y saca etiquetas', () => {
    expect(htmlToPlainText('<p>Hola</p><p>Chau <b>che</b></p>')).toBe('Hola\n\nChau che');
  });

  it('un <p></p> vacío da texto vacío', () => {
    expect(htmlToPlainText('<p></p>')).toBe('');
    expect(htmlToPlainText('<p> <br> </p>')).toBe('');
  });
});

describe('plainTextToHtml', () => {
  it('escapa HTML y arma párrafos', () => {
    expect(plainTextToHtml('a <b>\nb\n\nc')).toBe('<p>a &lt;b&gt;<br>b</p><p>c</p>');
  });
});

describe('toSnippet', () => {
  it('une líneas y corta largo', () => {
    expect(toSnippet('hola\n  mundo')).toBe('hola mundo');
    expect(toSnippet('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
});

import { describe, it, assert } from 'vitest';

import {
  unescapeHtml,
  extractInlineImages,
  ensureResponsiveImages,
  resolveImsFileRefs,
  cleanQuestionHtml,
  convertLatexItemizeToMarkdown,
} from './html.js';

describe('unescapeHtml', () => {
  it('unescapes common HTML entities', () => {
    assert.equal(unescapeHtml('&lt;p&gt;hello &amp; world&lt;/p&gt;'), '<p>hello & world</p>');
  });

  it('unescapes quotes', () => {
    assert.equal(unescapeHtml('&quot;test&#39;s&quot;'), '"test\'s"');
  });

  it('unescapes nbsp', () => {
    assert.equal(unescapeHtml('foo&nbsp;bar'), 'foo\u00A0bar');
  });
});

describe('extractInlineImages', () => {
  it('replaces data URI with file reference', () => {
    // 1x1 red PNG as base64
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const html = `<img src="data:image/png;base64,${b64}">`;
    const result = extractInlineImages(html);

    assert.equal(result.files.size, 1);
    const [filename] = [...result.files.keys()];
    assert.match(filename, /^inline-[0-9a-f]{16}\.png$/);
    assert.include(result.html, `src="clientFilesQuestion/${filename}"`);
    assert.notInclude(result.html, 'data:image');
  });

  it('returns unchanged HTML when no data URIs', () => {
    const html = '<img src="image.png">';
    const result = extractInlineImages(html);
    assert.equal(result.html, html);
    assert.equal(result.files.size, 0);
  });

  it('deduplicates identical images', () => {
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const html = `<img src="data:image/png;base64,${b64}"><img src="data:image/png;base64,${b64}">`;
    const result = extractInlineImages(html);
    assert.equal(result.files.size, 1);
  });
});

describe('ensureResponsiveImages', () => {
  it('adds responsive style to plain img tag', () => {
    const result = ensureResponsiveImages('<img src="test.png">');
    assert.include(result, 'max-width: 100%');
    assert.include(result, 'height: auto');
  });

  it('appends to existing style', () => {
    const result = ensureResponsiveImages('<img style="border: 1px solid red" src="test.png">');
    assert.include(result, 'border: 1px solid red');
    assert.include(result, 'max-width: 100%');
  });

  it('does not modify if max-width already present', () => {
    const html = '<img style="max-width: 50%" src="test.png">';
    const result = ensureResponsiveImages(html);
    assert.equal(result, html);
  });
});

describe('resolveImsFileRefs', () => {
  it('rewrites $IMS-CC-FILEBASE$ to clientFilesQuestion path', () => {
    const html = '<img src="$IMS-CC-FILEBASE$/Quiz%20Files/image.png">';
    const result = resolveImsFileRefs(html);
    assert.include(result.html, 'clientFilesQuestion/image.png');
    assert.equal(result.fileRefs.get('image.png'), 'Quiz Files/image.png');
  });
});

describe('convertLatexItemizeToMarkdown', () => {
  it('converts a simple itemize block to markdown bullets', () => {
    const html = 'Before \\begin{itemize}\\item First\\item Second\\item Third\\end{itemize} After';
    const result = convertLatexItemizeToMarkdown(html);
    assert.include(result, '<markdown>');
    assert.include(result, '- First');
    assert.include(result, '- Second');
    assert.include(result, '- Third');
    assert.include(result, '</markdown>');
    assert.include(result, 'Before');
    assert.include(result, 'After');
  });

  it('handles optional label in \\item[label]', () => {
    const html = '\\begin{itemize}\\item[a] Apple\\item[b] Banana\\end{itemize}';
    const result = convertLatexItemizeToMarkdown(html);
    assert.include(result, '- Apple');
    assert.include(result, '- Banana');
  });

  it('returns empty markdown block for itemize with no items', () => {
    const html = '\\begin{itemize}\\end{itemize}';
    const result = convertLatexItemizeToMarkdown(html);
    assert.equal(result, '<markdown>\n</markdown>');
  });

  it('passes through HTML with no LaTeX itemize unchanged', () => {
    const html = '<p>No LaTeX here</p>';
    assert.equal(convertLatexItemizeToMarkdown(html), html);
  });

  it('collapses internal whitespace in item text', () => {
    const html = '\\begin{itemize}\\item  Foo   Bar  \\end{itemize}';
    const result = convertLatexItemizeToMarkdown(html);
    assert.include(result, '- Foo Bar');
  });
});

describe('cleanQuestionHtml', () => {
  it('strips wrapping div', () => {
    assert.equal(cleanQuestionHtml('<div><p>Hello</p></div>'), '<p>Hello</p>');
  });

  it('preserves content without wrapping div', () => {
    assert.equal(cleanQuestionHtml('<p>Hello</p>'), '<p>Hello</p>');
  });

  it('trims whitespace', () => {
    assert.equal(cleanQuestionHtml('  <p>Hello</p>  '), '<p>Hello</p>');
  });
});

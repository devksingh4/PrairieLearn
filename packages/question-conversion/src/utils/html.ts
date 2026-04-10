import crypto from 'node:crypto';

/** Unescape HTML entities (Canvas exports HTML-escaped content). */
export function unescapeHtml(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', '\u00A0');
}

const DATA_URI_RE = /src=(["'])data:(?<mime>image\/[a-zA-Z0-9.+-]+);base64,(?<data>[^"']+)\1/g;

/**
 * Extract inline base64 data URI images from HTML, replacing them with
 * local file references in clientFilesQuestion/.
 *
 * Returns the rewritten HTML and a map of filename → Buffer.
 */
export function extractInlineImages(html: string): {
  html: string;
  files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();

  const rewritten = html.replaceAll(DATA_URI_RE, (_match, quote, mime, data) => {
    const ext = mime.split('/')[1].replace('+xml', '');
    const imgBytes = Buffer.from(data, 'base64');
    const digest = crypto.createHash('sha256').update(imgBytes).digest('hex').slice(0, 16);
    const filename = `inline-${digest}.${ext}`;
    files.set(filename, imgBytes);
    return `src=${quote}clientFilesQuestion/${filename}${quote}`;
  });

  return { html: rewritten, files };
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;

/**
 * Add responsive CSS to all img tags that don't already have max-width set.
 */
export function ensureResponsiveImages(html: string): string {
  return html.replaceAll(IMG_TAG_RE, (tag) => {
    if (/style=/i.test(tag) && /max-width/i.test(tag)) {
      return tag;
    }
    if (/style=/i.test(tag)) {
      return tag.replace(
        /style=(["'])(.*?)\1/i,
        (_, q, style) =>
          `style=${q}${style.replace(/;?\s*$/, '')}; max-width: 100%; height: auto;${q}`,
      );
    }
    return tag.replace('<img', '<img style="max-width: 100%; height: auto;"');
  });
}

const IMS_CC_FILEBASE_RE = /\$IMS-CC-FILEBASE\$\/([^"'\s]+)/g;

/**
 * Resolve $IMS-CC-FILEBASE$ references in HTML for PrairieLearn output.
 *
 * Rewrites src="$IMS-CC-FILEBASE$/path/img.png" to:
 * src="clientFilesQuestion/img.png"
 *
 * Returns the rewritten HTML and a map of { filename → original decoded relative path }
 * so the caller can locate and copy the source files.
 */
export function resolveImsFileRefs(html: string): {
  html: string;
  fileRefs: Map<string, string>;
} {
  const fileRefs = new Map<string, string>();

  const rewritten = html.replaceAll(IMS_CC_FILEBASE_RE, (_match, rawPath: string) => {
    const decodedPath = decodeURIComponent(rawPath);
    const filename = decodedPath.split('/').pop() ?? decodedPath;
    fileRefs.set(filename, decodedPath);
    return `clientFilesQuestion/${filename}`;
  });

  return { html: rewritten, fileRefs };
}

const ITEMIZE_BLOCK_RE = /\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g;
const ITEM_TOKEN_RE = /\\item(?:\[[^\]]*\])?/g;

/**
 * Convert LaTeX \begin{itemize}...\end{itemize} environments embedded in HTML
 * to PrairieLearn <markdown> bullet lists.
 *
 * Canvas sometimes exports questions with raw LaTeX itemize environments in the
 * prompt HTML. PrairieLearn renders <markdown> blocks via its markdown element.
 */
export function convertLatexItemizeToMarkdown(html: string): string {
  return html.replaceAll(ITEMIZE_BLOCK_RE, (_match, body: string) => {
    // Find all \item tokens and extract text between them
    const itemTokens: RegExpExecArray[] = [];
    ITEM_TOKEN_RE.lastIndex = 0;
    let token: RegExpExecArray | null;
    while ((token = ITEM_TOKEN_RE.exec(body)) !== null) {
      itemTokens.push(token);
    }

    if (itemTokens.length === 0) {
      return '<markdown>\n</markdown>';
    }

    const lines: string[] = [];
    for (let i = 0; i < itemTokens.length; i++) {
      const start = itemTokens[i].index + itemTokens[i][0].length;
      const end = i + 1 < itemTokens.length ? itemTokens[i + 1].index : body.length;
      const itemText = body.slice(start, end).trim().replaceAll(/\s+/g, ' ');
      if (itemText) {
        lines.push(`- ${itemText}`);
      }
    }

    if (lines.length === 0) {
      return '<markdown>\n</markdown>';
    }

    return `<markdown>\n${lines.join('\n')}\n</markdown>`;
  });
}

/**
 * Clean up question HTML for PrairieLearn output.
 * Strips wrapping <div> tags that Canvas often adds.
 */
export function cleanQuestionHtml(html: string): string {
  let cleaned = html.trim();
  // Remove single wrapping <div>...</div>
  const divWrapRe = /^<div>\s*([\s\S]*?)\s*<\/div>$/i;
  const divMatch = divWrapRe.exec(cleaned);
  if (divMatch) {
    cleaned = divMatch[1].trim();
  }
  return cleaned;
}

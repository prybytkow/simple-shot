/**
 * Upload screenshot via HTTP API (multipart form field "image").
 * Compatible with lightshot-style servers: POST /upload → XML/JSON with public URL.
 * Auth: X-API-Key (+ Authorization: Bearer).
 */
export class ApiUploader {
  async uploadFile(fileBuffer: Buffer, fileName: string, settings: any): Promise<string> {
    const endpoint = (settings.api?.endpoint || '').trim();
    const apiKey = (settings.api?.apiKey || '').trim();

    if (!endpoint) {
      throw new Error('API endpoint is not configured');
    }
    if (!apiKey) {
      throw new Error('API key is not configured');
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`Invalid API endpoint: ${endpoint}`);
    }

    const form = new FormData();
    const bytes = new Uint8Array(fileBuffer);
    form.append('image', new Blob([bytes], { type: 'image/png' }), fileName);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`API upload failed (${response.status})${snippet ? `: ${snippet}` : ''}`);
    }

    const publicUrl = extractPublicUrl(bodyText);
    if (!publicUrl) {
      throw new Error('API upload succeeded but response did not contain a file URL');
    }
    return publicUrl;
  }
}

function extractPublicUrl(body: string): string | null {
  const trimmed = (body || '').trim();
  if (!trimmed) return null;

  const xmlMatch = trimmed.match(/<url>\s*([^<]+?)\s*<\/url>/i);
  if (xmlMatch?.[1]) {
    return xmlMatch[1].trim();
  }

  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    let fromJson: string | undefined;
    if (typeof json.url === 'string') fromJson = json.url;
    else if (typeof json.link === 'string') fromJson = json.link;
    else if (json.data && typeof json.data === 'object' && json.data !== null) {
      const dataUrl = (json.data as Record<string, unknown>).url;
      if (typeof dataUrl === 'string') fromJson = dataUrl;
    }
    if (fromJson) return fromJson.trim();
  } catch {
    // not JSON
  }

  if (/^https?:\/\//i.test(trimmed) && !trimmed.includes('<') && !trimmed.includes('{')) {
    return trimmed.split(/\s/)[0];
  }

  return null;
}

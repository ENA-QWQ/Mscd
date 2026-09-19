const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type, Accept, Origin, User-Agent',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Encoding, Last-Modified, ETag',
};

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const incomingUrl = new URL(request.url);
    const rawQuery = incomingUrl.href.split('?')[1] || '';
    const urlMatch = rawQuery.match(/(?:^|&)url=(.*)/s);
    if (!urlMatch || !urlMatch[1]) {
        return jsonError('Missing target URL.', 400);
    }

    let target;
    try {
        target = decodeURIComponent(urlMatch[1]);
    } catch {
        target = urlMatch[1];
    }

    if (target.includes('/proxy')) {
        return jsonError('Invalid path.', 400);
    }

    let targetUrl;
    try {
        targetUrl = new URL(target);
    } catch {
        return jsonError('Invalid target URL.', 400);
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol) || isLocalAddress(targetUrl.hostname)) {
        return jsonError('Blocked URL.', 403);
    }

    if (targetUrl.protocol === 'http:') {
        targetUrl.protocol = 'https:';
    }

    const fetchHeaders = new Headers();

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) fetchHeaders.set('Range', rangeHeader);

    const ifRangeHeader = request.headers.get('if-range');
    if (ifRangeHeader) fetchHeaders.set('If-Range', ifRangeHeader);

    fetchHeaders.set('Accept', '*/*');
    fetchHeaders.set('Accept-Encoding', 'identity');
    if (!fetchHeaders.has('User-Agent')) {
        fetchHeaders.set('User-Agent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
        );
    }

    const fetchInit = {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: fetchHeaders,
        redirect: 'manual',
    };

    let upstreamRes;
    try {
        upstreamRes = await fetch(targetUrl.toString(), fetchInit);
    } catch (e) {
        return jsonError('Fetch error: ' + (e && e.message ? e.message : String(e)), 502);
    }

    if ([301, 302, 303, 307, 308].includes(upstreamRes.status)) {
        return jsonError('Redirects to another URL are not allowed.', 502);
    }

    const responseHeaders = new Headers();

    const passThrough = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'last-modified',
        'etag',
        'cache-control',
        'expires',
    ];

    for (const name of passThrough) {
        const value = upstreamRes.headers.get(name);
        if (value) responseHeaders.set(name, value);
    }

    for (const [k, v] of Object.entries(corsHeaders)) {
        responseHeaders.set(k, v);
    }

    return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: responseHeaders,
    });
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function isLocalAddress(hostname) {
    if (!hostname) return true;
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (/^(0|127)\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)\d+\.\d+/.test(host)) return true;
    if (/^0x[0-9a-f]+$/.test(host) || /^\d+$/.test(host)) return true;
    if (host === '::' || host === '::1' || /^0*:0*:0*:0*:0*:0*:0*:0*1?$/.test(host)) return true;
    if (/^::ffff:/.test(host)) return true;
    if (/^(fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/.test(host)) return true;
    return false;
}
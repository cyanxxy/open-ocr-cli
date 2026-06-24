const SUPPORTED_URL_PROTOCOLS = new Set(['http:', 'https:']);

// audit H-08: Gemini's URL Context only supports publicly-accessible HTTP/HTTPS
// URLs. We reject anything that targets the local machine, a private network, or
// a tunnelling host, and anything that smuggles credentials in the authority.
// This is defense-in-depth against SSRF-style abuse and avoids handing the model
// URLs it can never legitimately fetch.

const LOOPBACK_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

// Hostname suffixes for public tunnelling services that expose otherwise-private
// origins. Gemini URL Context does not support these.
const TUNNELING_HOST_SUFFIXES = [
  '.ngrok.io',
  '.ngrok-free.app',
  '.ngrok.app',
  '.ngrok.dev',
  '.pinggy.io',
  '.pinggy.link',
  '.pinggy.online',
  '.loca.lt', // localtunnel
];

/**
 * Returns true when an IPv4 dotted-quad hostname falls inside a loopback,
 * private (RFC 1918), link-local, or carrier-grade-NAT range.
 */
function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) {
    return false;
  }

  const [a, b] = octets;

  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8 private
  if (a === 10) return true;
  // 172.16.0.0/12 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 0.0.0.0/8 "this network"
  if (a === 0) return true;

  return false;
}

/**
 * Returns true when an IPv6 hostname (with or without brackets) is a loopback,
 * unique-local (fc00::/7), or link-local (fe80::/10) address.
 */
function isPrivateIpv6(hostname: string): boolean {
  const stripped = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  if (stripped === '::1' || stripped === '::') {
    return true;
  }

  // Unique local addresses fc00::/7 (fc.. and fd..)
  if (/^f[cd][0-9a-f]{0,2}:/.test(stripped)) {
    return true;
  }

  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]?:/.test(stripped)) {
    return true;
  }

  // IPv4-mapped loopback, e.g. ::ffff:127.0.0.1
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(stripped);
  if (mapped && isPrivateIpv4(mapped[1])) {
    return true;
  }

  return false;
}

function isTunnelingHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return TUNNELING_HOST_SUFFIXES.some((suffix) => lowered === suffix.slice(1) || lowered.endsWith(suffix));
}

/**
 * Parse a URL and return it only when it is a publicly-fetchable HTTP/HTTPS URL
 * that Gemini's URL Context can actually retrieve. Returns null otherwise.
 *
 * audit H-08: in addition to the http(s) scheme check, this rejects embedded
 * credentials, loopback/localhost, private/link-local/CGNAT IP ranges, and known
 * tunnelling hosts.
 */
export function parseSupportedHttpUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!SUPPORTED_URL_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  // Reject credentials smuggled into the authority (user:pass@host).
  if (parsed.username || parsed.password) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return null;
  }

  if (LOOPBACK_HOSTNAMES.has(hostname) || LOOPBACK_HOSTNAMES.has(`[${hostname}]`)) {
    return null;
  }

  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return null;
  }

  if (isTunnelingHost(hostname)) {
    return null;
  }

  return parsed;
}

export function isSupportedHttpUrl(value: string): boolean {
  return parseSupportedHttpUrl(value) !== null;
}

export function getUnsupportedUrls(urls: string[]): string[] {
  return urls.filter((url) => !isSupportedHttpUrl(url));
}

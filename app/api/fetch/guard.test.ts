import { describe, expect, it } from 'vitest';
import { isBlockedHost, parseTargetUrl } from './guard';

describe('parseTargetUrl', () => {
  it('accepts http/https public URLs', () => {
    expect(parseTargetUrl('https://example.com/list.m3u')).toBeInstanceOf(URL);
    expect(parseTargetUrl('http://93.184.216.34/x')).toBeInstanceOf(URL);
  });

  it.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'gopher://x',
    'not a url',
    '',
  ])('rejects bad scheme/URL: %s', (u) => {
    expect(parseTargetUrl(u)).toBeNull();
  });

  it.each([
    'http://localhost/x',
    'http://localhost:8080/x',
    'http://sub.localhost/x',
    'http://box.local/x',
    'http://thing.internal/x',
  ])('rejects localhost-style names: %s', (u) => {
    expect(parseTargetUrl(u)).toBeNull();
  });

  it.each([
    'http://127.0.0.1/x',
    'http://127.8.8.8/x',
    'http://10.1.2.3/x',
    'http://172.16.0.1/x',
    'http://172.31.255.255/x',
    'http://192.168.1.1/x',
    'http://169.254.1.1/x',
    'http://0.0.0.0/x',
    'http://100.64.0.1/x',
    'http://224.0.0.1/x',
    'http://255.255.255.255/x',
    'http://2130706433/x',        // decimal IPv4 for 127.0.0.1
    'http://0177.0.0.1/x',        // octal form
    'http://[::1]/x',
    'http://[::ffff:10.0.0.1]/x', // IPv4-mapped IPv6
    'http://[::ffff:0a00:0001]/x',
    'http://[fe80::1]/x',
    'http://[fc00::1]/x',
  ])('rejects private/reserved IP literals: %s', (u) => {
    expect(parseTargetUrl(u)).toBeNull();
  });

  it('accepts public IPs adjacent to blocked ranges', () => {
    expect(parseTargetUrl('http://172.32.0.1/x')).toBeInstanceOf(URL);
    expect(parseTargetUrl('http://11.0.0.1/x')).toBeInstanceOf(URL);
    expect(parseTargetUrl('http://192.169.1.1/x')).toBeInstanceOf(URL);
  });
});

describe('isBlockedHost', () => {
  it('blocks bracketed IPv6 and mapped v4', () => {
    expect(isBlockedHost('[::1]')).toBe(true);
    expect(isBlockedHost('::ffff:192.168.0.9')).toBe(true);
    expect(isBlockedHost('::ffff:8.8.8.8')).toBe(false);
  });

  it('passes domain names (DNS checked separately)', () => {
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

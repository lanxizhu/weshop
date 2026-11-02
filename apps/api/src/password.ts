import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64

/** 密码哈希：scrypt，格式 scrypt:<salt>:<hash>（均为 base64url），随 hash 存库 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('base64url')
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN).toString('base64url')
  return `scrypt:${salt}:${hash}`
}

/** 校验密码，stored 为 hashPassword 产出的字符串 */
export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(plain, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

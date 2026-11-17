import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

function scryptAsync(plain: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

const SCRYPT_KEYLEN = 64

/** 密码哈希：scrypt，格式 scrypt:<salt>:<hash>（均为 base64url），随 hash 存库 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url')
  const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN)
  return `scrypt:${salt}:${hash.toString('base64url')}`
}

/** 校验密码，stored 为 hashPassword 产出的字符串 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  if (expected.length === 0) return false
  const actual = await scryptAsync(plain, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

import { afterEach, describe, expect, it } from 'vitest'
import { http, uploadImage } from './api'

const originalAdapter = http.defaults.adapter

afterEach(() => {
  http.defaults.adapter = originalAdapter
})

describe('uploadImage', () => {
  it('以 multipart FormData 发送文件，而不是 JSON 序列化', async () => {
    let requestData: unknown
    let contentType = ''
    http.defaults.adapter = async (config) => {
      requestData = config.data
      contentType = String(config.headers?.get('Content-Type') ?? '')
      return {
        data: { url: '/uploads/icon.png' },
        status: 201,
        statusText: 'Created',
        headers: {},
        config,
      }
    }

    const file = new File(['png'], 'icon.png', { type: 'image/png' })
    await expect(uploadImage(file)).resolves.toBe('/uploads/icon.png')

    expect(requestData).toBeInstanceOf(FormData)
    if (requestData instanceof FormData) {
      expect(requestData.get('file')).toBe(file)
    }
    expect(contentType).not.toContain('application/json')
  })
})

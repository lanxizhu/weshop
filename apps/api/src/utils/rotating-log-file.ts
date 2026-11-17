import fs from 'node:fs'
import path from 'node:path'

interface RotatingLogFileOptions {
  directory: string
  maxBytes: number
  maxFiles: number
}

export class RotatingLogFile {
  private readonly file: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private stream: fs.WriteStream
  private size = 0

  constructor(options: RotatingLogFileOptions) {
    this.file = path.join(options.directory, 'api.log')
    this.maxBytes = options.maxBytes
    this.maxFiles = options.maxFiles
    fs.mkdirSync(options.directory, { recursive: true })
    this.size = this.currentSize()
    this.stream = this.openStream()
  }

  private currentSize(): number {
    try {
      return fs.statSync(this.file).size
    }
    catch {
      return 0
    }
  }

  private openStream(): fs.WriteStream {
    const fd = fs.openSync(this.file, 'a')
    const stream = fs.createWriteStream(this.file, { fd, flags: 'a' })
    stream.on('error', (error) => {
      console.error('[logger] 日志写入失败', error)
    })
    return stream
  }

  private rotate(): void {
    this.stream.end()
    try {
      if (this.maxFiles <= 1) {
        fs.rmSync(this.file, { force: true })
      }
      else {
        for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
          const source = index === 1 ? this.file : `${this.file}.${index - 1}`
          const destination = `${this.file}.${index}`
          fs.rmSync(destination, { force: true })
          if (fs.existsSync(source)) fs.renameSync(source, destination)
        }
      }
    }
    catch (error) {
      console.error('[logger] 日志轮转失败', error)
    }
    this.size = this.currentSize()
    this.stream = this.openStream()
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line)
    if (this.size > 0 && this.size + bytes > this.maxBytes)
      this.rotate()
    this.size += bytes
    this.stream.write(line)
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.stream.once('finish', resolve)
      this.stream.once('error', resolve)
      this.stream.end()
    })
  }
}

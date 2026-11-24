import { AsyncLocalStorage } from 'node:async_hooks'
import { createPool } from 'mysql2/promise'
import type { Pool, PoolConnection, QueryResult, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  MYSQL_CONNECTION_LIMIT,
  MYSQL_DATABASE,
  MYSQL_HOST,
  MYSQL_PASSWORD,
  MYSQL_PORT,
  MYSQL_USER,
} from './config.js'

export type SqlParam = string | number | bigint | null

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface SqlStatement {
  get<T = unknown>(...params: SqlParam[]): Promise<T | undefined>
  all<T = unknown>(...params: SqlParam[]): Promise<T[]>
  run(...params: SqlParam[]): Promise<RunResult>
}

export interface DatabaseAdapter {
  prepare(sql: string): SqlStatement
  exec(sql: string): Promise<void>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

function localUtcOffset(): string {
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

function normalizeParam(value: SqlParam): string | number | null {
  if (typeof value !== 'bigint') return value
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString()
}

class MysqlStatement implements SqlStatement {
  constructor(
    private readonly adapter: MysqlAdapter,
    private readonly sql: string,
  ) {}

  async get<T = unknown>(...params: SqlParam[]): Promise<T | undefined> {
    const rows = await this.adapter.query(this.sql, params) as RowDataPacket[]
    return rows[0] as T | undefined
  }

  async all<T = unknown>(...params: SqlParam[]): Promise<T[]> {
    return await this.adapter.query(this.sql, params) as T[]
  }

  async run(...params: SqlParam[]): Promise<RunResult> {
    const result = await this.adapter.query(this.sql, params) as ResultSetHeader
    return { changes: Number(result.affectedRows), lastInsertRowid: Number(result.insertId) }
  }
}

class MysqlAdapter implements DatabaseAdapter {
  private readonly transactionContext = new AsyncLocalStorage<PoolConnection>()
  private readonly initializedConnections = new WeakSet<PoolConnection>()
  private readonly pool: Pool = createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    database: MYSQL_DATABASE,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    connectionLimit: MYSQL_CONNECTION_LIMIT,
    waitForConnections: true,
    enableKeepAlive: true,
    charset: 'utf8mb4',
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  })

  prepare(sql: string): SqlStatement {
    return new MysqlStatement(this, sql)
  }

  private async initializeConnection(connection: PoolConnection): Promise<void> {
    if (this.initializedConnections.has(connection)) return
    await connection.query('SET SESSION time_zone = ?', [localUtcOffset()])
    this.initializedConnections.add(connection)
  }

  async query(sql: string, params: SqlParam[] = []): Promise<QueryResult> {
    const transactionConnection = this.transactionContext.getStore()
    if (transactionConnection) {
      const [result] = await transactionConnection.query(sql, params.map(normalizeParam))
      return result
    }
    const connection = await this.pool.getConnection()
    try {
      await this.initializeConnection(connection)
      const [result] = await connection.query(sql, params.map(normalizeParam))
      return result
    }
    finally {
      connection.release()
    }
  }

  async exec(sql: string): Promise<void> {
    await this.query(sql)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) return fn()
    const connection = await this.pool.getConnection()
    try {
      await this.initializeConnection(connection)
      await connection.beginTransaction()
      try {
        const result = await this.transactionContext.run(connection, fn)
        await connection.commit()
        return result
      }
      catch (error) {
        try {
          await connection.rollback()
        }
        catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'MySQL 事务回滚失败')
        }
        throw error
      }
    }
    finally {
      connection.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export function createDatabaseAdapter(): DatabaseAdapter {
  return new MysqlAdapter()
}

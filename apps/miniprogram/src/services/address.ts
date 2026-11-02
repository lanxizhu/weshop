import type { Address, AddressInput } from '@weshop/shared'
import { request } from './request'

export function fetchAddresses(): Promise<{ addresses: Address[] }> {
  return request<{ addresses: Address[] }>('/addresses')
}

export function createAddress(input: AddressInput): Promise<{ address: Address }> {
  return request<{ address: Address }>('/addresses', { method: 'POST', data: { ...input } })
}

export function updateAddress(id: number, input: AddressInput): Promise<{ address: Address }> {
  return request<{ address: Address }>(`/addresses/${id}`, { method: 'PUT', data: { ...input } })
}

export function setDefaultAddress(id: number): Promise<{ address: Address }> {
  return request<{ address: Address }>(`/addresses/${id}/default`, { method: 'PATCH' })
}

export function deleteAddress(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/addresses/${id}`, { method: 'DELETE' })
}

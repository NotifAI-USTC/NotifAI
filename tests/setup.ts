import { afterEach, vi } from 'vitest'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value))
  }
}

const localStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorage,
})
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorage,
})

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.restoreAllMocks()
})

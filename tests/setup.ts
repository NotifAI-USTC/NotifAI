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

// 测试环境必须提供确定性的 API 基地址，否则 request.ts 在模块加载时会因
// 缺少 VITE_API_BASE_URL 抛出 ApiConfigurationError（CI 上没有 gitignored 的 .env）。
// 这里在 setup 阶段注入，保证测试不依赖本机环境文件，行为一致。
vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.invalid/api')
vi.stubEnv('VITE_USE_MOCK', 'false')

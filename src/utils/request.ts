import axios from 'axios'
import type { NoticeItem, NoticeListResponse } from '../types/notice'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
})

// 响应拦截器：统一错误处理
request.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message || error.message || '网络请求失败'
    console.error('[API Error]', message)
    return Promise.reject(error)
  },
)

export default request

/** 获取通知列表 */
export async function fetchNotices(params: {
  category?: string
  page?: number
  pageSize?: number
}): Promise<NoticeListResponse> {
  const res = await request.get<NoticeListResponse>('/notices', { params })
  return res.data
}

/** 获取单条通知详情 */
export async function fetchNoticeById(id: string): Promise<NoticeItem> {
  const res = await request.get<NoticeItem>(`/notices/${id}`)
  return res.data
}

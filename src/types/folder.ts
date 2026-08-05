export interface Folder {
  id: string
  name: string
  icon: string
  createdAt: number
}

export const DEFAULT_FOLDERS: Folder[] = [
  { id: 'default', name: '默认收藏', icon: '$star', createdAt: 0 },
  { id: 'course', name: '课程相关', icon: '$school', createdAt: 1 },
  { id: 'competition', name: '竞赛活动', icon: '$trophy', createdAt: 2 },
  { id: 'research', name: '科研学术', icon: '$flask', createdAt: 3 },
  { id: 'campus', name: '校园生活', icon: '$domain', createdAt: 4 },
]

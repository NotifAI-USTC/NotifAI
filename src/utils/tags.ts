/**
 * 智能标签推荐工具
 */

import type { NoticeItem } from '../types/notice'
import { calculateRemainingDays } from './date'

// 标签关键词映射
const TAG_KEYWORDS: Record<string, string[]> = {
  学业: ['选课', '考试', '成绩', '学分', '补考', '重修', '转专业', '辅修', '双学位'],
  竞赛: ['竞赛', '比赛', '大赛', '挑战杯', '数学建模', 'ACM', '编程', '算法'],
  科研: ['科研', '论文', '实验', '课题', '项目', '基金', '实验室', '研究'],
  讲座: ['讲座', '报告', '学术', '论坛', '研讨会', '沙龙'],
  就业: ['招聘', '实习', '就业', '校招', '宣讲会', '简历', '面试', 'offer'],
  升学: ['考研', '保研', '出国', '留学', '申请', '推免', '研究生'],
  奖学金: ['奖学金', '助学金', '补助', '资助', '奖励'],
  社团: ['社团', '学生会', '志愿者', '活动', '招新'],
  国际: ['国际', '交流', '交换', '留学', '海外', '外事'],
  紧急: ['紧急', '重要', '截止', '最后', '尽快', '立即'],
  新生: ['新生', '入学', '迎新', '报到', '注册'],
  毕业: ['毕业', '论文', '答辩', '学位', '典礼', '离校'],
  缴费: ['缴费', '费用', '学费', '住宿费', '支付'],
  通知: ['通知', '公告', '告示', '发布'],
  活动: ['活动', '晚会', '比赛', '运动会', '文化节'],
}

// 来源标签映射
const SOURCE_TAGS: Record<string, string[]> = {
  教务处: ['学业', '教务'],
  本科生院: ['学业', '教务'],
  研究生院: ['升学', '科研'],
  学工部: ['学生事务'],
  校团委: ['社团', '活动'],
  就业指导中心: ['就业'],
  国际合作与交流部: ['国际'],
  图书馆: ['学习资源'],
  后勤保障处: ['生活'],
  保卫处: ['安全'],
  财务处: ['缴费'],
}

// 预定义标签颜色
export const TAG_COLORS: Record<string, string> = {
  学业: '#4a6cf7',
  竞赛: '#f59e0b',
  科研: '#8b5cf6',
  讲座: '#06b6d4',
  就业: '#10b981',
  升学: '#6366f1',
  奖学金: '#f97316',
  社团: '#ec4899',
  国际: '#14b8a6',
  紧急: '#ef4444',
  新生: '#84cc16',
  毕业: '#a855f7',
  缴费: '#64748b',
  通知: '#6b7280',
  活动: '#f43f5e',
}

// 推荐标签
export function recommendTags(notice: NoticeItem): string[] {
  const tags: string[] = []
  const text = `${notice.title} ${notice.aiSummary}`.toLowerCase()

  // 基于关键词推荐
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      tags.push(tag)
    }
  }

  // 基于来源推荐
  const sourceTags = Object.hasOwn(SOURCE_TAGS, notice.source)
    ? SOURCE_TAGS[notice.source]
    : undefined
  if (sourceTags) {
    sourceTags.forEach((tag) => {
      if (!tags.includes(tag)) {
        tags.push(tag)
      }
    })
  }

  // 基于截止时间推荐紧急标签
  if (notice.deadline) {
    const diffDays = calculateRemainingDays(notice.deadline)
    if (diffDays !== null && diffDays >= 0 && diffDays <= 3) {
      if (!tags.includes('紧急')) {
        tags.push('紧急')
      }
    }
  }

  return tags
}

// 获取标签颜色
export function getTagColor(tag: string): string {
  return Object.hasOwn(TAG_COLORS, tag) ? TAG_COLORS[tag] : '#6b7280'
}

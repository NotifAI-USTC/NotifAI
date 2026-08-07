/** 根据背景色计算可读的前景文本颜色（基于 WCAG 相对亮度）。 */
export function getContrastTextColor(background: string): '#000000' | '#ffffff' {
  const channels = background
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
  if (!channels || channels.length !== 3 || channels.some(Number.isNaN)) return '#ffffff'

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

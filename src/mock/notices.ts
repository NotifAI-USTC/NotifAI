import type { NoticeItem, NoticeListResponse } from '../types/notice'

// 获取今天和未来几天的日期
function getDate(daysFromNow: number): string {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  return formatLocalDate(date)
}

// 获取过去几天的日期
function getPastDate(daysAgo: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return formatLocalDate(date)
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 模拟通知数据 */
export const mockNotices: NoticeItem[] = [
  // ===== 教务通知 =====
  {
    id: 'edu-001',
    title: '关于本学期本科生选课安排的通知',
    source: '教务处',
    publishDate: getPastDate(2),
    aiSummary: '本学期选课即将开始，请同学们提前确认培养方案并规划课程。',
    deadline: getDate(5),
    targetAudience: '全体本科生',
    coreAction: '登录教务系统进行选课',
    originUrl: 'https://www.ustc.edu.cn/notice/001',
    cleanContent: `
      <h3>一、选课时间安排</h3>
      <p>第一轮选课：${getDate(1)} 9:00 - ${getDate(5)} 17:00</p>
      <p>第二轮选课：${getDate(6)} 9:00 - ${getDate(10)} 17:00</p>
      <p>补退选阶段：${getDate(11)} 9:00 - ${getDate(20)} 17:00</p>
      
      <h3>二、选课注意事项</h3>
      <ul>
        <li>请提前登录教务系统确认账号密码正确</li>
        <li>建议使用 Chrome 或 Firefox 浏览器</li>
        <li>选课期间如遇系统拥堵，请耐心等待</li>
      </ul>
      
      <h3>三、课程容量说明</h3>
      <p>热门课程容量有限，采用先到先得原则。如未选上，请关注后续补退选阶段。</p>
    `,
    attachments: [
      { name: '本学期课程表.xlsx', url: 'https://example.com/files/course-schedule.xlsx' },
      { name: '选课系统使用指南.pdf', url: 'https://example.com/files/selection-guide.pdf' },
    ],
  },
  {
    id: 'edu-002',
    title: '假期期间图书馆开放时间调整',
    source: '图书馆',
    publishDate: getPastDate(1),
    aiSummary: '假期期间图书馆开放时间调整为9:00-17:00，部分楼层暂停开放。',
    deadline: null,
    targetAudience: '全校师生',
    coreAction: '合理安排借阅时间',
    originUrl: 'https://www.ustc.edu.cn/notice/002',
    cleanContent: `
      <h3>假期开放时间</h3>
      <p>${getPastDate(1)} 至 ${getDate(14)}：</p>
      <ul>
        <li>周一至周五：9:00 - 17:00</li>
        <li>周六、周日：闭馆</li>
      </ul>
      
      <h3>楼层安排</h3>
      <p>1-3楼正常开放，4-6楼关闭进行设备维护</p>
      <p>自习室座位需提前预约</p>
    `,
    attachments: [
      { name: '图书馆假期时间表.pdf', url: 'https://example.com/files/library-schedule.pdf' },
    ],
  },
  {
    id: 'edu-003',
    title: '关于本学期教材领取的通知',
    source: '教务处',
    publishDate: getPastDate(3),
    aiSummary: '教材领取窗口即将开放，请携带学生证到指定地点领取。',
    deadline: getDate(10),
    targetAudience: '全体本科生',
    coreAction: '携带学生证到教材中心领取',
    originUrl: 'https://www.ustc.edu.cn/notice/003',
    cleanContent: `
      <h3>领取时间</h3>
      <p>${getDate(6)} 至 ${getDate(10)}，每天 9:00-17:00</p>
      
      <h3>领取地点</h3>
      <p>东区教材中心（学生活动中心一楼）</p>
      
      <h3>注意事项</h3>
      <ul>
        <li>请携带本人学生证</li>
        <li>如需代领，请携带双方学生证及委托书</li>
        <li>教材费用将从校园卡扣除</li>
      </ul>
    `,
    attachments: [],
  },
  {
    id: 'edu-004',
    title: '国家奖学金与校级优秀学生奖学金申报提醒',
    source: '学工部',
    publishDate: getPastDate(7),
    aiSummary: '奖学金申报今天截止，符合条件的同学须在系统中提交材料并联系辅导员审核。',
    deadline: getDate(0),
    targetAudience: '全日制本科生',
    coreAction: '今天17:00前提交奖学金申请',
    originUrl: 'https://www.ustc.edu.cn/notice/edu-004',
    cleanContent: `
      <h3>申报范围</h3>
      <p>本次评选包含国家奖学金、国家励志奖学金和校级优秀学生奖学金。</p>
      <h3>时间要求</h3>
      <p>网上申报截止时间：${getDate(0)} 17:00，逾期系统将自动关闭。</p>
      <h3>提交材料</h3>
      <ul>
        <li>奖学金申请表</li>
        <li>成绩单及综合测评证明</li>
        <li>获奖、科研或社会实践证明</li>
      </ul>
    `,
    attachments: [
      { name: '奖学金申请表.docx', url: 'https://example.com/files/scholarship-form.docx' },
      { name: '评审细则.pdf', url: 'https://example.com/files/scholarship-rules.pdf' },
    ],
  },
  {
    id: 'edu-005',
    title: '关于选派学生参加海外交换学习项目的报名通知',
    source: '国际合作与交流部',
    publishDate: getPastDate(4),
    aiSummary: '新一批海外交换项目开放申请，覆盖亚洲、欧洲和北美多所合作高校。',
    deadline: getDate(14),
    targetAudience: '本科二、三年级学生及研究生',
    coreAction: '完成在线申请并向院系提交纸质材料',
    originUrl: 'https://www.ustc.edu.cn/notice/edu-005',
    cleanContent: `
      <h3>项目说明</h3>
      <p>交换学习时间为一学期，学生在外所修学分经审核后可按规定转换。</p>
      <h3>基本条件</h3>
      <ul>
        <li>综合成绩排名原则上位于专业前50%</li>
        <li>具备项目要求的外语水平</li>
        <li>无未解除的纪律处分</li>
      </ul>
      <h3>申请截止</h3>
      <p>${getDate(14)} 17:00 前完成系统提交。</p>
    `,
    attachments: [
      { name: '交换项目清单.xlsx', url: 'https://example.com/files/exchange-programs.xlsx' },
      { name: '交换学习申请指南.pdf', url: 'https://example.com/files/exchange-guide.pdf' },
    ],
  },
  {
    id: 'edu-006',
    title: '实验室安全准入考试开放通知',
    source: '科研部',
    publishDate: getPastDate(2),
    aiSummary: '进入实验室前须完成在线学习和安全考试，成绩达到90分方可通过。',
    deadline: getDate(7),
    targetAudience: '新进入实验室的本科生、研究生及科研助理',
    coreAction: '登录实验室安全平台完成考试',
    originUrl: 'https://www.ustc.edu.cn/notice/edu-006',
    cleanContent: `
      <h3>考试安排</h3>
      <p>考试平台全天开放，答题时间45分钟，可在截止日期前重复参加。</p>
      <h3>通过标准</h3>
      <p>满分100分，90分及以上为通过。涉及化学、生物实验的人员还须完成专项模块。</p>
      <h3>截止时间</h3>
      <p>${getDate(7)} 23:59。</p>
    `,
    attachments: [
      { name: '实验室安全学习手册.pdf', url: 'https://example.com/files/lab-safety.pdf' },
    ],
  },
  {
    id: 'edu-007',
    title: '期末考试成绩复核申请',
    source: '本科生院',
    publishDate: getPastDate(10),
    aiSummary: '对期末成绩有异议的同学可提交复核申请，本轮申请通道已经关闭。',
    deadline: getPastDate(1),
    targetAudience: '全体本科生',
    coreAction: '查看已提交申请的处理进度',
    originUrl: 'https://www.ustc.edu.cn/notice/edu-007',
    cleanContent: `
      <h3>申请范围</h3>
      <p>成绩复核仅核查分数登记、合计和录入是否有误，不重新评阅试卷。</p>
      <h3>处理进度</h3>
      <p>申请已于 ${getPastDate(1)} 截止，结果将在五个工作日内反馈。</p>
    `,
    attachments: [],
  },
  {
    id: 'edu-008',
    title: '考试周考场安排及诚信考试提示',
    source: '教务处',
    publishDate: getDate(0),
    aiSummary: '考试周考场信息已经发布，请提前核对考试时间、地点并遵守考场纪律。',
    deadline: null,
    targetAudience: '全体学生',
    coreAction: '下载个人考试安排并核对考场',
    originUrl: 'https://www.ustc.edu.cn/notice/edu-008',
    cleanContent: `
      <h3>考场查询</h3>
      <p>请登录教务系统，在“考试安排”中查看个人考试时间和座位号。</p>
      <h3>入场要求</h3>
      <ul>
        <li>携带校园卡或有效身份证件</li>
        <li>提前15分钟到达考场</li>
        <li>手机、智能手表等设备按监考要求集中存放</li>
      </ul>
    `,
    attachments: [
      { name: '考试周公共课考场安排.xlsx', url: 'https://example.com/files/exam-rooms.xlsx' },
    ],
  },

  // ===== 学术讲座 =====
  {
    id: 'lecture-001',
    title: '人工智能前沿讲座：大语言模型的未来',
    source: '计算机学院',
    publishDate: getPastDate(1),
    aiSummary: '邀请业界专家分享大语言模型最新进展，探讨AI未来发展方向。',
    deadline: getDate(2),
    targetAudience: '研究生及高年级本科生',
    coreAction: '扫描二维码报名参加',
    originUrl: 'https://www.ustc.edu.cn/notice/004',
    cleanContent: `
      <h3>讲座主题</h3>
      <p>大语言模型的现状与未来：从GPT到通用人工智能</p>
      
      <h3>主讲人</h3>
      <p>张教授，清华大学人工智能研究院</p>
      
      <h3>时间地点</h3>
      <ul>
        <li>时间：${getDate(2)} 14:00-16:00</li>
        <li>地点：西区图书馆报告厅</li>
        <li>线上同步：腾讯会议 123-456-789</li>
      </ul>
      
      <h3>报名方式</h3>
      <p>扫描下方二维码或点击链接报名，名额限200人。</p>
    `,
    attachments: [{ name: '讲座海报.jpg', url: 'https://example.com/files/lecture-poster.jpg' }],
  },
  {
    id: 'lecture-002',
    title: '量子计算前沿讲座：从理论到实践',
    source: '物理学院',
    publishDate: getPastDate(2),
    aiSummary: '特邀量子信息领域专家分享量子计算的最新成果与产业化进展。',
    deadline: getDate(1),
    targetAudience: '全校师生',
    coreAction: '凭校园卡入场，座位有限先到先得',
    originUrl: 'https://www.ustc.edu.cn/notice/005',
    cleanContent: `
      <h3>讲座信息</h3>
      <p>主题：量子计算——从理论到实践的突破</p>
      <p>主讲：量子信息领域特邀教授</p>
      
      <h3>时间地点</h3>
      <p>时间：${getDate(1)} 15:00-17:00</p>
      <p>地点：东区大礼堂</p>
      
      <h3>入场须知</h3>
      <ul>
        <li>凭校园卡入场</li>
        <li>请提前15分钟到场</li>
        <li>讲座期间请将手机调至静音</li>
      </ul>
    `,
    attachments: [],
  },

  {
    id: 'lecture-003',
    title: '数据科学前沿论坛：让大模型读懂科学数据',
    source: '大数据学院',
    publishDate: getDate(0),
    aiSummary: '论坛聚焦AI大模型、科学数据治理与跨学科研究，提供线上同步直播。',
    deadline: getDate(4),
    targetAudience: '全校师生',
    coreAction: '预约线下座位或线上直播',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-003',
    cleanContent: `
      <h3>论坛主题</h3>
      <p>从多模态模型到科学智能：数据、算法与可信评测。</p>
      <h3>时间地点</h3>
      <p>${getDate(4)} 14:30，东区水上报告厅。</p>
      <h3>议程</h3>
      <ul>
        <li>科学数据基础设施与开放共享</li>
        <li>大模型在材料和生命科学中的应用</li>
        <li>青年学者圆桌讨论</li>
      </ul>
    `,
    attachments: [
      { name: '数据科学前沿论坛海报.png', url: 'https://example.com/files/data-forum.png' },
    ],
  },
  {
    id: 'lecture-004',
    title: '新能源材料系列讲座：下一代固态电池界面调控',
    source: '化学与材料科学学院',
    publishDate: getPastDate(3),
    aiSummary: '报告介绍固态电池关键界面问题及原位表征技术，讲座后安排学术交流。',
    deadline: getDate(8),
    targetAudience: '化学、材料、物理相关专业师生',
    coreAction: '在学院活动平台登记参加',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-004',
    cleanContent: `
      <h3>报告摘要</h3>
      <p>报告将围绕固态电解质稳定性、界面离子输运和电池失效分析展开。</p>
      <h3>报告时间</h3>
      <p>${getDate(8)} 10:00-11:30，材料楼学术报告厅。</p>
      <h3>交流安排</h3>
      <p>报告结束后设置30分钟提问环节，无需纸质门票。</p>
    `,
    attachments: [],
  },
  {
    id: 'lecture-005',
    title: '生命医学交叉讲座：单细胞技术与精准医学',
    source: '生命科学与医学部',
    publishDate: getPastDate(5),
    aiSummary: '讲座将通过真实研究案例介绍单细胞测序、空间组学和临床转化。',
    deadline: getDate(10),
    targetAudience: '生命科学、医学及数据科学相关师生',
    coreAction: '填写报名表并选择参会方式',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-005',
    cleanContent: `
      <h3>主要内容</h3>
      <ul>
        <li>单细胞多组学技术进展</li>
        <li>空间转录组数据分析</li>
        <li>科研成果的临床验证路径</li>
      </ul>
      <h3>时间地点</h3>
      <p>${getDate(10)} 15:00，生命科学楼一楼报告厅。</p>
    `,
    attachments: [
      { name: '讲座摘要与嘉宾简介.pdf', url: 'https://example.com/files/biomed-talk.pdf' },
    ],
  },
  {
    id: 'lecture-006',
    title: '地球观测午间学术沙龙',
    source: '地球与空间科学学院',
    publishDate: getPastDate(6),
    aiSummary: '本期沙龙讨论卫星遥感在极端天气监测中的应用，无需报名。',
    deadline: null,
    targetAudience: '对遥感、气象和地球系统科学感兴趣的师生',
    coreAction: '按时前往教学行政楼参加',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-006',
    cleanContent: `
      <h3>沙龙议题</h3>
      <p>多源卫星数据融合、强对流天气快速识别与灾害风险评估。</p>
      <h3>参与方式</h3>
      <p>活动免费开放，不设报名截止时间，现场座位共80个。</p>
    `,
    attachments: [],
  },
  {
    id: 'lecture-007',
    title: '集成电路名家讲堂：先进封装与芯片系统协同设计',
    source: '信息科学技术学院',
    publishDate: getPastDate(8),
    aiSummary: '讲堂聚焦先进封装、Chiplet互连和芯片系统协同优化，面向全校开放。',
    deadline: getDate(18),
    targetAudience: '电子信息、计算机、材料相关专业学生',
    coreAction: '通过活动预约系统报名',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-007',
    cleanContent: `
      <h3>讲座信息</h3>
      <p>${getDate(18)} 14:00-16:00，西区学生活动中心礼堂。</p>
      <h3>内容提要</h3>
      <p>从系统需求出发，介绍2.5D/3D封装、Chiplet标准和热管理的最新实践。</p>
      <h3>席位说明</h3>
      <p>线下限额300人，报名成功后将发送电子入场凭证。</p>
    `,
    attachments: [
      { name: '嘉宾介绍.pdf', url: 'https://example.com/files/chip-speaker.pdf' },
      { name: '讲堂议程.pdf', url: 'https://example.com/files/chip-agenda.pdf' },
    ],
  },
  {
    id: 'lecture-008',
    title: '交叉科学论坛报名结束及直播回放说明',
    source: '科研部',
    publishDate: getPastDate(12),
    aiSummary: '线下论坛报名已经结束，未能到场的师生可在活动结束后观看回放。',
    deadline: getPastDate(2),
    targetAudience: '全校科研人员及研究生',
    coreAction: '关注科研部主页获取回放链接',
    originUrl: 'https://www.ustc.edu.cn/notice/lecture-008',
    cleanContent: `
      <h3>报名状态</h3>
      <p>线下席位已满，报名通道于 ${getPastDate(2)} 关闭。</p>
      <h3>回放安排</h3>
      <p>论坛结束后三个工作日内发布经嘉宾授权的报告回放和演示文稿。</p>
    `,
    attachments: [],
  },

  // ===== 学科竞赛 =====
  {
    id: 'contest-001',
    title: '本年度美国大学生数学建模竞赛报名通知',
    source: '数学科学学院',
    publishDate: getPastDate(4),
    aiSummary: '美赛报名即将截止，请有意参赛的同学尽快组队报名。',
    deadline: getDate(3),
    targetAudience: '全校本科生',
    coreAction: '三人组队在官网报名',
    originUrl: 'https://www.ustc.edu.cn/notice/006',
    cleanContent: `
      <h3>竞赛时间</h3>
      <p>${getDate(30)} 至 ${getDate(34)}（北京时间）</p>
      
      <h3>报名截止</h3>
      <p>${getDate(3)}</p>
      
      <h3>组队要求</h3>
      <ul>
        <li>每队3人，可跨学院组队</li>
        <li>至少1人熟悉编程</li>
        <li>建议配备1人数学建模经验</li>
      </ul>
      
      <h3>报名方式</h3>
      <p>访问官方网站 http://www.comap.com/mcmp 注册并报名</p>
      <p>报名费：100美元/队</p>
    `,
    attachments: [
      { name: '美赛参赛指南.pdf', url: 'https://example.com/files/mcm-guide.pdf' },
      { name: '历届优秀论文集.zip', url: 'https://example.com/files/past-papers.zip' },
    ],
  },
  {
    id: 'contest-002',
    title: '第十六届"挑战杯"全国大学生课外学术科技作品竞赛通知',
    source: '校团委',
    publishDate: getPastDate(5),
    aiSummary: '"挑战杯"竞赛开始征集作品，鼓励同学们积极参与科技创新。',
    deadline: getDate(20),
    targetAudience: '全校本科生、研究生',
    coreAction: '联系院系团委提交作品申报书',
    originUrl: 'https://www.ustc.edu.cn/notice/007',
    cleanContent: `
      <h3>竞赛简介</h3>
      <p>"挑战杯"被誉为中国大学生科技创新的"奥林匹克"盛会</p>
      
      <h3>作品类别</h3>
      <ul>
        <li>自然科学类学术论文</li>
        <li>哲学社会科学类调查报告</li>
        <li>科技发明制作</li>
      </ul>
      
      <h3>赛程安排</h3>
      <p>院级初赛：${getDate(20)}</p>
      <p>校级复赛：${getDate(30)}</p>
      <p>省级决赛：待定</p>
      
      <h3>联系方式</h3>
      <p>校团委科技创新部：0551-63600000</p>
    `,
    attachments: [
      { name: '申报书模板.docx', url: 'https://example.com/files/application-template.docx' },
    ],
  },

  {
    id: 'contest-003',
    title: 'ACM程序设计校赛组队及报名通知',
    source: '计算机学院',
    publishDate: getPastDate(1),
    aiSummary: '程序设计校赛报名即将截止，支持跨学院三人组队，优胜队伍将参加集训选拔。',
    deadline: getDate(1),
    targetAudience: '全体在校学生',
    coreAction: '完成三人组队并提交报名信息',
    originUrl: 'https://www.ustc.edu.cn/notice/contest-003',
    cleanContent: `
      <h3>竞赛安排</h3>
      <p>比赛采用ICPC赛制，时长5小时，支持C++、Java和Python。</p>
      <h3>报名要求</h3>
      <ul>
        <li>每队最多3名正式队员</li>
        <li>允许跨年级、跨学院组队</li>
        <li>报名截止：${getDate(1)} 20:00</li>
      </ul>
    `,
    attachments: [{ name: 'ACM校赛规则.pdf', url: 'https://example.com/files/acm-rules.pdf' }],
  },
  {
    id: 'contest-004',
    title: '校园数据创新应用竞赛作品征集',
    source: '大数据学院',
    publishDate: getPastDate(4),
    aiSummary: '竞赛开放脱敏校园数据集，鼓励围绕学习、科研和校园服务提出数据产品方案。',
    deadline: getDate(15),
    targetAudience: '全校本科生、研究生',
    coreAction: '组队提交项目说明书与演示视频',
    originUrl: 'https://www.ustc.edu.cn/notice/contest-004',
    cleanContent: `
      <h3>赛题方向</h3>
      <ul>
        <li>教学资源智能推荐</li>
        <li>校园能耗分析与优化</li>
        <li>科研信息可视化</li>
      </ul>
      <h3>作品要求</h3>
      <p>每队2-5人，提交10页以内项目说明书和不超过5分钟的演示视频。</p>
    `,
    attachments: [
      { name: '竞赛数据使用协议.pdf', url: 'https://example.com/files/data-agreement.pdf' },
      { name: '作品说明书模板.docx', url: 'https://example.com/files/data-contest-template.docx' },
    ],
  },
  {
    id: 'contest-005',
    title: '全国大学生物理实验竞赛校内选拔',
    source: '物理学院',
    publishDate: getPastDate(9),
    aiSummary: '校内选拔分为命题实验和创新作品两类，报名团队可预约开放实验室。',
    deadline: getDate(30),
    targetAudience: '本科生',
    coreAction: '选择赛道并提交校内选拔报名表',
    originUrl: 'https://www.ustc.edu.cn/notice/contest-005',
    cleanContent: `
      <h3>竞赛组别</h3>
      <p>基础物理实验、近代物理实验和物理实验创新作品。</p>
      <h3>开放实验室</h3>
      <p>每周三、周六开放，参赛队须至少提前两天预约。</p>
      <h3>报名截止</h3>
      <p>${getDate(30)} 17:00。</p>
    `,
    attachments: [
      { name: '校内选拔报名表.xlsx', url: 'https://example.com/files/physics-contest.xlsx' },
    ],
  },
  {
    id: 'contest-006',
    title: '大学生化学创新实验设计竞赛结果公示',
    source: '化学与材料科学学院',
    publishDate: getPastDate(15),
    aiSummary: '创新实验设计竞赛申报已结束，现公示校级评审结果和推荐名单。',
    deadline: getPastDate(3),
    targetAudience: '参赛学生及指导教师',
    coreAction: '查看公示结果；异议受理已结束',
    originUrl: 'https://www.ustc.edu.cn/notice/contest-006',
    cleanContent: `
      <h3>公示说明</h3>
      <p>评审结果按创新性、科学性、可操作性和安全规范综合确定。</p>
      <h3>异议受理</h3>
      <p>异议受理已于 ${getPastDate(3)} 截止，最终名单将在学院网站归档。</p>
    `,
    attachments: [
      {
        name: '校级评审结果及推荐参加全国赛作品名单.pdf',
        url: 'https://example.com/files/chemistry-results.pdf',
      },
    ],
  },
  {
    id: 'contest-007',
    title: '大学生网络安全攻防竞赛报名',
    source: '信息科学技术学院',
    publishDate: getPastDate(2),
    aiSummary: '网络安全竞赛设置解题赛和攻防赛，欢迎具备编程、密码学或系统安全基础的同学参加。',
    deadline: getDate(6),
    targetAudience: '全体在校学生',
    coreAction: '组建1-4人队伍并签署竞赛承诺书',
    originUrl: 'https://www.ustc.edu.cn/notice/contest-007',
    cleanContent: `
      <h3>赛制说明</h3>
      <p>初赛采用线上CTF解题赛，决赛采用线下攻防对抗形式。</p>
      <h3>报名提醒</h3>
      <p>禁止使用未授权的扫描或攻击工具影响校内网络，违规队伍将取消资格。</p>
    `,
    attachments: [
      { name: '竞赛规程.pdf', url: 'https://example.com/files/security-contest.pdf' },
      { name: '参赛承诺书.docx', url: 'https://example.com/files/security-pledge.docx' },
    ],
  },

  // ===== 校园生活 =====
  {
    id: 'campus-001',
    title: '假期食堂及浴室开放安排',
    source: '后勤保障处',
    publishDate: getPastDate(2),
    aiSummary: '假期期间部分食堂和浴室调整开放时间，请提前了解。',
    deadline: null,
    targetAudience: '留校师生',
    coreAction: '查看各食堂开放时间表',
    originUrl: 'https://www.ustc.edu.cn/notice/008',
    cleanContent: `
      <h3>食堂开放情况</h3>
      <table>
        <tr><th>食堂</th><th>开放时间</th><th>备注</th></tr>
        <tr><td>东区学生食堂</td><td>7:00-20:00</td><td>正常营业</td></tr>
        <tr><td>西区学生食堂</td><td>7:00-19:00</td><td>部分窗口</td></tr>
        <tr><td>南区食堂</td><td>闭餐</td><td>维护中</td></tr>
      </table>
      
      <h3>浴室开放时间</h3>
      <p>东区浴室：12:00-22:00</p>
      <p>西区浴室：14:00-22:00</p>
    `,
    attachments: [],
  },
  {
    id: 'campus-002',
    title: '校园电动车充电桩新增及使用规范',
    source: '保卫处',
    publishDate: getPastDate(1),
    aiSummary: '新增50个电动车充电桩，规范校园电动车停放和充电行为。',
    deadline: null,
    targetAudience: '全校师生',
    coreAction: '查看充电桩位置分布图',
    originUrl: 'https://www.ustc.edu.cn/notice/009',
    cleanContent: `
      <h3>新增充电桩位置</h3>
      <ul>
        <li>东区教学楼停车场：20个</li>
        <li>西区图书馆旁：15个</li>
        <li>学生宿舍区：15个</li>
      </ul>
      
      <h3>使用规范</h3>
      <ul>
        <li>充电时间限制：单次不超过8小时</li>
        <li>充满后请及时移走，超时将收取占位费</li>
        <li>禁止飞线充电、室内充电</li>
      </ul>
      
      <h3>收费标准</h3>
      <p>1元/4小时，2元/8小时</p>
    `,
    attachments: [{ name: '充电桩分布图.jpg', url: 'https://example.com/files/charging-map.jpg' }],
  },
  {
    id: 'campus-003',
    title: '大型校园招聘会预告',
    source: '就业指导中心',
    publishDate: getPastDate(3),
    aiSummary: '大型校园招聘会即将举行，50余家企业参与，岗位涵盖多个行业。',
    deadline: getDate(25),
    targetAudience: '应届毕业生及有实习需求的学生',
    coreAction: '提前准备简历，关注企业名单',
    originUrl: 'https://www.ustc.edu.cn/notice/010',
    cleanContent: `
      <h3>招聘会信息</h3>
      <p>时间：${getDate(25)} 9:00-16:00</p>
      <p>地点：东区体育馆</p>
      
      <h3>参会企业（部分）</h3>
      <ul>
        <li>华为、腾讯、阿里巴巴、字节跳动</li>
        <li>中国银行、工商银行、建设银行</li>
        <li>中科院各研究所</li>
        <li>比亚迪、宁德时代、蔚来汽车</li>
      </ul>
      
      <h3>参会须知</h3>
      <ul>
        <li>请携带多份纸质简历</li>
        <li>着正装出席</li>
        <li>提前查看企业展位分布</li>
      </ul>
    `,
    attachments: [
      { name: '参会企业名单.pdf', url: 'https://example.com/files/company-list.pdf' },
      { name: '展位分布图.pdf', url: 'https://example.com/files/booth-map.pdf' },
    ],
  },

  {
    id: 'campus-004',
    title: '毕业生集中体检预约通知',
    source: '生命科学与医学部',
    publishDate: getPastDate(1),
    aiSummary: '毕业生集中体检预约将在两天后截止，请按就业单位要求选择体检套餐。',
    deadline: getDate(2),
    targetAudience: '应届毕业生',
    coreAction: '预约体检时段并保持空腹',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-004',
    cleanContent: `
      <h3>体检安排</h3>
      <p>体检地点为东区校医院，工作日上午7:30-11:00开放。</p>
      <h3>注意事项</h3>
      <ul>
        <li>体检前一天清淡饮食，晚22:00后禁食</li>
        <li>携带身份证、校园卡和一寸照片</li>
        <li>特殊岗位请提前确认体检项目</li>
      </ul>
    `,
    attachments: [
      { name: '毕业生体检项目与收费标准.pdf', url: 'https://example.com/files/health-check.pdf' },
    ],
  },
  {
    id: 'campus-005',
    title: '宿舍停水提醒',
    source: '后勤保障处',
    publishDate: getDate(0),
    aiSummary: '部分学生宿舍今天进行供水管网检修，预计晚间恢复，请提前储水。',
    deadline: getDate(0),
    targetAudience: '东区1号至4号学生宿舍住户',
    coreAction: '提前储备必要生活用水',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-005',
    cleanContent: `
      <h3>停水范围</h3>
      <p>东区1号至4号学生宿舍及相邻公共区域。</p>
      <h3>检修时间</h3>
      <p>${getDate(0)} 13:00-19:00，如提前完成将立即恢复供水。</p>
      <p>检修后短时出现水质浑浊时，请放水数分钟后再使用。</p>
    `,
    attachments: [],
  },
  {
    id: 'campus-006',
    title: '心理健康主题月活动一览',
    source: '学工部',
    publishDate: getPastDate(3),
    aiSummary: '主题月包含减压工作坊、团体辅导和心理咨询开放日，可按兴趣预约。',
    deadline: null,
    targetAudience: '全体在校学生',
    coreAction: '查看活动日历并预约感兴趣的场次',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-006',
    cleanContent: `
      <h3>活动内容</h3>
      <ul>
        <li>正念减压体验课</li>
        <li>睡眠管理专题工作坊</li>
        <li>人际沟通团体辅导</li>
        <li>心理中心开放日</li>
      </ul>
      <h3>预约说明</h3>
      <p>各场活动名额和报名时间不同，以预约系统显示为准。</p>
    `,
    attachments: [
      {
        name: '心理健康主题月活动日历.pdf',
        url: 'https://example.com/files/wellbeing-calendar.pdf',
      },
    ],
  },
  {
    id: 'campus-007',
    title: '国际组织与涉外机构专场招聘会',
    source: '国际合作与交流部',
    publishDate: getPastDate(6),
    aiSummary: '专场招聘会邀请国际组织、科研机构和跨国企业，提供全职、实习与志愿岗位。',
    deadline: getDate(11),
    targetAudience: '应届毕业生及有海外实习意向的学生',
    coreAction: '上传中英文简历并预约入场',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-007',
    cleanContent: `
      <h3>活动时间</h3>
      <p>${getDate(11)} 13:30-17:00，东区体育馆。</p>
      <h3>现场服务</h3>
      <ul>
        <li>中英文简历诊断</li>
        <li>国际组织胜任力咨询</li>
        <li>留学回国就业政策答疑</li>
      </ul>
    `,
    attachments: [
      { name: '参会机构与岗位清单.xlsx', url: 'https://example.com/files/global-jobs.xlsx' },
      { name: '双语简历检查清单.pdf', url: 'https://example.com/files/bilingual-cv.pdf' },
    ],
  },
  {
    id: 'campus-008',
    title: '近期失物招领信息汇总',
    source: '保卫处',
    publishDate: getPastDate(18),
    aiSummary: '',
    deadline: null,
    targetAudience: '全校师生',
    coreAction: '携带有效证件到对应值班点核验领取',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-008',
    cleanContent: `
      <h3>待认领物品</h3>
      <table>
        <tr><th>物品</th><th>拾取地点</th><th>保管点</th></tr>
        <tr><td>黑色双肩包</td><td>东区图书馆</td><td>东区门岗</td></tr>
        <tr><td>蓝牙耳机</td><td>西区食堂</td><td>西区保卫值班室</td></tr>
        <tr><td>校园卡</td><td>体育场</td><td>综合服务大厅</td></tr>
      </table>
      <p>领取时请说明物品特征，并出示有效证件。</p>
    `,
    attachments: [],
  },
  {
    id: 'campus-009',
    title: '图书逾期免罚归还周',
    source: '图书馆',
    publishDate: getPastDate(35),
    aiSummary: '逾期图书可在活动周内归还并申请免除滞纳金，遗失或损坏图书不在免罚范围。',
    deadline: getDate(5),
    targetAudience: '有逾期借阅记录的师生',
    coreAction: '在截止日前归还逾期图书',
    originUrl: 'https://www.ustc.edu.cn/notice/campus-009',
    cleanContent: `
      <h3>活动时间</h3>
      <p>${getPastDate(2)} 至 ${getDate(5)}。</p>
      <h3>办理方式</h3>
      <p>在自助还书机或服务台归还图书后，系统将在24小时内自动核销符合条件的费用。</p>
      <h3>不适用情形</h3>
      <p>图书遗失、污损以及馆际互借产生的费用不参与本次活动。</p>
    `,
    attachments: [
      {
        name: '图书逾期免罚归还周常见问题与各校区服务台开放时间.pdf',
        url: 'https://example.com/files/library-return-faq.pdf',
      },
    ],
  },

  // ===== 迎新特辑 =====
  {
    id: 'freshman-001',
    title: '新生入学须知（重要，请仔细阅读）',
    source: '本科生院',
    publishDate: getPastDate(1),
    aiSummary: '新生报到时间、地点、所需材料及注意事项汇总，请务必提前准备。',
    deadline: getDate(45),
    targetAudience: '全体新生',
    coreAction: '准备报到材料，关注迎新系统',
    originUrl: 'https://www.ustc.edu.cn/notice/011',
    cleanContent: `
      <h3>报到时间</h3>
      <p>${getDate(45)} 8:00-18:00</p>
      
      <h3>报到地点</h3>
      <p>各学院迎新点（详见录取通知书附图）</p>
      
      <h3>需携带材料</h3>
      <ul>
        <li>录取通知书原件</li>
        <li>身份证原件及复印件</li>
        <li>高考准考证</li>
        <li>一寸照片8张</li>
        <li>党团组织关系介绍信</li>
        <li>户口迁移证（如需迁户口）</li>
      </ul>
      
      <h3>缴费说明</h3>
      <p>学费、住宿费请通过随通知书寄送的银行卡代扣，或登录迎新系统在线缴费。</p>
    `,
    attachments: [
      { name: '新生入学手册.pdf', url: 'https://example.com/files/freshman-handbook.pdf' },
      { name: '校园地图.jpg', url: 'https://example.com/files/campus-map.jpg' },
      { name: '缴费指南.pdf', url: 'https://example.com/files/payment-guide.pdf' },
    ],
  },
  {
    id: 'freshman-002',
    title: '新生选课指导讲座',
    source: '教务处',
    publishDate: getPastDate(2),
    aiSummary: '专为新生举办的选课指导讲座，帮助了解课程体系和选课策略。',
    deadline: getDate(40),
    targetAudience: '全体新生',
    coreAction: '参加线上/线下选课指导讲座',
    originUrl: 'https://www.ustc.edu.cn/notice/012',
    cleanContent: `
      <h3>讲座安排</h3>
      <p>时间：${getDate(40)} 14:00-16:00</p>
      <p>地点：各学院指定教室（详见迎新系统）</p>
      <p>线上：B站直播（科大教务处官方账号）</p>
      
      <h3>讲座内容</h3>
      <ul>
        <li>本科培养方案解读</li>
        <li>课程体系介绍</li>
        <li>选课系统操作演示</li>
        <li>常见问题解答</li>
      </ul>
      
      <h3>互动环节</h3>
      <p>讲座最后30分钟为互动答疑时间，欢迎新生及家长提问。</p>
    `,
    attachments: [],
  },
  {
    id: 'freshman-003',
    title: '新生体检分批预约安排',
    source: '生命科学与医学部',
    publishDate: getPastDate(1),
    aiSummary: '新生体检按学院分批进行，请在三天内选择可参加的时段并填写健康信息。',
    deadline: getDate(3),
    targetAudience: '全体新生',
    coreAction: '填写健康信息并预约体检时段',
    originUrl: 'https://www.ustc.edu.cn/notice/freshman-003',
    cleanContent: `
      <h3>预约流程</h3>
      <ol>
        <li>登录迎新系统填写健康信息</li>
        <li>选择本学院开放的体检时段</li>
        <li>保存预约凭证并按时到场</li>
      </ol>
      <h3>体检须知</h3>
      <p>请携带身份证和校园卡，抽血项目要求空腹。</p>
    `,
    attachments: [
      { name: '新生体检流程图.png', url: 'https://example.com/files/freshman-checkup.png' },
    ],
  },
  {
    id: 'freshman-004',
    title: '新生宿舍入住与生活用品领取指南',
    source: '后勤保障处',
    publishDate: getPastDate(2),
    aiSummary: '宿舍楼栋和床位可在迎新系统查询，生活用品按预约时段集中领取。',
    deadline: getDate(15),
    targetAudience: '已完成住宿确认的新生',
    coreAction: '查询床位并预约生活用品领取时段',
    originUrl: 'https://www.ustc.edu.cn/notice/freshman-004',
    cleanContent: `
      <h3>入住办理</h3>
      <p>凭录取通知书和身份证到宿舍楼值班室领取钥匙及门禁卡。</p>
      <h3>用品领取</h3>
      <p>已订购生活用品的新生可在 ${getDate(15)} 前预约领取时段。</p>
      <h3>温馨提示</h3>
      <p>宿舍空间有限，请勿携带大功率电器。</p>
    `,
    attachments: [
      { name: '宿舍区平面图.pdf', url: 'https://example.com/files/dorm-map.pdf' },
      { name: '入住物品检查清单.pdf', url: 'https://example.com/files/move-in-checklist.pdf' },
    ],
  },
  {
    id: 'freshman-005',
    title: '新生绿色通道及奖助学金政策说明',
    source: '学工部',
    publishDate: getPastDate(4),
    aiSummary: '家庭经济困难新生可申请绿色通道缓缴学费，并同步办理助学贷款和困难认定。',
    deadline: getDate(20),
    targetAudience: '有资助需求的新生及家长',
    coreAction: '在迎新系统填写绿色通道申请',
    originUrl: 'https://www.ustc.edu.cn/notice/freshman-005',
    cleanContent: `
      <h3>绿色通道</h3>
      <p>学校确保每一位新生不因家庭经济困难而放弃入学，可先办理入学手续再完善资助材料。</p>
      <h3>资助项目</h3>
      <ul>
        <li>国家助学贷款</li>
        <li>国家助学金与校内困难补助</li>
        <li>勤工助学岗位</li>
      </ul>
    `,
    attachments: [
      { name: '学生资助政策简介.pdf', url: 'https://example.com/files/financial-aid.pdf' },
      { name: '家庭经济困难认定申请表.docx', url: 'https://example.com/files/aid-form.docx' },
    ],
  },
  {
    id: 'freshman-006',
    title: '新生安全教育学习与在线考试通知',
    source: '保卫处',
    publishDate: getPastDate(5),
    aiSummary: '新生须完成反诈、消防、交通和实验室安全课程，并通过在线考试。',
    deadline: getDate(10),
    targetAudience: '全体新生',
    coreAction: '完成四个学习模块并参加在线考试',
    originUrl: 'https://www.ustc.edu.cn/notice/freshman-006',
    cleanContent: `
      <h3>学习模块</h3>
      <ul>
        <li>电信网络诈骗识别</li>
        <li>宿舍消防与用电安全</li>
        <li>校园交通规则</li>
        <li>实验室基础安全</li>
      </ul>
      <h3>考试要求</h3>
      <p>考试满分100分，80分及以上为通过，可在 ${getDate(10)} 前重复作答。</p>
    `,
    attachments: [],
  },
]

/** 模拟获取通知列表的 API */
export function mockFetchNotices(params: {
  keyword?: string
  source?: string
  sources?: string[]
  dateFrom?: string
  dateTo?: string
  rangeFrom?: string
  rangeTo?: string
  hasDeadline?: boolean
  page?: number
  pageSize?: number
}): NoticeListResponse {
  const {
    keyword,
    source,
    sources,
    dateFrom,
    dateTo,
    rangeFrom,
    rangeTo,
    hasDeadline,
    page = 1,
    pageSize = 15,
  } = params

  let filtered = mockNotices

  if (keyword) {
    const query = keyword.toLocaleLowerCase()
    filtered = filtered.filter((notice) =>
      `${notice.title} ${notice.source} ${notice.aiSummary}`.toLocaleLowerCase().includes(query),
    )
  }
  if (source) filtered = filtered.filter((notice) => notice.source === source)
  if (sources) filtered = filtered.filter((notice) => sources.includes(notice.source))
  if (dateFrom) filtered = filtered.filter((notice) => notice.publishDate >= dateFrom)
  if (dateTo) filtered = filtered.filter((notice) => notice.publishDate <= dateTo)
  if (rangeFrom || rangeTo) {
    filtered = filtered.filter((notice) => {
      const dates = [notice.publishDate, notice.deadline].filter(
        (date): date is string => date !== null,
      )
      return dates.some(
        (date) => (!rangeFrom || date >= rangeFrom) && (!rangeTo || date <= rangeTo),
      )
    })
  }
  if (hasDeadline !== undefined) {
    filtered = filtered.filter((notice) => Boolean(notice.deadline) === hasDeadline)
  }

  filtered = [...filtered].sort(
    (a, b) => b.publishDate.localeCompare(a.publishDate) || a.id.localeCompare(b.id),
  )

  // 分页
  const start = (page - 1) * pageSize
  const items = filtered.slice(start, start + pageSize)

  return {
    items,
    total: filtered.length,
  }
}

/** 模拟获取单条通知详情的 API */
export function mockFetchNoticeById(id: string): NoticeItem | undefined {
  return mockNotices.find((n) => n.id === id)
}

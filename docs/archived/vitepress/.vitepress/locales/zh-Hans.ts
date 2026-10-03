import type {DefaultTheme} from "vitepress";

// 中文（root locale）导航与侧栏
export const zhNav: DefaultTheme.NavItem[] = [
  { text: '官网预览', link: '/official/' },
  { text: '文档首页', link: '/' },
  { text: '快速开始', link: '/quick-start' },
  { text: '教程', link: '/tutorials/' },
  { text: '核心能力', link: '/core/world-engine' },
  { text: '项目', link: '/projects/' },
  { text: '桌面版', link: '/desktop' },
  { text: '部署', link: '/deployment' },
  { text: '更新日志', link: '/changelog/' },
  { text: '理念', link: '/blog-agent-rp-harness' },
  { text: 'Agent', link: '/agent/' },
  { text: 'Profile', link: '/profile/' },
  {
    text: '宣传页',
    items: [
      { text: '评测实验室', link: '/promo/eval-lab/index.html' },
      { text: '进化实验室', link: '/promo/evolution-lab/index.html' },
      { text: '机制手册', link: '/promo/evolution-lab/mechanism.html' }
    ]
  },
  { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
]

export const zhSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '开始使用',
    items: [
      { text: '介绍', link: '/introduction' },
      { text: '快速开始', link: '/quick-start' }
    ]
  },
  {
    text: '基础教程',
    items: [
      { text: '总览', link: '/tutorials/' },
      { text: '开始前检查', link: '/tutorials/00-before-you-start' },
      { text: '认识工作台', link: '/tutorials/01-studio-tour' },
      { text: '创建第一本书', link: '/tutorials/02-first-project' },
      { text: '用 Skill 点燃故事', link: '/tutorials/03-skills-bootstrap' },
      { text: '写出前三章', link: '/tutorials/04-first-three-chapters' },
      { text: '导入角色卡', link: '/tutorials/05-import-character-card' }
    ]
  },
  {
    text: '核心能力',
    items: [
      { text: 'World Engine 世界引擎', link: '/core/world-engine' },
      { text: 'Plot 剧情工坊', link: '/core/plot-workbench' },
      { text: 'Markdown Studio', link: '/core/markdown-studio' },
      { text: 'llmlint 文风检查', link: '/core/llmlint' }
    ]
  },
  {
    text: '使用指南',
    items: [
      { text: '设置中心', link: '/guide/settings' },
      { text: '主题与配色', link: '/guide/theme' },
      { text: '变更与文件历史', link: '/guide/file-history' },
      { text: '账号与云备份', link: '/guide/account' }
    ]
  },
  {
    text: 'Agent',
    items: [
      { text: 'Agent 心智模型', link: '/agent/' },
      { text: '工具', link: '/agent/tools' },
      { text: 'Skill', link: '/agent/skills' },
      { text: 'Workflow 与 Job', link: '/agent/workflow' },
      { text: '三种模式', link: '/agent/modes' },
      { text: 'Agent Harness', link: '/agent/advanced' },
      { text: 'Subject RAG 记忆（历史系统）', link: '/agent/subject-rag-memory' }
    ]
  },
  {
    text: 'Profile',
    items: [
      { text: 'Profile 介绍', link: '/profile/' },
      { text: 'Leader', link: '/profile/leader' },
      { text: 'Writer', link: '/profile/writer' },
      { text: '其他 Profile', link: '/profile/other-profiles' }
    ]
  },
  {
    text: 'Profile TSX',
    items: [
      { text: 'Profile TSX 介绍', link: '/profile-tsx/' },
      { text: '从零写一个 Profile', link: '/profile-tsx/authoring' },
      { text: '节点说明', link: '/profile-tsx/nodes' },
      { text: '示例', link: '/profile-tsx/examples' }
    ]
  },
  {
    text: '部署与运维',
    items: [
      { text: '部署方式', link: '/deployment' },
      { text: '运行、数据与隐私', link: '/operations' },
      { text: '交付与运维桥梁', link: '/operator-bridge' }
    ]
  },
  {
    text: '项目与仓库',
    items: [
      { text: '项目总览', link: '/projects/' },
      { text: 'NeuroAgentHarness', link: '/projects/neuro-agent-harness' },
      { text: 'llmlint', link: '/projects/llmlint' },
      { text: 'nb-history', link: '/projects/nb-history' },
      { text: 'nb-workflow', link: '/projects/nb-workflow' },
      { text: 'nb-memory', link: '/projects/nb-memory' },
      { text: 'nb-ui', link: '/projects/nb-ui' },
      { text: '桌面版与 Manager', link: '/desktop' },
      { text: 'Monorepo 布局', link: '/monorepo' }
    ]
  },
  {
    text: '更新日志',
    items: [
      { text: '历史版本', link: '/changelog/' },
      { text: '0.8.x', link: '/changelog/v0.8' },
      { text: '0.7.x', link: '/changelog/v0.7' },
      { text: '0.5.x', link: '/changelog/v0.5' }
    ]
  },
  {
    text: '设计文章',
    items: [
      { text: 'Agent、创意写作与角色扮演', link: '/blog-agent-rp-harness' }
    ]
  }
]

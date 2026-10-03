import type {DefaultTheme} from "vitepress";

// 英文 locale 导航与侧栏。链接一律带 `/en` 前缀；canonical 源位于 `locales/en-US/`。
export const enNav: DefaultTheme.NavItem[] = [
  { text: 'Website', link: '/official/en/' },
  { text: 'Docs Home', link: '/en/' },
  { text: 'Quick Start', link: '/en/quick-start' },
  { text: 'Tutorials', link: '/en/tutorials/' },
  { text: 'Core', link: '/en/core/world-engine' },
  { text: 'Projects', link: '/en/projects/' },
  { text: 'Desktop', link: '/en/desktop' },
  { text: 'Deployment', link: '/en/deployment' },
  { text: 'Changelog', link: '/en/changelog/' },
  { text: 'Concepts', link: '/en/blog-agent-rp-harness' },
  { text: 'Agent', link: '/en/agent/' },
  { text: 'Profile', link: '/en/profile/' },
  {
    text: 'Promo',
    items: [
      { text: 'Evaluation Lab', link: '/en/promo/eval-lab/index.html' },
      { text: 'Evolution Lab', link: '/en/promo/evolution-lab/index.html' },
      { text: 'Mechanism Handbook', link: '/en/promo/evolution-lab/mechanism.html' }
    ]
  },
  { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
]

export const enSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Introduction', link: '/en/introduction' },
      { text: 'Quick Start', link: '/en/quick-start' }
    ]
  },
  {
    text: 'Tutorials',
    items: [
      { text: 'Overview', link: '/en/tutorials/' },
      { text: 'Before You Start', link: '/en/tutorials/00-before-you-start' },
      { text: 'Tour of the Studio', link: '/en/tutorials/01-studio-tour' },
      { text: 'Create Your First Book', link: '/en/tutorials/02-first-project' },
      { text: 'Ignite the Story with Skills', link: '/en/tutorials/03-skills-bootstrap' },
      { text: 'Write the First Three Chapters', link: '/en/tutorials/04-first-three-chapters' },
      { text: 'Import a Character Card', link: '/en/tutorials/05-import-character-card' }
    ]
  },
  {
    text: 'Core Capabilities',
    items: [
      { text: 'World Engine', link: '/en/core/world-engine' },
      { text: 'Plot Workbench', link: '/en/core/plot-workbench' },
      { text: 'Markdown Studio', link: '/en/core/markdown-studio' },
      { text: 'llmlint Prose Linting', link: '/en/core/llmlint' }
    ]
  },
  {
    text: 'Guides',
    items: [
      { text: 'Settings', link: '/en/guide/settings' },
      { text: 'Themes and Colors', link: '/en/guide/theme' },
      { text: 'Changes and File History', link: '/en/guide/file-history' },
      { text: 'Account and Cloud Backup', link: '/en/guide/account' }
    ]
  },
  {
    text: 'Agent',
    items: [
      { text: 'Mental Model', link: '/en/agent/' },
      { text: 'Tools', link: '/en/agent/tools' },
      { text: 'Skills', link: '/en/agent/skills' },
      { text: 'Workflows and Jobs', link: '/en/agent/workflow' },
      { text: 'Three Modes', link: '/en/agent/modes' },
      { text: 'Agent Harness', link: '/en/agent/advanced' },
      { text: 'Subject RAG Memory (legacy)', link: '/en/agent/subject-rag-memory' }
    ]
  },
  {
    text: 'Profile',
    items: [
      { text: 'What Is a Profile', link: '/en/profile/' },
      { text: 'Leader', link: '/en/profile/leader' },
      { text: 'Writer', link: '/en/profile/writer' },
      { text: 'Other Profiles', link: '/en/profile/other-profiles' }
    ]
  },
  {
    text: 'Profile TSX',
    items: [
      { text: 'Introduction', link: '/en/profile-tsx/' },
      { text: 'Write a Profile from Scratch', link: '/en/profile-tsx/authoring' },
      { text: 'Node Reference', link: '/en/profile-tsx/nodes' },
      { text: 'Examples', link: '/en/profile-tsx/examples' }
    ]
  },
  {
    text: 'Deployment and Operations',
    items: [
      { text: 'Deployment', link: '/en/deployment' },
      { text: 'Running, Data and Privacy', link: '/en/operations' },
      { text: 'Operator Bridge', link: '/en/operator-bridge' }
    ]
  },
  {
    text: 'Projects and Repository',
    items: [
      { text: 'Projects', link: '/en/projects/' },
      { text: 'NeuroAgentHarness', link: '/en/projects/neuro-agent-harness' },
      { text: 'llmlint', link: '/en/projects/llmlint' },
      { text: 'nb-history', link: '/en/projects/nb-history' },
      { text: 'nb-workflow', link: '/en/projects/nb-workflow' },
      { text: 'nb-memory', link: '/en/projects/nb-memory' },
      { text: 'nb-ui', link: '/en/projects/nb-ui' },
      { text: 'Desktop and Manager', link: '/en/desktop' },
      { text: 'Monorepo Layout', link: '/en/monorepo' }
    ]
  },
  {
    text: 'Release Notes',
    items: [
      { text: 'Release History', link: '/en/changelog/' },
      { text: '0.8.x', link: '/en/changelog/v0.8' },
      { text: '0.7.x', link: '/en/changelog/v0.7' },
      { text: '0.5.x', link: '/en/changelog/v0.5' }
    ]
  },
  {
    text: 'Design Notes',
    items: [
      { text: 'Agents, Creative Writing and Roleplay', link: '/en/blog-agent-rp-harness' }
    ]
  }
]

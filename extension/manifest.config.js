const WHITELIST_MATCHES = [
  'https://meet.google.com/*',
  'https://*.zoom.us/*',
  'https://teams.microsoft.com/*',
]

export default {
  manifest_version: 3,
  name: 'B2B Realtime Coach',
  version: '1.0.0',
  description: 'Assistant commercial en temps reel (objections, battle cards, scoring live).',
  action: {
    default_popup: 'index.html',
    default_title: 'B2B Coach',
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  background: {
    service_worker: 'src/background.js',
    type: 'module',
  },
  permissions: ['storage', 'tabs', 'tabCapture', 'offscreen', 'activeTab', 'scripting', 'sidePanel'],
  host_permissions: [...WHITELIST_MATCHES, 'https://*.supabase.co/*'],
  content_scripts: [
    {
      matches: WHITELIST_MATCHES,
      js: ['src/content.jsx'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['offscreen.html'],
      matches: ['<all_urls>'],
    },
  ],
} 

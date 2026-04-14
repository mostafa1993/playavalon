'use client';

import { Users, Settings, Eye, GitBranch } from 'lucide-react';
import { RULEBOOK_TABS, type RulebookTabId } from '@/lib/domain/rulebook-content';

const TAB_ICONS: Record<RulebookTabId, React.ReactNode> = {
  roles: <Users size={18} />,
  modes: <Settings size={18} />,
  visual: <Eye size={18} />,
  flow: <GitBranch size={18} />,
};

interface RulebookTabsProps {
  activeTab: RulebookTabId;
  onTabChange: (tabId: RulebookTabId) => void;
}

/**
 * Tab navigation component for the rulebook
 * Implements WAI-ARIA tab pattern for accessibility
 */
export function RulebookTabs({ activeTab, onTabChange }: RulebookTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Rulebook sections"
      className="flex gap-1 overflow-x-auto pb-2 border-b border-avalon-silver/20 scrollbar-hide"
    >
      {RULEBOOK_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2
              font-medium text-sm whitespace-nowrap
              transition-all duration-200
              outline-none focus:outline-none focus-visible:outline-none
              ${isActive
                ? 'text-avalon-gold'
                : 'text-avalon-text-muted hover:text-avalon-text-secondary'
              }
            `}
          >
            <span>{TAB_ICONS[tab.id]}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}


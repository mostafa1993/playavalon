'use client';

import { useState } from 'react';
import { RulebookTabs } from './RulebookTabs';
import { RolesTab } from './RolesTab';
import { GameModesTab } from './GameModesTab';
import { VisualGuideTab } from './VisualGuideTab';
import { GameFlowTab } from './GameFlowTab';
import { BookOpen } from 'lucide-react';
import type { RulebookTabId } from '@/lib/domain/rulebook-content';

interface RulebookContentProps {
  /** Initial tab to display */
  initialTab?: RulebookTabId;
  /** Whether to show compact styling (for modal) */
  compact?: boolean;
}

/**
 * Shared rulebook content component
 * Used by both the dedicated /rules page and the in-game modal
 */
export function RulebookContent({ initialTab = 'roles', compact = false }: RulebookContentProps) {
  const [activeTab, setActiveTab] = useState<RulebookTabId>(initialTab);

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Header (only show on non-compact/page view) */}
      {!compact && (
        <div className="text-center space-y-2 mb-8">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-avalon-gold">
            <BookOpen size={16} className="inline" /> Rulebook
          </h1>
          <p className="text-avalon-text-muted max-w-lg mx-auto">
            Everything you need to know about playing Avalon Online
          </p>
        </div>
      )}

      {/* Tab Navigation */}
      <RulebookTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      <div className={compact ? 'min-h-[300px]' : 'min-h-[400px]'}>
        {activeTab === 'roles' && <RolesTab />}
        {activeTab === 'modes' && <GameModesTab />}
        {activeTab === 'visual' && <VisualGuideTab />}
        {activeTab === 'flow' && <GameFlowTab />}
      </div>
    </div>
  );
}

